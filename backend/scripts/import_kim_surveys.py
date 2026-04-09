"""
/Users/jojo/pro/kim 폴더의 여론조사 PDF 자료 직접 import.

사용자가 prototype에서 수집한 PDF 결과보고서를 surveys 테이블에 적재.
extracted.txt가 이미 있으면 그걸 사용, 없으면 PDF에서 추출.

각 결과 표(【표N】 또는 사례수 헤더 + 전체 행)를 파싱.

실행:
  python -m scripts.import_kim_surveys --dir /Users/jojo/pro/kim
"""
import argparse
import asyncio
import re
import sys
import unicodedata
from pathlib import Path
from datetime import date as _date, datetime
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pdfplumber

from sqlalchemy import select, and_
from app.database import async_session_factory
import app.auth.models  # noqa
from app.elections.models import Survey


# 결과 PDF 식별 키워드 (질문지/안내/영수증 제외)
_RESULT_KEYWORDS = ["결과", "통계표", "분석"]
_SKIP_KEYWORDS = ["설문지", "설문안", "안내(게시", "Receipt", "투표율 분석", "투표율분석", "전체+질문지", "전체질문지", "프로필"]


def is_result_pdf(filename: str) -> bool:
    name = unicodedata.normalize("NFC", filename)
    name_low = name.lower()
    if any(s.lower() in name_low for s in _SKIP_KEYWORDS):
        return False
    return any(k in name for k in _RESULT_KEYWORDS)


def extract_text_from_file(pdf_path: Path) -> str:
    """추출된 txt가 있으면 그걸, 없으면 PDF 추출."""
    extracted = pdf_path.with_suffix(".extracted.txt")
    if extracted.exists():
        return extracted.read_text(encoding="utf-8", errors="ignore")
    try:
        with pdfplumber.open(str(pdf_path)) as pdf:
            return "\n".join((p.extract_text() or "") for p in pdf.pages)
    except Exception as e:
        print(f"  PDF read error: {e}")
        return ""


def infer_meta(filename: str, text: str) -> dict:
    """파일명 + 본문에서 메타 정보 추출."""
    filename = unicodedata.normalize("NFC", filename)
    text = unicodedata.normalize("NFC", text)
    meta = {
        "survey_org": None, "client_org": None, "region_sido": "충청북도",
        "region_sigungu": None, "election_type": None, "survey_date": None,
        "sample_size": None, "margin_of_error": None,
    }
    # 시·군 추론
    for sgg in ("청주시", "충주시", "제천시", "옥천군", "영동군", "괴산군", "보은군", "단양군", "음성군", "진천군", "증평군"):
        if sgg in filename or sgg in text[:500]:
            meta["region_sigungu"] = sgg
            break

    # election_type 추론 (text 더 넓게 검사)
    head = text[:3000]
    if "도지사" in filename or "도지사" in head or "광역단체장" in filename or "광역단체장" in head:
        meta["election_type"] = "governor"
    elif "교육감" in filename or "교육감" in head:
        meta["election_type"] = "superintendent"
    elif "시장" in filename or "기초단체장" in filename or "시장" in head or "기초단체장" in head:
        meta["election_type"] = "mayor"
    elif "지방선거" in filename or "지방선거" in head or "지선" in filename or "지선" in head:
        meta["election_type"] = "mayor" if meta["region_sigungu"] else "governor"

    # 조사기관 추출
    org_m = re.search(r"조사\s*기관[^\n]*?[▪：:]+\s*([^\n]+)", text)
    if org_m:
        meta["survey_org"] = org_m.group(1).strip()[:200]
    else:
        # 파일명에서
        if "리얼미터" in filename: meta["survey_org"] = "리얼미터"
        elif "여론조사꽃" in filename: meta["survey_org"] = "여론조사꽃"
        elif "충북MBC" in filename or "MBC" in filename: meta["survey_org"] = "충북MBC/코리아리서치"
        elif "리서치앤리서치" in filename or "중부매일" in filename: meta["survey_org"] = "리서치앤리서치/중부매일"
        elif "한국리서치" in filename: meta["survey_org"] = "한국리서치"

    # 의뢰자
    client_m = re.search(r"(?:의뢰\s*기관|조사\s*의뢰)[^\n]*?[▪：:]+\s*([^\n]+)", text)
    if client_m:
        meta["client_org"] = client_m.group(1).strip()[:200]

    # 조사일자 - 여러 패턴 시도
    date_patterns = [
        r"조사\s*기간[^\n]*?(\d{4})[^\d]+(\d{1,2})[^\d]+(\d{1,2})",
        r"조사\s*일\s*[^\n]*?(\d{4})[^\d]+(\d{1,2})[^\d]+(\d{1,2})",
        r"^(\d{4})[\.\s]+(\d{1,2})[\.\s]+(\d{1,2})\.?\s*$",  # 첫 줄에 단독
        r"(\d{4})[\.\s년]+(\d{1,2})[\.\s월]+(\d{1,2})[일\s]",
    ]
    for pat in date_patterns:
        date_m = re.search(pat, text[:3000], re.MULTILINE)
        if date_m:
            try:
                y, m, d = int(date_m.group(1)), int(date_m.group(2)), int(date_m.group(3))
                if 2020 <= y <= 2030 and 1 <= m <= 12 and 1 <= d <= 31:
                    meta["survey_date"] = _date(y, m, d)
                    break
            except Exception:
                pass
    if not meta["survey_date"]:
        # 파일명에서 yymmdd 또는 YYYYMMDD
        d_m = re.search(r"(\d{6})", filename) or re.search(r"(\d{8})", filename)
        if d_m:
            s = d_m.group(1)
            try:
                if len(s) == 6:
                    meta["survey_date"] = datetime.strptime(s, "%y%m%d").date()
                else:
                    meta["survey_date"] = datetime.strptime(s, "%Y%m%d").date()
            except Exception:
                pass

    # 표본크기
    n_m = re.search(r"(\d{3,4})\s*명", text[:2000])
    if n_m:
        meta["sample_size"] = int(n_m.group(1))

    # 표본오차
    e_m = re.search(r"±\s*(\d+\.\d+)\s*%?\s*포?인?트?", text[:2000])
    if e_m:
        meta["margin_of_error"] = float(e_m.group(1))

    return meta


