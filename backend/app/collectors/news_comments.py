"""
ElectionPulse - 네이버 뉴스 댓글 수집기
기사 URL에서 댓글 수집 + 감성분석
"""
import re
import json
from typing import Optional

import httpx
import structlog

logger = structlog.get_logger()

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}

COMMENT_API = "https://apis.naver.com/commentBox/cbox/web_naver_list_jsonp.json"


async def fetch_article_comments(
    article_url: str,
    max_comments: int = 20,
) -> dict:
    """
    네이버 뉴스 기사의 댓글 수집.
    Returns: {
        "total": int,
        "comments": [{"text": str, "sympathy": int, "antipathy": int, "author": str}],
        "summary": {"positive_ratio": float, "total_sympathy": int}
    }
    """
    # URL에서 oid, aid 추출
    m = re.search(r"article/(\d+)/(\d+)", article_url)
    if not m:
        return {"total": 0, "comments": [], "summary": {}}

    oid, aid = m.group(1), m.group(2)

    params = {
        "ticket": "news",
        "templateId": "default_society",
        "pool": "cbox5",
        "lang": "ko",
        "country": "KR",
        "objectId": f"news{oid},{aid}",
        "pageSize": max_comments,
        "page": 1,
        "sort": "FAVORITE",  # 공감순
    }

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(
                COMMENT_API, params=params,
                headers={**HEADERS, "Referer": article_url},
                timeout=10,
            )

            if resp.status_code != 200:
                return {"total": 0, "comments": [], "summary": {}}

            text = resp.text
            if not text.startswith("_callback"):
                return {"total": 0, "comments": [], "summary": {}}

            # JSONP → JSON
            json_str = text[text.index("(") + 1:text.rindex(")")]
            data = json.loads(json_str)

            result = data.get("result", {})
            total = result.get("count", {}).get("comment", 0)
            comment_list = result.get("commentList", [])

            comments = []
            total_sympathy = 0
            total_antipathy = 0

            for cm in comment_list:
                sym = cm.get("sympathyCount", 0)
                anti = cm.get("antipathyCount", 0)
                comments.append({
                    "text": cm.get("contents", ""),
                    "sympathy": sym,
                    "antipathy": anti,
                    "author": cm.get("userName", ""),
                    "date": cm.get("modTime", ""),
                })
                total_sympathy += sym
                total_antipathy += anti

            # 공감 비율 (여론 지표)
            total_reactions = total_sympathy + total_antipathy
            positive_ratio = total_sympathy / total_reactions if total_reactions > 0 else 0.5

            return {
                "total": total,
                "comments": comments,
                "summary": {
                    "positive_ratio": round(positive_ratio, 3),
                    "total_sympathy": total_sympathy,
                    "total_antipathy": total_antipathy,
                    "avg_sympathy": round(total_sympathy / len(comments), 1) if comments else 0,
                },
            }

        except Exception as e:
            logger.error("comment_fetch_error", url=article_url, error=str(e))
            return {"total": 0, "comments": [], "summary": {}}


async def collect_comments_for_articles(
    articles: list[dict],
    max_per_article: int = 10,
) -> list[dict]:
    """
    여러 기사의 댓글을 한꺼번에 수집.
    articles: [{"url": str, "title": str, "candidate": str}, ...]
    """
    results = []
    for article in articles:
        url = article.get("url", "")
        if "n.news.naver.com" not in url and "news.naver.com" not in url:
            continue

        comment_data = await fetch_article_comments(url, max_per_article)
        if comment_data["total"] > 0:
            results.append({
                **article,
                "comment_count": comment_data["total"],
                "comments": comment_data["comments"],
                "comment_summary": comment_data["summary"],
            })

    logger.info("comments_collected", articles=len(articles), with_comments=len(results))
    return results
