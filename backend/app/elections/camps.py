"""
ElectionPulse - 후보 진영(camp) 매핑 헬퍼.

조회 우선순위:
  1. historical_candidate_camps 테이블 (수동/검증된 매핑)
  2. Candidate.party_alignment (캠프가 직접 설정한 본인 진영)
  3. raw 정당명 → 정규화 (_normalize_party)
"""
from typing import Optional
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.elections.history_models import HistoricalCandidateCamp
from app.elections.models import Candidate


# 정당 → 진영 정규화 (NEC raw 정당명을 진보/보수/중도/기타로)
_PROGRESSIVE_PARTIES = {
    "더불어민주당", "민주당", "새정치민주연합", "통합민주당", "열린우리당",
    "새천년민주당", "민주통합당", "민주노동당", "정의당", "진보신당", "통합진보당",
    "민주평화당", "진보당", "민중당", "노동당", "녹색당", "사회당",
    "기본소득당", "정의민주당", "조국혁신당", "새진보연합", "더불어민주연합",
    "민주연합", "민주개혁신당",
}
_CONSERVATIVE_PARTIES = {
    "국민의힘", "미래통합당", "자유한국당", "새누리당", "한나라당",
    "친박연대", "자유선진당", "국민중심당", "보수신당", "공화당",
    "대한애국당", "우리공화당", "기독자유당", "기독자유통일당",
    "친박연합", "신민당", "민주공화당", "국민통합21",
}
_CENTRIST_PARTIES = {
    "국민의당", "바른미래당", "바른정당", "안철수신당", "민생당", "새로운미래",
    "개혁신당",
}


def normalize_party(party: Optional[str]) -> str:
    """raw 정당명 → '진보' / '보수' / '중도' / '기타'."""
    if not party:
        return "기타"
    p = party.strip()
    if p in _PROGRESSIVE_PARTIES:
        return "진보"
    if p in _CONSERVATIVE_PARTIES:
        return "보수"
    if p in _CENTRIST_PARTIES:
        return "중도"
    # 키워드 기반 fallback
    if any(k in p for k in ("민주", "진보", "정의", "녹색", "노동", "민중", "사회", "혁신")):
        return "진보"
    if any(k in p for k in ("국민의힘", "보수", "공화", "한나라", "새누리", "자유", "통합", "애국")):
        return "보수"
    return "기타"


# party_alignment(영문) → 한글 진영
_ALIGNMENT_KO = {
    "progressive": "진보",
    "conservative": "보수",
    "centrist": "중도",
    "independent": "기타",
}


async def load_camp_overrides(
    db: AsyncSession,
    election_type: str,
    region_sido: Optional[str] = None,
) -> dict[str, str]:
    """역대 후보 진영 매핑을 dict로 한 번에 로드 (성능).

    Returns: {candidate_name: camp}
    """
    # 같은 election_type + (해당 region OR 전국 공통) 매핑 모두 가져오기
    rows = (await db.execute(
        select(HistoricalCandidateCamp).where(
            HistoricalCandidateCamp.election_type == election_type,
            or_(
                HistoricalCandidateCamp.region_sido == region_sido,
                HistoricalCandidateCamp.region_sido.is_(None),
            ),
        )
    )).scalars().all()

    # 같은 이름이 여러 매핑이면: 지역 정확 매칭 우선
    result: dict[str, str] = {}
    for r in rows:
        if r.candidate_name in result and r.region_sido is None:
            continue  # 이미 region 매칭이 있으면 전국 공통 무시
        result[r.candidate_name] = r.camp
    return result


async def load_current_candidate_alignments(
    db: AsyncSession,
    election_type: str,
) -> dict[str, str]:
    """현재 캠프 후보들의 party_alignment를 진영 dict로."""
    rows = (await db.execute(
        select(Candidate.name, Candidate.party_alignment, Candidate.party).where(
            Candidate.party_alignment.is_not(None),
        )
    )).all()
    result: dict[str, str] = {}
    for name, alignment, party in rows:
        camp = _ALIGNMENT_KO.get(alignment)
        if camp:
            result[name] = camp
    return result


def lookup_camp(
    name: str,
    raw_party: Optional[str],
    overrides: dict[str, str],
    alignments: dict[str, str],
) -> str:
    """단일 후보의 진영 결정.

    1. historical_candidate_camps override
    2. Candidate.party_alignment
    3. raw 정당명 정규화
    """
    if name in overrides:
        return overrides[name]
    if name in alignments:
        return alignments[name]
    return normalize_party(raw_party)


# 진영 → 색상 (frontend에서도 동일하게)
CAMP_COLORS = {
    "진보": "#2563eb",  # 파랑
    "보수": "#dc2626",  # 빨강
    "중도": "#7c3aed",  # 보라
    "기타": "#9ca3af",  # 회색
}
