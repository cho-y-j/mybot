"""
NESDC 결과보고서 PDF 자동 다운로드 + 파싱 → surveys.results 채우기.

기존 NESDC import (`import_nesdc_surveys.py`)는 메타데이터만 적재.
이 스크립트는 각 survey의 source_url에서 detail 페이지를 fetch,
'결과' 키워드가 든 첨부 PDF를 받아와 텍스트 추출 → 후보별 지지율 dict 저장.

실행:
  python -m scripts.parse_nesdc_pdfs --sido 충청북도
  python -m scripts.parse_nesdc_pdfs --survey-id <uuid>  # 단일 survey만
"""
import argparse
import asyncio
import re
import sys
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import httpx
import pdfplumber

from sqlalchemy import select
from app.database import async_session_factory
import app.auth.models  # noqa
from app.elections.models import Survey


# 첨부파일 view() 호출 + 파일명 추출
_FILE_RE = re.compile(
    r"onclick=\"javascript:view\('([^']+)',\s*'([^']+)',\s*'B0000005',\s*'([^']+)'\);\"[^>]*>\s*([^<]+)",
    re.DOTALL,
)


async def get_result_pdf_url(client: httpx.AsyncClient, view_url: str) -> Optional[tuple[str, str]]:
    """detail 페이지에서 결과보고서 PDF 다운로드 URL 추출."""
    r = await client.get(view_url)
    if r.status_code != 200:
        return None
    html = r.text

    # 모든 첨부파일 찾기
    files = []
    for m in _FILE_RE.finditer(html):
        atch_id, file_sn, bbs_key, filename = m.group(1), m.group(2), m.group(3), m.group(4).strip()
        files.append((atch_id, file_sn, bbs_key, filename))

    if not files:
        return None

    # "결과" 키워드 포함된 파일 우선 (질문지/조사문안 제외)
    result_files = [f for f in files if ("결과" in f[3] or "분석" in f[3]) and "질문" not in f[3]]
    target = result_files[0] if result_files else files[-1]  # 폴백: 마지막 파일

    atch_id, file_sn, bbs_key, filename = target
    download_url = (
        f"https://www.nesdc.go.kr/portal/cmm/fms/FileDown.do"
        f"?atchFileId={atch_id}&fileSn={file_sn}&bbsId=B0000005&bbsKey={bbs_key}"
    )
    return download_url, filename


# 한글 이름 (2-4자) + 공백 + 숫자 패턴
_NAME_PCT_RE = re.compile(r"([가-힣]{2,4})\s+(\d+\.\d+)")


def parse_pdf_results(pdf_path: str) -> dict:
    """PDF에서 결과 추출 (두 가지 형식 모두 처리).

    Format A (모노리서치): "조사 내용 요약" 페이지에 라벨+숫자 행
    Format B (유앤미리서치): 페이지마다 표 (헤더 + ▣ 전 체 ▣ 행)

    Returns: { 항목명: { 후보/정당명: float, ... }, ... }
    """
    sections = _parse_format_a(pdf_path)
    if sections:
        return sections
    return _parse_format_b(pdf_path)


def _parse_format_a(pdf_path: str) -> dict:
    """라벨+숫자 라인 형식 (모노리서치 등)."""
    sections = {}
    current_section = None
    current_data = {}

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages[:20]:
            text = page.extract_text() or ""
            if "조사 결과 요약" not in text and "조사결과 요약" not in text and not current_section:
                continue
            for raw_line in text.split("\n"):
                line = raw_line.strip()
                if not line:
                    continue
                if line.endswith("퍼센트") and len(line) < 40:
                    if current_section and current_data:
                        sections[current_section] = current_data
                    current_section = line.replace(" 퍼센트", "").strip()
                    current_data = {}
                    continue
                if line.startswith("합계"):
                    if current_section and current_data:
                        sections[current_section] = current_data
                    current_section = None
                    current_data = {}
                    continue
                if not current_section:
                    continue
                m = re.match(r"^(.+?)\s+(\d+\.\d+)$", line)
                if m:
                    current_data[m.group(1).strip()] = float(m.group(2))

    if current_section and current_data:
        sections[current_section] = current_data
    return sections


