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
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=120)

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


    async def analyze_batch(self, items: list[dict]) -> list[dict]:
        """
        배치 AI 감성 분석 — 10건씩 한 번에 Claude에 전달.
        items: [{"id": str, "text": str}, ...]
        Returns: [{"id": str, "sentiment": str, "score": float}, ...]
        """
        if not items:
            return []

        from app.services.ai_service import call_claude

        # 10건씩 배치
        results = []
        for i in range(0, len(items), 10):
            batch = items[i:i+10]
            numbered = "\n".join(f"{j+1}. {it['text'][:100]}" for j, it in enumerate(batch))

            prompt = (
                "다음 선거 관련 뉴스/게시글의 감성을 분석해주세요.\n\n"
                "규칙:\n"
                "- 후보에게 유리한 내용(공약, 지지, 성과, 문제해결) → positive\n"
                "- 후보에게 불리한 내용(비리, 논란, 비판, 의혹) → negative\n"
                "- 단순 사실보도, 일정, 판단 애매 → neutral\n"
                "- '학교폭력 방지', '비리 근절' 같은 해결 내용은 positive\n\n"
                "반드시 JSON 배열로만 답변:\n"
                '[{"n":1,"s":"positive","c":0.8},{"n":2,"s":"neutral","c":0.5},...]\n'
                "n=번호, s=sentiment, c=confidence(0~1)\n\n"
                f"텍스트:\n{numbered}"
            )

            ai_result = await call_claude(prompt, timeout=180, context="batch_sentiment")
            if ai_result and "items" in ai_result:
                for item in ai_result["items"]:
                    idx = item.get("n", 0) - 1
                    if 0 <= idx < len(batch):
                        sentiment = item.get("s", "neutral")
                        confidence = float(item.get("c", 0.5))
                        score = confidence if sentiment == "positive" else (-confidence if sentiment == "negative" else 0.0)
                        results.append({
                            "id": batch[idx]["id"],
                            "sentiment": sentiment,
                            "score": round(score, 3),
                        })

            # AI 결과에 없는 항목은 키워드 폴백
            result_ids = {r["id"] for r in results}
            for it in batch:
                if it["id"] not in result_ids:
                    sent, score = self._keyword_analysis_conservative(it["text"])
                    results.append({"id": it["id"], "sentiment": sent, "score": score})

        return results

    async def verify_batch_with_opus(
        self,
        items: list[dict],
        tenant_id: str | None = None,
        db=None,
    ) -> list[dict]:
        """
        Opus(premium)로 감성 분류 검증 + 4사분면 배정.
        1차(Sonnet) 판정을 Opus가 재확인.

        items: [{
            "id": str,
            "text": str,
            "current_sentiment": str,  # 1차 판정 (Sonnet)
            "candidate_name": str,
            "is_our_candidate": bool,
        }, ...]

        Returns: [{
            "id": str,
            "sentiment": str,         # 검증 후 최종 감성
            "score": float,
            "quadrant": str,           # strength|weakness|opportunity|threat
            "changed": bool,           # 1차 판정이 뒤집혔는지
            "reason": str,             # Opus 판단 근거
        }, ...]
        """
        if not items:
            return []

        from app.services.ai_service import call_claude

        results = []
        # 5건씩 배치 (Opus는 정밀 분석이라 더 작은 배치)
        for i in range(0, len(items), 5):
            batch = items[i:i + 5]
            numbered_items = []
            for j, it in enumerate(batch):
                side = "우리 후보" if it.get("is_our_candidate") else "경쟁 후보"
                numbered_items.append(
                    f"{j+1}. [{side}: {it['candidate_name']}] "
                    f"[현재판정: {it['current_sentiment']}] "
                    f"{it['text'][:150]}"
                )
            numbered = "\n".join(numbered_items)

            prompt = (
                "당신은 선거 캠프 미디어 분석 전문가입니다. 아래 뉴스/게시글의 감성 분류와 4사분면 전략 분류를 검증하세요.\n\n"
                "## 감성 규칙\n"
                "1. 감성은 해당 후보 관점에서 판단:\n"
                "   - 해당 후보에게 유리한 내용 → positive\n"
                "   - 해당 후보에게 불리한 내용 → negative\n"
                "   - 단순 사실보도, 중립적 비교, 판단 애매 → neutral\n"
                "2. '비리 근절 공약', '학폭 방지 대책' = 해결/예방 → positive (부정단어지만 맥락이 긍정)\n"
                "3. '비리 의혹 제기', '학폭 가해 전력' = 문제 발생 → negative\n\n"
                "## ★★ 4사분면 — 사건 vs 행동 구분 (가장 중요) ★★\n"
                "단순 매핑 금지! 발화 주체와 행위에 따라 정반대 분류 가능.\n\n"
                "### 우리 후보\n"
                "▶ 우리 후보 본인이 능동적으로 발표/해명/주장/공개/제안/약속/항의/요구/반발/입장표명한 콘텐츠\n"
                "  = **strength** (능동 메시지) — 사건이 부정적이어도 우리 후보의 행동은 강점\n"
                "  예: '서승우 경선 번복 반발' → 본인이 능동 항의 → strength (sentiment=negative여도!)\n"
                "  예: '후보 재경선 수용' → 대승적 결단 → strength\n"
                "  예: '후보 공약 발표' → strength\n\n"
                "▶ 우리 후보가 외부에 의해 비판/사고/논란/실수/의혹/스캔들로 보도\n"
                "  = **weakness** (실제 위기) — 즉시 방어 필요\n"
                "  예: '후보 부동산 투기 의혹 제기' → weakness\n"
                "  예: '후보 컷오프, 자격 미달 지적' → weakness\n\n"
                "### 경쟁 후보\n"
                "▶ 경쟁 후보가 비판/사고/논란/약점 노출 → **opportunity** (공격 기회)\n"
                "▶ 경쟁 후보 능동 발표/성과/동원 성공 → **threat** (경쟁 위협)\n\n"
                "### 제3자/일반 뉴스 → neutral → null\n\n"
                "## 규칙\n"
                "1. 기존 판정이 틀렸으면 반드시 교정 (특히 '우리 후보 + negative 사건 + 능동 행동' = strength)\n"
                "2. sentiment와 quadrant는 독립적으로 판단. 'negative = weakness' 기계적 매핑 금지.\n"
                "3. 본문에 '~가 발표했다', '~가 입장을 밝혔다', '~가 항의했다' 같은 능동 발화 있으면 strength 가능성 검토.\n\n"
                "반드시 JSON 배열로만 답변:\n"
                '[{"n":1,"s":"positive","c":0.9,"q":"strength","r":"능동 항의로 strength"},...]\n'
                "n=번호, s=최종감성, c=확신도(0~1), q=4사분면(strength/weakness/opportunity/threat/null), r=판단근거(20자이내)\n\n"
                f"텍스트:\n{numbered}"
            )

            ai_result = await call_claude(
                prompt, timeout=300, context="sentiment_verify",
                model_tier="premium",  # Opus 강제
                tenant_id=tenant_id,
                db=db,
            )

            if ai_result and "items" in ai_result:
                for item in ai_result["items"]:
                    idx = item.get("n", 0) - 1
                    if 0 <= idx < len(batch):
                        original = batch[idx]
                        new_sentiment = item.get("s", original["current_sentiment"])
                        confidence = float(item.get("c", 0.5))
                        score = confidence if new_sentiment == "positive" else (
                            -confidence if new_sentiment == "negative" else 0.0
                        )
                        quadrant = item.get("q", "null")
                        if quadrant == "null":
                            quadrant = None

                        results.append({
                            "id": original["id"],
                            "sentiment": new_sentiment,
                            "score": round(score, 3),
                            "quadrant": quadrant,
                            "changed": new_sentiment != original["current_sentiment"],
                            "reason": item.get("r", ""),
                        })

            # AI 결과에 없는 항목은 기존 판정 유지
            result_ids = {r["id"] for r in results}
            for it in batch:
                if it["id"] not in result_ids:
                    results.append({
                        "id": it["id"],
                        "sentiment": it["current_sentiment"],
                        "score": 0.0,
                        "quadrant": None,
                        "changed": False,
                        "reason": "검증 실패 — 기존 유지",
                    })

        return results


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
