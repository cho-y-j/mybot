"""
schedules_v2 — Celery 태스크

- geocode_schedule_task: 일정 생성/수정 시 주소→좌표+행정구역 백필
- auto_complete_past_schedules: 매시간, 과거 planned → done
- expand_recurring_schedules: 매일 03:00 KST, RRULE 일정 90일 인스턴스 펼침
- morning_result_reminder_prep: 매일 07:00 KST, 어제 결과 미입력 숫자 Redis 캐시
"""
import asyncio
from datetime import datetime, timedelta, timezone, date
from uuid import UUID, uuid4

import structlog
from sqlalchemy import select, and_, or_, func

from app.collectors.tasks import celery_app, get_sync_session
from app.schedules_v2.models import CandidateSchedule

logger = structlog.get_logger()
KST = timezone(timedelta(hours=9))


def _run_async(coro):
    """동기 Celery 컨텍스트에서 async 함수 실행."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # Jupyter/dev 환경 안전장치
            import nest_asyncio
            nest_asyncio.apply()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


# ─── 지오코딩 ───────────────────────────────────────────────────────────────

@celery_app.task(name="schedules_v2.geocode_schedule")
def geocode_schedule_task(schedule_id: str):
    """일정 주소를 카카오 API로 지오코딩 + 행정구역 백필."""
    from app.schedules_v2.geocode import geocode_address

    session = get_sync_session()
    try:
        sched = session.get(CandidateSchedule, UUID(schedule_id))
        if not sched or not sched.location:
            return {"status": "skipped", "reason": "no location"}
        if sched.location_lat and sched.location_lng:
            return {"status": "skipped", "reason": "already geocoded"}

        result = _run_async(geocode_address(sched.location))
        if not result:
            return {"status": "no_match", "address": sched.location[:50]}

        sched.location_lat = result["lat"]
        sched.location_lng = result["lng"]
        sched.admin_sido = result.get("sido")
        sched.admin_sigungu = result.get("sigungu")
        sched.admin_dong = result.get("dong")
        sched.admin_ri = result.get("ri")
        if not sched.location_url:
            sched.location_url = result.get("kakao_url")

        session.commit()
        logger.info(
            "geocode_done",
            schedule_id=schedule_id,
            dong=result.get("dong"),
            lat=result["lat"],
            lng=result["lng"],
        )
        return {
            "status": "ok",
            "dong": result.get("dong"),
            "sigungu": result.get("sigungu"),
        }
    except Exception as e:
        logger.error("geocode_task_error", schedule_id=schedule_id, error=str(e)[:200])
        return {"status": "error", "error": str(e)[:200]}
    finally:
        session.close()


# ─── 과거 일정 자동 완료 ────────────────────────────────────────────────────

@celery_app.task(name="schedules_v2.auto_complete_past")
def auto_complete_past_schedules():
    """ends_at < now AND status IN (planned, in_progress) → status='done'.

    매시간 실행. 결과 입력은 별도 (사용자 UI).
    """
    session = get_sync_session()
    try:
        now = datetime.now(timezone.utc)
        rows = session.execute(
            select(CandidateSchedule).where(
                CandidateSchedule.ends_at < now,
                CandidateSchedule.status.in_(["planned", "in_progress"]),
            )
        ).scalars().all()

        updated = 0
        for sched in rows:
            sched.status = "done"
            updated += 1

        if updated:
            session.commit()
            logger.info("schedules_auto_completed", count=updated)
        return {"status": "ok", "updated": updated}
    except Exception as e:
        logger.error("auto_complete_error", error=str(e)[:200])
        return {"status": "error", "error": str(e)[:200]}
    finally:
        session.close()


# ─── 반복 일정 인스턴스 펼침 ────────────────────────────────────────────────

@celery_app.task(name="schedules_v2.expand_recurring")
def expand_recurring_schedules():
    """RRULE 있는 일정의 향후 90일 인스턴스 생성.

    매일 03:00 KST 실행. 이미 생성된 인스턴스(parent_schedule_id 로 식별)는 스킵.
    """
    from dateutil.rrule import rrulestr

    session = get_sync_session()
    try:
        # RRULE 있는 '부모' 일정만
        parents = session.execute(
            select(CandidateSchedule).where(
                CandidateSchedule.recurrence_rule.isnot(None),
                CandidateSchedule.parent_schedule_id.is_(None),
                CandidateSchedule.status != "canceled",
            )
        ).scalars().all()

        now = datetime.now(timezone.utc)
        horizon = now + timedelta(days=90)
        created = 0

        for parent in parents:
            try:
                rule = rrulestr(parent.recurrence_rule, dtstart=parent.starts_at)
            except Exception as e:
                logger.warning(
                    "recurrence_parse_fail",
                    parent_id=str(parent.id), rule=parent.recurrence_rule, error=str(e)[:120],
                )
                continue

            # 이미 생성된 인스턴스 시작시각 집합
            existing_starts = set(
                row.starts_at.replace(microsecond=0)
                for row in session.execute(
                    select(CandidateSchedule).where(
                        CandidateSchedule.parent_schedule_id == parent.id
                    )
                ).scalars().all()
            )
            existing_starts.add(parent.starts_at.replace(microsecond=0))  # 부모 자신

            duration = parent.ends_at - parent.starts_at
            for occ in rule.between(parent.starts_at, horizon, inc=True):
                occ_utc = occ if occ.tzinfo else occ.replace(tzinfo=timezone.utc)
                if occ_utc.replace(microsecond=0) in existing_starts:
                    continue
                # 첫 occurrence(= parent.starts_at)는 부모 자신이므로 skip
                if occ_utc.replace(microsecond=0) == parent.starts_at.replace(microsecond=0):
                    continue
                child = CandidateSchedule(
                    id=uuid4(),
                    election_id=parent.election_id,
                    candidate_id=parent.candidate_id,
                    tenant_id=parent.tenant_id,
                    title=parent.title,
                    description=parent.description,
                    location=parent.location,
                    location_url=parent.location_url,
                    location_lat=parent.location_lat,
                    location_lng=parent.location_lng,
                    admin_sido=parent.admin_sido,
                    admin_sigungu=parent.admin_sigungu,
                    admin_dong=parent.admin_dong,
                    admin_ri=parent.admin_ri,
                    starts_at=occ_utc,
                    ends_at=occ_utc + duration,
                    all_day=parent.all_day,
                    category=parent.category,
                    visibility=parent.visibility,
                    status="planned",
                    recurrence_rule=None,  # 인스턴스는 RRULE 없음
                    parent_schedule_id=parent.id,
                    created_by=parent.created_by,
                )
                session.add(child)
                created += 1

        if created:
            session.commit()
            logger.info("schedules_recurring_expanded", created=created, parents=len(parents))
        return {"status": "ok", "created": created, "parents": len(parents)}
    except Exception as e:
        logger.error("expand_recurring_error", error=str(e)[:200])
        return {"status": "error", "error": str(e)[:200]}
    finally:
        session.close()


# ─── 오전 브리핑용: 어제 결과 미입력 숫자 캐시 ──────────────────────────────

@celery_app.task(name="schedules_v2.media_match")
def media_match_schedules():
    """완료 일정에 관련 뉴스·커뮤니티 자동 매칭.

    대상: status='done' AND (media_coverage = '[]'::jsonb OR media_coverage IS NULL)
    조건: 최근 14일 내 일정만 (오래된 일정은 DB 기사가 이미 없음)
    매칭: 일정 ±3h 시간대 + 본문에 후보 이름 포함 + AI(Sonnet) "이 일정과 관련 있나" 판정
    저장: media_coverage JSONB = [{type, id, title, url, sentiment, confidence}]
    """
    import json as _json
    from sqlalchemy import text as sql_text
    from app.services.ai_service import call_claude_text

    session = get_sync_session()
    try:
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=14)

        # 대상 일정 — 최대 20건씩 처리 (AI 호출 부담)
        rows = session.execute(sql_text("""
            SELECT cs.id::text AS id, cs.title, cs.starts_at, cs.ends_at,
                   cs.candidate_id::text AS cand_id,
                   cs.election_id::text AS eid,
                   cs.admin_dong, cs.location,
                   c.name AS cand_name
              FROM candidate_schedules cs
              JOIN candidates c ON c.id = cs.candidate_id
             WHERE cs.status = 'done'
               AND (cs.media_coverage = '[]'::jsonb OR cs.media_coverage IS NULL)
               AND cs.starts_at >= :cutoff
             ORDER BY cs.starts_at DESC
             LIMIT 20
        """), {"cutoff": cutoff}).mappings().all()

        if not rows:
            return {"status": "ok", "processed": 0}

        processed = 0
        matched_total = 0

        for row in rows:
            window_from = row["starts_at"] - timedelta(hours=3)
            window_to = row["ends_at"] + timedelta(hours=3)

            # 관련 뉴스 후보 (후보 이름 포함 + 시간대 ±3h)
            candidates_news = session.execute(sql_text("""
                SELECT id::text AS id, title, url, sentiment, published_at
                  FROM news_articles
                 WHERE election_id = cast(:eid as uuid)
                   AND candidate_id = cast(:cand_id as uuid)
                   AND (
                        (published_at IS NOT NULL AND published_at BETWEEN :wfrom AND :wto)
                     OR (published_at IS NULL AND collected_at BETWEEN :wfrom AND :wto)
                   )
                   AND is_relevant = true
                 ORDER BY published_at DESC NULLS LAST, collected_at DESC
                 LIMIT 10
            """), {
                "eid": row["eid"], "cand_id": row["cand_id"],
                "wfrom": window_from, "wto": window_to,
            }).mappings().all()

            if not candidates_news:
                # 빈 배열로 저장해서 재처리 방지 (다음 실행에서는 skip)
                session.execute(sql_text("""
                    UPDATE candidate_schedules
                       SET media_coverage = '[]'::jsonb
                     WHERE id = cast(:sid as uuid)
                """), {"sid": row["id"]})
                processed += 1
                continue

            # AI 판정 — 1회 호출로 전체 필터
            prompt = f"""당신은 선거 캠프의 일정-미디어 매칭 전문가입니다.
