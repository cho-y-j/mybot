"""
ElectionPulse - 선거 접근 권한 및 공통 데이터 조회 헬퍼
같은 선거에 참여하는 모든 tenant의 데이터를 통합 조회.

REFACTOR NOTE (2026-04-14): candidates 테이블은 election-shared.
- `Candidate.tenant_id`는 legacy (첫 생성자 기록용) — logic에 사용 금지.
- `Candidate.is_our_candidate`는 canonical creator 관점이라 믿을 수 없음.
- "내 후보"를 판정할 때는 `tenant_elections.our_candidate_id == candidate.id` 비교.
- 선거별 후보 목록은 `list_election_candidates()` 헬퍼 사용.
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


async def list_election_candidates(
    db: AsyncSession,
    election_id: UUID | str,
    tenant_id: str | None = None,
    enabled_only: bool = True,
):
    """
    선거에 속한 후보자 목록 — election-shared 모델의 canonical source.

    - `election_id` 기준으로만 필터 (tenant_id 무시: 후보는 선거 단위 공유)
    - `tenant_id` 인자가 주어지면 해당 tenant의 "우리 후보" 관점에서
      `c.is_our_candidate` 속성을 동적으로 세팅한 뒤 반환.
    - 반환되는 Candidate 객체의 `.is_our_candidate`는 **해당 tenant 관점** 값
      (DB 컬럼값은 그대로 유지, in-memory 속성만 오버라이드).
    - `priority` 오름차순 정렬, 이름 중복은 하나만 유지 (tenant_id legacy로 dup 있을 수 있음).
    """
    from app.elections.models import Candidate

    q = select(Candidate).where(Candidate.election_id == election_id)
    if enabled_only:
        q = q.where(Candidate.enabled == True)
    q = q.order_by(Candidate.priority, Candidate.name)

    rows = (await db.execute(q)).scalars().all()

    # 레거시 중복 (같은 election + 같은 name) 제거 — 더 작은 priority 우선
    seen_names = set()
    unique = []
    for c in rows:
        if c.name in seen_names:
            continue
        seen_names.add(c.name)
        unique.append(c)

    if tenant_id is not None:
        our_cand_id = await get_our_candidate_id(db, tenant_id, election_id)
        for c in unique:
            c.is_our_candidate = bool(our_cand_id and str(c.id) == our_cand_id)
        unique.sort(key=lambda x: (0 if x.is_our_candidate else 1, x.priority or 99))

    return unique


async def get_or_create_candidate(
    db: AsyncSession,
    election_id: UUID | str,
    name: str,
    **create_kwargs,
):
    """
    election-shared upsert. (election_id, name) 가 이미 있으면 그 row를 반환,
    없으면 새로 insert. 온보딩에서 쓰기 위한 헬퍼.

    create_kwargs에는 party, priority, search_keywords, homonym_filters, tenant_id 등.
    """
    from app.elections.models import Candidate

    existing = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id,
            Candidate.name == name,
        ).limit(1)
    )).scalar_one_or_none()
    if existing is not None:
        return existing, False

    cand = Candidate(election_id=election_id, name=name, **create_kwargs)
    db.add(cand)
    await db.flush()
    return cand, True
