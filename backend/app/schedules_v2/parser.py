"""
schedules_v2 — 자연어 → 구조화 일정 파서 (Sonnet 기반)

예시 입력:
  "내일 오후 3시 청주시청 유세"  → 단건
  "09:00 시청 조회 / 10:30 봉명동 거리인사 / 14:00~16:00 회의"  → 복수
  "매주 화 아침 시청 앞 거리인사"  → 반복(RRULE)
"""
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

import structlog

from app.services.ai_service import call_claude_text
from app.schedules_v2.schemas import (
    ParseRequest, ParseResponse, ParsedSchedule,
)

logger = structlog.get_logger()

KST = timezone(timedelta(hours=9))

WEEKDAYS_KO = ["월", "화", "수", "목", "금", "토", "일"]


SYSTEM_PROMPT_TEMPLATE = """당신은 한국 선거 캠프의 일정 관리 AI 비서입니다.
사용자의 자연어 입력을 일정 데이터로 정확하게 변환해야 합니다.

[현재 기준 — 이것을 반드시 사용]
- 현재 KST 일시: {now_kst} ({weekday_ko}요일)
- 기본 date (시간만 있을 때): {default_date}

[반드시 JSON 배열로만 응답 — 다른 설명 금지. 코드 블록 없이 순수 JSON.]

각 일정은 다음 형식:
{{
  "title": "짧은 제목 (예: '청주시청 유세')",
  "description": null 또는 "부가 설명",
  "location": "장소 텍스트 (예: '충북 청주시 상당로 155')" 또는 null,
  "starts_at": "ISO 8601 + timezone (예: '2026-04-22T15:00:00+09:00')",
  "ends_at": "ISO 8601 + timezone (예: '2026-04-22T17:00:00+09:00')",
  "all_day": false,
  "category": "rally|street|debate|broadcast|interview|meeting|supporter|voting|internal|other",
  "recurrence_rule": null 또는 "RRULE 문자열 (예: 'FREQ=WEEKLY;BYDAY=TU')",
  "confidence": 0.0 ~ 1.0,
  "warnings": ["모호한 점이 있으면 한국어 한 줄씩"]
}}

[규칙]
1. 입력이 여러 줄이면 각 줄을 **별개의 일정**으로 취급.
2. 시간 종료가 없으면 starts_at + 2시간을 ends_at으로.
3. 종일 일정 키워드("종일", "하루 종일")가 있으면 all_day=true, starts_at=00:00, ends_at=23:59.
4. 카테고리 추론:
   - 유세/집회/가두 → rally
   - 거리인사/주민인사 → street
   - 토론/간담/좌담 → debate
   - 방송/라디오/TV → broadcast
   - 인터뷰/취재 → interview
   - 회의/MT/내부 → meeting 또는 internal
   - 지지자/후원회/당원 → supporter
   - 투표/개표 → voting
   - 위에 없으면 other
5. 반복 표현 ("매주 화", "매일", "평일"):
   - 매주 화 → "FREQ=WEEKLY;BYDAY=TU"
   - 매주 월수금 → "FREQ=WEEKLY;BYDAY=MO,WE,FR"
   - 매일 → "FREQ=DAILY"
   - 평일 → "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
6. 상대 시간 표현:
   - "오늘" = 오늘
   - "내일" = 내일
   - "모레" = 2일 뒤
   - "다음주 화요일" = 오늘 기준 다음주 화요일
   - "오후 3시" = 15:00, "오전 9시" = 09:00, "저녁 7시" = 19:00
7. 장소가 애매하면(예: "시청") location에 그대로 넣되 description에도 원문 보존.
8. confidence는 시간·장소 모두 명확하면 0.95, 시간만 명확하면 0.75, 시간 애매하면 0.4 이하.
9. 입력을 해석 못 하면 빈 배열 `[]` 반환 (절대 빈 객체로 때우지 말 것).
10. 반드시 배열 형식 — 단건이어도 `[{{...}}]`.
"""


def _build_system_prompt(default_date: Optional[str] = None) -> str:
    now = datetime.now(KST)
    default_date = default_date or now.date().isoformat()
    return SYSTEM_PROMPT_TEMPLATE.format(
        now_kst=now.strftime("%Y-%m-%d %H:%M"),
        weekday_ko=WEEKDAYS_KO[now.weekday()],
        default_date=default_date,
    )


def _strip_code_fences(text: str) -> str:
    """AI가 코드 블록으로 감싸서 보낸 경우 제거."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _parse_iso_flexible(s: str) -> datetime:
    """'2026-04-22T15:00:00+09:00' / 'Z' / microseconds 모두 허용."""
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


async def parse_schedule_text(req: ParseRequest) -> ParseResponse:
    """
    자연어 입력을 ParsedSchedule 배열로 변환.
    저장은 하지 않음 — 사용자가 확인 후 /bulk 또는 /{election_id} POST 호출.
    """
    system_prompt = _build_system_prompt(req.default_date)
    user_prompt = f"{system_prompt}\n\n[사용자 입력]\n{req.text.strip()}"

    ai_text = await call_claude_text(
        user_prompt,
        timeout=45,
        context="schedule_parse",
        model_tier="standard",  # Sonnet
    )

    if not ai_text:
        return ParseResponse(
            parsed=[],
            raw_ai_text=None,
            overall_confidence=0.0,
        )

    cleaned = _strip_code_fences(ai_text)

    parsed_items: list[ParsedSchedule] = []
    try:
        raw = json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.warning("schedule_parse_json_fail", error=str(e)[:200], raw=cleaned[:200])
        return ParseResponse(
            parsed=[],
            raw_ai_text=ai_text,
            overall_confidence=0.0,
        )

    # dict 하나만 오면 list로 감싸기 (프롬프트는 배열 요구했지만 방어)
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list):
        logger.warning("schedule_parse_unexpected_type", type=type(raw).__name__)
        return ParseResponse(parsed=[], raw_ai_text=ai_text, overall_confidence=0.0)

    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            starts_at = _parse_iso_flexible(item["starts_at"])
            ends_at = _parse_iso_flexible(item["ends_at"])
            # 타임존 없으면 KST로 가정
            if starts_at.tzinfo is None:
                starts_at = starts_at.replace(tzinfo=KST)
            if ends_at.tzinfo is None:
                ends_at = ends_at.replace(tzinfo=KST)

            category = item.get("category", "other")
            if category not in (
                'rally', 'street', 'debate', 'broadcast', 'interview',
                'meeting', 'supporter', 'voting', 'internal', 'other',
            ):
                category = "other"

            parsed_items.append(ParsedSchedule(
                title=str(item.get("title", "")).strip() or "(제목 없음)",
                description=item.get("description"),
                location=item.get("location"),
                starts_at=starts_at,
                ends_at=ends_at,
                all_day=bool(item.get("all_day", False)),
                category=category,
                recurrence_rule=item.get("recurrence_rule"),
                confidence=float(item.get("confidence", 0.8)),
                warnings=list(item.get("warnings", [])),
            ))
        except (KeyError, ValueError, TypeError) as e:
            logger.warning("schedule_parse_item_fail", error=str(e)[:120], item=str(item)[:200])
            continue

    overall = (
        sum(p.confidence for p in parsed_items) / len(parsed_items)
        if parsed_items else 0.0
    )

    logger.info(
        "schedule_parse_done",
        input_length=len(req.text),
        parsed_count=len(parsed_items),
        overall_confidence=round(overall, 2),
    )

    return ParseResponse(
        parsed=parsed_items,
        raw_ai_text=ai_text if not parsed_items else None,  # 실패 시만 원문 노출
        overall_confidence=overall,
    )
