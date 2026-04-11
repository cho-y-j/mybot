"""
ElectionPulse - AI Chat Context Builder
사용자 질문에 맞는 DB 데이터를 자동 검색하여 AI 컨텍스트 구성.
수집된 모든 데이터를 학습한 것처럼 대답할 수 있게 함.
"""
from datetime import date, timedelta, datetime, timezone
from sqlalchemy import select, func, desc, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.elections.models import (
    Election, Candidate, NewsArticle, CommunityPost,
    YouTubeVideo, SearchTrend, SentimentDaily, Survey, Keyword,
    SurveyCrosstab,
)
import structlog

logger = structlog.get_logger()

# 질문 의도 분류 키워드
INTENT_KEYWORDS = {
    "news": ["뉴스", "기사", "언론", "보도", "헤드라인", "최근", "오늘"],
    "sentiment": ["감성", "긍정", "부정", "여론", "반응", "평가", "인식"],
    "trend": ["트렌드", "검색", "검색량", "인기", "관심", "추이", "변화"],
    "candidate": ["후보", "경쟁", "비교", "강점", "약점", "공약", "전략"],
    "youtube": ["유튜브", "영상", "조회수", "채널", "동영상", "댓글"],
    "community": ["커뮤니티", "카페", "블로그", "학부모", "맘카페", "댓글"],
    "survey": ["여론조사", "지지율", "설문", "조사", "투표", "교차분석"],
    "strategy": ["전략", "어떻게", "뭘 해야", "방향", "제안", "추천", "대응"],
    "risk": ["위기", "위험", "문제", "약점", "불리", "걱정", "우려"],
    "competitor": ["경쟁자", "갭", "차이", "부족", "격차", "비교분석"],
    "content": ["콘텐츠", "블로그", "해시태그", "키워드", "SEO", "포스팅"],
    "report": ["보고서", "리포트", "브리핑", "지난", "어제", "이전", "저번"],
    "history": ["과거", "역대", "지난 선거", "2022", "2018", "2014", "당선", "투표율", "역사"],
}


async def build_chat_context(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    question: str,
) -> str:
    """
    사용자 질문을 분석하여 관련 DB 데이터를 수집하고
    AI가 정확하게 답변할 수 있는 컨텍스트 구성.
    """
    # 질문 의도 파악
    intents = _detect_intents(question)

    # 기본 정보 로드
    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()

    candidates = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id,
            Candidate.tenant_id == tenant_id,
            Candidate.enabled == True,
        ).order_by(Candidate.priority)
    )).scalars().all()

    our = next((c for c in candidates if c.is_our_candidate), None)
    d_day = (election.election_date - date.today()).days if election else 0

    sections = []

    # ── 선거 기본 정보 (항상 포함) ──
    sections.append(_build_election_info(election, candidates, d_day))

    # ── 의도별 데이터 로드 ──
    today = date.today()
    week_ago = today - timedelta(days=7)

    if "news" in intents or "sentiment" in intents or not intents:
        sections.append(await _build_news_context(db, tenant_id, election_id, candidates, today))

    if "sentiment" in intents or "candidate" in intents or not intents:
        sections.append(await _build_sentiment_context(db, tenant_id, election_id, candidates, today))

    if "trend" in intents:
        sections.append(await _build_trend_context(db, tenant_id, election_id, candidates))

    if "youtube" in intents:
        sections.append(await _build_youtube_context(db, tenant_id, election_id, candidates))

    if "community" in intents:
        sections.append(await _build_community_context(db, tenant_id, election_id, candidates))

    if "survey" in intents:
        sections.append(await _build_survey_context(db, tenant_id, election_id))

    if "strategy" in intents or "risk" in intents or "candidate" in intents:
        sections.append(await _build_strategy_context(db, tenant_id, election_id, candidates, our))

    # B4 추가: 커뮤니티/카페 글 상세
    if "community" in intents or not intents:
        sections.append(await _build_community_detail_context(db, tenant_id, election_id, candidates))

    # B4 추가: 유튜브 댓글 감성
    if "youtube" in intents or "sentiment" in intents:
        sections.append(await _build_youtube_comments_context(db, tenant_id, candidates))

    # B4 추가: 뉴스 댓글 감성
    if "sentiment" in intents or "news" in intents:
        sections.append(await _build_news_comments_context(db, tenant_id))

    # B4 추가: 경쟁자 갭 분석
    if "competitor" in intents or "strategy" in intents or "candidate" in intents:
        sections.append(await _build_competitor_gap_context(db, tenant_id, election_id))

    # B4 추가: 여론조사 교차분석
    if "survey" in intents:
        sections.append(await _build_survey_crosstab_context(db, tenant_id, election_id))

    # B4 추가: 콘텐츠 전략 추천
    if "content" in intents or "strategy" in intents:
        sections.append(await _build_content_strategy_context(db, tenant_id, election_id))

    # 보고서 히스토리 (이전 보고서 참고)
    if "report" in intents or "strategy" in intents or not intents:
        sections.append(await _build_report_history_context(db, tenant_id, election_id))

    # 과거 선거 데이터
    if "history" in intents:
        sections.append(await _build_history_context(db, election_id, election))

    # 특정 후보 이름이 언급되면 해당 후보 상세 정보 추가
    for cand in candidates:
        if cand.name in question:
            sections.append(await _build_candidate_detail(db, tenant_id, cand, today))

    context = "\n\n".join(s for s in sections if s)
    return context