후보 '{row['cand_name']}'의 다음 일정이 있습니다:

일정: {row['title']}
시간: {row['starts_at'].strftime('%Y-%m-%d %H:%M')}
장소: {row['admin_dong'] or row['location'] or '미상'}

아래는 이 일정 시간대 ±3시간 이내에 수집된 뉴스 후보들입니다.
이 중 **정말 이 일정과 관련된** 기사만 JSON 배열로 답해주세요.

뉴스 후보:
"""
            for i, n in enumerate(candidates_news):
                prompt += f"\n[{i}] {n['title']}\n  URL: {n['url'][:120]}\n"
            prompt += """
응답 형식 (JSON만, 다른 텍스트 금지):
[{"idx": 0, "reason": "일정과 관련된 이유 한 줄", "confidence": 0.0~1.0}, ...]

관련 없으면 빈 배열 []. 단순한 후보 이름 언급이지만 일정과 무관하면 제외.
"""
            try:
                ai_resp = _run_async(call_claude_text(prompt, timeout=60, context="schedule_media_match", model_tier="standard"))
            except Exception:
                ai_resp = None

            selected = []
            if ai_resp:
                try:
                    # 코드 블록 제거
                    clean = ai_resp.strip()
                    if clean.startswith("```"):
                        clean = clean.split("```")[1]
                        if clean.startswith("json"):
                            clean = clean[4:]
                    verdicts = _json.loads(clean)
                    for v in verdicts:
                        idx = v.get("idx")
                        if isinstance(idx, int) and 0 <= idx < len(candidates_news):
                            n = candidates_news[idx]
                            selected.append({
                                "type": "news",
                                "id": n["id"],
                                "title": n["title"],
                                "url": n["url"],
                                "sentiment": n.get("sentiment"),
                                "confidence": float(v.get("confidence", 0.7)),
                                "reason": (v.get("reason") or "")[:150],
                            })
                except Exception as e:
                    logger.warning("media_match_parse_fail", error=str(e)[:100], sched_id=row["id"])

            # 저장 (빈 배열이어도 저장 → 재처리 방지)
            session.execute(sql_text("""
                UPDATE candidate_schedules
                   SET media_coverage = cast(:cov as jsonb)
                 WHERE id = cast(:sid as uuid)
            """), {"sid": row["id"], "cov": _json.dumps(selected, ensure_ascii=False)})
            processed += 1
            matched_total += len(selected)

            logger.info(
                "media_match_done",
                sched_id=row["id"], title=row["title"][:30],
                candidates=len(candidates_news), matched=len(selected),
            )

        session.commit()
        return {"status": "ok", "processed": processed, "matched": matched_total}
    except Exception as e:
        logger.error("media_match_error", error=str(e)[:200])
        return {"status": "error", "error": str(e)[:200]}
    finally:
        session.close()


@celery_app.task(name="schedules_v2.morning_result_reminder_prep")
def morning_result_reminder_prep():
    """어제 `status=done AND result_summary IS NULL` 건수를 Redis에 캐시.

    오전 브리핑(07:00 KST) 생성 시 이 숫자를 사용해 "어제 N건 결과 미입력" 배너 생성.
    """
    import redis
    from app.config import get_settings

    session = get_sync_session()
    try:
        now_kst = datetime.now(KST)
        yesterday = now_kst.date() - timedelta(days=1)
        y_start = datetime.combine(yesterday, datetime.min.time(), tzinfo=KST).astimezone(timezone.utc)
        y_end = datetime.combine(yesterday, datetime.max.time(), tzinfo=KST).astimezone(timezone.utc)

        # 테넌트별 미입력 카운트
        rows = session.execute(
            select(
                CandidateSchedule.tenant_id,
                func.count(CandidateSchedule.id).label("cnt"),
            )
            .where(
                CandidateSchedule.starts_at >= y_start,
                CandidateSchedule.starts_at <= y_end,
                CandidateSchedule.status == "done",
                CandidateSchedule.result_summary.is_(None),
                CandidateSchedule.result_mood.is_(None),
            )
            .group_by(CandidateSchedule.tenant_id)
        ).all()

        settings = get_settings()
        r = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
        cached = 0
        for tid, cnt in rows:
            key = f"schedules:yest_pending:{tid}:{yesterday.isoformat()}"
            r.setex(key, 86400, cnt)  # 24시간 TTL
            cached += 1

        logger.info(
            "morning_reminder_prep",
            tenant_count=cached, for_date=yesterday.isoformat(),
        )
        return {"status": "ok", "tenants": cached, "date": yesterday.isoformat()}
    except Exception as e:
        logger.error("morning_reminder_prep_error", error=str(e)[:200])
        return {"status": "error", "error": str(e)[:200]}
    finally:
        session.close()
