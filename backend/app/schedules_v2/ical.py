"""
schedules_v2 — iCal(RFC 5545) export
Phase 4-A: 캠프 전용 캘린더 구독 피드.

엔드포인트:
  GET /api/ical/{token}.ics    — 공개 (인증 없음, 토큰 기반)

사용자 흐름:
  1. 캠프가 /settings에서 "캘린더 구독 URL 발급" 클릭
  2. 서버가 UUID 토큰 생성, tenants.ical_token 저장
  3. 반환된 https://ai.on1.kr/api/ical/{token}.ics 를 Google/Apple Calendar에 등록
  4. 클라이언트는 5~15분마다 자동 refresh
"""
import uuid
from datetime import datetime, timezone
from io import StringIO

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy import text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.common.dependencies import CurrentUser

router = APIRouter()


def _escape_ical(s: str) -> str:
    """RFC 5545 TEXT 이스케이프: ; , \\ → \\;, \\, \\\\ / 개행 → \\n"""
    if not s:
        return ""
    return (
        s.replace("\\", "\\\\")
         .replace(";", "\\;")
         .replace(",", "\\,")
         .replace("\n", "\\n")
         .replace("\r", "")
    )


def _fold_line(line: str) -> str:
    """RFC 5545 line folding (75 octets per line)."""
    if len(line) <= 75:
        return line
    out = [line[:75]]
    rest = line[75:]
    while rest:
        out.append(" " + rest[:74])  # continuation: space + 74
        rest = rest[74:]
    return "\r\n".join(out)


def _fmt_dt(dt: datetime) -> str:
    """UTC ISO → 20260430T140000Z"""
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _fmt_date(dt: datetime) -> str:
    """YYYYMMDD (all-day)"""
    return dt.strftime("%Y%m%d")


async def generate_ical(db: AsyncSession, tenant_id: str) -> str:
    """tenant의 모든 election 일정을 iCal 문자열로 생성."""
    rows = (await db.execute(sql_text("""
        SELECT cs.id::text AS id, cs.title, cs.description, cs.location,
               cs.admin_sigungu, cs.admin_dong,
               cs.starts_at, cs.ends_at, cs.all_day,
               cs.category, cs.visibility, cs.status,
               cs.result_summary, cs.attended_count,
               cs.recurrence_rule, cs.updated_at,
               COALESCE(el.name, '') AS election_name
          FROM candidate_schedules cs
          LEFT JOIN elections el ON el.id = cs.election_id
         WHERE cs.tenant_id = cast(:tid as uuid)
           AND cs.status != 'canceled'
           AND cs.parent_schedule_id IS NULL  -- RRULE 확장 인스턴스는 iCal RRULE로 표현
         ORDER BY cs.starts_at ASC
    """), {"tid": tenant_id})).mappings().all()

    dtstamp = _fmt_dt(datetime.now(timezone.utc))

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//ElectionPulse//Candidate Schedules//KO",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:ElectionPulse 후보자 일정",
        "X-WR-TIMEZONE:Asia/Seoul",
    ]

    for r in rows:
        uid = f"{r['id']}@electionpulse"
        starts = r["starts_at"]
        ends = r["ends_at"]

        # DESCRIPTION 조합
        desc_parts = []
        if r["election_name"]:
            desc_parts.append(f"선거: {r['election_name']}")
        if r["category"]:
            desc_parts.append(f"분류: {r['category']}")
        desc_parts.append(f"상태: {r['status']}")
        if r["visibility"] == "public":
            desc_parts.append("(홈페이지 공개)")
        if r["result_summary"]:
            desc_parts.append(f"결과: {r['result_summary']}")
        if r["attended_count"]:
            desc_parts.append(f"참석: {r['attended_count']}명")
        if r["description"]:
            desc_parts.append("")
            desc_parts.append(r["description"])
        description = "\n".join(desc_parts)

        location_parts = []
        if r["location"]:
            location_parts.append(r["location"])
        if r["admin_sigungu"] and r["admin_dong"]:
            location_parts.append(f"({r['admin_sigungu']} {r['admin_dong']})")
        location = " ".join(location_parts) if location_parts else ""

        lines.append("BEGIN:VEVENT")
        lines.append(_fold_line(f"UID:{uid}"))
        lines.append(f"DTSTAMP:{dtstamp}")
        if r["updated_at"]:
            lines.append(f"LAST-MODIFIED:{_fmt_dt(r['updated_at'])}")

        if r["all_day"]:
            lines.append(f"DTSTART;VALUE=DATE:{_fmt_date(starts)}")
            # iCal 관습: 종료일은 +1일 (exclusive)
            end_date = ends if ends else starts
            lines.append(f"DTEND;VALUE=DATE:{_fmt_date(end_date)}")
        else:
            lines.append(f"DTSTART:{_fmt_dt(starts)}")
            lines.append(f"DTEND:{_fmt_dt(ends)}")

        lines.append(_fold_line(f"SUMMARY:{_escape_ical(r['title'])}"))
        if location:
            lines.append(_fold_line(f"LOCATION:{_escape_ical(location)}"))
        if description:
            lines.append(_fold_line(f"DESCRIPTION:{_escape_ical(description)}"))

        # RRULE 있으면 그대로 포함 (이미 RFC 5545 형식)
        if r["recurrence_rule"]:
            lines.append(f"RRULE:{r['recurrence_rule']}")

        # 완료 일정은 CONFIRMED, 예정은 TENTATIVE
        status_map = {"planned": "TENTATIVE", "in_progress": "CONFIRMED", "done": "CONFIRMED"}
        lines.append(f"STATUS:{status_map.get(r['status'], 'TENTATIVE')}")
        lines.append("END:VEVENT")

    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


