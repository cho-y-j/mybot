"""
ElectionPulse - 공통 수집 필터
모든 collector가 공유하는 동명이인·관련성 필터 로직.
"""
from datetime import datetime, timezone, timedelta
from typing import Iterable
import structlog

logger = structlog.get_logger()


def apply_homonym_filter(
    items: list[dict],
    filters: dict | None,
    text_fields: Iterable[str] = ("title", "description"),
) -> list[dict]:
    """동명이인·관련성 필터를 텍스트 기반으로 적용.

    filters:
        exclude: list[str] — 이 단어가 본문에 있으면 무조건 차단
        require_any: list[str] — 이 중 하나라도 있어야 함 (정치/지역 컨텍스트 OR)
        require_name: list[str] — 후보 이름 변형 (이 중 하나라도 있어야 함, 강제)
    """
    if not filters:
        return items
    exclude = filters.get("exclude") or []
    require_any = filters.get("require_any") or []
    require_name = filters.get("require_name") or []

    filtered = []
    excluded = no_name = no_require = 0
    for item in items:
        text = " ".join(str(item.get(f, "") or "") for f in text_fields)
        if exclude and any(ex in text for ex in exclude):
            excluded += 1
            continue
        if require_name and not any(n in text for n in require_name):
            no_name += 1
            continue
        if require_any and not any(req in text for req in require_any):
            no_require += 1
            continue
        filtered.append(item)

    logger.info(
        "homonym_filtered",
        before=len(items), after=len(filtered),
        excluded=excluded, no_name=no_name, no_context=no_require,
    )
    return filtered


_DATE_RE = None  # lazy compile


def _parse_korean_date_text(text: str, now: datetime) -> str | None:
    """한국어 날짜 텍스트 → 'YYYY-MM-DD' 변환. 실패 시 None."""
    import re
    # 절대 날짜: "2026.04.10." 또는 "2026-04-10"
    m = re.search(r"(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})", text)
    if m:
        try:
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            return f"{y:04d}-{mo:02d}-{d:02d}"
        except ValueError:
            pass
    # 상대 시간
    m = re.search(r"(\d+)\s*시간\s*전", text)
    if m:
        return (now - timedelta(hours=int(m.group(1)))).strftime("%Y-%m-%d")
    m = re.search(r"(\d+)\s*일\s*전", text)
    if m:
        return (now - timedelta(days=int(m.group(1)))).strftime("%Y-%m-%d")
    m = re.search(r"(\d+)\s*분\s*전", text)
    if m:
        return now.strftime("%Y-%m-%d")
    m = re.search(r"(\d+)\s*주\s*전", text)
    if m:
        return (now - timedelta(weeks=int(m.group(1)))).strftime("%Y-%m-%d")
    if "어제" in text:
        return (now - timedelta(days=1)).strftime("%Y-%m-%d")
    if "오늘" in text or "방금" in text:
        return now.strftime("%Y-%m-%d")
    return None


def extract_naver_result_date(node, max_levels: int = 10) -> str | None:
    """네이버 검색 결과 HTML에서 작성 날짜 추출.

    네이버의 새 sds-comps 디자인 시스템은 CSS class가 자주 바뀌므로
    node의 조상 체인을 올라가며 날짜 텍스트를 찾는 방식 사용.

    Args:
        node: BeautifulSoup element (a_tag 또는 item container 어느 쪽이든)
        max_levels: 최대 몇 단계까지 올라갈지 (기본 10)

    Returns:
        'YYYY-MM-DD' 형식 문자열 또는 None
        (parse_published_at이 바로 처리 가능한 ISO 형식)
    """
    if node is None:
        return None

    now = datetime.now(timezone.utc)
    current = node

    for _ in range(max_levels):
        if current is None:
            break
        # 이 레벨의 모든 텍스트 노드를 순회
        try:
            for text in current.stripped_strings:
                t = str(text).strip()
                if not t or len(t) > 60:
                    continue
                result = _parse_korean_date_text(t, now)
                if result:
                    return result
        except Exception:
            pass
        # 상위로
        parent = getattr(current, "parent", None)
        if parent is None or parent == current:
            break
        current = parent

    return None


def parse_published_at(raw_date: str | None) -> datetime | None:
    """다양한 형식의 날짜 문자열을 aware datetime으로 파싱.

    지원: RFC 2822 (네이버 pubDate), ISO 8601 (유튜브 publishedAt),
         "YYYYMMDD" (네이버 블로그 postdate), "YYYY-MM-DD".
    실패 시 None.
    """
    if not raw_date:
        return None
    raw_date = raw_date.strip()

    # ISO 8601 (YouTube: "2026-04-10T09:00:00Z")
    try:
        return datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        pass

    # RFC 2822 (네이버 뉴스 pubDate)
    try:
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(raw_date)
        if dt:
            return dt
    except (ValueError, TypeError):
        pass

    # "YYYYMMDD" (네이버 블로그 postdate)
    if len(raw_date) == 8 and raw_date.isdigit():
        try:
            return datetime.strptime(raw_date, "%Y%m%d").replace(tzinfo=timezone.utc)
        except ValueError:
            pass

    # "YYYY-MM-DD" 또는 "YYYY.MM.DD"
    for fmt in ("%Y-%m-%d", "%Y.%m.%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(raw_date, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue

    return None


def is_within_recent_days(dt: datetime | None, days: int = 7) -> bool:
    """published_at이 최근 N일 이내인지 판정. None이면 False (드롭)."""
    if dt is None:
        return False
    now = datetime.now(timezone.utc)
    # naive datetime은 UTC로 가정
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt >= now - timedelta(days=days)
