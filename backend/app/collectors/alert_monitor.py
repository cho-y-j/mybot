"""
ElectionPulse - Real-time Crisis Detection (Alert Monitor)
30분마다 경량 체크: 뉴스 급증, 부정 기사 스파이크, 위기 키워드 감지
Redis에 이전 상태 저장 → 비교 → 스파이크 시 텔레그램 즉시 알림
"""
import json
from datetime import datetime, timezone, timedelta
from typing import Optional
from urllib.parse import quote

import httpx
from bs4 import BeautifulSoup
import structlog

logger = structlog.get_logger()

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.3",
}

# 위기 감지 키워드 (부정적 이벤트)
CRISIS_KEYWORDS = [
    "비리", "횡령", "의혹", "수사", "구속", "기소", "사퇴", "사임",
    "논란", "파문", "갈등", "폭로", "탄핵", "체포", "뇌물", "사기",
    "허위", "위장", "고발", "고소", "경찰", "검찰", "불법",
    "성추행", "성폭력", "성희롱", "음주운전", "학력위조",
]

# 심각도 수준
SEVERITY_CRITICAL = "critical"  # 즉시 대응 필요
SEVERITY_WARNING = "warning"    # 주의 관찰
SEVERITY_INFO = "info"          # 참고용


class AlertMonitor:
    """실시간 위기 감지 모니터."""

    def __init__(self, redis_url: str | None = None):
        from app.config import get_settings as _gs
        redis_url = redis_url or _gs().REDIS_URL or "redis://redis:6379/0"
        self.redis_url = redis_url
        self._redis = None

    async def _get_redis(self):
        """Redis 연결 (lazy init)."""
        if self._redis is None:
            try:
                import redis.asyncio as aioredis
                self._redis = aioredis.from_url(
                    self.redis_url,
                    decode_responses=True,
                )
            except ImportError:
                logger.warning("redis_not_available", msg="redis package not installed")
                return None
        return self._redis

    async def check_alerts(
        self,
        tenant_id: str,
        candidate_names: list[str],
        our_candidate: str = "",
        threshold_news_spike: int = 5,
        threshold_negative_ratio: float = 0.5,
    ) -> list[dict]:
        """
        위기 감지 메인 루프.
        Returns: [{severity, candidate, message, details, timestamp}, ...]
        """
        alerts = []
        now = datetime.now(timezone.utc)

        for candidate in candidate_names:
            # 1. 뉴스 건수 체크
            news_count, negative_count, crisis_articles = await self._quick_news_check(candidate)

            # 2. 이전 상태와 비교
            prev = await self._get_previous_state(tenant_id, candidate)
            prev_count = prev.get("news_count", 0) if prev else 0
            prev_negative = prev.get("negative_count", 0) if prev else 0

            # 알림 종류별 dedup 헬퍼 (오늘 같은 후보 같은 type 1회만)
            async def _can_send(alert_type: str) -> bool:
                if not self.redis:
                    return True
                try:
                    key = f"alert:dedup:{tenant_id}:{candidate}:{alert_type}:{now.date().isoformat()}"
                    if await self.redis.exists(key):
                        return False
                    await self.redis.setex(key, 86400, "sent")
                    return True
                except Exception:
                    return True

            # 3. 스파이크 감지
            # 3a. 뉴스 급증 (이전 대비 threshold_news_spike 이상 증가)
            if prev_count > 0 and news_count - prev_count >= threshold_news_spike and await _can_send("news_spike"):
                severity = SEVERITY_CRITICAL if candidate == our_candidate else SEVERITY_WARNING
                alerts.append({
                    "severity": severity,
                    "candidate": candidate,
                    "type": "news_spike",
                    "message": f"{candidate} 관련 뉴스 급증: {prev_count}건 → {news_count}건 (+{news_count - prev_count})",
                    "details": {
                        "previous": prev_count,
                        "current": news_count,
                        "increase": news_count - prev_count,
                    },
                    "timestamp": now.isoformat(),
                })

            # 3b. 부정 기사 급증
            if prev_negative > 0 and negative_count - prev_negative >= 3 and await _can_send("negative_spike"):
                severity = SEVERITY_CRITICAL if candidate == our_candidate else SEVERITY_WARNING
                alerts.append({
                    "severity": severity,
                    "candidate": candidate,
                    "type": "negative_spike",
                    "message": f"{candidate} 부정 기사 급증: {prev_negative}건 → {negative_count}건",
                    "details": {
                        "previous_negative": prev_negative,
                        "current_negative": negative_count,
                        "crisis_articles": crisis_articles[:3],
                    },
                    "timestamp": now.isoformat(),
                })

            # 3c. 위기 키워드 감지 (새로 등장한 위기 기사) — URL 단위 dedup
            prev_crisis_urls = set(prev.get("crisis_urls", [])) if prev else set()
            new_crisis = [a for a in crisis_articles if a["url"] not in prev_crisis_urls]
            if new_crisis:
                for article in new_crisis[:3]:
                    # URL 단위 dedup (이미 알림 발송한 URL은 제외)
                    url_dedup_key = f"alert:url:{tenant_id}:{article['url']}"
                    if self.redis:
                        try:
                            if await self.redis.exists(url_dedup_key):
                                continue
                            await self.redis.setex(url_dedup_key, 86400 * 7, "sent")  # 7일
                        except Exception:
                            pass

                    is_our = candidate == our_candidate
                    severity = SEVERITY_CRITICAL if is_our else SEVERITY_INFO
                    alerts.append({
                        "severity": severity,
                        "candidate": candidate,
                        "type": "crisis_keyword",
                        "message": f"{'⚠️ 우리 후보 ' if is_our else ''}{candidate}: {article['title'][:60]}",
                        "details": {
                            "title": article["title"],
                            "url": article["url"],
                            "matched_keywords": article.get("matched_keywords", []),
                        },
                        "timestamp": now.isoformat(),
                    })

            # 3d. 부정 비율 과다 (전체 뉴스 중 부정 비율)
            if news_count >= 5:
                neg_ratio = negative_count / news_count
                if neg_ratio >= threshold_negative_ratio and candidate == our_candidate and await _can_send("high_negative_ratio"):
                    alerts.append({
                        "severity": SEVERITY_WARNING,
                        "candidate": candidate,
                        "type": "high_negative_ratio",
                        "message": f"{candidate} 부정 뉴스 비율 {neg_ratio:.0%} ({negative_count}/{news_count}건)",
                        "details": {
                            "negative_ratio": neg_ratio,
                            "negative_count": negative_count,
                            "total_count": news_count,
                        },
                        "timestamp": now.isoformat(),
                    })

            # 4. 현재 상태 저장
            await self._save_current_state(tenant_id, candidate, {
                "news_count": news_count,
                "negative_count": negative_count,
                "crisis_urls": [a["url"] for a in crisis_articles],
                "checked_at": now.isoformat(),
            })

        logger.info(
            "alert_check_done",
            tenant_id=tenant_id,
            candidates=len(candidate_names),
            alerts=len(alerts),
        )
        return alerts

    async def _quick_news_check(self, candidate: str) -> tuple[int, int, list[dict]]:
        """
        경량 뉴스 체크: 네이버 뉴스 검색 스크래핑.
        Returns: (total_count, negative_count, crisis_articles)
        """
        encoded = quote(f"{candidate} 선거 OR 교육감 OR 후보")
        url = f"https://search.naver.com/search.naver?where=news&query={encoded}&sort=1&pd=4"
        # pd=4 = 최근 1일

        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(url, headers=HEADERS, timeout=10)
                resp.raise_for_status()
                soup = BeautifulSoup(resp.text, "html.parser")

                articles = []
                for a_tag in soup.find_all("a", href=True):
                    href = a_tag.get("href", "")
                    title = a_tag.get_text(strip=True)

                    if len(title) < 15:
                        continue
                    if "naver.com/search" in href:
                        continue
                    if any(x in title for x in ["언론사 선정", "네이버 메인에서", "구독하세요", "관련뉴스"]):
                        continue
                    if not any(x in href for x in ["news", "article", ".co.kr", ".com"]):
                        continue

                    articles.append({"title": title, "url": href})

                # 중복 제거
                seen = set()
                unique = []
                for a in articles:
                    key = a["title"][:20]
                    if key not in seen:
                        seen.add(key)
                        unique.append(a)

                total = len(unique)

                # 부정/위기 키워드 매칭
                negative_count = 0
                crisis_articles = []
                for article in unique:
                    title = article["title"]
                    matched = [kw for kw in CRISIS_KEYWORDS if kw in title]
                    if matched:
                        negative_count += 1
                        crisis_articles.append({
                            **article,
                            "matched_keywords": matched,
                        })

                return total, negative_count, crisis_articles

            except Exception as e:
                logger.error("alert_news_check_error", candidate=candidate, error=str(e))
                return 0, 0, []

    async def _get_previous_state(self, tenant_id: str, candidate: str) -> Optional[dict]:
        """Redis에서 이전 체크 상태 조회."""
        redis = await self._get_redis()
        if not redis:
            return None
        try:
            key = f"alert:{tenant_id}:{candidate}"
            data = await redis.get(key)
            return json.loads(data) if data else None
        except Exception as e:
            logger.error("redis_get_error", error=str(e))
            return None

    async def _save_current_state(self, tenant_id: str, candidate: str, state: dict):
        """Redis에 현재 상태 저장 (TTL 24시간)."""
        redis = await self._get_redis()
        if not redis:
            return
        try:
            key = f"alert:{tenant_id}:{candidate}"
            await redis.set(key, json.dumps(state, ensure_ascii=False), ex=86400)
        except Exception as e:
            logger.error("redis_set_error", error=str(e))

    async def close(self):
        """Redis 연결 종료."""
        if self._redis:
            await self._redis.close()
            self._redis = None


