"""
ElectionPulse - 선거 접근 권한 및 공통 데이터 조회 헬퍼
같은 선거에 참여하는 모든 tenant의 데이터를 통합 조회.
"""
from uuid import UUID
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession


async def get_election_tenant_ids(db: AsyncSession, election_id: UUID) -> list[str]:
    """
    해당 선거에 참여하는 모든 tenant_id 반환.
    tenant_elections 테이블 + elections.tenant_id 기반.
    """
    # tenant_elections 매핑에서
    mapped = (await db.execute(text(
        "SELECT tenant_id FROM tenant_elections WHERE election_id = :eid"
    ), {"eid": str(election_id)})).scalars().all()

    # elections 테이블의 원래 소유자도 포함
    owner = (await db.execute(text(
        "SELECT tenant_id FROM elections WHERE id = :eid"
    ), {"eid": str(election_id)})).scalar()

    all_tids = set(str(t) for t in mapped)
    if owner:
        all_tids.add(str(owner))

    return list(all_tids)


async def can_access_election(db: AsyncSession, tenant_id: str, election_id: UUID) -> bool:
    """사용자의 tenant가 이 선거에 접근 가능한지 확인."""
    tids = await get_election_tenant_ids(db, election_id)
    return str(tenant_id) in tids


async def get_our_candidate_id(db: AsyncSession, tenant_id: str, election_id: UUID) -> str | None:
    """해당 tenant의 '우리 후보' ID 반환."""
    result = (await db.execute(text(
        "SELECT our_candidate_id FROM tenant_elections "
        "WHERE tenant_id = :tid AND election_id = :eid AND our_candidate_id IS NOT NULL"
    ), {"tid": str(tenant_id), "eid": str(election_id)})).scalar()
    return str(result) if result else None


async def get_shared_election_id(db: AsyncSession, tenant_id: str) -> str | None:
    """
    tenant가 참여하는 선거 ID를 반환.
    자기 tenant에 선거가 없으면 tenant_elections에서 찾음.
    """
    from app.elections.models import Election

    # 1. 자기 tenant의 선거
    own = (await db.execute(
        select(Election.id).where(Election.tenant_id == tenant_id)
    )).scalar()
    if own:
        return str(own)

    # 2. 매핑된 선거
    mapped = (await db.execute(text(
        "SELECT election_id FROM tenant_elections WHERE tenant_id = :tid LIMIT 1"
    ), {"tid": tenant_id})).scalar()

    return str(mapped) if mapped else None