# 후보 이름 패턴 (한글 2-4자, 정당명 제외)
_PARTY_NAMES = {"더불어민주당", "민주당", "국민의힘", "조국혁신당", "진보당", "정의당", "국민의당", "기본소득당", "개혁신당"}

# 한국 성씨 화이트리스트 (단어 자체가 자주 등장하는 한 글자 surname은 제외)
# 제외 surname: 어, 지, 도 등 일반 단어와 충돌
_SURNAMES = set("김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민진엄채원천방공현함변염여추소석선설마길연표명기반왕금옥육인맹제모탁국은편")

# 일반 명사 블랙리스트 (PDF 표 헤더에 자주 등장)
_BLACKLIST = {
    "완료", "적용", "사례수", "전체", "남성", "여성", "남자", "여자", "기타", "없음", "모름", "응답",
    "일자리", "고령복지", "인프라", "도지사", "교육감", "시장", "군수", "구청장", "후보", "지지", "정당",
    "도정", "운영", "평가", "지역", "연령", "성별", "직업", "구분", "내용", "표본", "조사", "기관",
    "민주당", "국힘", "보수", "진보", "중도", "수도권", "충청", "영남", "호남",
    "공무원", "주부", "농업", "자영업", "학생", "회사원", "은퇴", "무직", "농임어업",
    "찬성", "반대", "긍정", "부정", "유지", "변경", "적극", "다소", "전혀", "잘함", "못함",
    "지난", "이번", "다음", "현재", "과거", "미래", "올해", "내년", "작년",
    "모르", "모른다", "잘모", "조사완료", "인상에", "전월세", "임대료", "인상", "동결",
    "찬성한다", "반대한다", "이재명", "윤석열", "문재인",  # 대통령 이름 제외
    "기타후보", "기타인물", "없다",
}


def _is_name(word: str) -> bool:
    if not word or word in _PARTY_NAMES or word in _BLACKLIST:
        return False
    if not re.match(r"^[가-힣]{2,4}$", word):
        return False
    # 첫 글자가 성씨면 후보 이름일 가능성 높음
    return word[0] in _SURNAMES


