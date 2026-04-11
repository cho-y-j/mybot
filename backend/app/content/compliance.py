"""
ElectionPulse - 선거법 컴플라이언스 체커
공직선거법 실제 조항 기반 콘텐츠 사전 검증
"""
import re
from datetime import date


class ComplianceChecker:
    """선거 콘텐츠 법적 검증기 — 공직선거법 조항 기반."""

    # ── 실제 법 조항 매핑 ──

    RULES = [
        # 1. AI 생성물 표기 의무 (제82조의8)
        {
            "article": "제82조의8 (AI 생성물 표시의무)",
            "summary": "AI 기술을 이용하여 생성한 선거운동용 콘텐츠에는 AI 생성물 표시 의무",
            "penalty": "과태료 300만원 이하",
            "check": "ai_disclosure",
        },
        # 2. 허위사실 공표 금지 (제250조)
        {
            "article": "제250조 (허위사실공표죄)",
            "summary": "당선되거나 되게 할 목적으로 후보자에 대해 허위사실을 공표한 자",
            "penalty": "5년 이하 징역 또는 3천만원 이하 벌금 + 당선무효",
            "check": "false_statement",
        },
        # 3. 후보자 비방 금지 (제110조)
        {
            "article": "제110조 (후보자비방죄)",
            "summary": "공연히 사실을 적시하여 후보자를 비방한 자",
            "penalty": "3년 이하 징역 또는 500만원 이하 벌금",
            "check": "defamation",
        },
        # 4. 기부행위 제한 (제112조)
        {
            "article": "제112조 (기부행위의 제한)",
            "summary": "후보자·예비후보자는 당해 선거구 안에 있는 자에게 금품제공 금지",
            "penalty": "5년 이하 징역 또는 1천만원 이하 벌금 + 당선무효",
            "check": "monetary",
        },
        # 5. 인터넷 선거운동 규정 (제82조의7)
        {
            "article": "제82조의7 (인터넷 선거운동)",
            "summary": "인터넷 홈페이지·SNS를 이용한 선거운동은 실명 확인 후 가능",
            "penalty": "2년 이하 징역 또는 400만원 이하 벌금",
            "check": "internet_campaign",
        },
        # 6. 탈법방법 선거운동 금지 (제93조)
        {
            "article": "제93조 (탈법방법에 의한 문서·도화 배부 금지)",
            "summary": "선거일 전 180일부터 선거일까지 후보자 명의의 문서·도화 배부 제한",
            "penalty": "2년 이하 징역 또는 400만원 이하 벌금",
            "check": "illegal_distribution",
        },
        # 7. 여론조사 공표 제한 (제108조)
        {
            "article": "제108조 (여론조사의 결과공표 금지)",
            "summary": "선거일 전 6일부터 선거일까지 여론조사 결과 공표·인용 금지",
            "penalty": "3년 이하 징역 또는 600만원 이하 벌금",
            "check": "poll_publication",
        },
        # 8. 선거운동 기간 제한 (제59조)
        {
            "article": "제59조 (선거운동기간)",
            "summary": "선거운동은 후보자등록마감일 다음 날부터 선거일 전일까지만 가능",
            "penalty": "해당 행위 위반시 각 규정에 따른 처벌",
            "check": "campaign_period",
        },
        # 9. 딥페이크 금지 (제82조의8 제2항)
        {
            "article": "제82조의8 제2항 (딥페이크 금지)",
            "summary": "선거일 전 90일부터 AI 딥페이크 영상·이미지 사용 금지",
            "penalty": "7년 이하 징역 또는 1천~5천만원 벌금",
            "check": "deepfake",
        },
        # 10. 홍보물 발행 제한 (제86조 제5항)
        {
            "article": "제86조 제5항 (홍보물 발행 제한)",
            "summary": "지방자치단체는 선거일 전 90일부터 업적홍보성 인쇄물·광고 제한",
            "penalty": "3년 이하 징역 또는 600만원 이하 벌금",
            "check": "promo_material",
        },
    ]

    # ── 키워드 패턴 (조항별) ──

    AI_KEYWORDS = ["GPT", "ChatGPT", "Claude", "AI 생성", "인공지능 생성", "AI가 작성", "자동 생성", "AI 활용"]

    DEFAMATION_PATTERNS = [
        r"거짓말", r"사기꾼", r"범죄자", r"비리", r"뇌물", r"횡령",
        r"부패", r"전과", r"구속", r"체포", r"기소", r"탈세",
        r"도둑", r"먹튀", r"가짜", r"사이비", r"무능",
    ]

    FALSE_STATEMENT_PATTERNS = [
        r"확인된\s*바", r"관계자에\s*따르면", r"~로\s*밝혀졌", r"~인\s*것으로\s*확인",
    ]

    MONETARY_PATTERNS = [
        r"돈\s*을?\s*(주|드|나눠|지급)", r"경품", r"추첨", r"상금",
        r"현금\s*(지급|제공)", r"무료\s*(제공|배포)",
        r"기프티콘", r"상품권", r"사은품",
    ]

    SMS_REQUIREMENTS = [
        {"name": "선거운동정보 표기", "pattern": r"선거운동정보"},
        {"name": "후보 전화번호", "pattern": r"\d{2,3}-\d{3,4}-\d{4}"},
        {"name": "수신거부 방법", "pattern": r"수신거부|수신\s*거부"},
    ]

    def check_content(self, text: str, content_type: str = "general", election_date: str = None) -> dict:
        """
        콘텐츠 선거법 검증 — 실제 조항 기반.
        Returns: {"compliant": bool, "violations": [...], "warnings": [...], "suggestions": [...], "score": 0-100}
        """
        violations = []
        warnings = []
        suggestions = []

        # 1. AI 생성물 표기 의무 (제82조의8)
        has_ai_keyword = any(kw.lower() in text.lower() for kw in self.AI_KEYWORDS)
        has_ai_mark = "[AI 생성물]" in text or "[AI생성물]" in text or "[AI 활용]" in text
        if has_ai_keyword and not has_ai_mark:
            rule = self._get_rule("ai_disclosure")
            violations.append({
                "rule": rule["article"],
                "detail": "AI 관련 키워드 포함 시 [AI 생성물] 또는 [AI 활용] 표기 필수",
                "penalty": rule["penalty"],
                "fix": "콘텐츠 시작에 '[AI 활용]' 표기 추가",
            })

        # 2. 비방/명예훼손 (제110조)
        for pattern in self.DEFAMATION_PATTERNS:
            matches = re.findall(pattern, text)
            if matches:
                rule = self._get_rule("defamation")
                warnings.append({
                    "rule": rule["article"],
                    "detail": f"'{matches[0]}' 표현이 후보자 비방에 해당할 수 있음",
                    "penalty": rule["penalty"],
                    "fix": "사실 관계 확인 후 객관적 표현으로 수정",
                })

        # 3. 허위사실 위험 표현 (제250조)
        for pattern in self.FALSE_STATEMENT_PATTERNS:
            matches = re.findall(pattern, text)
            if matches:
                rule = self._get_rule("false_statement")
                warnings.append({
                    "rule": rule["article"],
                    "detail": f"'{matches[0]}' — 출처 불명확한 사실 주장은 허위사실공표 위험",
                    "penalty": rule["penalty"],
                    "fix": "정확한 출처 명시 또는 표현 수정",
                })

        # 4. 금품 제공 약속 (제112조)
        for pattern in self.MONETARY_PATTERNS:
            matches = re.findall(pattern, text)
            if matches:
                rule = self._get_rule("monetary")
                violations.append({
                    "rule": rule["article"],
                    "detail": f"'{matches[0]}' 표현이 기부행위 제한 위반 소지",
                    "penalty": rule["penalty"],
                    "fix": "금품/경품 관련 표현 삭제",
                })

        # 5. SMS 필수 요소 (문자메시지인 경우)
        if content_type == "sms":
            for req in self.SMS_REQUIREMENTS:
                if not re.search(req["pattern"], text):
                    violations.append({
                        "rule": "제82조의5 (문자메시지 전송)",
                        "detail": f"SMS에 '{req['name']}' 미포함",
                        "penalty": "2년 이하 징역 또는 400만원 이하 벌금",
                        "fix": f"'{req['name']}' 추가 필수",
                    })

        # 6. 선거일 기반 시기별 제한
        if election_date:
            d_day = (date.fromisoformat(election_date) - date.today()).days
            timeline_items = self._check_timeline(d_day, content_type)
            warnings.extend(timeline_items)

        # 7. 콘텐츠 개선 제안
        if len(text) > 2000 and content_type == "sns":
            suggestions.append("SNS 콘텐츠는 500자 이내 권장 — 간결할수록 효과적")
        if "#" not in text and content_type in ("sns", "blog"):
            suggestions.append("해시태그 3~5개 추가 시 검색 노출 증가")
        if not has_ai_mark and content_type in ("blog", "sns", "youtube"):
            suggestions.append("AI 활용 콘텐츠는 [AI 활용] 표기를 권장합니다")

        return {
            "compliant": len(violations) == 0,
            "violations": violations,
            "warnings": warnings,
            "suggestions": suggestions,
            "score": max(0, 100 - len(violations) * 30 - len(warnings) * 10),
        }

    def _get_rule(self, check_type: str) -> dict:
        for r in self.RULES:
            if r["check"] == check_type:
                return r
        return {"article": "공직선거법", "summary": "", "penalty": "", "check": ""}

    def _check_timeline(self, d_day: int, content_type: str) -> list:
        """선거일 기준 시기별 제한 확인."""
        items = []

        if d_day <= 0:
            items.append({
                "rule": "선거일 이후",
                "detail": "선거가 종료되었습니다. 선거 관련 콘텐츠 게시에 주의하세요.",
                "penalty": "",
            })
        elif d_day <= 1:
            rule = self._get_rule("campaign_period")
            items.append({
                "rule": f"{rule['article']} — 선거일 전일",
                "detail": "선거운동 금지 기간 — 투표 독려 외 선거운동 불가",
                "penalty": rule["penalty"],
            })
        elif d_day <= 6:
            rule = self._get_rule("poll_publication")
            items.append({
                "rule": rule["article"],
                "detail": "선거일 6일 전부터 여론조사 결과 공표·인용 금지",
                "penalty": rule["penalty"],
            })
        elif d_day <= 14:
            items.append({
                "rule": "제59조 (공식 선거운동 기간)",
                "detail": "공식 선거운동 기간 — 모든 콘텐츠에 선거운동정보 표기 필요",
                "penalty": "각 규정별 처벌",
            })

        if d_day <= 90 and content_type in ("youtube", "sns"):
            rule = self._get_rule("deepfake")
            items.append({
                "rule": rule["article"],
                "detail": "선거일 90일 전부터 AI 딥페이크 영상/이미지 사용 금지",
                "penalty": rule["penalty"],
            })

        return items