def _detect_intents(question: str) -> list[str]:
    """질문에서 의도 키워드 감지."""
    detected = []
    q = question.lower()
    for intent, keywords in INTENT_KEYWORDS.items():
        if any(kw in q for kw in keywords):
            detected.append(intent)
    return detected


def _build_election_info(election, candidates, d_day) -> str:
    """선거 기본 정보."""
    if not election:
        return ""
    our = next((c for c in candidates if c.is_our_candidate), None)
    lines = [
        "=== 선거 기본 정보 ===",
        f"선거: {election.name}",
        f"선거일: {election.election_date} (D-{d_day})",
        f"지역: {election.region_sido or ''} {election.region_sigungu or ''}",
        f"후보 수: {len(candidates)}명",
    ]
    if our:
        lines.append(f"우리 후보: {our.name} ({our.party or '무소속'})")
    for c in candidates:
        marker = " ⭐(우리)" if c.is_our_candidate else ""
        lines.append(f"  - {c.name} ({c.party or '무소속'}){marker}")
    return "\n".join(lines)


async def _build_news_context(db, tenant_id, election_id, candidates, today) -> str:
    """뉴스 컨텍스트 — AI 분석 결과(ai_summary, strategic_quadrant, action_summary) 포함."""
    lines = ["=== 뉴스 현황 (오늘) ==="]

    for cand in candidates:
        total = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == cand.id,
                func.date(NewsArticle.collected_at) == today,
            )
        )).scalar() or 0
        pos = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == cand.id,
                func.date(NewsArticle.collected_at) == today,
                NewsArticle.sentiment == "positive",
            )
        )).scalar() or 0
        neg = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == cand.id,
                func.date(NewsArticle.collected_at) == today,
                NewsArticle.sentiment == "negative",
            )
        )).scalar() or 0
        lines.append(f"{cand.name}: {total}건 (긍정 {pos}, 부정 {neg}, 중립 {total-pos-neg})")

    # 최근 뉴스 — race-shared 경로 (P2-01)
    # rn=race_news_articles (race 단위 팩트), ca=race_news_camp_analysis (캠프별 관점)
    recent = (await db.execute(text("""
        SELECT rn.title, rn.sentiment, rn.ai_summary, ca.ai_reason,
               ca.strategic_quadrant, rn.ai_threat_level, ca.action_summary,
               ca.is_about_our_candidate, rn.published_at, c.name AS cand_name
        FROM race_news_articles rn
        JOIN race_news_camp_analysis ca ON ca.race_news_id = rn.id
        LEFT JOIN candidates c ON c.id = ca.candidate_id
        WHERE ca.tenant_id = :tid
          AND rn.election_id = :eid
          AND (ca.strategic_quadrant IS NOT NULL OR rn.ai_analyzed_at IS NOT NULL)
        ORDER BY
          CASE rn.ai_threat_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          rn.published_at DESC NULLS LAST,
          rn.collected_at DESC
        LIMIT 12
    """), {"tid": tenant_id, "eid": election_id})).all()

    if recent:
        lines.append("\n최근 주요 뉴스 (AI 분석 포함):")
        for r in recent:
            emoji = {"positive": "+", "negative": "-", "neutral": "o"}.get(r.sentiment, "o")
            sq = f" [{r.strategic_quadrant}]" if r.strategic_quadrant else ""
            thr = f" ⚠{r.ai_threat_level}" if r.ai_threat_level in ("high", "medium") else ""
            lines.append(f"  [{emoji}][{r.cand_name or '?'}]{sq}{thr} {r.title}")
            if r.ai_summary:
                lines.append(f"    AI 요약: {r.ai_summary[:150]}")
            if r.ai_reason:
                lines.append(f"    판단 근거: {r.ai_reason[:120]}")
            if r.action_summary:
                lines.append(f"    권장 액션: {r.action_summary[:120]}")

    return "\n".join(lines)