@router.get("/ical/{token}.ics", response_class=PlainTextResponse)
async def ical_feed(token: str, db: AsyncSession = Depends(get_db)):
    """공개 iCal 피드 — 토큰 기반 인증."""
    if not token or len(token) < 20:
        raise HTTPException(status_code=404)

    row = (await db.execute(sql_text(
        "SELECT id FROM tenants WHERE ical_token = :t AND is_active = true"
    ), {"t": token})).first()

    if not row:
        raise HTTPException(status_code=404)

    tenant_id = str(row.id)
    ical_text = await generate_ical(db, tenant_id)

    return PlainTextResponse(
        content=ical_text,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": 'inline; filename="candidate-schedules.ics"',
            # 클라이언트가 너무 자주 refresh 하지 않게
            "Cache-Control": "public, max-age=300",
        },
    )


# ── 토큰 관리 (인증 필요) ──────────────────────────────────────────

@router.post("/ical/issue-token")
async def issue_ical_token(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """캠프 전용 iCal 구독 URL 발급/재발급 (기존 토큰 즉시 무효화)."""
    tid = user.get("tenant_id")
    if not tid:
        raise HTTPException(403, "No tenant")

    new_token = uuid.uuid4().hex + uuid.uuid4().hex  # 64자 (128 bit entropy × 2)
    await db.execute(
        sql_text("UPDATE tenants SET ical_token = :t WHERE id = cast(:tid as uuid)"),
        {"t": new_token, "tid": str(tid)},
    )
    await db.commit()
    return {"token": new_token, "ical_url_path": f"/api/ical/{new_token}.ics"}


@router.delete("/ical/token")
async def revoke_ical_token(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """iCal 구독 토큰 폐기."""
    tid = user.get("tenant_id")
    if not tid:
        raise HTTPException(403, "No tenant")
    await db.execute(
        sql_text("UPDATE tenants SET ical_token = NULL WHERE id = cast(:tid as uuid)"),
        {"tid": str(tid)},
    )
    await db.commit()
    return {"revoked": True}


@router.get("/ical/my-token")
async def my_ical_token(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """현재 캠프 iCal 토큰 조회 (있으면)."""
    tid = user.get("tenant_id")
    if not tid:
        raise HTTPException(403, "No tenant")
    row = (await db.execute(
        sql_text("SELECT ical_token FROM tenants WHERE id = cast(:tid as uuid)"),
        {"tid": str(tid)},
    )).first()
    if not row or not row.ical_token:
        return {"token": None, "ical_url_path": None}
    return {"token": row.ical_token, "ical_url_path": f"/api/ical/{row.ical_token}.ics"}
