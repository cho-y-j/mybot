"""
ElectionPulse - 감성 분석 엔진
1순위: AI (Claude CLI) — 맥락 이해, 정확도 높음
2순위: 키워드 기반 — AI 불가시 폴백, 확실하지 않으면 중립
"""
import re
import asyncio
import shutil
import statistics
from typing import Optional
import structlog

logger = structlog.get_logger()


class SentimentAnalyzer:
    """
    선거 뉴스 감성 분석기.
    AI가 맥락을 이해하고 판단. 확신 없으면 중립.
    """

    def analyze(self, text: str) -> tuple[str, float]:
        """
        동기 감성 분석 (Celery/수집 태스크용).
        AI 불가시 키워드 폴백, 확실하지 않으면 중립.
        """
        if not text:
            return "neutral", 0.0

        # 키워드 기반 분석 (보수적 — 확실한 것만)
        return self._keyword_analysis_conservative(text)

    async def analyze_with_ai(self, text: str) -> tuple[str, float]:
        """
        AI 기반 감성 분석 (정확도 높음).
        Claude CLI로 맥락 이해.
        """
        if not text:
            return "neutral", 0.0

        # AI 시도
        try:
            result = await self._ai_sentiment(text)
            if result:
                return result
        except Exception as e:
            logger.warning("ai_sentiment_fail", error=str(e))

        # AI 불가시 보수적 키워드 분석
        return self._keyword_analysis_conservative(text)

    async def _ai_sentiment(self, text: str) -> Optional[tuple[str, float]]:
        """Claude CLI로 감성 분석."""
        claude_path = shutil.which("claude")
        if not claude_path:
            return None

        prompt = (
            "다음 선거 관련 뉴스 제목/내용의 감성을 분석해주세요.\n"
            "규칙:\n"
            "1. 후보에게 유리한 내용(공약발표, 지지, 성과) → positive\n"
            "2. 후보에게 불리한 내용(비리, 논란, 비판) → negative\n"
            "3. '학교폭력 방지', '비리 근절' 같은 해결/예방 내용은 → positive\n"
            "4. 단순 사실 보도, 일정, 중립적 비교 → neutral\n"
            "5. 판단이 애매하면 반드시 → neutral\n\n"
            "JSON 형식으로만 답변: {\"sentiment\": \"positive|negative|neutral\", \"score\": 0.0~1.0, \"reason\": \"한줄 이유\"}\n\n"
            f"텍스트: {text[:300]}"
        )

        try:
            proc = await asyncio.create_subprocess_exec(
                claude_path, "-p", prompt,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30)

            if proc.returncode == 0 and stdout:
                import json
                result_text = stdout.decode("utf-8").strip()
                # JSON 추출
                match = re.search(r'\{[^}]+\}', result_text)
                if match:
                    data = json.loads(match.group())
                    sentiment = data.get("sentiment", "neutral")
                    score = float(data.get("score", 0.5))
                    if sentiment == "positive":
                        return "positive", score
                    elif sentiment == "negative":
                        return "negative", -score
                    return "neutral", 0.0
        except asyncio.TimeoutError:
            pass
        except Exception:
            pass

        return None

    def _keyword_analysis_conservative(self, text: str) -> tuple[str, float]:
        """
        보수적 키워드 분석 — 확실한 것만 판정, 나머지 중립.
        핵심: "폭력 방지" ≠ "폭력 발생". 맥락 패턴을 먼저 봄.
        """
        if not text:
            return "neutral", 0.0

        pos_score = 0
        neg_score = 0

        # ── 1단계: 맥락 패턴 (가중치 높음) ──
        # 부정 단어 + 긍정 수식어 → 긍정
        POSITIVE_PATTERNS = [
            r"폭력\s*(방지|예방|근절|대책|해결|퇴치)",
            r"비리\s*(근절|척결|방지|예방)",
            r"부패\s*(근절|척결|방지)",
            r"격차\s*(해소|줄이|개선)",
            r"문제\s*(해결|개선|대책)",
            r"(공약|정책|비전)\s*(발표|제시|약속)",
            r"(지원|확대|강화|개선|혁신|투자)\s*(하겠|할\s*것|추진|계획|방안)",
            r"(무상|무료)\s*(급식|교육|돌봄|보육)",
            r"(보호|존중|지원)\s*(강화|확대)",
        ]
        for pattern in POSITIVE_PATTERNS:
            if re.search(pattern, text):
                pos_score += 3

        # 확실한 부정 패턴
        NEGATIVE_PATTERNS = [
            r"(의혹|혐의|비리|횡령|탈세)\s*(제기|포착|드러|발각|확인)",
            r"(논란|파문|갈등)\s*(확산|심화|가열|불거)",
            r"(비판|비난|반발)\s*(거세|잇따|쇄도)",
            r"(거짓|허위|위장)\s*(사실|발언|경력)",
            r"(사퇴|퇴진|사임)\s*(요구|압박|촉구)",
            r"(수사|기소|재판|구속)\s*(착수|결정|돌입)",
        ]
        for pattern in NEGATIVE_PATTERNS:
            if re.search(pattern, text):
                neg_score += 3

        # ── 2단계: 단순 키워드 (가중치 낮음, 보조) ──
        CLEAR_POSITIVE = {"호평", "지지", "환영", "성과", "약진", "돌풍", "선전", "당선"}
        CLEAR_NEGATIVE = {"구속", "체포", "기소", "탄핵", "횡령", "뇌물", "사기"}

        for word in CLEAR_POSITIVE:
            if word in text:
                pos_score += 1
        for word in CLEAR_NEGATIVE:
            if word in text:
                neg_score += 1

        # ── 판정: 확실한 것만. 나머지 중립 ──
        total = pos_score + neg_score
        if total == 0:
            return "neutral", 0.0

        # 차이가 확실할 때만 판정 (3점 이상 차이)
        if pos_score >= neg_score + 2:
            score = min(1.0, pos_score / (total + 1))
            return "positive", round(score, 3)
        elif neg_score >= pos_score + 2:
            score = min(1.0, neg_score / (total + 1))
            return "negative", round(-score, 3)

        # 애매하면 중립 (이게 핵심!)
        return "neutral", 0.0

    def analyze_with_candidate(
        self, text: str, candidate_name: str,
        homonym_exclude: list[str] = None,
        homonym_require: list[str] = None,
    ) -> Optional[tuple[str, float]]:
        """후보 관련성 확인 + 감성 분석."""
        if candidate_name not in text:
            return None
        if homonym_exclude and any(ex in text for ex in homonym_exclude):
            return None
        if homonym_require and not any(req in text for req in homonym_require):
            return None
        return self.analyze(text)


class TrendDetector:
    """트렌드 변화 감지기."""

    @staticmethod
    def detect_spike(values: list[float], threshold: float = 2.0) -> list[dict]:
        if len(values) < 3:
            return []
        mean = statistics.mean(values)
        stdev = statistics.stdev(values) if len(values) > 1 else 0
        if stdev == 0:
            return []
        return [
            {"index": i, "value": v, "z_score": round((v - mean) / stdev, 2),
             "direction": "up" if (v - mean) / stdev > 0 else "down"}
            for i, v in enumerate(values) if abs((v - mean) / stdev) >= threshold
        ]

    @staticmethod
    def calculate_momentum(values: list[float], window: int = 3) -> float:
        if len(values) < window * 2:
            return 0.0
        recent = statistics.mean(values[-window:])
        previous = statistics.mean(values[-window * 2:-window])
        if previous == 0:
            return 0.0
        return round((recent - previous) / previous * 100, 1)

    @staticmethod
    def severity_level(our_ratio: float, max_ratio: float) -> str:
        if max_ratio == 0:
            return "unknown"
        pct = our_ratio / max_ratio * 100
        if pct < 30:
            return "critical"
        elif pct < 60:
            return "warning"
        return "normal"
