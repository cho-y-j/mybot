"""
ElectionPulse — 홈페이지 자동 채우기.

신규 가입 캠프(또는 backfill)가 호출하면, mybot이 이미 수집·분석한 데이터로
homepage 모든 섹션을 자동 INSERT.

채우는 범위:
1. SiteSetting: 정당별 컬러, 이름/직함/지역, 선거 D-Day, Hero 슬로건
2. Profile:     CandidateProfile.education/career → profiles row들
3. Pledge:      CandidateProfile.pledges_nec → pledges row들 + 아이콘 자동 매칭
4. Schedule:    선거 법정 일정 (공고/사전투표/본투표/선거일)
5. Block(intro): AI 3문단 후보 소개

사용자가 나중에 다 수정 가능 — 이 함수는 "빈 공간 대신 합리적 기본값"만.
"""
from datetime import date, timedelta
import json
import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger()


# ─── 정당별 컬러 팔레트 (한국 선거 표준) ──────────────────────
PARTY_COLORS = {
    # 정당명 → (primary, accent)
    "민주당": ("#004EA2", "#00A88F"),
    "더불어민주당": ("#004EA2", "#00A88F"),
    "국민의힘": ("#E61E2B", "#004EA2"),
    "국힘": ("#E61E2B", "#004EA2"),
    "개혁신당": ("#FF7210", "#374151"),
    "조국혁신당": ("#06275E", "#E61E2B"),
    "정의당": ("#FFCC00", "#374151"),
    "녹색당": ("#3CB371", "#374151"),
    "진보당": ("#D6001C", "#374151"),
}
ALIGNMENT_COLORS = {
    "progressive": ("#004EA2", "#00A88F"),
    "conservative": ("#E61E2B", "#004EA2"),
    "centrist": ("#FF7210", "#374151"),
    "independent": ("#374151", "#6B7280"),
}


def resolve_colors(party: str | None, alignment: str | None) -> tuple[str, str]:
    if party:
        for key, colors in PARTY_COLORS.items():
            if key in party:
                return colors
    if alignment and alignment in ALIGNMENT_COLORS:
        return ALIGNMENT_COLORS[alignment]
    return ("#374151", "#6B7280")


# ─── 공약 아이콘 자동 매칭 ───────────────────────────────────
PLEDGE_ICONS = [
    ("교육", "fas fa-graduation-cap"),
    ("학생", "fas fa-graduation-cap"),
    ("학교", "fas fa-school"),
    ("안전", "fas fa-shield-alt"),
    ("치안", "fas fa-shield-alt"),
    ("경제", "fas fa-chart-line"),
    ("일자리", "fas fa-briefcase"),
    ("복지", "fas fa-hand-holding-heart"),
    ("청년", "fas fa-users"),
    ("노인", "fas fa-user-friends"),
    ("환경", "fas fa-leaf"),
    ("녹색", "fas fa-leaf"),
    ("교통", "fas fa-bus"),
    ("주거", "fas fa-home"),
    ("주택", "fas fa-home"),
    ("문화", "fas fa-theater-masks"),
    ("체육", "fas fa-running"),
    ("농업", "fas fa-tractor"),
    ("어업", "fas fa-fish"),
    ("의료", "fas fa-hospital"),
    ("보건", "fas fa-hospital"),
    ("육아", "fas fa-baby"),
    ("여성", "fas fa-venus"),
]


def icon_for_pledge(title: str, description: str = "") -> str:
    text_blob = f"{title} {description}"
    for kw, icon in PLEDGE_ICONS:
        if kw in text_blob:
            return icon
    return "fas fa-bullhorn"


# ─── 선거 법정 일정 템플릿 ───────────────────────────────────
def election_schedule_items(election_date: date, election_type: str) -> list[dict]:
    """선거일 기준 법정 일정 자동 생성 (공직선거법 기준)."""
    if not election_date:
        return []
    items = [
        {
            "title": "사전투표",
            "event_date": election_date - timedelta(days=5),
            "end_date": election_date - timedelta(days=4),
            "location": "전국 사전투표소",
            "description": "오전 6시 ~ 오후 6시",
        },
        {
            "title": f"{'교육감' if election_type == 'superintendent' else '공식'} 선거일",
            "event_date": election_date,
            "location": "본인 투표소",
            "description": "오전 6시 ~ 오후 6시",
        },
    ]
    return items


