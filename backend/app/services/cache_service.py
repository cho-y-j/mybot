"""
ElectionPulse - Cache Service
analysis_cache 테이블 기반 범용 캐시 읽기/쓰기.
"""
import json
import uuid
from datetime import datetime, timezone
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

logger = structlog.get_logger()


async def get_cache(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    cache_type: str,
    max_age_hours: int = 24,
) -> dict | None:
    """캐시 조회. max_age_hours 이내 데이터만 반환."""
    try:
        row = (await db.execute(text(
            "SELECT data, created_at FROM analysis_cache "
            "WHERE tenant_id = :tid AND election_id = :eid AND cache_type = :ctype "
            "ORDER BY created_at DESC LIMIT 1"
        ), {"tid": str(tenant_id), "eid": str(election_id), "ctype": cache_type})).first()

        if not row:
            return None

        data = row[0] if isinstance(row[0], dict) else json.loads(row[0])
        created_at = row[1]

        # TTL 체크
        if created_at and max_age_hours > 0:
            age = (datetime.now(timezone.utc) - created_at.replace(tzinfo=timezone.utc)).total_seconds() / 3600
            if age > max_age_hours:
                return None

        data["_cached"] = True
        data["_cached_at"] = created_at.isoformat() if created_at else None
        return data

    except Exception as e:
        logger.warning("cache_read_error", cache_type=cache_type, error=str(e)[:200])
        return None


async def set_cache(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    cache_type: str,
    data: dict,
) -> None:
    """캐시 저장 (upsert).
    NOT NULL 컬럼(analysis_type, analysis_date, result_data)도 함께 채움."""
    try:
        clean_data = {k: v for k, v in data.items() if not k.startswith("_cached")}
        data_json = json.dumps(clean_data, ensure_ascii=False, default=str)
        await db.execute(text(
            "INSERT INTO analysis_cache "
            "  (id, tenant_id, election_id, cache_type, data, "
            "   analysis_type, analysis_date, result_data, created_at) "
            "VALUES (:id, :tid, :eid, :ctype, :data, "
            "        :ctype, CURRENT_DATE, :data, NOW()) "
            "ON CONFLICT (tenant_id, election_id, cache_type) "
            "DO UPDATE SET data = EXCLUDED.data, "
            "              result_data = EXCLUDED.result_data, "
            "              created_at = NOW()"
        ), {
            "id": str(uuid.uuid4()),
            "tid": str(tenant_id),
            "eid": str(election_id),
            "ctype": cache_type,
            "data": data_json,
        })
        await db.commit()
    except Exception as e:
        # 실패 시 세션 rollback으로 트랜잭션 오염 방지
        try:
            await db.rollback()
        except Exception:
            pass
        logger.warning("cache_write_error", cache_type=cache_type, error=str(e)[:200])