async def _build_sentiment_context(db, tenant_id, election_id, candidates, today) -> str:
    """감성 분석 컨텍스트."""
    lines = ["=== 감성 분석 ==="]
    for cand in candidates:
        total = (await db.execute(
            select(func.count()).where(NewsArticle.candidate_id == cand.id)
        )).scalar() or 0
        pos = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == cand.id, NewsArticle.sentiment == "positive",
            )
        )).scalar() or 0
        neg = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == cand.id, NewsArticle.sentiment == "negative",
            )
        )).scalar() or 0
        pos_rate = round(pos / total * 100) if total else 0
        neg_rate = round(neg / total * 100) if total else 0
        lines.append(f"{cand.name}: 전체 {total}건, 긍정률 {pos_rate}%, 부정률 {neg_rate}%")
    return "\n".join(lines)


async def _build_trend_context(db, tenant_id, election_id, candidates) -> str:
    """검색 트렌드 컨텍스트."""
    lines = ["=== 검색 트렌드 ==="]
    trends = (await db.execute(
        select(SearchTrend).where(SearchTrend.tenant_id == tenant_id)
        .order_by(SearchTrend.checked_at.desc()).limit(20)
    )).scalars().all()
    for t in trends:
        lines.append(f"{t.keyword}: 검색량 {t.search_volume or t.relative_volume} ({t.platform})")
    return "\n".join(lines) if len(lines) > 1 else ""


async def _build_youtube_context(db, tenant_id, election_id, candidates) -> str:
    """유튜브 컨텍스트."""
    lines = ["=== 유튜브 현황 ==="]
    for cand in candidates:
        vids = (await db.execute(
            select(YouTubeVideo).where(YouTubeVideo.candidate_id == cand.id)
            .order_by(YouTubeVideo.views.desc()).limit(3)
        )).scalars().all()
        total_views = sum(v.views or 0 for v in vids)
        lines.append(f"{cand.name}: {len(vids)}개 영상, 총 {total_views:,}회 조회")
        for v in vids:
            lines.append(f"  - {v.title} ({v.views:,}회)")
    return "\n".join(lines)


async def _build_community_context(db, tenant_id, election_id, candidates) -> str:
    """커뮤니티 컨텍스트."""
    lines = ["=== 커뮤니티/블로그 ==="]
    for cand in candidates:
        count = (await db.execute(
            select(func.count()).where(CommunityPost.candidate_id == cand.id)
        )).scalar() or 0
        lines.append(f"{cand.name}: {count}건")
    return "\n".join(lines)