async def auto_fill_homepage(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    homepage_user_id: int,
) -> dict:
    """homepage User에 대한 모든 섹션 자동 INSERT.

    반환: 섹션별 처리 건수
    """
    result = {"site_setting": 0, "profiles": 0, "pledges": 0, "schedules": 0, "blocks": 0}

    # 0. 캠프 핵심 데이터 로드
    cand_row = (await db.execute(text("""
        SELECT c.id, c.name, c.party, c.party_alignment, c.role, c.photo_url, c.career_summary,
               e.name as election_name, e.election_type, e.election_date, e.region_sido, e.region_sigungu
        FROM candidates c
        JOIN elections e ON e.id = c.election_id
        JOIN tenant_elections te ON te.election_id = e.id AND te.our_candidate_id = c.id
        WHERE te.tenant_id = cast(:tid as uuid) AND e.id = cast(:eid as uuid)
        LIMIT 1
    """), {"tid": tenant_id, "eid": election_id})).first()

    if not cand_row:
        logger.warning("autofill_no_candidate", tenant=tenant_id, election=election_id)
        return result

    cand_id = cand_row[0]
    name, party, alignment, role, photo_url, career_summary = (
        cand_row[1], cand_row[2], cand_row[3], cand_row[4], cand_row[5], cand_row[6]
    )
    election_name, election_type, election_date = cand_row[7], cand_row[8], cand_row[9]
    region_sido, region_sigungu = cand_row[10], cand_row[11]

    profile_row = (await db.execute(text("""
        SELECT education, career, pledges_nec
        FROM candidate_profiles WHERE candidate_id = :cid
    """), {"cid": cand_id})).first()
    education, career, pledges_nec = (
        profile_row[0] if profile_row else None,
        profile_row[1] if profile_row else None,
        profile_row[2] if profile_row else None,
    )

    primary, accent = resolve_colors(party, alignment)
    region_text = f"{region_sido or ''} {region_sigungu or ''}".strip()
    type_label = {
        "superintendent": "교육감", "governor": "도지사", "mayor": "시장",
        "congressional": "국회의원", "council": "의원",
    }.get(election_type, "후보")
    position_title = f"{region_text} {type_label} 예비후보"

    # 1. SiteSetting (upsert)
    existing = (await db.execute(text(
        "SELECT id FROM homepage.site_settings WHERE user_id = :uid"
    ), {"uid": homepage_user_id})).first()

    subtitle = (career_summary or "")[:200] if career_summary else None
    default_slogan = f"{region_text}을 바꾸는 {name}"

    if existing:
        await db.execute(text("""
            UPDATE homepage.site_settings SET
                party_name = :party, position_title = :pos, subtitle = :subt,
                hero_slogan = COALESCE(hero_slogan, :slogan),
                profile_image_url = COALESCE(profile_image_url, :photo),
                primary_color = :primary, accent_color = :accent,
                election_date = :edate, election_name = :ename,
                updated_at = NOW()
            WHERE user_id = :uid
        """), {
            "uid": homepage_user_id, "party": party, "pos": position_title,
            "subt": subtitle, "slogan": default_slogan,
            "photo": photo_url, "primary": primary, "accent": accent,
            "edate": election_date, "ename": election_name,
        })
    else:
        await db.execute(text("""
            INSERT INTO homepage.site_settings
                (user_id, party_name, position_title, subtitle, hero_slogan,
                 profile_image_url, primary_color, accent_color,
                 election_date, election_name, updated_at)
            VALUES (:uid, :party, :pos, :subt, :slogan,
                    :photo, :primary, :accent, :edate, :ename, NOW())
        """), {
            "uid": homepage_user_id, "party": party, "pos": position_title,
            "subt": subtitle, "slogan": default_slogan,
            "photo": photo_url, "primary": primary, "accent": accent,
            "edate": election_date, "ename": election_name,
        })
    result["site_setting"] = 1

    # 2. Profiles: education + career (기존 없을 때만)
    prof_count = (await db.execute(text(
        "SELECT COUNT(*) FROM homepage.profiles WHERE user_id = :uid"
    ), {"uid": homepage_user_id})).scalar() or 0

    if prof_count == 0:
        idx = 0
        if education:
            for line in [l.strip() for l in education.split("\n") if l.strip()][:10]:
                await db.execute(text("""
                    INSERT INTO homepage.profiles (user_id, type, title, is_current, sort_order, created_at)
                    VALUES (:uid, 'education', :title, false, :so, NOW())
                """), {"uid": homepage_user_id, "title": line[:200], "so": idx})
                idx += 1
                result["profiles"] += 1
        idx = 0
        if career:
            for line in [l.strip() for l in career.split("\n") if l.strip()][:15]:
                await db.execute(text("""
                    INSERT INTO homepage.profiles (user_id, type, title, is_current, sort_order, created_at)
                    VALUES (:uid, 'career', :title, :curr, :so, NOW())
                """), {
                    "uid": homepage_user_id, "title": line[:200],
                    "curr": idx == 0, "so": idx,
                })
                idx += 1
                result["profiles"] += 1

    # 3. Pledges (기존 없을 때만)
    pl_count = (await db.execute(text(
        "SELECT COUNT(*) FROM homepage.pledges WHERE user_id = :uid"
    ), {"uid": homepage_user_id})).scalar() or 0

    if pl_count == 0 and pledges_nec:
        items = pledges_nec if isinstance(pledges_nec, list) else []
        for i, p in enumerate(items[:7]):
            if isinstance(p, dict):
                title = (p.get("title") or p.get("subject") or "")[:200]
                desc = (p.get("description") or p.get("summary") or p.get("content") or "")
                details = p.get("details") or []
            else:
                title = str(p)[:200]
                desc = ""
                details = []
            if not title:
                continue
            icon = icon_for_pledge(title, desc)
            await db.execute(text("""
                INSERT INTO homepage.pledges (user_id, icon, title, description, details, sort_order, created_at)
                VALUES (:uid, :icon, :title, :desc, cast(:details as jsonb), :so, NOW())
            """), {
                "uid": homepage_user_id, "icon": icon, "title": title,
                "desc": desc[:1000] if desc else None,
                "details": json.dumps(details if isinstance(details, list) else [], ensure_ascii=False),
                "so": i,
            })
            result["pledges"] += 1

    # 4. Schedules (선거 법정 일정)
    sch_count = (await db.execute(text(
        "SELECT COUNT(*) FROM homepage.schedules WHERE user_id = :uid"
    ), {"uid": homepage_user_id})).scalar() or 0

    if sch_count == 0 and election_date:
        for i, ev in enumerate(election_schedule_items(election_date, election_type)):
            await db.execute(text("""
                INSERT INTO homepage.schedules
                    (user_id, title, date, time, location, sort_order, created_at)
                VALUES (:uid, :title, :dt, :tm, :loc, :so, NOW())
            """), {
                "uid": homepage_user_id, "title": ev["title"],
                "dt": ev["event_date"],
                "tm": (ev.get("description") or "")[:10] or None,
                "loc": ev.get("location"), "so": i,
            })
            result["schedules"] += 1

    # 5. Blocks — 기본 섹션 세트 (hero, intro, goals, schedule, news 등) 한 번만
    # 템플릿이 blocks 기반 렌더링이라 섹션이 없으면 빈 화면. 기본 순서 고정 + visible=true.
    blk_count = (await db.execute(text(
        "SELECT COUNT(*) FROM homepage.blocks WHERE user_id = :uid"
    ), {"uid": homepage_user_id})).scalar() or 0

    if blk_count == 0:
        intro_text = await _generate_intro(
            name=name, party=party, region=region_text, type_label=type_label,
            education=education, career=career, tenant_id=tenant_id, db=db,
        )
        default_blocks = [
            ("hero", None, None),
            ("keywords", None, None),
            ("intro", f"{name} 후보 소개",
             json.dumps({"text": intro_text or ""}, ensure_ascii=False) if intro_text else None),
            ("goals", "공약", None),
            ("schedule", "일정", None),
            ("news", "관련 기사", None),
            ("videos", "영상", None),
            ("gallery", "활동", None),
            ("contacts", "연락처", None),
        ]
        for i, (btype, btitle, bcontent) in enumerate(default_blocks, 1):
            await db.execute(text("""
                INSERT INTO homepage.blocks (user_id, type, title, content, visible, sort_order, created_at, updated_at)
                VALUES (:uid, :bt, :btitle, cast(:content as jsonb), true, :so, NOW(), NOW())
            """), {
                "uid": homepage_user_id, "bt": btype, "btitle": btitle,
                "content": bcontent, "so": i,
            })
            result["blocks"] += 1

    logger.info("autofill_homepage_done", tenant=tenant_id, election=election_id, result=result)
    return result


async def _generate_intro(
    *, name: str, party: str | None, region: str, type_label: str,
    education: str | None, career: str | None,
    tenant_id: str, db: AsyncSession,
) -> str | None:
    """AI로 3문단 후보 소개문 생성."""
    try:
        from app.services.ai_service import call_claude_text
        prompt = f"""다음 {region} {type_label} 예비후보의 공식 소개문을 3문단으로 작성하세요.

이름: {name}
정당: {party or '무소속'}
학력: {(education or '')[:500]}
경력: {(career or '')[:800]}

조건:
- 1문단: 출생/성장/학력 간략
- 2문단: 주요 경력과 성과
- 3문단: {region}을 위한 비전 1문장
- 과장 금지, 사실 기반, 300~450자
- 존댓말 서술체 (~입니다)
- 공직선거법 준수 — 비방/허위 금지
"""
        res = await call_claude_text(prompt, timeout=60, model_tier="standard",
                                     context="homepage_intro", tenant_id=tenant_id, db=db)
        if res and len(res.strip()) > 50:
            return res.strip()[:1500]
    except Exception as e:
        logger.warning("autofill_intro_failed", error=str(e)[:200])
    return None