async def check_db_alerts(
    db, tenant_id: str, election_id: str,
    since_minutes: int = 30,
) -> list[dict]:
    """DB 기반 실시간 위기 감지 (Phase 2 이벤트 기반 방식).

    수집+AI 분석이 끝난 직후 호출. AI가 이미 분류한
    strategic_value='weakness' (우리 후보 약점 노출), ai_threat_level in ('high','medium'),
    sentiment_verified=TRUE 인 항목들을 긴급 알림 후보로 삼는다.

    Redis SET을 사용해 이미 알림 발송한 URL은 중복 제외.

    Returns: [{severity, candidate, type, message, details, timestamp}, ...]
    """
    from sqlalchemy import text as sql_text
    alerts: list[dict] = []
    now = datetime.now(timezone(timedelta(hours=9)))

    # Redis (알림 중복 방지용 SET)
    redis_client = None
    try:
        import redis.asyncio as aioredis
        from app.config import get_settings as _gs
        _redis_url = _gs().REDIS_URL or "redis://redis:6379/0"
        redis_client = aioredis.from_url(
            _redis_url, decode_responses=True,
        )
    except Exception as e:
        logger.warning("alert_redis_unavailable", error=str(e)[:200])

    alerted_key = f"alerted:{tenant_id}:{election_id}"

    async def _is_alerted(url: str) -> bool:
        if not redis_client:
            return False
        try:
            return bool(await redis_client.sismember(alerted_key, url))
        except Exception:
            return False

    async def _mark_alerted(url: str) -> None:
        if not redis_client:
            return
        try:
            await redis_client.sadd(alerted_key, url)
            await redis_client.expire(alerted_key, 86400)  # 24시간 TTL
        except Exception:
            pass

    # ── 뉴스에서 critical 항목 쿼리 ──
    # 우리 후보 약점 노출 (weakness) + 고위협 (high threat_level) + 검증된 부정
    rows = (await db.execute(sql_text(f"""
        SELECT n.id, n.title, n.url, n.ai_summary, n.ai_reason,
               n.sentiment,
               COALESCE(sv.strategic_value, n.strategic_value) AS strategic_value,
               n.ai_threat_level,
               c.name AS candidate, c.is_our_candidate
        FROM news_articles n
        LEFT JOIN candidates c ON n.candidate_id = c.id
        LEFT JOIN news_strategic_views sv ON sv.news_id = n.id AND sv.tenant_id = :tid
        WHERE n.election_id = :eid
          AND n.ai_analyzed_at > NOW() - INTERVAL '{since_minutes} minutes'
          AND n.sentiment_verified = TRUE
          AND COALESCE(sv.is_about_our_candidate, n.is_about_our_candidate) = TRUE
          AND (n.is_relevant IS NULL OR n.is_relevant = TRUE)
          AND (
            COALESCE(sv.strategic_value, n.strategic_value) = 'weakness'
            OR n.ai_threat_level IN ('high', 'medium')
          )
        ORDER BY
          CASE n.ai_threat_level
            WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3
          END,
          n.ai_analyzed_at DESC
        LIMIT 20
    """), {"tid": tenant_id, "eid": election_id})).all()

    for r in rows:
        if await _is_alerted(r.url):
            continue
        severity = SEVERITY_CRITICAL if r.ai_threat_level == "high" else SEVERITY_WARNING
        alerts.append({
            "severity": severity,
            "candidate": r.candidate or "",
            "type": "weakness_detected",
            "message": f"⚠️ {r.candidate or '우리 후보'}: {r.title[:70]}",
            "details": {
                "title": r.title,
                "url": r.url,
                "summary": r.ai_summary or "",
                "reason": r.ai_reason or "",
                "strategic_value": r.strategic_value,
                "threat_level": r.ai_threat_level,
            },
            "timestamp": now.isoformat(),
        })
        await _mark_alerted(r.url)

    # ── 경쟁 후보의 약점 (opportunity) — 우리에게 기회 ──
    opp_rows = (await db.execute(sql_text(f"""
        SELECT n.id, n.title, n.url, n.ai_summary, c.name AS candidate
        FROM news_articles n
        LEFT JOIN candidates c ON n.candidate_id = c.id
        LEFT JOIN news_strategic_views sv ON sv.news_id = n.id AND sv.tenant_id = :tid
        WHERE n.election_id = :eid
          AND n.ai_analyzed_at > NOW() - INTERVAL '{since_minutes} minutes'
          AND n.sentiment_verified = TRUE
          AND COALESCE(sv.strategic_value, n.strategic_value) = 'opportunity'
          AND n.ai_threat_level IN ('high', 'medium')
          AND (n.is_relevant IS NULL OR n.is_relevant = TRUE)
        ORDER BY n.ai_analyzed_at DESC
        LIMIT 10
    """), {"tid": tenant_id, "eid": election_id})).all()

    for r in opp_rows:
        if await _is_alerted(r.url):
            continue
        alerts.append({
            "severity": SEVERITY_INFO,
            "candidate": r.candidate or "",
            "type": "opportunity_detected",
            "message": f"💡 경쟁자 약점: {r.title[:70]}",
            "details": {
                "title": r.title,
                "url": r.url,
                "summary": r.ai_summary or "",
                "candidate": r.candidate,
            },
            "timestamp": now.isoformat(),
        })
        await _mark_alerted(r.url)

    if redis_client:
        try:
            await redis_client.aclose()
        except Exception:
            pass

    logger.info(
        "db_alerts_check",
        tenant=tenant_id, election=election_id,
        since=since_minutes, count=len(alerts),
    )
    return alerts


