"""
ElectionPulse - 실시간 웹 검색 서비스
챗/분석 시 수집 안 된 최신 정보를 네이버 검색으로 보강.

사용 시나리오:
- 사용자가 "오늘", "방금", "최근" 등 최신성 요구 시
- 내부 수집 데이터가 부족한 주제에 대한 질문
- 출처 각주 시스템의 신뢰 소스
"""
import re
from datetime import datetime, timezone, timedelta
import structlog
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger()

# 최신성 키워드 (등장 시 실시간 검색 트리거)
RECENCY_KEYWORDS = [
    "오늘", "지금", "방금", "최근", "현재", "요즘",
    "속보", "실시간", "어제", "이번주", "이번 주", "금일",
    "breaking", "latest", "today",
]


def needs_realtime(question: str) -> bool:
    """질문에 최신성 요구가 있는지 판단."""
    q = (question or "").lower()
    return any(kw in q for kw in RECENCY_KEYWORDS)


async def search_realtime_news(
    keywords: list[str],
    max_per_keyword: int = 5,
    hours: int = 48,
) -> list[dict]:
    """네이버 뉴스 API로 최근 N시간 기사 실시간 조회.

    Returns: [{"title", "url", "source", "description", "pub_date", "keyword"}]
    """
    from app.collectors.naver import NaverCollector

    collector = NaverCollector()
    if not collector.client_id:
        logger.info("realtime_search_skip", reason="no_naver_client")
        return []

    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    all_articles = []
    seen_urls = set()

    for kw in keywords[:5]:  # 최대 5개 키워드
        try:
            articles = await collector.search_news(kw, display=max_per_keyword)
            for a in articles:
                url = a.get("url", "")
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)

                # 날짜 파싱
                pub_at = None
                try:
                    from app.collectors.filters import parse_published_at
                    pub_at = parse_published_at(a.get("pub_date"))
                except Exception:
                    pass

                # 시간 컷오프 (최근 N시간 기사만)
                if pub_at and pub_at < cutoff:
                    continue

                all_articles.append({
                    "title": a.get("title", ""),
                    "url": url,
                    "source": a.get("source", ""),
                    "description": a.get("description", ""),
                    "pub_date": pub_at.isoformat() if pub_at else None,
                    "keyword": kw,
                })
        except Exception as e:
            logger.warning("realtime_search_kw_error", keyword=kw, error=str(e)[:100])

    # 최신순 정렬
    all_articles.sort(
        key=lambda x: x.get("pub_date") or "",
        reverse=True
    )

    logger.info("realtime_search_done",
                keywords=len(keywords), results=len(all_articles), hours=hours)
    return all_articles[:15]


async def build_realtime_context(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    question: str,
) -> str:
    """챗 질문에 실시간 검색 결과를 context 블록으로 변환.

    - 최신성 키워드 감지 시에만 실행
    - 후보 이름 기반으로 검색
    - 출처 각주용 URL 포함
    """
    if not needs_realtime(question):
        return ""

    # 후보 목록 조회
    try:
        from app.common.election_access import list_election_candidates
        candidates = await list_election_candidates(db, election_id, tenant_id=tenant_id)
    except Exception:
        return ""

    if not candidates:
        return ""

    # 검색 키워드 구성: 우리 후보 + 경쟁자 (최대 5개)
    our = next((c for c in candidates if c.is_our_candidate), None)
    keywords = []
    if our:
        keywords.append(our.name)
    for c in candidates:
        if not c.is_our_candidate and c.name not in keywords:
            keywords.append(c.name)
        if len(keywords) >= 5:
            break

    articles = await search_realtime_news(keywords, max_per_keyword=4, hours=48)
    if not articles:
        return ""

    lines = ["=== 실시간 웹 검색 (네이버 최근 48시간) ==="]
    lines.append(f"※ 내부 수집 DB에 없는 최신 정보. 질문 \"{question[:50]}\"에 대한 실시간 보강.")
    lines.append("")

    for i, a in enumerate(articles, 1):
        pub = ""
        if a.get("pub_date"):
            try:
                dt = datetime.fromisoformat(a["pub_date"])
                pub = dt.strftime(" (%m/%d %H:%M)")
            except Exception:
                pass
        lines.append(f"[RT{i}] {a['title']}{pub}")
        lines.append(f"   출처: {a.get('source') or '네이버'} | {a['url']}")
        if a.get("description"):
            lines.append(f"   요약: {a['description'][:200]}")
        lines.append("")

    return "\n".join(lines)
