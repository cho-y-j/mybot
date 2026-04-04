"""
ElectionPulse - 선거법 컴플라이언스 체커
콘텐츠 게시 전 선거법 위반 사전 검증 (모든 선거 유형 범용)
"""
import re
from datetime import date, timedelta


class ComplianceChecker:
    """선거 콘텐츠 법적 검증기."""

    # AI 생성물 표기 의무 키워드
    AI_KEYWORDS = ["GPT", "ChatGPT", "Claude", "AI 생성", "인공지능 생성", "AI가 작성", "자동 생성"]

    # 비방/명예훼손 위험 표현
    DEFAMATION_PATTERNS = [
        r"거짓말", r"사기꾼", r"범죄자", r"비리", r"뇌물", r"횡령",
        r"부패", r"전과", r"구속", r"체포", r"기소", r"탈세",
        r"도둑", r"먹튀", r"가짜", r"사이비", r"무능",
    ]

    # 금품 제공 약속 위험 표현
    MONETARY_PATTERNS = [
        r"돈\s*을?\s*(주|드|나눠|지급)", r"경품", r"추첨", r"상금",
        r"현금\s*(지급|제공)", r"무료\s*(제공|배포)",
        r"기프티콘", r"상품권", r"사은품",
    ]

    # SMS 필수 요소
    SMS_REQUIREMENTS = [
        {"name": "선거운동정보 표기", "pattern": r"선거운동정보"},
        {"name": "후보 전화번호", "pattern": r"\d{2,3}-\d{3,4}-\d{4}"},
        {"name": "수신거부 방법", "pattern": r"수신거부|수신\s*거부"},
    ]

    def check_content(self, text: str, content_type: str = "general", election_date: str = None) -> dict:
        """
        콘텐츠 선거법 검증.
        content_type: general | sms | blog | sns | youtube
        Returns: {"compliant": bool, "violations": [...], "warnings": [...], "suggestions": [...]}
        """
        violations = []
        warnings = []
        suggestions = []

        # 1. AI 생성물 표기 의무 확인
        if any(kw.lower() in text.lower() for kw in self.AI_KEYWORDS):
            if "[AI 생성물]" not in text and "[AI생성물]" not in text:
                violations.append({
                    "rule": "AI 생성물 표기 의무",
                    "detail": "AI 관련 키워드가 포함된 콘텐츠에는 [AI 생성물] 표기 필수",
                    "fix": "콘텐츠 시작 부분에 '[AI 생성물]' 또는 '[AI 활용]' 표기 추가",
                })

        # 2. 비방/명예훼손 검사
        for pattern in self.DEFAMATION_PATTERNS:
            matches = re.findall(pattern, text)
            if matches:
                warnings.append({
                    "rule": "비방/명예훼손 위험",
                    "detail": f"'{matches[0]}' 표현이 명예훼손 소지 있음",
                    "keyword": matches[0],
                    "fix": "사실 관계 확인 후 객관적 표현으로 수정",
                })

        # 3. 금품 제공 약속 검사
        for pattern in self.MONETARY_PATTERNS:
            matches = re.findall(pattern, text)
            if matches:
                violations.append({
                    "rule": "금품 제공 약속 금지",
                    "detail": f"'{matches[0]}' 표현이 선거법 위반 소지",
                    "fix": "금품/경품 관련 표현 삭제",
                })

        # 4. SMS 특화 검사
        if content_type == "sms":
            for req in self.SMS_REQUIREMENTS:
                if not re.search(req["pattern"], text):
                    violations.append({
                        "rule": f"SMS 필수 요소: {req['name']}",
                        "detail": f"문자 메시지에 '{req['name']}' 미포함",
                        "fix": f"'{req['name']}' 내용 추가 필수",
                    })

        # 5. 선거일 기반 제한 확인
        if election_date:
            d_day = (date.fromisoformat(election_date) - date.today()).days
            timeline_warnings = self._check_timeline(d_day, content_type)
            warnings.extend(timeline_warnings)

        # 6. 콘텐츠 개선 제안
        if len(text) > 2000 and content_type == "sns":
            suggestions.append("SNS 콘텐츠는 간결할수록 효과적 — 500자 이내 권장")
        if "#" not in text and content_type in ("sns", "blog"):
            suggestions.append("해시태그 추가 시 검색 노출 증가 — 3~5개 권장")

        return {
            "compliant": len(violations) == 0,
            "violations": violations,
            "warnings": warnings,
            "suggestions": suggestions,
            "score": max(0, 100 - len(violations) * 30 - len(warnings) * 10),
        }

    def _check_timeline(self, d_day: int, content_type: str) -> list:
        """선거일 기준 시기별 제한 확인."""
        warnings = []

        if d_day <= 0:
            warnings.append({
                "rule": "선거일 이후",
                "detail": "선거가 종료되었습니다. 선거 관련 콘텐츠 게시에 주의하세요.",
            })
        elif d_day <= 1:
            warnings.append({
                "rule": "선거일 전일 (D-1)",
                "detail": "선거운동 금지 기간 — 투표 독려 외 선거운동 불가",
            })
        elif d_day <= 6:
            warnings.append({
                "rule": "여론조사 공표 금지 (D-6)",
                "detail": "선거일 6일 전부터 여론조사 결과 공표/인용 금지",
            })
        elif d_day <= 14:
            warnings.append({
                "rule": "선거운동 집중 기간 (D-14)",
                "detail": "공식 선거운동 기간 — 모든 콘텐츠에 선거운동정보 표기 필요",
            })
        elif d_day <= 90:
            if content_type in ("youtube", "sns"):
                warnings.append({
                    "rule": "딥페이크 금지 (D-90)",
                    "detail": "선거일 90일 전부터 AI 딥페이크 영상/이미지 사용 금지",
                })

        return warnings