def format_alert_message(alerts: list[dict]) -> str:
    """알림 목록을 텔레그램 메시지 형식으로 변환."""
    if not alerts:
        return ""

    severity_emoji = {
        SEVERITY_CRITICAL: "🚨",
        SEVERITY_WARNING: "⚠️",
        SEVERITY_INFO: "ℹ️",
    }

    now = datetime.now(timezone(timedelta(hours=9)))
    lines = [
        f"<b>🔔 [위기 감지 알림]</b>",
        f"시각: {now.strftime('%Y-%m-%d %H:%M')}",
        f"감지 건수: {len(alerts)}건",
        "",
    ]

    # 심각도 순서로 정렬
    severity_order = {SEVERITY_CRITICAL: 0, SEVERITY_WARNING: 1, SEVERITY_INFO: 2}
    sorted_alerts = sorted(alerts, key=lambda a: severity_order.get(a["severity"], 99))

    for i, alert in enumerate(sorted_alerts, 1):
        emoji = severity_emoji.get(alert["severity"], "")
        lines.append(f"{emoji} <b>{i}. {alert['message']}</b>")

        # 위기 기사 URL 포함
        details = alert.get("details", {})
        if "title" in details and "url" in details:
            lines.append(f"   <a href=\"{details['url']}\">{details['title'][:40]}...</a>")
        if "crisis_articles" in details:
            for ca in details["crisis_articles"][:2]:
                lines.append(f"   - {ca['title'][:50]}")

        lines.append("")

    lines.append("━" * 20)
    lines.append("CampAI 위기감지 시스템")

    return "\n".join(lines)
