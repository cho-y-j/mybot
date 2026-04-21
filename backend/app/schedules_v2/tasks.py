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
