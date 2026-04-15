"""
ElectionPulse - 풍부한 AI 컨텍스트 빌더 (챗/토론/콘텐츠 공용)

통합 소스:
  1. RAG 벡터 검색 (내부 수집 데이터 의미 기반)
  2. 과거 선거 NEC 데이터
  3. 후보자 공식 프로필 (info.nec.go.kr)
  4. 캠프 학습 메모리 (보고서/브리핑/이전 콘텐츠)
  5. 공직선거법 10개 조항

모든 소스에 출처 각주 [ref-xxx] 부여 → citations 배열 반환.
"""
from datetime import date
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

import structlog
logger = structlog.get_logger()


async def build_rich_context(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    topic: str,
    *,
    include_realtime: bool = False,  # 웹검색 필요 여부 (토론/콘텐츠는 AI가 직접 호출)
    max_rag: int = 12,
    max_reports: int = 3,
    max_briefings: int = 4,
    include_law: bool = True,
    include_profiles: bool = True,
) -> tuple[str, list[dict]]:
    """
    주제에 맞는 풍부한 컨텍스트 + 출처 배열 반환.

    Returns: (context_text, citations)
      citations = [{"id": "rag-1", "type": "news", "title": "...", "url": "...", ...}]
    """
    from app.elections.models import Election
    from app.common.election_access import list_election_candidates

    sections = []
    citations: list[dict] = []

    # 1. 기본 정보
    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        return "", []

    candidates = await list_election_candidates(db, election_id, tenant_id=tenant_id)
    our = next((c for c in candidates if c.is_our_candidate), None)
    competitors = [c for c in candidates if not c.is_our_candidate]
    d_day = (election.election_date - date.today()).days if election.election_date else 0

    comp_strs = [f"{c.name}({c.party or '무소속'})" for c in competitors]
    info = [
        "=== 선거 기본 정보 ===",
        f"선거: {election.name} (D-{d_day})",
        f"지역: {election.region_sido or ''} {election.region_sigungu or ''}",
        f"유형: {election.election_type}",
        f"우리 후보: {our.name if our else '-'} ({our.party if our and our.party else '무소속'})",
        f"경쟁 후보: {', '.join(comp_strs)}",
    ]
    sections.append("\n".join(info))

    # 2. RAG 벡터 검색 — 주제와 관련된 데이터
    try:
        from app.services.embedding_service import search_similar
        rag = await search_similar(db, tenant_id, topic, limit=max_rag, election_id=election_id)
        if rag:
            lines = ["=== 주제 관련 수집 데이터 (AI 벡터 검색) ==="]
            for i, r in enumerate(rag, 1):
                rid = f"rag-{i}"
                lines.append(f"[ref-{rid}] [{r['source_type']}] {r['title'] or ''} (유사도 {r['similarity']})")
                if r.get('content'):
                    lines.append(f"  {r['content']}")
                citations.append({
                    "id": rid, "type": r['source_type'],
                    "title": r['title'] or '',
                    "source_id": r.get('source_id'),
                    "preview": (r['content'] or '')[:200],
                    "similarity": r.get('similarity'),
                })
            sections.append("\n".join(lines))
    except Exception as e:
        logger.warning("rich_ctx_rag_failed", error=str(e)[:100])
        try: await db.rollback()
        except Exception: pass

    # 3. 후보자 공식 프로필
    if include_profiles and candidates:
        try:
            from app.elections.models import CandidateProfile
            prof_lines = ["=== 후보자 공식 프로필 (info.nec.go.kr) ==="]
            has_data = False
            for c in candidates[:6]:
                p = (await db.execute(
                    select(CandidateProfile).where(CandidateProfile.candidate_id == c.id)
                )).scalar_one_or_none()
                if p:
                    has_data = True
                    prof_lines.append(f"\n▶ {c.name} ({c.party or '무소속'})")
                    if p.education: prof_lines.append(f"  학력: {p.education}")
                    if p.career: prof_lines.append(f"  경력: {p.career[:300]}")
                    if p.assets: prof_lines.append(f"  재산: {p.assets}")
                    if p.military: prof_lines.append(f"  병역: {p.military}")
                    if p.crimes: prof_lines.append(f"  전과: {p.crimes}")
                    if p.pledges_nec:
                        pl = p.pledges_nec if isinstance(p.pledges_nec, list) else []
                        if pl:
                            prof_lines.append(f"  공약: {', '.join(str(x)[:60] for x in pl[:5])}")
                    if p.source_url:
                        pid = f"nec-{str(c.id)[:8]}"
                        prof_lines.append(f"  [ref-{pid}] 출처: {p.source_url}")
                        citations.append({
                            "id": pid, "type": "nec",
                            "title": f"{c.name} 공식 프로필",
                            "source": "info.nec.go.kr",
                            "url": p.source_url,
                        })
            if has_data:
                sections.append("\n".join(prof_lines))
        except Exception as e:
            logger.warning("rich_ctx_profile_failed", error=str(e)[:100])
            try: await db.rollback()
            except Exception: pass

    # 4. 과거 선거 데이터 (NEC)
    try:
        from app.chat.context_builder import _build_history_context
        hist = await _build_history_context(db, election_id, election)
        if hist:
            sections.append(hist)
            citations.append({
                "id": "nec-history", "type": "nec",
                "title": f"{election.region_sido} {election.election_type} 역대 선거",
                "source": "중앙선거관리위원회",
            })
    except Exception as e:
        logger.warning("rich_ctx_history_failed", error=str(e)[:100])
        try: await db.rollback()
        except Exception: pass

    # 4.5 여론조사 (같은 선거 공유, 공공 데이터)
    try:
        from app.elections.models import Survey
        surveys = (await db.execute(
            select(Survey).where(Survey.election_id == election_id)
            .order_by(Survey.survey_date.desc()).limit(5)
        )).scalars().all()
        if surveys:
            lines = ["=== 최근 여론조사 (같은 선거) ==="]
            for s in surveys:
                res = s.results or {}
                parts = [f"{n}: {v}%" for n, v in sorted(res.items(), key=lambda x: -float(x[1] or 0))[:6]]
                sid = f"survey-{str(s.id)[:8]}"
                lines.append(f"[ref-{sid}] {s.survey_date} {s.survey_org} (N={s.sample_size or '?'}, 오차 ±{s.margin_of_error or '?'}%): {', '.join(parts)}")
                if s.source_url:
                    citations.append({
                        "id": sid, "type": "survey",
                        "title": f"{s.survey_org} 여론조사 ({s.survey_date})",
                        "source": s.survey_org,
                        "url": s.source_url,
                    })
            sections.append("\n".join(lines))
    except Exception as e:
        logger.warning("rich_ctx_survey_failed", error=str(e)[:100])
        try: await db.rollback()
        except Exception: pass

    # 5. 캠프 학습 메모리 (보고서 + 브리핑 + 이전 콘텐츠)
    try:
        from app.services.camp_context import build_camp_memory
        camp_mem = await build_camp_memory(
            db, tenant_id, election_id,
            max_reports=max_reports, max_briefings=max_briefings, max_content=3,
        )
        if camp_mem:
            sections.append(camp_mem)
    except Exception as e:
        logger.warning("rich_ctx_camp_failed", error=str(e)[:100])
        try: await db.rollback()
        except Exception: pass

    # 6. 공직선거법 조항 (콘텐츠/토론 법적 안전 필수)
    if include_law:
        try:
            from app.content.compliance import ComplianceChecker
            sections.append(f"=== 공직선거법 주요 조항 (필수 준수) ===\n{ComplianceChecker.get_law_text()}")
            citations.append({
                "id": "law", "type": "nec",
                "title": "공직선거법 주요 조항",
                "source": "국가법령정보센터",
            })
        except Exception:
            pass

    return "\n\n".join(s for s in sections if s), citations


