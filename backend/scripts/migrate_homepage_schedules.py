"""
homepage.schedules → public.candidate_schedules 마이그레이션.
2026-04-21 Phase 2-D.

규칙:
  - homepage.users.code ↔ homepage.schedules.user_id
  - homepage.users.election_id 로 mybot election_id 매핑
  - candidate_id: 해당 election의 우리 후보 (tenant_elections.our_candidate_id 또는 candidates.is_our_candidate)
  - time 필드 파싱:
      "HH:MM"            → 해당 시각 시작 + 2시간
      "오전 N시 ~ 오후"  → all_day=true (06:00~18:00)
      기타              → all_day=true
  - visibility: 'public' (투표·선거일 일정은 캠프가 지지자에게 알리는 용도)
  - category: 제목 키워드 매칭 ("투표"/"선거일" → voting)
  - 중복 방지: UNIQUE (election_id, title, starts_at)

실행:
  docker exec ep_backend python backend/scripts/migrate_homepage_schedules.py --dry-run
  docker exec ep_backend python backend/scripts/migrate_homepage_schedules.py --execute
"""
import argparse
import re
import sys
import uuid
from datetime import datetime, timezone, timedelta, date

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.config import get_settings

KST = timezone(timedelta(hours=9))
settings = get_settings()

SYNC_URL = settings.DATABASE_URL.replace("+asyncpg", "+psycopg2")
engine = create_engine(SYNC_URL, pool_pre_ping=True)


def parse_time_field(time_str: str | None, d: date) -> tuple[datetime, datetime, bool]:
    """time 텍스트 파싱 → (starts_at, ends_at, all_day).

    입력:
      "06:00" / "14:30"        → 해당 시각 ~ +2시간
      "오전 6시 ~ 오후"         → all_day (06:00~18:00)
      "오전 N시" / "오후 N시"   → 해당 시각 ~ +2시간
      None / 기타              → all_day (09:00~18:00)
    """
    if not time_str:
        s = datetime.combine(d, datetime.min.time().replace(hour=9), tzinfo=KST)
        e = datetime.combine(d, datetime.min.time().replace(hour=18), tzinfo=KST)
        return s.astimezone(timezone.utc), e.astimezone(timezone.utc), True

    t = time_str.strip()

    # "HH:MM"
    m = re.match(r"^(\d{1,2}):(\d{2})$", t)
    if m:
        h, mm = int(m.group(1)), int(m.group(2))
        s = datetime.combine(d, datetime.min.time().replace(hour=h, minute=mm), tzinfo=KST)
        e = s + timedelta(hours=2)
        return s.astimezone(timezone.utc), e.astimezone(timezone.utc), False

    # "오전 N시" / "오후 N시" (단일 시각)
    m = re.search(r"(오전|오후)\s*(\d{1,2})\s*시(?!\s*~)", t)
    if m and "~" not in t:
        ampm, h = m.group(1), int(m.group(2))
        if ampm == "오후" and h != 12:
            h += 12
        s = datetime.combine(d, datetime.min.time().replace(hour=h), tzinfo=KST)
        e = s + timedelta(hours=2)
        return s.astimezone(timezone.utc), e.astimezone(timezone.utc), False

    # "오전 N시 ~ 오후" / 범위 (all_day로 처리)
    s = datetime.combine(d, datetime.min.time().replace(hour=6), tzinfo=KST)
    e = datetime.combine(d, datetime.min.time().replace(hour=18), tzinfo=KST)
    return s.astimezone(timezone.utc), e.astimezone(timezone.utc), True


def pick_category(title: str) -> str:
    """제목 키워드 → category enum."""
    t = title or ""
    if "투표" in t or "선거일" in t or "개표" in t:
        return "voting"
    if "유세" in t or "집회" in t:
        return "rally"
    if "인사" in t:
        return "street"
    if "토론" in t or "간담" in t:
        return "debate"
    if "방송" in t:
        return "broadcast"
    if "인터뷰" in t or "취재" in t:
        return "interview"
    if "회의" in t:
        return "meeting"
    if "후원" in t or "지지" in t or "당원" in t:
        return "supporter"
    return "other"


