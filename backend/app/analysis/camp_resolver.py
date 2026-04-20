"""
후보자 진영(진보/보수) 자동 해결 — 범용 헬퍼.

우선순위:
1. Candidate.party_alignment (후보 등록 시 입력값) — progressive/conservative → 진보/보수
2. historical_candidate_camps (슈퍼관리자/AI가 사전 매핑)
3. 정당명 기반 자동 매핑 (민주 계열/국힘 계열)
4. AI WebSearch fallback — 후보명·선거·지역 → AI가 자동 판정 → historical_candidate_camps 에 저장

모든 선거 유형에 공통 적용. 교육감·시장·도지사·구청장·군수·국회의원·의원 전부 동일.
"""
from __future__ import annotations

import re
import structlog
from sqlalchemy import select, text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.elections.models import Candidate

logger = structlog.get_logger()


_ALIGNMENT_MAP = {
    "progressive": "진보",
    "conservative": "보수",
    # centrist/independent 는 '' 반환 (중립 — 진보/보수 어느 쪽으로도 분류 안 함)
}


def _from_party_name(party: str | None) -> str:
    """정당명 → 진영 (1차 자동)."""
    if not party:
        return ""
    if re.search(r"(더불어민주당|민주당|새정치민주연합|열린우리당|통합민주당|민주노동당|진보당|정의당|녹색당|조국혁신당|개혁|민중)", party):
        return "진보"
    if re.search(r"(국민의힘|한나라당|새누리당|미래통합당|자유한국당|새천년민주당|민주자유당|신한국당|한국당)", party):
        return "보수"
    return ""


async def _lookup_alignment_db(db: AsyncSession, candidate_name: str) -> str:
    """Candidate.party_alignment 조회 (후보 등록값)."""
    if not candidate_name:
        return ""
    row = (await db.execute(
        select(Candidate.party_alignment).where(Candidate.name == candidate_name).limit(1)
    )).scalar_one_or_none()
    return _ALIGNMENT_MAP.get(row or "", "")


async def _lookup_historical(db: AsyncSession, candidate_name: str, election_type: str, region: str) -> str:
    """historical_candidate_camps 조회."""
    if not candidate_name:
        return ""
    row = (await db.execute(sa_text("""
        SELECT camp FROM historical_candidate_camps
        WHERE candidate_name = :name AND election_type = :etype AND region_sido = :region
        ORDER BY created_at DESC LIMIT 1
    """), {"name": candidate_name, "etype": election_type, "region": region})).first()
    return row[0] if row else ""


async def _save_historical(db: AsyncSession, candidate_name: str, election_type: str, region: str, camp: str, source: str, notes: str = "") -> None:
    """historical_candidate_camps 저장 (AI 판정 결과 캐싱)."""
    try:
        await db.execute(sa_text("""
            INSERT INTO historical_candidate_camps (candidate_name, election_type, region_sido, camp, source, notes)
            VALUES (:name, :etype, :region, :camp, :source, :notes)
            ON CONFLICT DO NOTHING
        """), {
            "name": candidate_name, "etype": election_type, "region": region,
            "camp": camp, "source": source, "notes": notes or f"{source} 자동 매핑",
        })
        await db.commit()
    except Exception as e:
        logger.warning("camp_save_failed", error=str(e))
        await db.rollback()