async def _build_survey_context(db, tenant_id, election_id) -> str:
    """여론조사 컨텍스트 — 실제 NESDC 데이터 포함."""
    from sqlalchemy import text as sql_text

    # 테넌트 여론조사
    surveys = (await db.execute(
        select(Survey).where(Survey.tenant_id == tenant_id)
        .order_by(Survey.survey_date.desc()).limit(5)
    )).scalars().all()

    # 공공데이터 여론조사 (최근 10건)
    public = (await db.execute(
        sql_text("SELECT survey_org, survey_date, results FROM surveys WHERE tenant_id IS NULL ORDER BY survey_date DESC LIMIT 10")
    )).fetchall()

    lines = ["=== 여론조사 (최신) ==="]

    if public:
        lines.append("** 전국 정당 지지율 (NESDC 공공데이터) **")
        for org, sdate, results in public[:5]:
            r = results if isinstance(results, dict) else {}
            top = sorted(r.items(), key=lambda x: -x[1])[:3]
            top_str = ", ".join(f"{p}: {v}%" for p, v in top)
            lines.append(f"  {sdate} {org}: {top_str}")

        # 30일 평균
        all_results = [r[2] for r in public if isinstance(r[2], dict)]
        if all_results:
            avg = {}
            for r in all_results:
                for p, v in r.items():
                    if isinstance(v, (int, float)) and v > 0:
                        avg.setdefault(p, []).append(v)
            lines.append("  [최근 평균]")
            for p, vals in sorted(avg.items(), key=lambda x: -sum(x[1])/len(x[1]))[:5]:
                lines.append(f"    {p}: {sum(vals)/len(vals):.1f}%")

    if surveys:
        lines.append("\n** 선거별 여론조사 **")
        for s in surveys:
            lines.append(f"  {s.survey_org} ({s.survey_date}): {s.results}")

    return "\n".join(lines) if len(lines) > 1 else ""


