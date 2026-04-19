"""
추천 주제 엔진 — "이번 주 콘텐츠 주제 10개" 자동 푸시

담당자 워크플로우:
- 페이지 진입 → "이번 주 추천 주제" 10개가 이미 준비돼 있음
- 각 주제: 키워드 + 이유 + 관련도 + 추천 포맷 + 우선순위
- 클릭 → 주제 카드 (해시태그·블로그 제목 등) 자동 생성

범용성: 교육감·도지사·시장·군수·구청장·국회의원·지방의원 7유형 모두 지원
"""
from __future__ import annotations

import hashlib
import json
import structlog
from datetime import datetime, timezone, timedelta, date
from typing import Any

from sqlalchemy import select, func, text, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.elections.models import Election, Candidate, NewsArticle, CommunityPost, Survey
from app.common.election_access import list_election_candidates, get_our_candidate_id

logger = structlog.get_logger()


# 선거 유형별 기본 이슈 풀 (AI가 이 리스트를 참고하되, 지역·시사 맥락에 맞게 선별/변형/확장)
ELECTION_ISSUE_POOL: dict[str, list[str]] = {
    "superintendent": [
        "늘봄학교", "사교육비", "AI교육", "교권", "학교폭력", "고교학점제",
        "돌봄공백", "무상급식", "디지털교육", "교육격차", "학교시설안전",
        "원어민교사", "특수교육", "유아교육", "학부모상담", "방과후학교",
    ],
    "governor": [
        "지역경제", "일자리창출", "균형발전", "대중교통", "인구감소",
        "지방소멸", "산업단지", "청년정책", "주거복지", "노인돌봄",
        "관광진흥", "스마트농업", "귀농귀촌", "기후위기", "재난대응",
        "의료접근성", "공공의료", "광역철도",
    ],
    "mayor": [
        "교통체증", "주거", "재개발", "생활민원", "문화시설", "공원녹지",
        "스마트시티", "돌봄", "지역상권", "청년주거", "도시재생",
        "쓰레기처리", "안전", "주차난", "아동친화도시", "장애인복지",
    ],
    "gun_head": [
        "농업진흥", "귀농귀촌", "인구감소", "지역특산품", "관광", "축제",
        "기초생활", "의료사각지대", "교통불편", "청년유입", "학교통폐합",
        "농촌일손", "마을공동체", "기후농업",
    ],
    "gu_head": [
        "재개발", "주차장", "공공시설", "생활민원", "청년주거",
        "어르신복지", "아동친화", "공원", "안전", "문화예술",
    ],
    "congressional": [
        "지역구숙원사업", "국비확보", "SOC인프라", "지역경제활성화",
        "청년일자리", "주거정책", "복지사각지대", "지방분권", "예산심사",
        "의정활동", "민생입법", "기후대응",
    ],
    "council": [
        "지역예산", "의정활동", "조례제정", "생활민원", "공청회",
        "예산심사", "주민참여", "지역발전", "복지", "안전",
    ],
}


