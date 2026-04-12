"""
보고서 C안: 이전 심층분석 보고서 수준 + 프린트 친화 화이트 배경
깊이 있는 분석 텍스트 + 깔끔한 표 + 차트
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))

from fpdf import FPDF
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import numpy as np
import tempfile

FONT_DIR = Path(__file__).parent / "app/reports/fonts"
FONT_R = str(FONT_DIR / "NanumGothic.ttf")
FONT_B = str(FONT_DIR / "NanumGothicBold.ttf")

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

# 데이터
candidates = ['윤건영', '김성근', '김진균', '조동욱', '신문규']
news_count = [72, 18, 23, 20, 20]
news_pos = [48, 14, 12, 10, 15]
news_neg = [5, 0, 3, 6, 4]
news_neu = [19, 4, 8, 4, 1]
community = [44, 14, 14, 10, 6]
yt_count = [13, 8, 16, 7, 9]
yt_views = [51220, 28569, 4098, 1801, 5645]
search_vol = [16.06, 28.93, 3.64, 24.44, 1.60]

OUR = '김진균'
OUR_IDX = 2
D_DAY = 57
ELECTION = '2026 충북 교육감'
TODAY = '2026년 4월 10일 (목)'


def make_comparison_bar(filename):
    """후보별 미디어 노출 비교 (가로 막대)."""
    fig, axes = plt.subplots(1, 3, figsize=(7, 2.5))
    fig.patch.set_facecolor('white')

    datasets = [
        ('뉴스 보도량', news_count, '건'),
        ('커뮤니티 게시글', community, '건'),
        ('유튜브 조회수', [v/1000 for v in yt_views], '천회'),
    ]

    for ax, (title, data, unit) in zip(axes, datasets):
        ax.set_facecolor('white')
        colors = ['#1e40af' if c == OUR else '#94a3b8' for c in candidates]
        y_pos = range(len(candidates))
        bars = ax.barh(y_pos, data, color=colors, height=0.55, edgecolor='none')
        ax.set_yticks(y_pos)
        ax.set_yticklabels(candidates, fontsize=7)
        ax.invert_yaxis()
        ax.set_title(title, fontsize=8, fontweight='bold', color='#111827', pad=6)

        for bar, val in zip(bars, data):
            ax.text(bar.get_width() + max(data)*0.03, bar.get_y() + bar.get_height()/2,
                    f'{val:,.0f}{unit}', va='center', fontsize=6, color='#374151')

        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        ax.spines['bottom'].set_color('#e5e7eb')
        ax.spines['left'].set_color('#e5e7eb')
        ax.tick_params(colors='#6b7280', labelsize=6)

    plt.tight_layout(w_pad=3)
    plt.savefig(filename, dpi=180, bbox_inches='tight', facecolor='white')
    plt.close()


def make_sentiment_chart(filename):
    """후보별 감성 분포 스택 바."""
    fig, ax = plt.subplots(figsize=(6, 2))
    fig.patch.set_facecolor('white')
    ax.set_facecolor('white')

    y = range(len(candidates))
    ax.barh(y, news_pos, color='#16a34a', height=0.5, label='긍정')
    ax.barh(y, news_neu, left=news_pos, color='#d1d5db', height=0.5, label='중립')
    ax.barh(y, news_neg, left=[news_pos[i]+news_neu[i] for i in range(len(candidates))],
            color='#dc2626', height=0.5, label='부정')

    ax.set_yticks(y)
    ax.set_yticklabels(candidates, fontsize=7.5)
    ax.invert_yaxis()
    ax.set_title('후보별 뉴스 감성 분포', fontsize=9, fontweight='bold', color='#111827', pad=8)
    ax.legend(fontsize=6.5, loc='lower right', framealpha=0.9)

    for i in range(len(candidates)):
        total = news_count[i]
        pos_pct = round(news_pos[i]/total*100) if total else 0
        ax.text(total + 1, i, f'{pos_pct}%', va='center', fontsize=6.5, color='#16a34a', fontweight='bold')

    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['bottom'].set_color('#e5e7eb')
    ax.spines['left'].set_color('#e5e7eb')
    ax.tick_params(colors='#6b7280', labelsize=7)

    plt.tight_layout()
    plt.savefig(filename, dpi=180, bbox_inches='tight', facecolor='white')
    plt.close()


class ReportC(FPDF):
    def __init__(self):
        super().__init__()
        self.add_font("K", "", FONT_R)
        self.add_font("K", "B", FONT_B)
        self.set_auto_page_break(auto=True, margin=20)

    def header_bar(self):
        """매 페이지 상단 브랜드 바."""
        self.set_fill_color(*BRAND_BLUE)
        self.rect(0, 0, 210, 3, 'F')

        self.set_y(5)
        self.set_font("K", "B", 8)
        self.set_text_color(*BRAND_BLUE)
        self.cell(90, 5, "  CampAI  |  AI 선거 참모")
        self.set_font("K", "", 7)
        self.set_text_color(*MUTED)
        self.cell(100, 5, f"CONFIDENTIAL  |  {TODAY}", align="R")
        self.ln(3)
        self.set_draw_color(*BORDER)
        self.line(15, self.get_y(), 195, self.get_y())
        self.ln(4)

    def footer_bar(self):
        """푸터."""
        self.set_y(-15)
        self.set_draw_color(*BORDER)
        self.line(15, self.get_y(), 195, self.get_y())
        self.ln(2)
        self.set_font("K", "", 6)
        self.set_text_color(*MUTED)
        self.cell(90, 4, "  [AI 생성물] CampAI 자동 생성 참고자료 | 의사결정 전 사실 확인 필요")
        self.cell(90, 4, f"page {self.page_no()}", align="R")

    def cover_page(self):
        """표지 — 깔끔한 화이트."""
        self.add_page()

        # 상단 파란 바
        self.set_fill_color(*BRAND_BLUE)
        self.rect(0, 0, 210, 60, 'F')

        # CampAI 로고
        self.set_y(18)
        self.set_font("K", "B", 28)
        self.set_text_color(*WHITE)
        self.cell(0, 12, "CampAI", align="C", new_x="LMARGIN", new_y="NEXT")
        self.set_font("K", "", 10)
        self.set_text_color(190, 210, 255)
        self.cell(0, 6, "AI 선거 참모  |  데이터 기반 전략 분석", align="C", new_x="LMARGIN", new_y="NEXT")

        # 보고서 제목
        self.set_y(80)
        self.set_font("K", "B", 24)
        self.set_text_color(*DARK_TEXT)
        self.cell(0, 12, "일일 전략 보고서", align="C", new_x="LMARGIN", new_y="NEXT")

        self.ln(3)
        self.set_font("K", "", 14)
        self.set_text_color(*BRAND_BLUE)
        self.cell(0, 8, ELECTION, align="C", new_x="LMARGIN", new_y="NEXT")

        # D-Day 박스
        self.ln(8)
        x_center = 80
        self.set_fill_color(*BRAND_LIGHT)
        self.rect(x_center, self.get_y(), 50, 20, 'F')
        self.set_xy(x_center, self.get_y() + 2)
        self.set_font("K", "B", 20)
        self.set_text_color(*BRAND_BLUE)
        self.cell(50, 10, f"D-{D_DAY}", align="C", new_x="LMARGIN", new_y="NEXT")
        self.set_xy(x_center, self.get_y())
        self.set_font("K", "", 8)
        self.set_text_color(*MUTED)
        self.cell(50, 5, "선거일까지", align="C")

        # 정보
        self.set_y(145)
        info = [
            ("보고일", TODAY),
            ("선거명", ELECTION),
            ("우리 후보", OUR),
            ("분석 기간", "2026.04.05 ~ 2026.04.10"),
            ("데이터", f"뉴스 {sum(news_count)}건 | 커뮤니티 {sum(community)}건 | 유튜브 {sum(yt_count)}건"),
        ]
        for label, value in info:
            self.set_x(50)
            self.set_font("K", "", 8)
            self.set_text_color(*MUTED)
            self.cell(30, 7, label)
            self.set_font("K", "B", 8)
            self.set_text_color(*DARK_TEXT)
            self.cell(80, 7, value, new_x="LMARGIN", new_y="NEXT")

        # 하단 면책
        self.set_y(250)
        self.set_draw_color(*BORDER)
        self.line(50, self.get_y(), 160, self.get_y())
        self.ln(4)
        self.set_font("K", "", 7)
        self.set_text_color(*MUTED)
        self.cell(0, 4, "CONFIDENTIAL", align="C", new_x="LMARGIN", new_y="NEXT")
        self.cell(0, 4, "본 보고서는 CampAI가 수집 데이터를 기반으로 자동 생성한 참고자료입니다.", align="C", new_x="LMARGIN", new_y="NEXT")
        self.cell(0, 4, "의사결정 전 반드시 사실 확인이 필요하며, 선거법상 [AI 생성물]에 해당합니다.", align="C", new_x="LMARGIN", new_y="NEXT")
        self.cell(0, 4, "CampAI (c) 2026  |  campai.kr", align="C", new_x="LMARGIN", new_y="NEXT")

    def section_heading(self, num, title):
        """섹션 제목 (로마 숫자 스타일)."""
        self.ln(3)
        y = self.get_y()
        self.set_fill_color(*BRAND_BLUE)
        self.rect(15, y, 180, 0.8, 'F')
        self.ln(3)
        self.set_font("K", "B", 12)
        self.set_text_color(*BRAND_BLUE)
        self.cell(0, 8, f"{num}. {title}", new_x="LMARGIN", new_y="NEXT")
        self.ln(1)

    def sub_heading(self, title):
        """소제목."""
        self.ln(2)
        self.set_font("K", "B", 9)
        self.set_text_color(*DARK_TEXT)
        self.cell(0, 6, title, new_x="LMARGIN", new_y="NEXT")
        self.ln(1)

    def body_text(self, text):
        """본문 텍스트."""
        self.set_font("K", "", 8.5)
        self.set_text_color(*BODY_TEXT)
        self.multi_cell(180, 5.5, text)
        self.ln(1)

    def bold_text(self, text):
        """강조 텍스트."""
        self.set_font("K", "B", 8.5)
        self.set_text_color(*DARK_TEXT)
        self.multi_cell(180, 5.5, text)
        self.ln(1)

    def alert_box(self, text, level="warning"):
        """알림 박스."""
        colors = {
            "danger": (RED, (254, 226, 226), (127, 29, 29)),
            "warning": (AMBER, (254, 243, 199), (120, 53, 15)),
            "info": (BRAND_BLUE, BRAND_LIGHT, (30, 58, 138)),
            "good": (GREEN, (220, 252, 231), (20, 83, 45)),
        }
        border_c, bg_c, text_c = colors.get(level, colors["warning"])

        y = self.get_y()
        self.set_fill_color(*bg_c)
        self.rect(15, y, 180, 12, 'F')
        self.set_fill_color(*border_c)
        self.rect(15, y, 2.5, 12, 'F')

        self.set_xy(20, y + 2)
        self.set_font("K", "B", 8)
        self.set_text_color(*text_c)
        self.multi_cell(172, 4, text)
        self.set_y(y + 14)

    def data_table(self, headers, rows, col_widths, highlight_row=None):
        """깔끔한 데이터 테이블."""
        y = self.get_y()
        total_w = sum(col_widths)

        # 헤더
        self.set_fill_color(*BRAND_BLUE)
        self.rect(15, y, total_w, 7, 'F')
        x = 15
        self.set_font("K", "B", 7)
        self.set_text_color(*WHITE)
        for i, h in enumerate(headers):
            self.set_xy(x, y + 1)
            self.cell(col_widths[i], 5, h, align="C" if i > 0 else "L")
            x += col_widths[i]
        y += 7.5

        # 행
        for ri, row in enumerate(rows):
            is_hl = highlight_row is not None and ri == highlight_row
            bg = BRAND_LIGHT if is_hl else LIGHT_BG if ri % 2 == 0 else WHITE
            self.set_fill_color(*bg)
            self.rect(15, y, total_w, 6.5, 'F')

            if is_hl:
                self.set_fill_color(*BRAND_BLUE)
                self.rect(15, y, 2, 6.5, 'F')

            x = 15
            for i, val in enumerate(row):
                self.set_xy(x, y + 0.8)
                self.set_font("K", "B" if (i == 0 and is_hl) else "", 7)
                self.set_text_color(*BRAND_BLUE if is_hl else DARK_TEXT)
                self.cell(col_widths[i], 5, str(val), align="C" if i > 0 else "L")
                x += col_widths[i]
            y += 6.5

        self.set_y(y + 3)

    def bullet_list(self, items, bullet="*"):
        """불릿 리스트."""
        for item in items:
            self.set_x(18)
            self.set_font("K", "", 8)
            self.set_text_color(*BODY_TEXT)
            self.cell(5, 5, bullet)
            self.multi_cell(170, 5, item)
            self.ln(0.5)


def generate():
    tmp = tempfile.mkdtemp()
    make_comparison_bar(f'{tmp}/comparison.png')
    make_sentiment_chart(f'{tmp}/sentiment.png')

    pdf = ReportC()

    # ── 표지 ──
    pdf.cover_page()

    # ── I. 핵심 요약 ──
    pdf.add_page()
    pdf.header_bar()
    pdf.section_heading("I", "핵심 요약 (Executive Summary)")

    pdf.alert_box(
        "경고: 김진균 후보 전 채널 열세. 뉴스 노출 3위(23건), 유튜브 조회수 4위(4,098회), "
        "검색 트렌드 5위(3.6). 윤건영(72건/51,220회) 대비 전 지표 30~50% 수준. 즉각적인 미디어 노출 확대 전략 필요.",
        "danger"
    )

    pdf.body_text(
        f"D-{D_DAY}. 윤건영이 뉴스 72건으로 압도적 1위를 유지하며 미디어 장악력을 보이고 있다. "
        f"김진균은 23건으로 3위를 기록, 윤건영 대비 31.9% 수준에 불과하다. "
        f"다만 긍정률 52.2%(12/23건)는 김성근(77.8%)에 이어 2위권으로, 보도의 질적 측면은 양호한 편이다."
    )
    pdf.body_text(
        "커뮤니티에서는 윤건영(44건)이 독주, 김진균과 김성근이 각 14건으로 동률 2위. "
        "유튜브에서 김진균은 영상 수(16건)는 1위이나 조회수(4,098회)는 4위로, "
        "콘텐츠 도달력이 현저히 부족하다. 쇼츠 중심 전략으로 조회수 극복이 시급하다."
    )

    pdf.bold_text("오늘의 핵심 판단:")
    pdf.bullet_list([
        "미디어 노출 절대량이 부족하다. 보도자료/인터뷰를 통한 뉴스 노출을 3배 이상 확대해야 한다.",
        "유튜브 쇼츠 콘텐츠를 일 1건 이상 제작하여 조회수 2만 이상 달성을 목표로 한다.",
        "조동욱 부정뉴스 6건은 공략 기회. 비교 콘텐츠를 통한 상대적 이미지 제고 전략을 추진한다.",
    ])

    # ── II. 후보 비교 분석 ──
    pdf.section_heading("II", "후보 비교 분석")

    pdf.sub_heading("2-1. 종합 비교표")
    headers = ['후보', '뉴스', '긍정', '부정', '긍정률', '커뮤니티', '유튜브', '검색량']
    rows = []
    for i, name in enumerate(candidates):
        pos_rate = f"{round(news_pos[i]/max(news_count[i],1)*100)}%"
        rows.append([
            f"{'* ' if name == OUR else '  '}{name}",
            str(news_count[i]),
            str(news_pos[i]),
            str(news_neg[i]),
            pos_rate,
            str(community[i]),
            f"{yt_views[i]:,}",
            f"{search_vol[i]:.1f}",
        ])
    pdf.data_table(headers, rows, [30, 16, 16, 16, 20, 22, 30, 22], highlight_row=OUR_IDX)

    pdf.body_text(
        "분석: 윤건영이 뉴스(72건), 커뮤니티(44건), 유튜브 조회수(51,220회) 전 채널에서 압도적 1위를 차지하고 있다. "
        "이는 현직 교육감의 행정 뉴스가 자연스럽게 보도되는 구조적 이점에 기인한다. "
        "김진균은 뉴스 3위(23건), 커뮤니티 공동 2위(14건)로 중위권이나, 유튜브 조회수와 검색 트렌드에서 하위권을 기록하고 있다."
    )
    pdf.body_text(
        "주목할 점: 김성근의 검색량(28.9)이 전체 1위로, 최근 미디어 노출이 검색 관심도로 이어지고 있다. "
        "반면 김진균의 검색량(3.6)은 최하위로, 유권자 인지도 제고가 가장 시급한 과제이다."
    )

    pdf.sub_heading("2-2. 미디어 노출 비교 차트")
    pdf.image(f'{tmp}/comparison.png', x=15, w=180)

    # ── III. 감성 분석 ──
    pdf.add_page()
    pdf.header_bar()
    pdf.section_heading("III", "뉴스 감성 분석")

    pdf.image(f'{tmp}/sentiment.png', x=25, w=160)
    pdf.ln(3)

    pdf.body_text(
        "김진균의 긍정률 52.2%는 전체 평균(64.5%) 대비 낮은 편이나, 이는 부정 뉴스 3건이 비율에 영향을 미친 결과이다. "
        "절대 수치로 보면 긍정 12건/부정 3건으로 4:1 비율이며, 부정 뉴스의 실질적 위험도는 높지 않다."
    )
    pdf.body_text(
        "김성근(긍정률 77.8%)은 부정 뉴스가 0건으로 미디어 이미지가 가장 깨끗하나, "
        "이는 보도량 자체가 적어(18건) 검증 기사가 나오지 않은 것으로 해석할 수 있다. "
        "조동욱은 부정 6건(30%)으로 가장 높은 부정 비율을 보이며, 이는 공략 기회로 활용 가능하다."
    )

    # ── IV. 위기 & 기회 ──
    pdf.section_heading("IV", "위기 & 기회")

    pdf.sub_heading("위기 항목")
    pdf.alert_box("미디어 노출 절대 부족 - 윤건영 대비 31.9% 수준. 보도자료 + 인터뷰 집중 필요", "danger")
    pdf.alert_box("검색 트렌드 최하위(3.6) - 유권자 인지도 심각 부족. SNS 캠페인 필요", "danger")
    pdf.alert_box("유튜브 조회수 4위(4,098회) - 콘텐츠 도달력 부족. 쇼츠 전략 전환", "warning")

    pdf.ln(2)
    pdf.sub_heading("기회 항목")
    pdf.alert_box("조동욱 부정뉴스 6건 - 비교 콘텐츠로 상대적 이미지 제고 가능", "good")
    pdf.alert_box("김성근 커뮤니티 약세(14건) - 맘카페/교육 블로그에서 선점 기회", "good")
    pdf.alert_box("유튜브 영상 수 1위(16건) - 이미 콘텐츠 기반은 갖춤. 쇼츠 전환으로 조회수 폭발 가능", "info")

    # ── V. AI 전략 제언 ──
    pdf.add_page()
    pdf.header_bar()
    pdf.section_heading("V", "AI 전략 제언")

    strategies = [
        ("1. 뉴스 노출 3배 확대 (최우선)",
         "현재 23건으로 윤건영(72건)의 1/3 수준. 보도자료를 일 2건 이상 배포하고, "
         "지역 언론 인터뷰를 주 3회 이상 확보한다. 교육 정책 발표를 뉴스 이벤트와 연계하여 "
         "보도량을 주간 단위로 50건 이상 달성하는 것을 목표로 한다."),
        ("2. 유튜브 쇼츠 일 1건 제작",
         "영상 수(16건)는 1위이나 조회수(4,098회)는 4위. 이는 긴 영상 위주의 콘텐츠 전략이 "
         "도달력에 한계가 있음을 의미한다. 60초 이내 교육 이슈 쇼츠를 일 1건 제작하여 "
         "주간 조회수 20,000회 이상을 목표로 한다. 급식, 돌봄, 사교육비 등 학부모 관심 이슈를 소재로 활용."),
        ("3. 조동욱 부정뉴스 공략",
         "조동욱의 부정뉴스 6건(부정률 30%)은 전체 후보 중 가장 높은 수치. "
         "직접 공격보다는 '교육 전문성' 프레임으로 비교 콘텐츠를 제작한다. "
         "'교육 현장 경험 30년 vs 정치인 출신' 구도를 자연스럽게 형성하는 방향."),
        ("4. 검색 트렌드 개선 캠페인",
         "네이버 검색량 3.6으로 5위. 이는 유권자 인지도가 극히 낮다는 의미. "
         "SNS 해시태그 캠페인(#김진균교육감 #AI교육 #사교육비제로)과 블로그 SEO 콘텐츠를 "
         "주 5건 이상 발행하여 검색 유입을 유도한다."),
        ("5. 맘카페/교육 커뮤니티 공세",
         "커뮤니티 14건은 윤건영(44건)의 1/3 수준. 맘카페와 교육 블로그에 "
         "'급식 정책', '돌봄 확대', 'AI교육' 등 학부모 관심 주제로 정보성 게시물을 확대한다. "
         "직접적인 선거 홍보보다 정책 정보 제공 방식으로 접근하여 자연스러운 노출을 확보."),
    ]

    for title, desc in strategies:
        pdf.sub_heading(title)
        pdf.body_text(desc)

    # ── VI. 불편한 진실 ──
    pdf.section_heading("VI", "불편한 진실")
    pdf.body_text(
        "데이터가 보여주는 불리한 사실을 있는 그대로 기술합니다. "
        "불편하더라도 직시해야 전략 수정이 가능합니다."
    )

    truths = [
        "뉴스 23건은 5명 중 3위이지만, 1위 윤건영(72건)과의 격차가 49건으로 매우 크다. "
        "현재 속도로는 격차 축소가 불가능하며, 보도 전략의 근본적 전환이 필요하다.",
        "유튜브 영상 16건(1위)에도 불구하고 조회수 4,098회(4위)는 콘텐츠 매력도의 문제를 시사한다. "
        "영상을 많이 만드는 것이 아니라 '보는 영상'을 만들어야 한다.",
        "검색 트렌드 3.6(5위)은 유권자 대다수가 '김진균'을 검색조차 하지 않는다는 의미이다. "
        "인지도 자체가 부족한 상황에서 정책 홍보는 효과가 제한적이다. 인지도 확보가 선행되어야 한다.",
        "부정 뉴스 3건의 존재는 '검증받는 후보'라는 긍정적 해석도 가능하나, "
        "긍정률 52%는 전체 평균(65%) 대비 낮아 미디어 이미지 관리에 더 주의가 필요하다.",
    ]

    for truth in truths:
        pdf.set_x(15)
        pdf.set_font("K", "", 8)
        pdf.set_text_color(*RED)
        pdf.cell(5, 5, "-")
        pdf.set_text_color(*BODY_TEXT)
        pdf.multi_cell(175, 5, truth)
        pdf.ln(1.5)

    # 푸터
    for p in range(1, pdf.pages_count + 1):
        pdf.page = p
        pdf.footer_bar()

    outpath = "/Users/jojo/pro/mybot/report_sample_C.pdf"
    pdf.output(outpath)
    print(f"C안 생성 완료: {outpath}")


if __name__ == "__main__":
    generate()
