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

    # 후보 성향은 '등록값'만 사실 — 이름 동일 다른 정치인과 혼동 금지
    _align_kor = {"conservative": "보수", "progressive": "진보", "centrist": "중도", "independent": "무소속"}
    _is_nonpartisan = (election.election_type or "") in ("superintendent", "edu_board")

    def _fmt(c):
        a = _align_kor.get(c.party_alignment or "", "성향 미지정")
        if _is_nonpartisan:
            return f"{c.name} [정당: 무소속·정당공천금지 선거 | 성향(등록값): {a}]"
        return f"{c.name} [정당: {c.party or '무소속'} | 성향(등록값): {a}]"

    comp_strs = [_fmt(c) for c in competitors]
    info = [
        "=== 선거 기본 정보 ===",
        f"선거: {election.name} (D-{d_day})",
        f"지역: {election.region_sido or ''} {election.region_sigungu or ''}",
        f"유형: {election.election_type}",
        f"우리 후보: {_fmt(our) if our else '-'}",
        f"경쟁 후보: {', '.join(comp_strs) if comp_strs else '-'}",
    ]
    if _is_nonpartisan:
        info.append(
            "※ 정당 공천 금지 선거. 정당 프레임(○○당 강세 등) 금지. 후보 성향은 위 '성향(등록값)'만 사실."
        )
    info.append(
        "[후보 정체성 판단 절대 규칙] 각 후보의 '성향(등록값)'은 캠프가 직접 등록한 확정 사실이다. "
        "이름이 같은 다른 정치인(사전 학습·WebSearch)과 절대 혼동하지 말고, 등록값과 반대되는 이념 분류(보수↔진보) 서술을 하지 마라."
    )
    sections.append("\n".join(info))

    # 2. RAG 벡터 검색 — 주제와 관련된 데이터 (유사도 하한 0.55 엄수 → 무관 섹션 오염 차단)
    try:
        from app.services.embedding_service import search_similar
        rag = await search_similar(
            db, tenant_id, topic, limit=max_rag, election_id=election_id,
            min_similarity=0.55,
        )
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
[후보 정체성 판단 절대 규칙 — 최우선]
★ 각 후보의 '성향(등록값)'은 캠프가 등록한 확정 사실이다. 이 값만 근거로 쓴다.
★ 이름이 같은 다른 유명 정치인·공인(사전 학습·WebSearch 결과)과 절대 혼동 금지. 동일인 단정 금지.
★ 후보를 '진보/보수/민주당/국민의힘' 프레임으로 서술할 때 위 등록값과 반드시 일치해야 한다. 반대로 서술하면 콘텐츠 신뢰도 0.
★ 교육감·교육위원 선거는 정당 공천 금지 → '○○당 강세/약세' 같은 정당 구도 서술 금지. 개인 등록 성향만 사용.
★ 수집 자료에 '[동명이인/무관]' 태그가 보이면 해당 자료는 근거로 인용하지 말 것.

[선거법 준수 필수 — 절대 위반 금지]
1. **허위사실 공표 금지 (제250조)**: 확인되지 않은 사실 단정 금지. 출처 없는 의혹 주장 금지.
2. **후보자 비방 금지 (제110조)**: 경쟁 후보에 대한 비방/모욕/인신공격 금지.
   → 공약/정책 비교는 OK. 인격 비난은 NO.
3. **기부행위 약속 금지 (제112조)**: 금품·경품·무료 제공 암시 금지.
4. **AI 생성물 표시 (제82조의8)**: 콘텐츠 첫줄에 "[AI 활용]" 표기.
5. **객관성 원칙**: 수집된 데이터에 있는 사실만 인용. 추측·상상 금지.

[참고 자료 사용 원칙 — 질문/주제 관련성 엄수]
- 위 컨텍스트에 포함된 [ref-xxx] 데이터만 근거로 사용.
- **각주는 반드시 주장 내용과 관련이 있어야 한다.** 선거법 질문에 뉴스 [ref-rag-x]를 붙이거나, 후보 프로필 설명에 무관한 커뮤니티 각주를 붙이지 말 것.
- 적절한 근거가 섹션에 없으면 [ref-xxx]를 달지 말고, 대신 WebSearch로 공식 출처(law.go.kr, nec.go.kr, info.nec.go.kr 등)를 조회해 [web](URL) 형식으로 인용.
- 확인 불가한 내용은 "확인되지 않음"으로 명시 (절대 지어내지 말 것).
- 선거법/규정 관련 주장은 반드시 '공직선거법 주요 조항' 섹션 또는 law.go.kr/nec.go.kr 공식 출처만 사용. 뉴스 RAG는 선거법 주장의 근거로 부적합.
"""
