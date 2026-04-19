"""
주제 선정 대시보드 — 담당자가 '오늘 이 키워드로 포스팅할까' 5분 안에 결정하도록 돕는 통합 엔진.

핵심 원칙:
- 한눈에 판단 가능한 요약 카드 (볼륨 + 관련도 + 해시태그 + 롱테일 + 추천 포맷)
- 복사/붙여넣기 바로 가능한 결과물 (해시태그 묶음, 블로그 제목, 메타 설명)
- 네이버 API는 월간만 주므로 일/주는 추정치 + DataLab 트렌드 ratio 활용
- AI 호출 한 번에 관련도/해시태그/포맷/제목/메타 일괄 생성 (Sonnet)
"""
from __future__ import annotations

import json
import structlog
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.collectors.keyword_volume import KeywordVolumeAPI
from app.elections.models import Election
from app.common.election_access import get_our_candidate_id, list_election_candidates

logger = structlog.get_logger()


ELECTION_TYPE_LABEL = {
    "superintendent": "교육감",
    "governor": "도지사",
    "mayor": "시장",
    "gun_head": "군수",
    "gu_head": "구청장",
    "congressional": "국회의원",
    "council": "지방의원",
}


async def build_topic_card(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    keyword: str,
) -> dict[str, Any]:
    """키워드 1개 → 담당자가 결정 가능한 완전한 주제 카드."""
    keyword = keyword.strip()
    if not keyword:
        return {"error": "키워드 비어있음"}

    # 1) 선거/후보 컨텍스트
    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        return {"error": "선거 정보 없음"}

    our_cid = await get_our_candidate_id(db, tenant_id, election.id)
    candidates = await list_election_candidates(db, election.id, tenant_id=tenant_id)
    our_candidate = next((c for c in candidates if str(c.id) == str(our_cid)), None)
    our_name = our_candidate.name if our_candidate else None

    etype_label = ELECTION_TYPE_LABEL.get(election.election_type, election.election_type)
    region = election.region_sido or ""
    region_short = region.replace("광역시", "").replace("특별시", "").replace("특별자치시", "").replace("도", "")[:2] \
        if region else ""

    # 2) 네이버 검색광고 API — 해당 키워드 + 연관 키워드
    vol_api = KeywordVolumeAPI()
    all_results = await vol_api.get_keyword_volumes([keyword])

    exact = next((r for r in all_results if r["keyword"].strip() == keyword), None)
    related = [r for r in all_results if r["keyword"].strip() != keyword]

    if not exact:
        # 키워드 자체 데이터 없으면 related 최상위 하나로 대체
        exact = all_results[0] if all_results else {
            "keyword": keyword, "pc": 0, "mobile": 0, "total": 0, "competition": "없음",
        }

    monthly_total = int(exact.get("total") or 0)
    monthly_pc = int(exact.get("pc") or 0)
    monthly_mobile = int(exact.get("mobile") or 0)

    volume = {
        "monthly_total": monthly_total,
        "monthly_pc": monthly_pc,
        "monthly_mobile": monthly_mobile,
        # 일/주는 추정치 — 네이버는 월간만 제공
        "daily_estimate": round(monthly_total / 30) if monthly_total else 0,
        "weekly_estimate": round(monthly_total / 4.3) if monthly_total else 0,
        "pc_ratio": round((monthly_pc / monthly_total) * 100) if monthly_total else 0,
        "mobile_ratio": round((monthly_mobile / monthly_total) * 100) if monthly_total else 0,
        "competition": exact.get("competition") or "없음",
        "avg_pc_ctr": exact.get("avg_pc_ctr", 0),
        "avg_mobile_ctr": exact.get("avg_mobile_ctr", 0),
    }

    # 3) 경쟁도 낮은 롱테일 키워드 (담당자 실무 핵심)
    # — 경쟁도 "낮음" + 월 검색량 500~ + 상위 10개
    longtail = []
    for r in related:
        comp = (r.get("competition") or "").strip()
        total = int(r.get("total") or 0)
        if comp in ("낮음", "low", "LOW") and total >= 500:
            longtail.append({
                "keyword": r["keyword"],
                "total": total,
                "daily_estimate": round(total / 30),
                "competition": comp,
                "pc": int(r.get("pc") or 0),
                "mobile": int(r.get("mobile") or 0),
            })
    longtail = sorted(longtail, key=lambda x: -x["total"])[:10]

    # 높은 검색량 관련 키워드 (경쟁도 무관)
    top_related = [
        {
            "keyword": r["keyword"],
            "total": int(r.get("total") or 0),
            "competition": r.get("competition") or "",
        }
        for r in sorted(related, key=lambda x: -int(x.get("total") or 0))[:10]
    ]

    # 4) AI 호출 한 번 — 관련도/해시태그/포맷/제목/메타 일괄
    ai_bundle = await _generate_ai_bundle(
        keyword=keyword,
        our_name=our_name,
        etype_label=etype_label,
        region=region,
        region_short=region_short,
        competitors=[c.name for c in candidates if not (our_cid and str(c.id) == str(our_cid))],
        monthly_total=monthly_total,
        competition=volume["competition"],
        top_related=top_related[:5],
        tenant_id=str(tenant_id),
        db=db,
    )

    # AI가 필터링한 "선거 맥락 관련 있는 것만"
    relevant_names = set(ai_bundle.get("related_relevant", []) or [])
    filtered_related = [r for r in top_related if r["keyword"] in relevant_names]
    filtered_longtail = [lt for lt in longtail if lt["keyword"] in relevant_names]

    # AI가 직접 제안한 롱테일 (네이버 반환이 부실할 때)
    ai_longtail = ai_bundle.get("longtail_suggestions", []) or []

    return {
        "keyword": keyword,
        "election": {
            "id": str(election.id),
            "name": election.name,
            "type_label": etype_label,
            "region": region,
            "our_candidate": our_name,
        },
        "volume": volume,
        "relevance": ai_bundle.get("relevance", {}),
        "hashtags": ai_bundle.get("hashtags", []),
        "longtail": filtered_longtail,          # 네이버 롱테일 중 선거 관련만
        "ai_longtail": ai_longtail,              # AI가 제안하는 롱테일
        "top_related": filtered_related,         # 네이버 관련 중 선거 관련만
        "raw_related": top_related,              # 참고용 (디버그/확인)
        "recommended_format": ai_bundle.get("format", {}),
        "blog_titles": ai_bundle.get("blog_titles", []),
        "meta_descriptions": ai_bundle.get("meta_descriptions", []),
        "sns_captions": ai_bundle.get("sns_captions", []),
        "ai_generated": ai_bundle.get("ai_generated", False),
    }