def migrate(dry_run: bool = True) -> dict:
    stats = {"total": 0, "skipped_no_election": 0, "skipped_no_candidate": 0, "skipped_duplicate": 0, "inserted": 0}

    with Session(engine) as sess:
        rows = sess.execute(text("""
            SELECT s.id AS hs_id, s.user_id, s.title, s.date, s.time, s.location,
                   u.code, u.election_id AS election_id
              FROM homepage.schedules s
              JOIN homepage.users u ON s.user_id = u.id
          ORDER BY s.id
        """)).mappings().all()

        stats["total"] = len(rows)

        for r in rows:
            election_id = r["election_id"]
            if not election_id:
                stats["skipped_no_election"] += 1
                print(f"  [SKIP] #{r['hs_id']} {r['title']}: no election for user {r['code']}")
                continue

            # 해당 선거의 우리 후보 찾기 — tenant_elections 우선, 없으면 candidates.is_our_candidate
            cand = sess.execute(text("""
                SELECT te.our_candidate_id AS cid, te.tenant_id
                  FROM tenant_elections te
                 WHERE te.election_id = :eid
                   AND te.our_candidate_id IS NOT NULL
                 LIMIT 1
            """), {"eid": str(election_id)}).first()

            if not cand or not cand.cid:
                # fallback: candidates 테이블
                cand = sess.execute(text("""
                    SELECT id AS cid, tenant_id
                      FROM candidates
                     WHERE election_id = :eid AND is_our_candidate = true
                     LIMIT 1
                """), {"eid": str(election_id)}).first()

            if not cand:
                stats["skipped_no_candidate"] += 1
                print(f"  [SKIP] #{r['hs_id']} {r['title']}: no our-candidate for election {election_id}")
                continue

            starts_at, ends_at, all_day = parse_time_field(r["time"], r["date"])
            category = pick_category(r["title"])

            # 중복 체크 — 같은 election + title + starts_at
            existing = sess.execute(text("""
                SELECT id FROM candidate_schedules
                 WHERE election_id = :eid AND title = :title AND starts_at = :sa
                 LIMIT 1
            """), {"eid": str(election_id), "title": r["title"], "sa": starts_at}).scalar()

            if existing:
                stats["skipped_duplicate"] += 1
                print(f"  [DUP]  #{r['hs_id']} {r['title']}: already in candidate_schedules ({existing})")
                continue

            if dry_run:
                stats["inserted"] += 1
                print(f"  [WOULD INSERT] #{r['hs_id']} '{r['title']}' {starts_at.isoformat()} all_day={all_day} cat={category} → election {election_id}")
                continue

            new_id = uuid.uuid4()
            sess.execute(text("""
                INSERT INTO candidate_schedules
                  (id, election_id, candidate_id, tenant_id,
                   title, location, starts_at, ends_at, all_day,
                   category, visibility, status)
                VALUES
                  (:id, :eid, :cid, :tid,
                   :title, :location, :sa, :ea, :ad,
                   :cat, 'public', 'planned')
            """), {
                "id": new_id, "eid": str(election_id), "cid": str(cand.cid), "tid": str(cand.tenant_id),
                "title": r["title"], "location": r["location"],
                "sa": starts_at, "ea": ends_at, "ad": all_day,
                "cat": category,
            })
            stats["inserted"] += 1
            print(f"  [OK]   #{r['hs_id']} '{r['title']}' → candidate_schedules {new_id}")

        if not dry_run:
            sess.commit()

    return stats


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true", help="실제 INSERT 실행 (없으면 dry-run)")
    args = ap.parse_args()

    mode = "EXECUTE" if args.execute else "DRY-RUN"
    print(f"=== homepage.schedules → candidate_schedules 마이그레이션 ({mode}) ===")
    stats = migrate(dry_run=not args.execute)
    print()
    print("결과:", stats)
    if not args.execute:
        print("(--execute 로 재실행하면 실제 INSERT)")