# ────────────────────────────────────────────────────────────
# 선거법 준수 프롬프트 조각 (토론/콘텐츠 공통)
# ────────────────────────────────────────────────────────────

LEGAL_SAFETY_PROMPT = """
[선거법 준수 필수 — 절대 위반 금지]
1. **허위사실 공표 금지 (제250조)**: 확인되지 않은 사실 단정 금지. 출처 없는 의혹 주장 금지.
2. **후보자 비방 금지 (제110조)**: 경쟁 후보에 대한 비방/모욕/인신공격 금지.
   → 공약/정책 비교는 OK. 인격 비난은 NO.
3. **기부행위 약속 금지 (제112조)**: 금품·경품·무료 제공 암시 금지.
4. **AI 생성물 표시 (제82조의8)**: 콘텐츠 첫줄에 "[AI 활용]" 표기.
5. **객관성 원칙**: 수집된 데이터에 있는 사실만 인용. 추측·상상 금지.

[참고 자료 사용 원칙]
- 위 컨텍스트에 포함된 [ref-xxx] 데이터만 근거로 사용
- 주장마다 해당 [ref-xxx] 각주 필수
- 데이터에 없는 내용은 WebSearch로 검증 후 [web](URL) 형식 인용
- 확인 불가한 내용은 "확인되지 않음"으로 명시 (절대 지어내지 말 것)
"""