async def _generate_ai_bundle(
    *, keyword: str, our_name: str | None, etype_label: str, region: str, region_short: str,
    competitors: list[str], monthly_total: int, competition: str, top_related: list[dict],
    tenant_id: str, db: AsyncSession,
) -> dict:
    """Sonnet 1회 호출로 관련도/해시태그/포맷/제목/메타/SNS 캡션 일괄 생성."""
    from app.services.ai_service import call_claude_text

    cand_line = f" | 우리 후보: {our_name}" if our_name else ""
    comp_line = f" | 경쟁 후보: {', '.join(competitors[:5])}" if competitors else ""
    related_line = "\n".join(f"- {r['keyword']} ({r['total']:,}회)" for r in top_related) or "- 없음"

    prompt = f"""당신은 한국 지방선거 캠프의 온라인 홍보 담당자를 돕는 어시스턴트입니다.

## 키워드: "{keyword}"
## 선거: {etype_label} · {region}{cand_line}{comp_line}
## 월간 검색량: {monthly_total:,}회 · 경쟁도: {competition}

## 네이버 광고 API가 반환한 관련 키워드 (광고용이므로 선거와 무관한 것 다수 포함):
{related_line}

위 데이터를 보고 담당자가 **이 키워드로 블로그/SNS 포스팅을 해야 할지** 결정할 수 있도록 아래 JSON으로 **정확히** 반환하세요. 설명 없이 JSON만.

```json
{{
  "relevance": {{
    "score": 0-100 정수,
    "reason": "왜 이 점수인지 한 문장",
    "our_candidate_match": true/false
  }},
  "hashtags": [
    "#후보이름_키워드_결합 형태로 5~10개 — 지역·후보·키워드 조합",
    "뻔한 해시태그 말고 롱테일 스타일",
    "특수문자 없이, 띄어쓰기 없이"
  ],
  "related_relevant": [
    "네이버 반환 중 선거 맥락에 유용한 것만 엄선 (0~5개). 광고·상품·연예는 제외",
    "하나도 없으면 빈 배열 반환"
  ],
  "longtail_suggestions": [
    "네이버 반환이 부실할 때 AI가 직접 제안하는 롱테일 3~5개.",
    "형식: {{\"keyword\": \"키워드\", \"reason\": \"왜 담당자에게 유용한지 한 문장\"}}"
  ],
  "format": {{
    "type": "blog" 또는 "sns" 또는 "shorts",
    "reason": "왜 이 포맷이 적합한지 한 문장"
  }},
  "blog_titles": [
    "SEO 친화적 제목 3개 — 키워드 자연스럽게 포함, 40자 내외"
  ],
  "meta_descriptions": [
    "검색 결과에 뜨는 요약 2개 — 80~120자, 키워드 포함"
  ],
  "sns_captions": [
    "SNS(페이스북/인스타) 공유 문구 2개 — 감성 or 정보 톤, 100자 내외"
  ]
}}
```

주의:
- 해시태그는 실제로 의미 있는 조합으로. 예: 충북+늘봄학교+김진균 → `#충북늘봄학교` `#김진균교육공약` 등
- 우리 후보 이름({our_name or '(미설정)'})이 들어간 해시태그 2~3개 포함
- related_relevant: "챗지피티", "학원광고" 같은 건 제외. "정책 관련 변형어" 만
- longtail_suggestions: 담당자가 실제 블로그 제목·검색창에 쓸 법한 구체적 변형. "충북 + 키워드", "키워드 문제점", "키워드 대안" 스타일
- 관련도 점수는 **이 키워드가 {etype_label}({region}) 선거 콘텐츠로 적합한가** 기준
- 포맷 선택 기준: 정책/이슈(blog), 감성/짧은 반응(sns), 실시간 속보(shorts)"""

    try:
        text = await call_claude_text(
            prompt,
            timeout=45,
            context="topic_card_bundle",  # standard tier (Sonnet)
            tenant_id=tenant_id,
            db=db,
        )
    except Exception as e:
        logger.warning("topic_card_ai_failed", keyword=keyword, error=str(e))
        return _fallback_bundle(keyword, our_name, region_short)

    if not text:
        return _fallback_bundle(keyword, our_name, region_short)

    # JSON 추출 — 코드블록 있거나 없거나 처리
    try:
        s = text.strip()
        if s.startswith("```"):
            s = s.split("```", 2)[1]
            if s.startswith("json"):
                s = s[4:]
            s = s.rsplit("```", 1)[0]
        parsed = json.loads(s.strip())
        parsed["ai_generated"] = True
        return parsed
    except Exception as e:
        logger.warning("topic_card_json_parse_failed", error=str(e), preview=text[:200])
        return _fallback_bundle(keyword, our_name, region_short)