async def recommend_weekly_topics(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    force: bool = False,
) -> dict[str, Any]:
    """이번 주 추천 주제 10개 생성. 24시간 캐시."""
    # 1. 선거/후보 컨텍스트
    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        return {"error": "선거 정보 없음", "topics": []}

    our_cid = await get_our_candidate_id(db, tenant_id, election.id)
    candidates = await list_election_candidates(db, election.id, tenant_id=tenant_id)
    our_candidate = next((c for c in candidates if str(c.id) == str(our_cid)), None)
    competitors = [c for c in candidates if str(c.id) != str(our_cid or "")]

    # 2. 입력 시그니처 (뉴스 건수 + 커뮤니티 건수 + 여론조사 건수)
    since = date.today() - timedelta(days=7)
    news_cnt = (await db.execute(
        select(func.count(NewsArticle.id)).where(
            NewsArticle.election_id == election.id,
            NewsArticle.is_relevant == True,
            func.date(NewsArticle.collected_at) >= since,
        )
    )).scalar() or 0
    community_cnt = (await db.execute(
        select(func.count(CommunityPost.id)).where(
            CommunityPost.election_id == election.id,
            CommunityPost.is_relevant == True,
            func.date(CommunityPost.collected_at) >= since,
        )
    )).scalar() or 0
    survey_cnt = (await db.execute(
        select(func.count(Survey.id)).where(Survey.region_sido == election.region_sido)
    )).scalar() or 0
    signature = hashlib.md5(
        f"{news_cnt}:{community_cnt}:{survey_cnt}:{our_cid}:{date.today().isoformat()}".encode()
    ).hexdigest()

    # 3. 캐시 조회
    if not force:
        cached = (await db.execute(text("""
            SELECT topics, context_summary, inputs_signature, generated_at
            FROM topic_recommendations_cache
            WHERE election_id = :eid AND tenant_id = :tid
        """), {"eid": str(election_id), "tid": str(tenant_id)})).first()
        if cached:
            topics, ctx, sig, gen_at = cached
            age = datetime.now(timezone.utc) - gen_at
            if isinstance(topics, str):
                topics = json.loads(topics)
            if isinstance(ctx, str) and ctx:
                ctx = json.loads(ctx)
            stale = (age > timedelta(hours=24)) or (sig != signature)
            return {
                "topics": topics,
                "context": ctx or {},
                "generated_at": gen_at.isoformat(),
                "age_hours": round(age.total_seconds() / 3600, 1),
                "stale": stale,
                "stale_reason": (
                    "24시간 경과 — 새로고침 권장" if age > timedelta(hours=24) else
                    "데이터 변경됨 (뉴스/여론조사 업데이트)" if sig != signature else None
                ),
                "cached": True,
            }

    # 4. 최근 7일 뉴스 핫 키워드 (AI에게 컨텍스트)
    recent_news = (await db.execute(
        select(NewsArticle.title, NewsArticle.ai_summary, NewsArticle.sentiment)
        .where(
            NewsArticle.election_id == election.id,
            NewsArticle.is_relevant == True,
            func.date(NewsArticle.collected_at) >= since,
        )
        .order_by(NewsArticle.collected_at.desc())
        .limit(15)
    )).all()

    recent_community = (await db.execute(
        select(CommunityPost.title, CommunityPost.ai_summary)
        .where(
            CommunityPost.election_id == election.id,
            CommunityPost.is_relevant == True,
            func.date(CommunityPost.collected_at) >= since,
        )
        .order_by(CommunityPost.collected_at.desc())
        .limit(10)
    )).all()

    # 5. AI 호출 (Sonnet)
    from app.services.ai_service import call_claude_text

    etype = election.election_type
    issue_pool = ELECTION_ISSUE_POOL.get(etype, [])
    etype_label_map = {
        "superintendent": "교육감", "governor": "도지사", "mayor": "시장",
        "gun_head": "군수", "gu_head": "구청장",
        "congressional": "국회의원", "council": "지방의원",
    }
    etype_label = etype_label_map.get(etype, etype)
    region = election.region_sido or ""
    region_full = f"{region} {election.region_sigungu}" if election.region_sigungu else region

    news_block = "\n".join(f"- {n.title}" for n in recent_news[:12]) if recent_news else "- 없음"
    community_block = "\n".join(f"- {c.title or ''}" for c in recent_community[:8]) if recent_community else "- 없음"

    our_name = our_candidate.name if our_candidate else "(미설정)"
    competitors_line = ", ".join(c.name for c in competitors[:5]) or "(없음)"
    pool_line = ", ".join(issue_pool[:20]) if issue_pool else "(해당 선거 유형의 기본 이슈 풀이 없습니다. AI가 스스로 판단하세요.)"

    prompt = f"""당신은 한국 지방선거 캠프의 온라인 홍보 담당자를 돕는 전략 어시스턴트입니다.
담당자가 인력 부족으로 **"오늘 뭐 쓸까"** 고민할 시간이 없습니다.
**이번 주 블로그/SNS/쇼츠 콘텐츠 주제 10개**를 즉시 사용 가능한 형태로 추천하세요.

## 선거: {etype_label} · {region_full}
## 우리 후보: {our_name}
## 경쟁 후보: {competitors_line}
## 오늘 날짜: {date.today().isoformat()}

## 이 선거 유형의 기본 이슈 풀 (참고용):
{pool_line}

## 최근 7일 수집 뉴스 (실제 이슈):
{news_block}

## 최근 7일 커뮤니티 여론:
{community_block}

## 출력 요구사항
**JSON 배열만** 반환하세요. 설명 금지. 코드블록 없이 순수 JSON.

```json
[
  {{
    "keyword": "구체적 주제 (5~15자, 검색 가능한 키워드)",
    "title_hint": "이 주제로 쓸 블로그/포스팅 제목 한 줄 예시 (40자 내외)",
    "reason": "왜 지금 이 주제를 써야 하는지 (한 문장)",
    "relevance_score": 0~100 정수,
    "format": "blog" | "sns" | "shorts",
    "priority": "high" | "medium" | "low",
    "target_audience": "누구를 겨냥한 콘텐츠인지 (한 줄)",
    "angle": "어떤 관점·톤으로 써야 효과적인지 (한 줄)",
    "hashtags": ["#관련해시태그", "...", "5~7개"]
  }},
  ...
]
```

## 생성 규칙
- **10개 정확히** 반환
- 최소 4개는 **뉴스/커뮤니티에서 실제 나온 이슈** 반영 (상단에 위치)
- 최소 3개는 **{etype_label} 선거의 본질적 정책 주제** ({region}의 특성 반영)
- 최소 2개는 **경쟁 후보 대비 우리 후보의 강점·포지셔닝** 주제
- 포맷 분배: 블로그 5~6개, SNS 2~3개, 쇼츠 1~2개 (유동)
- priority: high = 지금 당장 써야, medium = 이번 주 내, low = 시간 여유 있으면
- 키워드는 **검색창에 바로 넣을 수 있는 형태** — 모호한 표현 금지
  - 나쁨: "교육의 미래"  좋음: "충북 AI교육 도입"
- 지역성 강조: 주제에 "{region}" 또는 "{election.region_sigungu or ''}" 단어 자연스럽게 포함 가능
- 경쟁 후보 비방 금지 (법률·윤리)"""

    try:
        text_resp = await call_claude_text(
            prompt, timeout=180,
            context="topic_recommender",  # standard tier (Sonnet)
            tenant_id=str(tenant_id), db=db,
        )
    except Exception as e:
        logger.warning("topic_recommender_ai_failed", error=str(e))
        return {"error": f"AI 호출 실패: {str(e)[:100]}", "topics": []}

    if not text_resp:
        return {"error": "AI 응답 없음", "topics": []}

    # JSON 파싱
    try:
        s = text_resp.strip()
        if s.startswith("```"):
            s = s.split("```", 2)[1]
            if s.startswith("json"):
                s = s[4:]
            s = s.rsplit("```", 1)[0]
        topics = json.loads(s.strip())
        if not isinstance(topics, list):
            raise ValueError("JSON이 배열이 아님")
    except Exception as e:
        logger.warning("topic_recommender_parse_failed", error=str(e), preview=text_resp[:200])
        return {"error": f"AI 응답 파싱 실패: {str(e)[:80]}", "topics": []}

    # 정렬: priority high 우선 + relevance_score 내림차순
    priority_order = {"high": 0, "medium": 1, "low": 2}
    topics.sort(key=lambda t: (priority_order.get(t.get("priority"), 3), -int(t.get("relevance_score") or 0)))

    context_summary = {
        "election_type": etype,
        "region": region_full,
        "recent_news_count": news_cnt,
        "recent_community_count": community_cnt,
        "survey_count": survey_cnt,
        "competitors": [c.name for c in competitors],
    }

    # DB upsert
    await db.execute(text("""
        INSERT INTO topic_recommendations_cache
            (election_id, tenant_id, topics, context_summary, inputs_signature, generated_at, updated_at)
        VALUES
            (:eid, :tid, CAST(:topics AS jsonb), CAST(:ctx AS jsonb), :sig, NOW(), NOW())
        ON CONFLICT (election_id, tenant_id) DO UPDATE SET
            topics = EXCLUDED.topics,
            context_summary = EXCLUDED.context_summary,
            inputs_signature = EXCLUDED.inputs_signature,
            generated_at = NOW(),
            updated_at = NOW()
    """), {
        "eid": str(election_id),
        "tid": str(tenant_id),
        "topics": json.dumps(topics, ensure_ascii=False),
        "ctx": json.dumps(context_summary, ensure_ascii=False),
        "sig": signature,
    })
    await db.commit()

    return {
        "topics": topics,
        "context": context_summary,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "age_hours": 0.0,
        "stale": False,
        "cached": False,
    }
