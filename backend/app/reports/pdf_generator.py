"""
CampAI - 전문 PDF 보고서 생성기
프린트 친화 화이트 배경 + 심층 분석 + 차트.
모든 캠프에 동일 템플릿 자동 적용.
"""
import os
import re
import tempfile
from pathlib import Path
from datetime import date

import structlog
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm

logger = structlog.get_logger()

# 폰트
FONT_DIR = Path(__file__).parent / "fonts"
FONT_R = str(FONT_DIR / "NanumGothic.ttf")
FONT_B = str(FONT_DIR / "NanumGothicBold.ttf")

if FONT_DIR.exists():
    fm.fontManager.addfont(FONT_R)
    fm.fontManager.addfont(FONT_B)
    plt.rcParams['font.family'] = 'NanumGothic'
    plt.rcParams['axes.unicode_minus'] = False

# 색상 (프린트 친화)
BRAND_BLUE = (30, 64, 175)
BRAND_LIGHT = (219, 234, 254)
DARK_TEXT = (17, 24, 39)
BODY_TEXT = (55, 65, 81)
MUTED = (107, 114, 128)
RED = (185, 28, 28)
GREEN = (21, 128, 61)
AMBER = (180, 83, 9)
LIGHT_BG = (249, 250, 251)
BORDER = (229, 231, 235)
WHITE = (255, 255, 255)


def _find_font():
    """번들된 NanumGothic 폰트 경로 반환. 리눅스/맥/윈도우 어디서나 동일하게 작동."""
    regular = FONT_DIR / "NanumGothic.ttf"
    bold = FONT_DIR / "NanumGothicBold.ttf"
    if regular.exists():
        return str(regular), str(bold) if bold.exists() else str(regular)
    return None, None


# ── 차트 생성 ──

def _make_bar_chart(labels, datasets, filename):
    """후보별 비교 바 차트 (3열)."""
    fig, axes = plt.subplots(1, len(datasets), figsize=(7, 2.5))
    fig.patch.set_facecolor('white')
    if len(datasets) == 1:
        axes = [axes]

    our_name = datasets[0].get("our", "")

    for ax, ds in zip(axes, datasets):
        ax.set_facecolor('white')
        colors = ['#1e40af' if l == our_name else '#94a3b8' for l in labels]
        y_pos = range(len(labels))
        bars = ax.barh(y_pos, ds["values"], color=colors, height=0.55, edgecolor='none')
        ax.set_yticks(y_pos)
        ax.set_yticklabels(labels, fontsize=7)
        ax.invert_yaxis()
        ax.set_title(ds["title"], fontsize=8, fontweight='bold', color='#111827', pad=6)

        for bar, val in zip(bars, ds["values"]):
            txt = f'{val:,.0f}' if val >= 10 else f'{val:.1f}'
            ax.text(bar.get_width() + max(ds["values"]) * 0.03, bar.get_y() + bar.get_height() / 2,
                    txt, va='center', fontsize=6, color='#374151')

        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        ax.spines['bottom'].set_color('#e5e7eb')
        ax.spines['left'].set_color('#e5e7eb')
        ax.tick_params(colors='#6b7280', labelsize=6)

    plt.tight_layout(w_pad=3)
    plt.savefig(filename, dpi=180, bbox_inches='tight', facecolor='white')
    plt.close()


def _make_sentiment_chart(labels, pos, neg, neu, filename):
    """감성 분포 스택 바."""
    fig, ax = plt.subplots(figsize=(6, 2))
    fig.patch.set_facecolor('white')
    ax.set_facecolor('white')

    y = range(len(labels))
    total = [pos[i] + neg[i] + neu[i] for i in range(len(labels))]
    ax.barh(y, pos, color='#16a34a', height=0.5, label='긍정')
    ax.barh(y, neu, left=pos, color='#d1d5db', height=0.5, label='중립')
    ax.barh(y, neg, left=[pos[i] + neu[i] for i in range(len(labels))],
            color='#dc2626', height=0.5, label='부정')

    ax.set_yticks(y)
    ax.set_yticklabels(labels, fontsize=7.5)
    ax.invert_yaxis()
    ax.set_title('후보별 뉴스 감성 분포', fontsize=9, fontweight='bold', color='#111827', pad=8)
    ax.legend(fontsize=6.5, loc='lower right', framealpha=0.9)

    for i in range(len(labels)):
        pos_pct = round(pos[i] / max(total[i], 1) * 100)
        ax.text(total[i] + 0.5, i, f'{pos_pct}%', va='center', fontsize=6.5, color='#16a34a', fontweight='bold')

    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['bottom'].set_color('#e5e7eb')
    ax.spines['left'].set_color('#e5e7eb')
    ax.tick_params(colors='#6b7280', labelsize=7)

    plt.tight_layout()
    plt.savefig(filename, dpi=180, bbox_inches='tight', facecolor='white')
    plt.close()


