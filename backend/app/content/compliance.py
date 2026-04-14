"""
ElectionPulse - 선거법 컴플라이언스 체커
공직선거법 실제 조항 기반 콘텐츠 사전 검증

2단계 검증:
  1단계: 패턴 매칭 (즉시 — 명백한 위반 감지)
  2단계: AI 법률 분석 (Sonnet — 맥락 기반 정밀 검증)
"""
import re
from datetime import date


# ── 공직선거법 주요 조항 전문 (AI 프롬프트용) ──

ELECTION_LAW_FULL = """
[공직선거법 주요 조항 — 콘텐츠 검증 기준]

■ 제82조의8 (AI 생성물 표시의무)
① 선거운동을 위하여 인공지능 기술을 이용하여 생성한 선거운동용 문자·음성·화상·동영상 등에는
   해당 콘텐츠가 인공지능 기술을 이용하여 생성된 것임을 표시하여야 한다.
② 선거일 전 90일부터 선거일까지 인공지능 기술을 이용하여 후보자의 얼굴·음성·신체를 합성한
   딥페이크 영상·이미지 등을 제작·유포할 수 없다.
- 위반 시: ① 과태료 300만원 이하 ② 7년 이하 징역 또는 1천만~5천만원 벌금

■ 제250조 (허위사실공표죄)
① 당선되거나 되게 할 목적으로 연설·방송·신문·통신·잡지·벽보·선전문서 기타의 방법으로
   후보자(후보자가 되려는 자를 포함)에게 유리하도록 후보자, 그의 배우자, 직계존비속이나
   형제자매에 관하여 허위의 사실을 공표하거나, 공표하게 한 자
② 당선되지 못하게 할 목적으로 후보자에게 불리하도록 허위의 사실을 공표한 자
- 위반 시: 5년 이하 징역 또는 3천만원 이하 벌금 + 당선무효

■ 제110조 (후보자비방죄)
공연히 사실을 적시하여 후보자(후보자가 되려는 자 포함)를 비방한 자.
다만, 진실한 사실로서 공공의 이익에 관한 때에는 처벌하지 아니한다.
- 사실이라도 비방 목적이면 위반
- 위반 시: 3년 이하 징역 또는 500만원 이하 벌금

■ 제112조 (기부행위의 제한)
① 후보자·예비후보자·선거사무관계자는 당해 선거구 안에 있는 자나 기관·단체·시설에
   금전·물품·음식물·향응·교통편의·숙박 등 기부행위를 할 수 없다.
② 결혼식 축의금·상가 부의금은 5만원 이내 허용
- "무료 제공", "경품", "추첨", "사은품" 등 약속도 기부행위에 해당
- 위반 시: 5년 이하 징역 또는 1천만원 이하 벌금 + 당선무효

■ 제93조 (탈법방법에 의한 문서·도화 배부 금지)
① 선거일 전 180일부터 선거일까지 선거에 영향을 미치게 하기 위하여 정당 또는 후보자를
   지지·추천하거나 반대하는 내용이 포함된 문서·도화·인쇄물·녹음테이프 등을 배부·게시 금지
② 다만, 인터넷 홈페이지·SNS를 이용한 선거운동은 상시 허용 (실명 확인 조건)
- 위반 시: 2년 이하 징역 또는 400만원 이하 벌금

■ 제82조의7 (인터넷 선거운동)
① 인터넷 홈페이지·SNS를 이용한 선거운동은 상시 허용
② 단, 정보통신망을 이용한 선거운동 시 전자우편·문자메시지 전송은
   수신자 동의 필요, 선거운동정보 표기 필요
- 블로그·유튜브·SNS 포스팅은 상시 가능 (선거운동 표현에 주의)
- 위반 시: 2년 이하 징역 또는 400만원 이하 벌금

■ 제108조 (여론조사의 결과공표 금지)
선거일 전 6일부터 선거일의 투표마감시각까지 선거에 관한 여론조사의 경위와
그 결과를 공표하거나 인용하여 보도할 수 없다.
- 위반 시: 3년 이하 징역 또는 600만원 이하 벌금

■ 제59조 (선거운동기간)
선거운동은 후보자등록마감일의 다음 날부터 선거일 전일까지에 한하여 할 수 있다.
다만, 예비후보자의 선거운동은 예비후보자등록일부터 가능.

■ 제86조 제5항 (홍보물 발행 제한)
지방자치단체의 장은 선거일 전 90일부터 업적홍보성 인쇄물·영상물·광고 등의
발행을 제한받는다. 1종 1회 개념 적용.
- 위반 시: 3년 이하 징역 또는 600만원 이하 벌금

■ 제82조의5 (문자메시지 전송)
문자메시지를 전송하는 방법으로 선거운동을 할 수 있으나,
① 선거운동정보 표기 필수
② 전화번호 표기 필수
③ 수신거부 방법 안내 필수
- 위반 시: 2년 이하 징역 또는 400만원 이하 벌금
"""