async def _build_strategy_context(db, tenant_id, election_id, candidates, our) -> str:
    """전략 분석 컨텍스트 — AI 4사분면(strength/weakness/opportunity/threat) 기반."""
    if not our:
        return ""
    lines = ["=== 전략 분석 (AI 4사분면 기반) ==="]

    # ── 1) 4사분면 요약 집계 (race-shared 경로) ──
    q_rows = (await db.execute(text("""
        SELECT ca.strategic_quadrant, COUNT(*) AS cnt
        FROM race_news_camp_analysis ca
        JOIN race_news_articles rn ON rn.id = ca.race_news_id
        WHERE ca.tenant_id = :tid AND rn.election_id = :eid
          AND ca.strategic_quadrant IS NOT NULL
          AND rn.ai_analyzed_at > NOW() - INTERVAL '14 days'
        GROUP BY ca.strategic_quadrant
    """), {"tid": tenant_id, "eid": election_id})).all()

    q_counts = {r.strategic_quadrant: r.cnt for r in q_rows}
    lines.append(
        f"최근 14일 4사분면: 강점 {q_counts.get('strength', 0)}건, "
        f"위기 {q_counts.get('weakness', 0)}건, "
        f"기회 {q_counts.get('opportunity', 0)}건, "
        f"위협 {q_counts.get('threat', 0)}건"
    )

    # ── 2) 우리 위기 (weakness) TOP 5 — 방어/해명이 필요한 항목 ──
    weak = (await db.execute(text("""
        SELECT rn.title, rn.ai_summary, ca.ai_reason, ca.action_summary, rn.ai_threat_level,
               c.name AS cand_name
        FROM race_news_camp_analysis ca
        JOIN race_news_articles rn ON rn.id = ca.race_news_id
        LEFT JOIN candidates c ON c.id = ca.candidate_id
        WHERE ca.tenant_id = :tid AND rn.election_id = :eid
          AND ca.strategic_quadrant = 'weakness'
        ORDER BY
          CASE rn.ai_threat_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          rn.published_at DESC NULLS LAST
        LIMIT 5
    """), {"tid": tenant_id, "eid": election_id})).all()

    if weak:
        lines.append("\n[우리 위기 — 방어/해명 필요]")
        for w in weak:
            thr = f" ⚠{w.ai_threat_level}" if w.ai_threat_level in ("high", "medium") else ""
            lines.append(f"  •{thr} {w.title}")
            if w.ai_summary:
                lines.append(f"    요약: {w.ai_summary[:140]}")
            if w.action_summary:
                lines.append(f"    대응: {w.action_summary[:120]}")

    # ── 3) 경쟁자 약점 (opportunity) TOP 5 — 공격 기회 (race-shared) ──
    opp = (await db.execute(text("""
        SELECT rn.title, rn.ai_summary, ca.action_summary, c.name AS cand_name
        FROM race_news_camp_analysis ca
        JOIN race_news_articles rn ON rn.id = ca.race_news_id
        LEFT JOIN candidates c ON c.id = ca.candidate_id
        WHERE ca.tenant_id = :tid AND rn.election_id = :eid
          AND ca.strategic_quadrant = 'opportunity'
        ORDER BY rn.published_at DESC NULLS LAST
        LIMIT 5
    """), {"tid": tenant_id, "eid": election_id})).all()

    if opp:
        lines.append("\n[경쟁자 약점 — 공격 기회]")
        for o in opp:
            lines.append(f"  • [{o.cand_name or '?'}] {o.title}")
            if o.ai_summary:
                lines.append(f"    요약: {o.ai_summary[:140]}")

    # ── 4) 우리 강점 (strength) TOP 5 — 확산/홍보 (race-shared) ──
    strong = (await db.execute(text("""
        SELECT rn.title, rn.ai_summary, ca.action_summary
        FROM race_news_camp_analysis ca
        JOIN race_news_articles rn ON rn.id = ca.race_news_id
        WHERE ca.tenant_id = :tid AND rn.election_id = :eid
          AND ca.strategic_quadrant = 'strength'
        ORDER BY rn.published_at DESC NULLS LAST
        LIMIT 5
    """), {"tid": tenant_id, "eid": election_id})).all()

    if strong:
        lines.append("\n[우리 강점 — 확산 대상]")
        for s in strong:
            lines.append(f"  • {s.title}")
            if s.ai_summary:
                lines.append(f"    요약: {s.ai_summary[:140]}")

    return "\n".join(lines)


async def _build_candidate_detail(db, tenant_id, cand, today) -> str:
    """특정 후보 상세 정보 — AI 분석 결과 포함."""
    lines = [f"=== {cand.name} 상세 ==="]
    lines.append(f"정당: {cand.party or '무소속'}")
    lines.append(f"검색 키워드: {', '.join(cand.search_keywords or [])}")
    if cand.career_summary:
        lines.append(f"경력: {cand.career_summary}")

    # 최근 뉴스 — AI 분석 포함
    recent = (await db.execute(text("""
        SELECT title, sentiment, strategic_quadrant, ai_summary, ai_threat_level,
               action_summary, published_at
        FROM news_articles
        WHERE candidate_id = :cid
        ORDER BY published_at DESC NULLS LAST, collected_at DESC
        LIMIT 6
    """), {"cid": str(cand.id)})).all()

    for n in recent:
        sq = f" [{n.strategic_quadrant}]" if n.strategic_quadrant else ""
        thr = f" ⚠{n.ai_threat_level}" if n.ai_threat_level in ("high", "medium") else ""
        lines.append(f"  [{n.sentiment or '-'}]{sq}{thr} {n.title}")
        if n.ai_summary:
            lines.append(f"    → {n.ai_summary[:140]}")

    return "\n".join(lines)


# ── B4: 추가 컨텍스트 빌더 ──