def parse_result_tables(text: str) -> list[dict]:
    """텍스트에서 결과 표 모두 추출.

    여러 형식 처리:
    - 형식 1: 【표】 + "사례수 [이름들]" 헤더 + 한참 아래 "전체 (n) (n) [숫자들]"
    - 형식 2: "구 분 완료 적용 [이름들] 기타 인물 없음" + 다음 라인 "전체 ..."
    """
    text = unicodedata.normalize("NFC", text)
    sections = []
    lines = text.split("\n")

    # 패스 1: "사례수" 또는 "구 분" 헤더 줄에서 후보 이름들 찾고
    #         그 다음 "전체"로 시작하는 첫 데이터 라인 사용
    for i, line in enumerate(lines):
        line_s = line.strip()
        if not line_s:
            continue

        # 헤더 후보: 후보 이름 2개 이상
        words = line_s.split()
        names = [w for w in words if _is_name(w)]
        if len(names) < 2:
            continue

        # 다음 30줄 안에 "전체" 데이터 라인 찾기
        for j in range(i + 1, min(i + 30, len(lines))):
            row = lines[j].strip()
            if not row:
                continue
            if row.startswith("전체") or row.startswith("◈ 전 체") or row.startswith("▣ 전 체") or "전 체" in row[:8]:
                # 숫자 (사례수 괄호 제외하고 % 값)
                # 패턴: 전체 (509) (509) 10.3 8.1 5.1 ...
                # 괄호 안 숫자 제거
                cleaned = re.sub(r"\([^)]*\)", "", row)
                nums = re.findall(r"\d+\.\d+", cleaned)
                if len(nums) >= len(names):
                    nums_f = [float(n) for n in nums]
                    data = {}
                    for k, name in enumerate(names):
                        if k < len(nums_f) and 0 < nums_f[k] < 100:
                            data[name] = nums_f[k]
                    if data:
                        # 섹션 제목 (위 5줄에서 【표】 또는 질문)
                        title = ""
                        for back in range(max(0, i - 10), i + 1):
                            t = lines[back].strip()
                            if "【" in t or "지지도" in t or "적합도" in t or "양자대결" in t or "가상대결" in t or t.startswith("Q"):
                                title = t
                                break
                        sections.append({"title": title or f"line{i}", "data": data})
                break
    return sections

    i = 0
    while i < len(lines):
        line = lines[i].strip()

        # 형식 2: 후보 헤더 줄 찾기
        # "구 분 완료 적용 신용한 노영민 한범덕 송기섭 기타 인물 없음 잘 모름"
        if (line.startswith("구 분") or "구분" in line) and ("완료" in line or "사례수" in line):
            # 후보 이름 추출 (헤더 끝부분)
            words = line.split()
            names = [w for w in words if _is_name(w)]
            # 다음 라인에서 "전체" 행 찾기 (보통 1-3 라인 안)
            for j in range(i + 1, min(i + 5, len(lines))):
                next_line = lines[j].strip()
                if not next_line:
                    continue
                if next_line.startswith("전체") or next_line.startswith("◈") or next_line.startswith("▣"):
                    # 숫자 추출
                    nums = re.findall(r"(\d+\.\d+|\d+)", next_line)
                    # 첫 두 숫자는 사례수 (조사완료, 가중값 적용)
                    nums = [float(n) for n in nums]
                    if len(nums) >= len(names) + 2:
                        data = {names[k]: nums[k + 2] for k in range(len(names)) if (nums[k + 2] < 100)}
                        if data:
                            # 섹션 제목 추출 (위 5줄에서 【표】 또는 질문)
                            title = ""
                            for k in range(max(0, i - 8), i):
                                if "【" in lines[k] or "Q" in lines[k][:3] or "지지도" in lines[k] or "적합도" in lines[k] or "대결" in lines[k]:
                                    title = lines[k].strip()
                                    break
                            sections.append({"title": title or f"line{i}", "data": data})
                    break
            i += 1
            continue

        # 형식 1: 【표N】 또는 라벨+숫자 라인 (단일 표 형식)
        if line.startswith("【") and "】" in line:
            title = line
            # 다음 표 헤더를 찾기 (사례수 ... 후보들)
            j = i + 1
            while j < len(lines) and j < i + 15:
                hl = lines[j].strip()
                if "사례수" in hl or "조사" in hl:
                    # 다음 줄에 후보 이름 있을 수 있음
                    k = j + 1
                    while k < len(lines) and k < j + 8:
                        names_line = lines[k].strip()
                        words = names_line.split()
                        names = [w for w in words if _is_name(w)]
                        if len(names) >= 2:
                            # 전체 행 찾기
                            for m in range(k + 1, min(k + 8, len(lines))):
                                row = lines[m].strip()
                                if row.startswith("전체"):
                                    nums = re.findall(r"\d+\.\d+", row)
                                    if len(nums) >= len(names):
                                        data = {names[idx]: float(nums[idx]) for idx in range(len(names)) if float(nums[idx]) < 100}
                                        if data:
                                            sections.append({"title": title, "data": data})
                                    break
                            break
                        k += 1
                    break
                j += 1
        i += 1

    return sections