def _fallback_bundle(keyword: str, our_name: str | None, region_short: str) -> dict:
    """AI 실패 시 최소한의 결과 — 담당자가 빈 화면 안 보게."""
    kw_clean = keyword.replace(" ", "")
    hashtags = [f"#{kw_clean}"]
    if region_short:
        hashtags.append(f"#{region_short}{kw_clean}")
    if our_name:
        name_clean = our_name.replace(" ", "")
        hashtags.extend([f"#{name_clean}{kw_clean}", f"#{name_clean}공약"])
    return {
        "relevance": {"score": 0, "reason": "AI 생성 실패 — 수동 판단 필요", "our_candidate_match": False},
        "hashtags": hashtags,
        "format": {"type": "blog", "reason": "기본값"},
        "blog_titles": [f"{keyword}, 지금 알아야 할 핵심"],
        "meta_descriptions": [],
        "sns_captions": [],
        "ai_generated": False,
    }


async def trending_topics_with_relevance(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
) -> dict:
    """실시간 급상승 키워드 + AI 관련도 점수 → 관련도 높은 것 상단 정렬."""
    import httpx
    import xml.etree.ElementTree as ET
    import re

    # 선거 컨텍스트
    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        return {"trends": [], "error": "선거 정보 없음"}

    etype_label = ELECTION_TYPE_LABEL.get(election.election_type, election.election_type)
    region = election.region_sido or ""

    # Google Trends RSS
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get("https://trends.google.com/trending/rss?geo=KR", timeout=10)
        root = ET.fromstring(resp.text)
        ns = {'ht': 'https://trends.google.com/trending/rss'}
        raw_items = []
        for item in root.findall('.//item'):
            title = (item.find('title').text or '').strip()
            if not re.search(r'[가-힣]', title):
                continue
            traffic = item.find('ht:approx_traffic', ns)
            news_items = []
            for ni in item.findall('ht:news_item', ns):
                nt = ni.find('ht:news_item_title', ns)
                nu = ni.find('ht:news_item_url', ns)
                if nt is not None:
                    news_items.append({"title": nt.text, "url": nu.text if nu is not None else ""})
            raw_items.append({
                "keyword": title,
                "traffic": traffic.text if traffic is not None else '',
                "news": news_items[:2],
            })
    except Exception as e:
        logger.error("trending_rss_failed", error=str(e))
        return {"trends": [], "error": f"Google Trends RSS 실패: {e}"}

    if not raw_items:
        return {"trends": [], "count": 0, "source": "Google Trends"}

    # AI 관련도 — 한 번의 호출로 전체 키워드 배치
    scored = await _score_relevance_batch(
        items=raw_items[:25],
        etype_label=etype_label,
        region=region,
        our_name=None,  # 관련도 판정에서는 후보명 결합 영향 제외
        tenant_id=str(tenant_id),
        db=db,
    )

    # 관련도 내림차순 정렬
    scored.sort(key=lambda x: -x.get("relevance_score", 0))

    return {
        "trends": scored,
        "count": len(scored),
        "source": "Google Trends + AI 관련도",
        "election_type": etype_label,
        "region": region,
    }