async def _build_community_detail_context(db, tenant_id, election_id, candidates) -> str:
    """커뮤니티/카페 글 상세 컨텍스트."""
    lines = ["=== 커뮤니티/카페 상세 ==="]

    for cand in candidates:
        posts = (await db.execute(
            select(CommunityPost).where(CommunityPost.candidate_id == cand.id)
            .order_by(CommunityPost.collected_at.desc()).limit(5)
        )).scalars().all()

        if posts:
            lines.append(f"\n{cand.name} 관련 커뮤니티 ({len(posts)}건):")
            for p in posts:
                sent = {"positive": "+", "negative": "-"}.get(p.sentiment, "o")
                issue = f" [{p.issue_category}]" if p.issue_category else ""
                lines.append(f"  [{sent}]{issue} {p.title[:50]} ({p.source or '미상'})")
                if p.content_snippet:
                    lines.append(f"    → {p.content_snippet[:80]}")
                engagement = p.engagement or {}
                if engagement:
                    parts = []
                    if engagement.get("views"):
                        parts.append(f"조회 {engagement['views']}")
                    if engagement.get("comments"):
                        parts.append(f"댓글 {engagement['comments']}")
                    if parts:
                        lines.append(f"    반응: {', '.join(parts)}")

    return "\n".join(lines) if len(lines) > 1 else ""


async def _build_youtube_comments_context(db, tenant_id, candidates) -> str:
    """유튜브 댓글 감성 컨텍스트."""
    try:
        from app.elections.history_models import YouTubeComment
    except ImportError:
        return ""

    lines = ["=== 유튜브 댓글 감성 ==="]

    for cand in candidates:
        # 후보 관련 영상 ID 조회
        video_ids = (await db.execute(
            select(YouTubeVideo.video_id).where(YouTubeVideo.candidate_id == cand.id)
        )).scalars().all()

        if not video_ids:
            continue

        total = (await db.execute(
            select(func.count()).where(YouTubeComment.video_id.in_(video_ids))
        )).scalar() or 0
        pos = (await db.execute(
            select(func.count()).where(
                YouTubeComment.video_id.in_(video_ids),
                YouTubeComment.sentiment == "positive",
            )
        )).scalar() or 0
        neg = (await db.execute(
            select(func.count()).where(
                YouTubeComment.video_id.in_(video_ids),
                YouTubeComment.sentiment == "negative",
            )
        )).scalar() or 0

        lines.append(f"{cand.name}: 댓글 {total}건 (긍정 {pos}, 부정 {neg}, 중립 {total - pos - neg})")

        # 최근 댓글 샘플
        recent_comments = (await db.execute(
            select(YouTubeComment)
            .where(YouTubeComment.video_id.in_(video_ids))
            .order_by(YouTubeComment.like_count.desc())
            .limit(3)
        )).scalars().all()

        for c in recent_comments:
            sent = {"positive": "+", "negative": "-"}.get(c.sentiment, "o")
            lines.append(f"  [{sent}] {c.text[:60]} (좋아요 {c.like_count})")

    return "\n".join(lines) if len(lines) > 1 else ""


async def _build_news_comments_context(db, tenant_id) -> str:
    """뉴스 댓글 감성 컨텍스트."""
    try:
        from app.elections.history_models import NewsComment
    except ImportError:
        return ""

    lines = ["=== 뉴스 댓글 감성 ==="]

    total = (await db.execute(
        select(func.count()).where(NewsComment.tenant_id == tenant_id)
    )).scalar() or 0

    if total == 0:
        return ""

    pos = (await db.execute(
        select(func.count()).where(
            NewsComment.tenant_id == tenant_id,
            NewsComment.sentiment == "positive",
        )
    )).scalar() or 0
    neg = (await db.execute(
        select(func.count()).where(
            NewsComment.tenant_id == tenant_id,
            NewsComment.sentiment == "negative",
        )
    )).scalar() or 0

    lines.append(f"전체: {total}건 (긍정 {pos}, 부정 {neg}, 중립 {total - pos - neg})")

    # 후보별
    candidates_in_comments = (await db.execute(
        select(NewsComment.candidate_name, func.count())
        .where(
            NewsComment.tenant_id == tenant_id,
            NewsComment.candidate_name.isnot(None),
        )
        .group_by(NewsComment.candidate_name)
    )).all()

    for cname, cnt in candidates_in_comments:
        lines.append(f"  {cname}: {cnt}건")

    # 인기 댓글 (공감 높은)
    top_comments = (await db.execute(
        select(NewsComment)
        .where(NewsComment.tenant_id == tenant_id)
        .order_by(NewsComment.sympathy_count.desc())
        .limit(3)
    )).scalars().all()

    if top_comments:
        lines.append("\n인기 댓글:")
        for c in top_comments:
            sent = {"positive": "+", "negative": "-"}.get(c.sentiment, "o")
            lines.append(f"  [{sent}] {c.text[:60]} (공감 {c.sympathy_count})")

    return "\n".join(lines)