# ── PDF 클래스 ──

class CampAIReport:
    """CampAI 전문 PDF 보고서."""

    def __init__(self):
        from fpdf import FPDF
        self.pdf = FPDF()
        font_r, font_b = _find_font()
        if not font_r:
            raise RuntimeError("한글 폰트를 찾을 수 없습니다")
        self.pdf.add_font("K", "", font_r)
        self.pdf.add_font("K", "B", font_b)
        self.pdf.set_auto_page_break(auto=True, margin=20)

    def _header_bar(self, election_name, d_day, report_date):
        p = self.pdf
        p.set_fill_color(*BRAND_BLUE)
        p.rect(0, 0, 210, 3, 'F')
        p.set_y(5)
        p.set_font("K", "B", 8)
        p.set_text_color(*BRAND_BLUE)
        p.cell(90, 5, f"  CampAI  |  {election_name}")
        p.set_font("K", "", 7)
        p.set_text_color(*MUTED)
        p.cell(100, 5, f"CONFIDENTIAL  |  D-{d_day}  |  {report_date}", align="R")
        p.ln(3)
        p.set_draw_color(*BORDER)
        p.line(15, p.get_y(), 195, p.get_y())
        p.ln(4)

    def _footer_bar(self):
        p = self.pdf
        p.set_y(-15)
        p.set_draw_color(*BORDER)
        p.line(15, p.get_y(), 195, p.get_y())
        p.ln(2)
        p.set_font("K", "", 6)
        p.set_text_color(*MUTED)
        p.cell(90, 4, "  [AI 생성물] CampAI 자동 생성 참고자료 | 의사결정 전 사실 확인 필요")
        p.cell(90, 4, f"page {p.page_no()}", align="R")

    def cover(self, election_name, d_day, report_date, our_candidate, data_summary=""):
        p = self.pdf
        p.add_page()

        p.set_fill_color(*BRAND_BLUE)
        p.rect(0, 0, 210, 60, 'F')
        p.set_y(18)
        p.set_font("K", "B", 28)
        p.set_text_color(*WHITE)
        p.cell(0, 12, "CampAI", align="C", new_x="LMARGIN", new_y="NEXT")
        p.set_font("K", "", 10)
        p.set_text_color(190, 210, 255)
        p.cell(0, 6, "AI 선거 참모  |  데이터 기반 전략 분석", align="C", new_x="LMARGIN", new_y="NEXT")

        p.set_y(80)
        p.set_font("K", "B", 24)
        p.set_text_color(*DARK_TEXT)
        p.cell(0, 12, "일일 전략 보고서", align="C", new_x="LMARGIN", new_y="NEXT")
        p.ln(3)
        p.set_font("K", "", 14)
        p.set_text_color(*BRAND_BLUE)
        p.cell(0, 8, election_name, align="C", new_x="LMARGIN", new_y="NEXT")

        p.ln(8)
        p.set_fill_color(*BRAND_LIGHT)
        p.rect(80, p.get_y(), 50, 20, 'F')
        p.set_xy(80, p.get_y() + 2)
        p.set_font("K", "B", 20)
        p.set_text_color(*BRAND_BLUE)
        p.cell(50, 10, f"D-{d_day}", align="C", new_x="LMARGIN", new_y="NEXT")
        p.set_xy(80, p.get_y())
        p.set_font("K", "", 8)
        p.set_text_color(*MUTED)
        p.cell(50, 5, "선거일까지", align="C")

        p.set_y(145)
        info = [
            ("보고일", report_date),
            ("선거명", election_name),
            ("우리 후보", our_candidate),
        ]
        if data_summary:
            info.append(("데이터", data_summary))
        for label, value in info:
            p.set_x(50)
            p.set_font("K", "", 8)
            p.set_text_color(*MUTED)
            p.cell(30, 7, label)
            p.set_font("K", "B", 8)
            p.set_text_color(*DARK_TEXT)
            p.cell(80, 7, value, new_x="LMARGIN", new_y="NEXT")

        p.set_y(250)
        p.set_draw_color(*BORDER)
        p.line(50, p.get_y(), 160, p.get_y())
        p.ln(4)
        p.set_font("K", "", 7)
        p.set_text_color(*MUTED)
        p.cell(0, 4, "CONFIDENTIAL", align="C", new_x="LMARGIN", new_y="NEXT")
        p.cell(0, 4, "본 보고서는 CampAI가 수집 데이터 기반으로 자동 생성한 참고자료입니다.", align="C", new_x="LMARGIN", new_y="NEXT")
        p.cell(0, 4, "의사결정 전 반드시 사실 확인이 필요하며, 선거법상 [AI 생성물]에 해당합니다.", align="C", new_x="LMARGIN", new_y="NEXT")

    def new_page(self, election_name, d_day, report_date):
        self.pdf.add_page()
        self._header_bar(election_name, d_day, report_date)

    def section(self, num, title):
        p = self.pdf
        p.ln(3)
        y = p.get_y()
        p.set_fill_color(*BRAND_BLUE)
        p.rect(15, y, 180, 0.8, 'F')
        p.ln(3)
        p.set_font("K", "B", 12)
        p.set_text_color(*BRAND_BLUE)
        p.cell(0, 8, f"{num}. {title}", new_x="LMARGIN", new_y="NEXT")
        p.ln(1)

    def sub_section(self, title):
        p = self.pdf
        p.ln(2)
        p.set_font("K", "B", 9)
        p.set_text_color(*DARK_TEXT)
        p.cell(0, 6, title, new_x="LMARGIN", new_y="NEXT")
        p.ln(1)

    def text(self, content):
        p = self.pdf
        p.set_font("K", "", 8.5)
        p.set_text_color(*BODY_TEXT)
        p.multi_cell(180, 5.5, content)
        p.ln(1)

    def bold(self, content):
        p = self.pdf
        p.set_font("K", "B", 8.5)
        p.set_text_color(*DARK_TEXT)
        p.multi_cell(180, 5.5, content)
        p.ln(1)

    def alert(self, text, level="warning"):
        p = self.pdf
        colors = {
            "danger": (RED, (254, 226, 226), (127, 29, 29)),
            "warning": (AMBER, (254, 243, 199), (120, 53, 15)),
            "info": (BRAND_BLUE, BRAND_LIGHT, (30, 58, 138)),
            "good": (GREEN, (220, 252, 231), (20, 83, 45)),
        }
        border_c, bg_c, text_c = colors.get(level, colors["warning"])

        y = p.get_y()
        p.set_fill_color(*bg_c)
        p.rect(15, y, 180, 12, 'F')
        p.set_fill_color(*border_c)
        p.rect(15, y, 2.5, 12, 'F')
        p.set_xy(20, y + 2)
        p.set_font("K", "B", 8)
        p.set_text_color(*text_c)
        p.multi_cell(172, 4, text)
        p.set_y(y + 14)

    def table(self, headers, rows, col_widths, highlight_row=None):
        p = self.pdf
        y = p.get_y()
        total_w = sum(col_widths)

        p.set_fill_color(*BRAND_BLUE)
        p.rect(15, y, total_w, 7, 'F')
        x = 15
        p.set_font("K", "B", 7)
        p.set_text_color(*WHITE)
        for i, h in enumerate(headers):
            p.set_xy(x, y + 1)
            p.cell(col_widths[i], 5, h, align="C" if i > 0 else "L")
            x += col_widths[i]
        y += 7.5

        for ri, row in enumerate(rows):
            is_hl = highlight_row is not None and ri == highlight_row
            bg = BRAND_LIGHT if is_hl else LIGHT_BG if ri % 2 == 0 else WHITE
            p.set_fill_color(*bg)
            p.rect(15, y, total_w, 6.5, 'F')
            if is_hl:
                p.set_fill_color(*BRAND_BLUE)
                p.rect(15, y, 2, 6.5, 'F')

            x = 15
            for i, val in enumerate(row):
                p.set_xy(x, y + 0.8)
                p.set_font("K", "B" if (i == 0 and is_hl) else "", 7)
                p.set_text_color(*BRAND_BLUE if is_hl else DARK_TEXT)
                p.cell(col_widths[i], 5, str(val), align="C" if i > 0 else "L")
                x += col_widths[i]
            y += 6.5
        p.set_y(y + 3)

    def bullets(self, items):
        p = self.pdf
        for item in items:
            p.set_x(18)
            p.set_font("K", "B", 8)
            p.set_text_color(*BRAND_BLUE)
            p.cell(5, 5, "-")
            p.set_font("K", "", 8)
            p.set_text_color(*BODY_TEXT)
            p.multi_cell(170, 5, item)
            p.ln(0.5)

    def image(self, path, x=15, w=180):
        self.pdf.image(path, x=x, w=w)

    def finalize(self):
        for pg in range(1, self.pdf.pages_count + 1):
            self.pdf.page = pg
            self._footer_bar()

    def save(self, filepath):
        self.finalize()
        self.pdf.output(filepath)
        logger.info("pdf_generated", path=filepath, pages=self.pdf.pages_count)
        return filepath


