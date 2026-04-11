"""
ElectionPulse - 공직선거법규 PDF 파싱 → DB 저장
중앙선거관리위원회 운용자료를 섹션별로 파싱하여 검색/열람 가능하게 함.
"""
import re
import fitz  # PyMuPDF
import structlog

logger = structlog.get_logger()

# 목차 기반 섹션 정의 (장/절/페이지)
CHAPTERS = [
    {
        "chapter": "Ⅰ. 각종 행사의 개최·후원행위",
        "article": "제86조 제2항 제4호",
        "page_start": 3, "page_end": 22,
        "keywords": ["행사", "개최", "후원", "교양", "교육강좌", "문화", "예술", "체육", "기념일", "민원상담", "공청회", "준공식", "보조금"],
    },
    {
        "chapter": "Ⅱ. 홍보물 발행행위",
        "article": "제86조 제5항",
        "page_start": 23, "page_end": 38,
        "keywords": ["홍보물", "인쇄물", "간행물", "영상물", "시설물", "신문", "방송", "광고", "인터뷰", "홈페이지"],
    },
    {
        "chapter": "Ⅲ. 지방자치단체장의 각종 행사 참석행위",
        "article": "제86조 제2항 제3호, 제6항",
        "page_start": 39, "page_end": 48,
        "keywords": ["참석", "공공기관", "사적행사", "금지시기"],
    },
    {
        "chapter": "Ⅳ. 지방자치단체장의 광고 출연행위",
        "article": "제86조 제7항",
        "page_start": 49, "page_end": 56,
        "keywords": ["광고", "출연", "영상물", "시설물", "SNS", "홈페이지"],
    },
    {
        "chapter": "Ⅴ. 금품 기타 이익 제공행위",
        "article": "제112조",
        "page_start": 57, "page_end": 94,
        "keywords": ["금품", "기부", "보조금", "포상", "표창", "위로금", "수당", "여행경비", "축의금", "부의금", "차량지원"],
    },
    {
        "chapter": "Ⅵ. 지방의회 행위 관련 제한·금지사례",
        "article": "제86조 등",
        "page_start": 95, "page_end": 102,
        "keywords": ["지방의회", "서신", "문자메시지", "홍보물", "게시", "의회의원", "금품제공"],
    },
    {
        "chapter": "Ⅶ. 부록 - 교육감선거 후보자 관련 제한·금지사례",
        "article": "교육감선거 관련",
        "page_start": 103, "page_end": 105,
        "keywords": ["교육감", "정당", "지지", "반대", "정당표방", "보수", "진보", "단일후보"],
    },
    {
        "chapter": "Ⅶ. 부록 - 공직선거법 (관련 조항)",
        "article": "공직선거법",
        "page_start": 106, "page_end": 118,
        "keywords": ["공직선거법", "선거운동", "기부행위", "당선무효"],
    },
    {
        "chapter": "Ⅶ. 부록 - 공직선거관리규칙",
        "article": "공직선거관리규칙",
        "page_start": 116, "page_end": 130,
        "keywords": ["선거관리규칙", "업무추진비", "집행규칙"],
    },
]


def parse_election_law_pdf(pdf_path: str) -> list[dict]:
    """
    공직선거법규 PDF를 파싱하여 섹션 리스트 반환.
    Returns: [{"chapter": ..., "article_number": ..., "content": ..., ...}, ...]
    """
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    logger.info("pdf_opened", path=pdf_path, pages=total_pages)

    sections = []

    for i, ch in enumerate(CHAPTERS):
        start = ch["page_start"] - 1  # 0-indexed
        end = min(ch["page_end"], total_pages)

        # 해당 페이지 범위의 텍스트 추출
        full_text = ""
        for page_num in range(start, end):
            page = doc[page_num]
            full_text += page.get_text("text") + "\n"

        # 텍스트 정제
        full_text = re.sub(r'\n{3,}', '\n\n', full_text.strip())

        # 관계 법규 / 운용기준 / 사례예시 분리 시도
        content = ""
        guidelines = ""
        examples = ""

        # "관계 법규" 또는 "관계법규" 이후 ~ "운용기준" 전까지
        law_match = re.search(r'(?:1\.\s*관계\s*법규|관계\s*법규)', full_text)
        guide_match = re.search(r'(?:2\.\s*법\s*제|운용기준)', full_text)
        example_match = re.search(r'(?:3\.\s*사례|사례예시|사례에시)', full_text)

        if law_match and guide_match:
            content = full_text[law_match.start():guide_match.start()].strip()
        elif law_match:
            content = full_text[law_match.start():].strip()

        if guide_match and example_match:
            guidelines = full_text[guide_match.start():example_match.start()].strip()
        elif guide_match:
            guidelines = full_text[guide_match.start():].strip()

        if example_match:
            examples = full_text[example_match.start():].strip()

        # 분리가 안 된 경우 전체를 content로
        if not content and not guidelines and not examples:
            content = full_text

        sections.append({
            "document_title": "2026 공직선거법규 운용자료 (중앙선거관리위원회)",
            "chapter": ch["chapter"],
            "section_title": ch["chapter"],
            "article_number": ch["article"],
            "content": content[:10000] if content else None,
            "guidelines": guidelines[:10000] if guidelines else None,
            "examples": examples[:15000] if examples else None,
            "page_start": ch["page_start"],
            "page_end": ch["page_end"],
            "keywords": ch["keywords"],
            "section_order": i + 1,
        })

    doc.close()
    logger.info("pdf_parsed", sections=len(sections))
    return sections


async def import_law_pdf_to_db(db_session, pdf_path: str) -> dict:
    """PDF를 파싱하여 DB에 저장."""
    from sqlalchemy import text
    import uuid

    sections = parse_election_law_pdf(pdf_path)

    # 기존 데이터 삭제 (같은 문서)
    await db_session.execute(text(
        "DELETE FROM election_law_sections WHERE document_title LIKE '%2026 공직선거법규%'"
    ))

    stored = 0
    for sec in sections:
        import json
        await db_session.execute(text("""
            INSERT INTO election_law_sections
            (id, document_title, chapter, section_title, article_number,
             content, guidelines, examples, page_start, page_end, keywords, section_order)
            VALUES (:id, :doc, :ch, :st, :art, :content, :guide, :ex, :ps, :pe, :kw, :ord)
        """), {
            "id": str(uuid.uuid4()),
            "doc": sec["document_title"],
            "ch": sec["chapter"],
            "st": sec["section_title"],
            "art": sec["article_number"],
            "content": sec["content"],
            "guide": sec["guidelines"],
            "ex": sec["examples"],
            "ps": sec["page_start"],
            "pe": sec["page_end"],
            "kw": json.dumps(sec["keywords"], ensure_ascii=False),
            "ord": sec["section_order"],
        })
        stored += 1

    await db_session.commit()
    logger.info("law_sections_stored", count=stored)
    return {"stored": stored, "sections": [s["chapter"] for s in sections]}