async def _build_competitor_gap_context(db, tenant_id, election_id) -> str:
    """경쟁자 갭 분석 컨텍스트."""
    try:
        from app.analysis.competitor import analyze_competitor_gaps
        result = await analyze_competitor_gaps(db, tenant_id, election_id, days=7)
    except Exception as e:
        logger.warning("competitor_gap_context_error", error=str(e))
        return ""

    if not result.get("gaps") and not result.get("strengths"):
        return ""

    lines = ["=== 경쟁자 대비 갭 분석 ==="]

    if result.get("gaps"):
        lines.append("\n부족한 영역:")
        for g in result["gaps"][:5]:
            lines.append(
                f"  [{g['severity']}] {g['area']}: 우리 {g['our_value']}{g.get('unit', '')} "
                f"vs {g['competitor']} {g['competitor_value']}{g.get('unit', '')}"
            )
            lines.append(f"    → {g['recommendation']}")

    if result.get("strengths"):
        lines.append("\n우위 영역:")
        for s in result["strengths"][:3]:
            lines.append(
                f"  [우위] {s['area']}: 우리 {s['our_value']}{s.get('unit', '')} "
                f"vs {s['competitor']} {s['competitor_value']}{s.get('unit', '')}"
            )

    if result.get("ai_summary"):
        lines.append(f"\nAI 요약: {result['ai_summary']}")

    return "\n".join(lines)


async def _build_survey_crosstab_context(db, tenant_id, election_id) -> str:
    """여론조사 교차분석 컨텍스트."""
    lines = ["=== 여론조사 교차분석 ==="]

    # 최신 여론조사 + 교차분석
    latest_surveys = (await db.execute(
        select(Survey)
        .where(Survey.tenant_id == tenant_id, Survey.election_id == election_id)
        .order_by(Survey.survey_date.desc())
        .limit(3)
    )).scalars().all()

    if not latest_surveys:
        return ""

    for survey in latest_surveys:
        lines.append(f"\n{survey.survey_org} ({survey.survey_date}):")
        if survey.results and isinstance(survey.results, dict):
            sorted_results = sorted(survey.results.items(), key=lambda x: -x[1] if isinstance(x[1], (int, float)) else 0)
            for name, rate in sorted_results:
                if isinstance(rate, (int, float)):
                    lines.append(f"  {name}: {rate}%")

        # 교차분석 데이터
        crosstabs = (await db.execute(
            select(SurveyCrosstab)
            .where(SurveyCrosstab.survey_id == survey.id)
            .order_by(SurveyCrosstab.dimension, SurveyCrosstab.segment)
        )).scalars().all()

        if crosstabs:
            # dimension별 그룹핑
            by_dim = {}
            for ct in crosstabs:
                by_dim.setdefault(ct.dimension, []).append(ct)

            for dim, items in by_dim.items():
                lines.append(f"  [{dim}]")
                # segment별 그룹핑
                by_seg = {}
                for item in items:
                    by_seg.setdefault(item.segment, []).append(item)
                for seg, seg_items in by_seg.items():
                    parts = [f"{si.candidate}: {si.value}%" for si in seg_items]
                    lines.append(f"    {seg}: {', '.join(parts)}")

    return "\n".join(lines)