def flatten(sections: list) -> dict:
    """모든 섹션의 후보 결과를 한 dict로 합침 (같은 후보는 max값 유지)."""
    if not sections:
        return {}
    merged = {}
    for s in sections:
        for k, v in s["data"].items():
            # blacklist 한 번 더 검증
            if k in _BLACKLIST:
                continue
            if k not in merged or merged[k] < v:
                merged[k] = v
    return merged


async def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dir", default="/Users/jojo/pro/kim")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    src = Path(args.dir)
    pdfs = sorted([f for f in src.glob("*.pdf") if is_result_pdf(f.name)])
    print(f"=== 결과 PDF {len(pdfs)}건 ===")
    for f in pdfs:
        print(f"  {unicodedata.normalize('NFC', f.name)}")

    print()
    async with async_session_factory() as db:
        added = 0
        updated = 0
        for f in pdfs:
            print(f"\n[{f.name}]")
            text = extract_text_from_file(f)
            if not text:
                print("  ⏭ no text")
                continue

            meta = infer_meta(f.name, text)
            print(f"  meta: {meta['survey_org']} | {meta['election_type']} | {meta['region_sigungu']} | {meta['survey_date']} | n={meta['sample_size']}")

            sections = parse_result_tables(text)
            print(f"  sections: {len(sections)}")
            results = flatten(sections)
            if results:
                top = sorted(results.items(), key=lambda x: -x[1])[:5]
                print(f"  ✅ Top 후보: {top}")
            else:
                print("  ⚠ no results extracted")

            if args.dry_run:
                continue

            if not meta["survey_org"] or not meta["survey_date"]:
                print("  ⏭ missing org/date")
                continue

            # 중복 체크: tenant_id NULL + 같은 org/date/region
            existing = (await db.execute(
                select(Survey).where(and_(
                    Survey.tenant_id.is_(None),
                    Survey.survey_org == meta["survey_org"],
                    Survey.survey_date == meta["survey_date"],
                    Survey.region_sido == meta["region_sido"],
                ))
            )).scalar_one_or_none()

            if existing:
                existing.results = results
                existing.region_sigungu = meta["region_sigungu"]
                existing.election_type = meta["election_type"] or existing.election_type
                existing.sample_size = meta["sample_size"] or existing.sample_size
                existing.margin_of_error = meta["margin_of_error"] or existing.margin_of_error
                existing.client_org = meta["client_org"] or existing.client_org
                updated += 1
                print(f"  ↻ updated existing")
            else:
                db.add(Survey(
                    tenant_id=None,
                    survey_org=meta["survey_org"],
                    client_org=meta["client_org"],
                    survey_date=meta["survey_date"],
                    sample_size=meta["sample_size"],
                    margin_of_error=meta["margin_of_error"],
                    election_type=meta["election_type"],
                    region_sido=meta["region_sido"],
                    region_sigungu=meta["region_sigungu"],
                    results=results,
                    source_url=f"file://{f}",
                    collected_at=datetime.utcnow(),
                ))
                added += 1
                print(f"  + added")

        if not args.dry_run:
            await db.commit()
        print(f"\n=== 완료: 신규 {added} / 업데이트 {updated} ===")


if __name__ == "__main__":
    asyncio.run(main())