async def _ai_resolve_camp(
    candidate_name: str, election_type: str, region: str, tenant_id: str | None, db: AsyncSession,
) -> str:
    """AI WebSearch 로 후보 진영 판정 (4순위 fallback)."""
    from app.services.ai_service import call_claude_text

    etype_label = {
        "superintendent": "교육감", "governor": "도지사", "mayor": "시장",
        "gun_head": "군수", "gu_head": "구청장",
        "congressional": "국회의원", "council": "지방의원",
    }.get(election_type, election_type)

    prompt = f"""한국 정치·선거 전문가로서 다음 후보의 진영(진보/보수/중도)을 판단하세요.

후보: {candidate_name}
선거: {region} {etype_label}

**진영 분류 기준**:
- 진보 = 더불어민주당 계열 또는 교육감이면 전교조·민주 계열 교육관
- 보수 = 국민의힘 계열 또는 교육감이면 교총·국민의힘 계열 교육관
- 중도 = 양쪽 모두 애매하거나 무소속 중립 (판단 불가면 이걸로)

웹 검색으로 해당 후보의 정치 성향·출신 정당·공약 성향을 확인하세요.

**반드시 다음 중 하나만 응답** (다른 말 금지, 한 단어만):
진보
보수
중도
불명"""

    try:
        raw = await call_claude_text(
            prompt, timeout=45,
            context="candidate_camp_resolver",  # standard tier (Sonnet) + web_search
            tenant_id=tenant_id, db=db,
            web_search=True,
        )
        if not raw:
            return ""
        t = raw.strip().split("\n")[0].strip()
        if "진보" in t: return "진보"
        if "보수" in t: return "보수"
        return ""
    except Exception as e:
        logger.warning("ai_camp_resolve_failed", name=candidate_name, error=str(e))
        return ""


async def resolve_candidate_camp(
    db: AsyncSession,
    candidate_name: str,
    party: str | None,
    election_type: str,
    region: str,
    *,
    tenant_id: str | None = None,
    enable_ai_fallback: bool = False,   # AI WebSearch 는 느리므로 명시적 허용 시만
) -> str:
    """
    범용 진영 해결 함수.
    반환: '진보' | '보수' | '' (분류 불가)
    """
    if not candidate_name:
        return _from_party_name(party)

    # 1. Candidate.party_alignment (가장 권위 있음 — 후보 본인/캠프가 등록한 값)
    camp = await _lookup_alignment_db(db, candidate_name)
    if camp:
        return camp

    # 2. historical_candidate_camps (역사 매핑 + AI 캐시)
    camp = await _lookup_historical(db, candidate_name, election_type, region)
    if camp:
        return camp

    # 3. 정당명 기반
    camp = _from_party_name(party)
    if camp:
        return camp

    # 4. AI WebSearch (옵션) — 결과를 historical_candidate_camps 에 저장해 영구 활용
    if enable_ai_fallback:
        camp = await _ai_resolve_camp(candidate_name, election_type, region, tenant_id, db)
        if camp:
            await _save_historical(db, candidate_name, election_type, region, camp, "ai", "AI WebSearch 자동 판정")
            return camp

    return ""


async def build_camp_map(
    db: AsyncSession,
    candidate_names: list[str],
    party_map: dict[str, str | None],
    election_type: str,
    region: str,
    *,
    tenant_id: str | None = None,
    enable_ai_fallback: bool = True,
) -> dict[str, str]:
    """
    후보 이름 목록 → {이름: 진영} 일괄 매핑.
    DB 매핑 없는 후보들만 AI WebSearch 로 병렬 조회 (enable_ai_fallback=True).
    """
    import asyncio

    result: dict[str, str] = {}
    # 1~3단계: DB 조회 (빠름)
    for name in candidate_names:
        camp = await resolve_candidate_camp(
            db, name, party_map.get(name), election_type, region,
            tenant_id=tenant_id, enable_ai_fallback=False,
        )
        result[name] = camp

    # 4단계: 빈 것만 AI 병렬 조회
    if enable_ai_fallback:
        missing = [n for n, c in result.items() if not c]
        if missing:
            async def _resolve_one(name: str) -> tuple[str, str]:
                camp = await _ai_resolve_camp(name, election_type, region, tenant_id, db)
                if camp:
                    await _save_historical(db, name, election_type, region, camp, "ai", "AI WebSearch batch")
                return name, camp

            results = await asyncio.gather(*(_resolve_one(n) for n in missing), return_exceptions=True)
            for r in results:
                if isinstance(r, tuple):
                    name, camp = r
                    if camp:
                        result[name] = camp
    return result