# ── 메인 생성 함수 ──

def generate_report_pdf(
    report_text: str,
    election_name: str = "",
    report_date: str = "",
    report_type: str = "daily",
    our_candidate: str = "",
    d_day: int = 0,
    candidates_data: list = None,
) -> str | None:
    """
    보고서 PDF 생성.
    candidates_data: [{name, news, pos, neg, community, yt_views, search_vol, is_ours}, ...]
    """
    try:
        from fpdf import FPDF
    except ImportError:
        logger.error("fpdf2_not_installed")
        return None

    font_r, _ = _find_font()
    if not font_r:
        logger.error("korean_font_not_found")
        return None

    if not report_date:
        report_date = date.today().isoformat()

    report = CampAIReport()

    # ── 표지 ──
    data_summary = ""
    if candidates_data:
        total_news = sum(c.get("news", 0) for c in candidates_data)
        total_comm = sum(c.get("community", 0) for c in candidates_data)
        total_yt = sum(c.get("yt_count", 0) for c in candidates_data)
        data_summary = f"뉴스 {total_news}건 | 커뮤니티 {total_comm}건 | 유튜브 {total_yt}건"

    report.cover(election_name, d_day, report_date, our_candidate, data_summary)

    # candidates_data가 있으면 차트 + 표 생성
    tmp = tempfile.mkdtemp()
    if candidates_data:
        names = [c["name"] for c in candidates_data]
        our_idx = next((i for i, c in enumerate(candidates_data) if c.get("is_ours")), None)

        # 차트 생성
        try:
            _make_bar_chart(names, [
                {"title": "뉴스 보도량", "values": [c.get("news", 0) for c in candidates_data], "our": our_candidate},
                {"title": "커뮤니티 게시글", "values": [c.get("community", 0) for c in candidates_data], "our": our_candidate},
                {"title": "유튜브 조회수(천)", "values": [c.get("yt_views", 0)/1000 for c in candidates_data], "our": our_candidate},
            ], f'{tmp}/comparison.png')

            _make_sentiment_chart(
                names,
                [c.get("pos", 0) for c in candidates_data],
                [c.get("neg", 0) for c in candidates_data],
                [c.get("news", 0) - c.get("pos", 0) - c.get("neg", 0) for c in candidates_data],
                f'{tmp}/sentiment.png',
            )
        except Exception as e:
            logger.warning("chart_generation_error", error=str(e)[:200])

    # ── 본문 (AI 텍스트 기반) ──
    report.new_page(election_name, d_day, report_date)

    # AI 텍스트를 섹션별로 파싱
    sections = _parse_report_sections(report_text)

    for sec_num, sec_title, sec_body in sections:
        # 페이지 여백 체크
        if report.pdf.get_y() > 240:
            report.new_page(election_name, d_day, report_date)

        report.section(sec_num, sec_title)

        # 차트 삽입 (후보 비교 섹션에)
        if candidates_data and sec_num in ("II", "2") and os.path.exists(f'{tmp}/comparison.png'):
            report.image(f'{tmp}/comparison.png', w=180)
            report.pdf.ln(3)

            # 비교표
            headers = ['후보', '뉴스', '긍정', '부정', '커뮤니티', '유튜브', '검색량']
            rows = []
            for c in candidates_data:
                rows.append([
                    f"{'* ' if c.get('is_ours') else '  '}{c['name']}",
                    str(c.get("news", 0)),
                    str(c.get("pos", 0)),
                    str(c.get("neg", 0)),
                    str(c.get("community", 0)),
                    f"{c.get('yt_views', 0):,}",
                    f"{c.get('search_vol', 0):.1f}",
                ])
            report.table(headers, rows, [30, 18, 18, 18, 22, 30, 22], highlight_row=our_idx)

        # 감성 차트 (감성 분석 섹션에)
        if candidates_data and sec_num in ("III", "3") and os.path.exists(f'{tmp}/sentiment.png'):
            report.image(f'{tmp}/sentiment.png', x=25, w=160)
            report.pdf.ln(3)

        # 본문 텍스트
        for line in sec_body:
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.startswith("[경고]") or stripped.startswith("[위험]"):
                report.alert(stripped.replace("[경고]", "").replace("[위험]", "").strip(), "danger")
            elif stripped.startswith("[기회]") or stripped.startswith("[긍정]"):
                report.alert(stripped.replace("[기회]", "").replace("[긍정]", "").strip(), "good")
            elif stripped.startswith("[주의]"):
                report.alert(stripped.replace("[주의]", "").strip(), "warning")
            elif stripped.startswith("- ") or stripped.startswith("* "):
                report.bullets([stripped[2:]])
            elif stripped.startswith("**") and stripped.endswith("**"):
                report.bold(stripped.strip("*"))
            else:
                report.text(stripped)

    # 저장
    output_dir = Path("/app/data/reports") if Path("/app/data").exists() else Path(tempfile.gettempdir()) / "electionpulse_reports"
    output_dir.mkdir(exist_ok=True)
    safe_name = re.sub(r'[^\w\-]', '_', election_name)[:30]
    filename = f"{report_date}_{safe_name}_{report_type}.pdf"
    filepath = str(output_dir / filename)

    report.save(filepath)
    return filepath