async def _score_relevance_batch(
    *, items: list[dict], etype_label: str, region: str, our_name: str | None,
    tenant_id: str, db: AsyncSession,
) -> list[dict]:
    """배치 관련도 점수 — 한 번의 AI 호출."""
    from app.services.ai_service import call_claude_text

    keywords_block = "\n".join(f"{i+1}. {it['keyword']}" for i, it in enumerate(items))

    prompt = f"""당신은 한국 {etype_label}({region}) 선거 캠프의 홍보 담당자입니다.
아래는 Google 실시간 급상승 검색어들입니다. 각 키워드가 **이 선거 홍보 콘텐츠로 적합한가** (0~100점) 판정하세요.

## 판정 기준
- 90+: 선거 주제와 직접 관련 (예: 교육감 선거에서 "늘봄학교", "사교육비")
- 70~89: 관련 있으나 간접적 (예: "아이돌봄" 정도)
- 50~69: 지역 이슈로 연결 가능
- 30~49: 약한 연결
- 0~29: 무관 (연예, 스포츠, 일반 사건)

## 급상승 키워드 목록:
{keywords_block}

**JSON 배열만** 반환하세요. 설명 금지.
```json
[{{"idx": 1, "score": 95, "reason": "한 문장"}}, ...]
```"""

    try:
        text = await call_claude_text(
            prompt, timeout=30,
            context="trending_relevance_batch",
            tenant_id=tenant_id, db=db,
        )
    except Exception as e:
        logger.warning("trending_relevance_failed", error=str(e))
        # 실패 시: 원래 데이터 그대로 + score 0
        return [{**it, "relevance_score": 0, "relevance_reason": "AI 관련도 판정 실패"} for it in items]

    if not text:
        return [{**it, "relevance_score": 0, "relevance_reason": "AI 응답 없음"} for it in items]

    try:
        s = text.strip()
        if s.startswith("```"):
            s = s.split("```", 2)[1]
            if s.startswith("json"):
                s = s[4:]
            s = s.rsplit("```", 1)[0]
        parsed = json.loads(s.strip())
    except Exception as e:
        logger.warning("trending_relevance_parse_failed", error=str(e), preview=text[:200])
        return [{**it, "relevance_score": 0, "relevance_reason": "AI 응답 파싱 실패"} for it in items]

    # idx → score 매핑
    score_map = {int(p["idx"]): (int(p.get("score", 0)), p.get("reason", "")) for p in parsed if isinstance(p, dict)}
    return [
        {**it,
         "relevance_score": score_map.get(i + 1, (0, ""))[0],
         "relevance_reason": score_map.get(i + 1, (0, ""))[1]}
        for i, it in enumerate(items)
    ]