def _parse_format_b(pdf_path: str) -> dict:
    """표 형식 (유앤미리서치 등) — extract_tables 사용."""
    sections = {}
    with pdfplumber.open(pdf_path) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            # 후보/시장/군수/지지/적합 키워드 있는 결과 페이지
            if not any(k in text for k in ("적합", "VS", "지지", "당선", "후보", "시장", "군수", "구청장")):
                continue

            tables = page.extract_tables()
            for tbl in tables:
                if not tbl or len(tbl) < 3:
                    continue

                # 헤더 라인 찾기 — 후보 이름 또는 정당명 들어있는 행
                header_idx = None
                headers = []
                for ri, row in enumerate(tbl):
                    cells = [(c or "").strip().replace("\n", "") for c in row]
                    # 빈 셀과 데이터 셀 카운트
                    name_cells = [c for c in cells if c and re.match(r"^[가-힣]{2,5}$", c)]
                    if len(name_cells) >= 2:
                        header_idx = ri
                        headers = cells
                        break

                if header_idx is None:
                    continue

                # 전체 데이터 라인 찾기
                total_row = None
                for ri, row in enumerate(tbl[header_idx + 1:], start=header_idx + 1):
                    cells = [(c or "").strip() for c in row]
                    joined = " ".join(cells)
                    if "전 체" in joined or "▣" in joined or "전체" in joined:
                        total_row = cells
                        break

                if not total_row:
                    continue

                # 헤더와 total_row 매칭 — 숫자 셀 정렬
                section_data = {}
                for h_cell, d_cell in zip(headers, total_row):
                    h_clean = (h_cell or "").strip().replace("\n", "")
                    d_clean = (d_cell or "").strip().replace("\n", "")
                    # 숫자 추출 (괄호 안 사례수 무시)
                    num_match = re.search(r"^\s*(\d+\.\d+)\s*$", d_clean)
                    if num_match and h_clean and re.match(r"^[가-힣]{2,5}$", h_clean):
                        section_data[h_clean] = float(num_match.group(1))

                if section_data:
                    # 섹션 이름은 페이지 첫 줄 (질문문 요약)
                    first_line = text.strip().split("\n")[0][:50]
                    sections[f"page{page_idx+1}_{first_line}"] = section_data

    return sections


def _is_candidate_name(label: str) -> bool:
    """라벨이 후보 이름(한글 2-4자)인지 판단."""
    if not label:
        return False
    cleaned = label
    for party in ("더불어민주당", "국민의힘", "조국혁신당", "진보당", "정의당", "국민의당", "기본소득당", "개혁신당"):
        cleaned = cleaned.replace(party, "").strip()
    return bool(re.match(r"^[가-힣]{2,4}$", cleaned))


def _clean_name(label: str) -> str:
    cleaned = label
    for party in ("더불어민주당", "국민의힘", "조국혁신당", "진보당", "정의당", "국민의당", "기본소득당", "개혁신당"):
        cleaned = cleaned.replace(party, "").strip()
    return cleaned


def flatten_to_results(sections: dict) -> dict:
    """파싱된 sections를 surveys.results 형식으로 평탄화.

    우선순위:
    1. 양자대결 (VS 키워드 또는 후보 2-3명 + 모름)
    2. 후보적합도 (적합도 키워드)
    3. 후보 이름이 가장 많이 들어간 첫 번째 섹션
    4. 정당지지도 (정당명만)
    """
    if not sections:
        return {}

    # 1. 양자대결
    versus = [k for k in sections if "VS" in k or "vs" in k]
    if versus:
        return _extract_candidates(sections[versus[0]])

    # 2. 후보적합도
    fit = [k for k in sections if "적합" in k]
    if fit:
        return _extract_candidates(sections[fit[0]])

    # 3. 후보 이름이 가장 많은 섹션
    best_key, best_count = None, 0
    for k, data in sections.items():
        cnt = sum(1 for label in data.keys() if _is_candidate_name(label))
        if cnt > best_count:
            best_count = cnt
            best_key = k
    if best_key and best_count >= 2:
        return _extract_candidates(sections[best_key])

    # 4. 정당지지도 (이름이 정당명)
    party_keys = [k for k in sections if "정당" in k or "지지" in k]
    if party_keys:
        return sections[party_keys[0]]

    # 5. 폴백 — 첫 섹션 그대로
    return next(iter(sections.values()), {})