def _parse_report_sections(text: str) -> list:
    """AI 보고서 텍스트를 섹션으로 파싱."""
    sections = []
    current_num = "I"
    current_title = "보고서"
    current_body = []

    # 이모지 제거 (한글 U+AC00-U+D7AF 보호)
    emoji_re = re.compile(
        "[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF"
        "\U0001F1E0-\U0001F1FF\U00002702-\U000027B0"
        "\U0001f926-\U0001f937\U0001F000-\U0001F9FF"
        "\u2640-\u2642\u2600-\u2B55\u200d\u23cf\u23e9\u231a\ufe0f\u3030"
        "\U000024C2-\U000024FF\U0001F200-\U0001F251]+",
        flags=re.UNICODE,
    )

    for line in text.split("\n"):
        clean = emoji_re.sub("", line).strip()
        clean = re.sub(r'</?b>', '', clean)
        # 마크다운 bold/header 제거 (섹션 감지 전)
        clean_for_match = re.sub(r'^\*{1,2}', '', clean)
        clean_for_match = re.sub(r'\*{1,2}$', '', clean_for_match).strip()
        clean_for_match = re.sub(r'^#{1,3}\s*', '', clean_for_match).strip()

        # 섹션 헤더 감지
        sec_match = re.match(r'^[═━=]{3,}.*?(PART|파트)\s*(\d+)', clean_for_match, re.IGNORECASE)
        num_match = re.match(r'^(\d{1,2})\.\s+(.+)', clean_for_match)
        roman_match = re.match(r'^(I{1,3}V?|VI{0,3})\.\s+(.+)', clean_for_match)

        if sec_match or (num_match and len(clean) < 60) or roman_match:
            if current_body:
                sections.append((current_num, current_title, current_body))
            if num_match:
                current_num = num_match.group(1)
                current_title = num_match.group(2)
            elif roman_match:
                current_num = roman_match.group(1)
                current_title = roman_match.group(2)
            else:
                current_num = sec_match.group(2) if sec_match else str(len(sections) + 1)
                current_title = clean
            current_body = []
        else:
            if clean:
                current_body.append(clean)

    if current_body:
        sections.append((current_num, current_title, current_body))

    # 섹션이 없으면 전체를 하나로
    if not sections:
        sections = [("I", "보고서", [l.strip() for l in text.split("\n") if l.strip()])]

    return sections
