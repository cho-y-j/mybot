"""
ElectionPulse - Briefing Service
AI/규칙 기반 일일 브리핑 생성.
"""
import structlog
from app.services.ai_service import call_claude

logger = structlog.get_logger()


async def generate_ai_briefing(
    our_name: str,
    news_by_cand: list,
    scores: list,
    neg_news: list,
    surveys: list,
    tenant_id: str | None = None,
    db=None,
) -> dict:
    """Claude AI 기반 일일 브리핑 생성. 실패 시 규칙 기반 fallback."""
    our_score = next((s for s in scores if s.get("is_ours")), None)
    our_news = next((n for n in news_by_cand if n.get("is_ours")), None)
    our_rank = next((i + 1 for i, s in enumerate(scores) if s.get("is_ours")), 0)

    # 팩트시트 구성
    factsheet = f"[오늘의 선거 현황 팩트시트]\n"
    factsheet += f"우리 후보: {our_name}\n"
    factsheet += f"현재 순위: {our_rank}위 / {len(scores)}명\n\n"

    factsheet += "[후보별 미디어 현황]\n"
    for s in scores:
        marker = " ★(우리)" if s.get("is_ours") else ""
        factsheet += f"- {s['name']}{marker}: 뉴스 {s['news']}건, 긍정률 {s['sentiment_rate']}%, 커뮤니티 {s.get('community', 0)}건, 유튜브 {s.get('youtube_views', 0)}조회\n"

    if neg_news:
        factsheet += f"\n[부정 뉴스 {len(neg_news)}건]\n"
        for nn in neg_news[:5]:
            factsheet += f"- [{nn['candidate']}] {nn['title'][:50]}\n"

    if surveys:
        factsheet += f"\n[최근 여론조사 {len(surveys)}건]\n"
        for sv in surveys[:3]:
            results_str = ", ".join(f"{k}: {v}" for k, v in (sv.get("results") or {}).items() if isinstance(v, (int, float)))
            factsheet += f"- {sv.get('org', '')} ({sv.get('date', '')}): {results_str[:100]}\n"

    # Claude AI 호출
    prompt = (
        f"{factsheet}\n\n"
        f"위 데이터를 바탕으로 선거 캠프 매니저에게 오늘의 브리핑을 작성하세요.\n"
        f"반드시 아래 JSON 형식으로만 답변하세요 (다른 텍스트 없이):\n"
        f'{{"crises": ["위기1", "위기2"], "opportunities": ["기회1", "기회2"], "todos": ["할일1", "할일2"]}}\n\n'
        f"규칙:\n"
        f"- crises: 지금 즉시 대응해야 할 위험 (최대 3개, 없으면 빈 배열)\n"
        f"- opportunities: 활용할 수 있는 기회 (최대 3개)\n"
        f"- todos: 오늘 구체적으로 해야 할 행동 (최대 3개)\n"
        f"- 각 항목은 구체적이고 실행 가능하게, 한국어로\n"
        f"- 데이터에 근거한 내용만 포함"
    )

    result = await call_claude(prompt, timeout=60, context="ai_briefing", tenant_id=tenant_id, db=db)
    if result:
        return {
            "rank": our_rank,
            "rank_total": len(scores),
            "crises": result.get("crises", [])[:3],
            "opportunities": result.get("opportunities", [])[:3],
            "todos": result.get("todos", [])[:3],
            "ai_generated": True,
        }

    # Claude 불가 시 규칙 기반 fallback
    return generate_rule_briefing(our_name, news_by_cand, scores, neg_news)


def generate_rule_briefing(our_name: str, news_by_cand: list, scores: list, neg_news: list) -> dict:
    """규칙 기반 빠른 브리핑 (Claude 호출 없음, 즉시 반환)."""
    crises, opportunities, todos = [], [], []
    our_news = next((n for n in news_by_cand if n.get("is_ours")), None)
    our_rank = next((i + 1 for i, s in enumerate(scores) if s.get("is_ours")), 0)

    if neg_news:
        for nn in neg_news[:2]:
            if nn.get("candidate") == our_name:
                crises.append(f"부정뉴스: {nn['title'][:40]}")
    if our_news and our_news.get("count", 0) == 0:
        crises.append("뉴스 노출 0건 — 긴급 대응 필요")
    if our_rank > 1 and scores:
        crises.append(f"미디어 노출 {our_rank}위 — {scores[0]['name']} 대비 열세")

    for n in news_by_cand:
        if not n.get("is_ours") and n.get("negative", 0) >= 3:
            opportunities.append(f"{n['name']} 부정뉴스 {n['negative']}건 — 공략 가능")
    if our_news and our_news.get("positive", 0) > 0:
        opportunities.append(f"긍정 뉴스 {our_news['positive']}건 — SNS 확산 활용")

    if our_rank > 1:
        todos.append("보도자료/인터뷰로 뉴스 노출 확대")
    if our_news and our_news.get("negative", 0) > 0:
        todos.append("부정 뉴스 해명 자료 준비")
    if not todos:
        todos.append("현재 모니터링 지속")

    return {
        "rank": our_rank, "rank_total": len(scores),
        "crises": crises[:3], "opportunities": opportunities[:3], "todos": todos[:3],
        "ai_generated": False,
    }