def _extract_candidates(data: dict) -> dict:
    """섹션에서 후보 이름만 추출 + 모름/없음/기타 묶음."""
    result = {}
    none_total = 0
    for k, v in data.items():
        if _is_candidate_name(k):
            result[_clean_name(k)] = v
        elif "모름" in k or "기타" in k or "없음" in k or "잘 모" in k or "응답" in k:
            none_total += v
    if none_total > 0:
        result["없음/모름"] = round(none_total, 1)
    return result


async def process_survey(client: httpx.AsyncClient, survey: Survey, db) -> dict:
    if not survey.source_url:
        return {"id": str(survey.id), "skipped": "no source_url"}

    # 1. 결과 PDF URL 추출
    pdf_info = await get_result_pdf_url(client, survey.source_url)
    if not pdf_info:
        return {"id": str(survey.id), "skipped": "no PDF found"}
    pdf_url, filename = pdf_info

    # 2. PDF 다운로드 (임시 파일)
    pdf_resp = await client.get(pdf_url)
    if pdf_resp.status_code != 200:
        return {"id": str(survey.id), "skipped": f"download failed {pdf_resp.status_code}"}

    tmp_path = f"/tmp/nesdc_{survey.id}.pdf"
    with open(tmp_path, "wb") as f:
        f.write(pdf_resp.content)

    # 3. 파싱
    try:
        sections = parse_pdf_results(tmp_path)
    except Exception as e:
        return {"id": str(survey.id), "skipped": f"parse error: {e}"}

    if not sections:
        return {"id": str(survey.id), "skipped": "no result sections"}

    flat = flatten_to_results(sections)
    if not flat:
        return {"id": str(survey.id), "skipped": "could not flatten"}

    # 4. DB 업데이트
    survey.results = flat
    # 표본크기 / 오차한계 추출 (PDF 메타에서)
    try:
        with pdfplumber.open(tmp_path) as pdf:
            meta_text = "\n".join((p.extract_text() or "") for p in pdf.pages[:5])
            sample_m = re.search(r"표본\s*크?기?\s*[:：]?\s*유효[^0-9]*?(\d+)\s*명", meta_text)
            if sample_m:
                survey.sample_size = int(sample_m.group(1))
            margin_m = re.search(r"표본오차[^±]*[±\+\-][^0-9]*(\d+\.\d+)\s*%?p?", meta_text)
            if margin_m:
                survey.margin_of_error = float(margin_m.group(1))
    except Exception:
        pass

    return {
        "id": str(survey.id),
        "filename": filename,
        "sections": list(sections.keys()),
        "results_count": len(flat),
        "results": flat,
    }


async def main():
    p = argparse.ArgumentParser()
    p.add_argument("--sido", default=None)
    p.add_argument("--survey-id", default=None)
    p.add_argument("--limit", type=int, default=100)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    async with async_session_factory() as db:
        q = select(Survey).where(Survey.source_url.like("https://www.nesdc.go.kr%"))
        if args.sido:
            q = q.where(Survey.region_sido == args.sido)
        if args.survey_id:
            q = q.where(Survey.id == args.survey_id)
        # 결과 비어있는 것만
        from sqlalchemy import or_, cast
        from sqlalchemy.dialects.postgresql import JSONB
        # results가 비어있거나 NULL
        q = q.limit(args.limit)

        surveys = (await db.execute(q)).scalars().all()
        # filter empty results
        target = [s for s in surveys if not s.results or (isinstance(s.results, dict) and not s.results)]
        print(f"=== NESDC PDF parse: {len(target)}/{len(surveys)}건 처리 ===")

        success = 0
        async with httpx.AsyncClient(headers={"User-Agent": "Mozilla/5.0"}, timeout=60.0, follow_redirects=True) as client:
            for i, s in enumerate(target):
                print(f"\n[{i+1}/{len(target)}] {s.survey_org} ({s.region_sigungu})", flush=True)
                result = await process_survey(client, s, db)
                if "results" in result:
                    success += 1
                    print(f"  ✅ {result['results_count']}개 항목: {list(result['results'].items())[:3]}")
                else:
                    print(f"  ⏭ {result.get('skipped')}")

                if not args.dry_run:
                    await db.commit()

        print(f"\n=== 완료: {success}/{len(target)}건 results 추출 성공 ===")


if __name__ == "__main__":
    asyncio.run(main())