async def _build_content_strategy_context(db, tenant_id, election_id) -> str:
    """콘텐츠 전략 추천 컨텍스트."""
    try:
        from app.content.strategy import generate_content_strategy
        result = await generate_content_strategy(db, tenant_id, election_id)
    except Exception as e:
        logger.warning("content_strategy_context_error", error=str(e))
        return ""

    if result.get("error"):
        return ""

    lines = ["=== 콘텐츠 전략 추천 ==="]

    if result.get("blog_topics"):
        lines.append("\n블로그 추천 주제:")
        for t in result["blog_topics"][:3]:
            lines.append(f"  [{t.get('priority', 'medium')}] {t['title']}")
            lines.append(f"    이유: {t.get('reason', '')}")

    if result.get("keyword_opportunities"):
        lines.append("\n키워드 기회:")
        for kw in result["keyword_opportunities"][:3]:
            lines.append(f"  '{kw['keyword']}' (검색량 {kw['search_volume']})")

    if result.get("youtube_topics"):
        lines.append("\n유튜브 추천 주제:")
        for yt in result["youtube_topics"][:2]:
            lines.append(f"  [{yt.get('priority', 'medium')}] {yt['title']}")

    return "\n".join(lines) if len(lines) > 1 else ""


async def _build_report_history_context(db, tenant_id, election_id) -> str:
    """최근 보고서 3건 요약 — 이전 맥락 참고용."""
    from app.elections.models import Report

    reports = (await db.execute(
        select(Report).where(
            Report.tenant_id == tenant_id,
            Report.election_id == election_id,
        ).order_by(Report.report_date.desc(), Report.created_at.desc()).limit(3)
    )).scalars().all()

    if not reports:
        return ""

    lines = ["=== 최근 보고서 히스토리 ==="]
    for r in reports:
        date_str = r.report_date.isoformat() if r.report_date else "날짜 미상"
        rtype = {"daily": "일일", "morning_brief": "오전", "afternoon_brief": "오후", "weekly": "주간"}.get(r.report_type, r.report_type)
        title = r.title[:50] if r.title else ""

        content = r.content_text or ""
        summary = content[:500].replace("\n", " ").strip()
        if len(content) > 500:
            summary += "..."

        lines.append(f"\n[{date_str} {rtype} 보고서] {title}")
        lines.append(f"  {summary}")

    lines.append("\n위 보고서의 이전 전략 추천이 현재 데이터에 어떤 영향을 미쳤는지 참고하세요.")

    return "\n".join(lines)


async def _build_history_context(db, election_id, election) -> str:
    """과거 선거 데이터 — 역대 결과, 투표율, 패턴."""
    if not election:
        return ""

    lines = ["=== 역대 선거 데이터 ==="]

    try:
        from app.elections.history_models import ElectionResult, VoterTurnout

        results = (await db.execute(
            select(ElectionResult).where(
                ElectionResult.region_sido == election.region_sido,
                ElectionResult.election_type == election.election_type,
                ElectionResult.is_winner == True,
            ).order_by(ElectionResult.election_year.desc()).limit(6)
        )).scalars().all()

        if results:
            lines.append("\n[역대 당선자]")
            for r in results:
                lines.append(f"  {r.election_year}년: {r.candidate_name} ({r.party or '무소속'}) {r.vote_rate}%")

        turnouts = (await db.execute(
            select(VoterTurnout).where(
                VoterTurnout.election_type == election.election_type,
                VoterTurnout.region == election.region_sido,
                VoterTurnout.category == "total",
            ).order_by(VoterTurnout.election_year.desc()).limit(5)
        )).scalars().all()

        if turnouts:
            lines.append("\n[역대 투표율]")
            for t in turnouts:
                lines.append(f"  {t.election_year}년: {t.turnout_rate}%")

    except Exception as e:
        lines.append(f"  (데이터 조회 오류: {str(e)[:100]})")

    return "\n".join(lines) if len(lines) > 1 else ""