class ComplianceChecker:
    """선거 콘텐츠 법적 검증기 — 1단계 패턴 + 2단계 AI."""

    # ── 패턴 매칭용 ──

    AI_KEYWORDS = ["GPT", "ChatGPT", "Claude", "AI 생성", "인공지능 생성", "AI가 작성", "자동 생성", "AI 활용"]

    DEFAMATION_PATTERNS = [
        r"거짓말", r"사기꾼", r"범죄자", r"비리", r"뇌물", r"횡령",
        r"부패", r"전과", r"구속", r"체포", r"기소", r"탈세",
        r"도둑", r"먹튀", r"가짜", r"사이비", r"무능",
    ]

    MONETARY_PATTERNS = [
        r"돈\s*을?\s*(주|드|나눠|지급)", r"경품", r"추첨", r"상금",
        r"현금\s*(지급|제공)", r"무료\s*(제공|배포)",
        r"기프티콘", r"상품권", r"사은품",
    ]

    def check_content(self, text: str, content_type: str = "general", election_date: str = None) -> dict:
        """
        1단계 패턴 매칭 — 즉시 결과 반환.
        명백한 위반만 감지. 정밀 분석은 check_with_ai() 사용.
        """
        violations = []
        warnings = []
        suggestions = []

        # AI 생성물 표기
        has_ai_keyword = any(kw.lower() in text.lower() for kw in self.AI_KEYWORDS)
        has_ai_mark = "[AI 생성물]" in text or "[AI생성물]" in text or "[AI 활용]" in text
        if has_ai_keyword and not has_ai_mark:
            violations.append({
                "rule": "제82조의8 (AI 생성물 표시의무)",
                "detail": "AI 관련 키워드 포함 시 [AI 생성물] 또는 [AI 활용] 표기 필수",
                "penalty": "과태료 300만원 이하",
                "fix": "콘텐츠 시작에 '[AI 활용]' 표기 추가",
            })

        # 비방 패턴
        for pattern in self.DEFAMATION_PATTERNS:
            matches = re.findall(pattern, text)
            if matches:
                warnings.append({
                    "rule": "제110조 (후보자비방죄)",
                    "detail": f"'{matches[0]}' 표현이 후보자 비방에 해당할 수 있음",
                    "penalty": "3년 이하 징역 또는 500만원 이하 벌금",
                    "fix": "객관적 표현으로 수정 (사실이라도 비방 목적이면 위반)",
                })

        # 금품 제공
        for pattern in self.MONETARY_PATTERNS:
            matches = re.findall(pattern, text)
            if matches:
                violations.append({
                    "rule": "제112조 (기부행위의 제한)",
                    "detail": f"'{matches[0]}' 표현이 기부행위 제한 위반 소지",
                    "penalty": "5년 이하 징역 또는 1천만원 이하 벌금 + 당선무효",
                    "fix": "금품/경품 관련 표현 삭제",
                })

        # 시기별 제한
        if election_date:
            d_day = (date.fromisoformat(election_date) - date.today()).days
            warnings.extend(self._check_timeline(d_day, content_type))

        # AI 표기 권장
        if not has_ai_mark and content_type in ("blog", "sns", "youtube"):
            suggestions.append("[AI 활용] 표기를 콘텐츠 첫줄에 추가하세요 (제82조의8)")

        return {
            "compliant": len(violations) == 0,
            "violations": violations,
            "warnings": warnings,
            "suggestions": suggestions,
            "score": max(0, 100 - len(violations) * 30 - len(warnings) * 10),
            "check_type": "pattern",
        }

    async def check_with_ai(self, text: str, content_type: str, election_date: str = None,
                            tenant_id: str = None, db=None) -> dict:
        """
        2단계 AI 기반 정밀 검증 — 실제 법 조항을 AI에 전달하여 법적 판단.
        """
        from app.services.ai_service import call_claude

        d_day_info = ""
        if election_date:
            d_day = (date.fromisoformat(election_date) - date.today()).days
            d_day_info = f"\n선거일: {election_date} (D-{d_day})"

        prompt = f"""다음 선거 콘텐츠를 공직선거법 기준으로 정밀 검증해주세요.

{ELECTION_LAW_FULL}

[검증 대상 콘텐츠]
유형: {content_type}
{d_day_info}

---
{text[:3000]}
---

위 법 조항을 기준으로 다음을 JSON으로 반환:
{{
  "compliant": true/false,
  "violations": [
    {{"rule": "조항번호", "detail": "구체적 위반 내용", "penalty": "처벌 내용", "fix": "수정 방안", "quote": "위반 부분 인용"}}
  ],
  "warnings": [
    {{"rule": "조항번호", "detail": "주의 사항", "fix": "권장 수정"}}
  ],
  "suggestions": ["개선 제안"],
  "score": 0~100,
  "analysis": "종합 의견 (2~3문장)"
}}

반드시 실제 법 조항에 근거하여 판단하세요. 추측하지 마세요."""

        result = await call_claude(prompt, timeout=120, context="compliance_check",
                                   tenant_id=tenant_id, db=db)

        if result:
            result["check_type"] = "ai"
            return result

        # AI 실패 시 패턴 매칭 폴백
        fallback = self.check_content(text, content_type, election_date)
        fallback["check_type"] = "pattern_fallback"
        fallback["analysis"] = "AI 검증 실패 — 패턴 매칭 결과만 표시됩니다."
        return fallback

    def _check_timeline(self, d_day: int, content_type: str) -> list:
        items = []
        if d_day <= 0:
            items.append({"rule": "선거 종료", "detail": "선거가 종료되었습니다."})
        elif d_day <= 1:
            items.append({"rule": "제59조 — 선거일 전일", "detail": "선거운동 금지 기간 — 투표 독려 외 불가", "penalty": "각 규정별 처벌"})
        elif d_day <= 6:
            items.append({"rule": "제108조", "detail": "선거일 6일 전부터 여론조사 결과 공표·인용 금지", "penalty": "3년 이하 징역 또는 600만원 이하 벌금"})
        elif d_day <= 14:
            items.append({"rule": "제59조 (공식 선거운동 기간)", "detail": "모든 콘텐츠에 선거운동정보 표기 필요"})
        if d_day <= 90 and content_type in ("youtube", "sns"):
            items.append({"rule": "제82조의8 제2항", "detail": "AI 딥페이크 영상/이미지 사용 금지", "penalty": "7년 이하 징역 또는 1천~5천만원 벌금"})
        return items

    @staticmethod
    def get_law_text() -> str:
        """AI 프롬프트에 포함할 선거법 전문 반환."""
        return ELECTION_LAW_FULL
