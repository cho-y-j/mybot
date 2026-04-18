"""
보고서 A안: 컨설팅 스타일 (맥킨지형)
정보 밀도 높은, 표 중심, 깔끔한 비즈니스 문서
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

# 폰트 설정
FONT_DIR = Path(__file__).parent / "app/reports/fonts"
FONT_R = str(FONT_DIR / "NanumGothic.ttf")
FONT_B = str(FONT_DIR / "NanumGothicBold.ttf")

# matplotlib 한글 폰트
fm.fontManager.addfont(FONT_R)
fm.fontManager.addfont(FONT_B)
plt.rcParams['font.family'] = 'NanumGothic'
plt.rcParams['axes.unicode_minus'] = False

# 색상
NAVY = (11, 14, 26)
DARK_BG = (20, 24, 40)
BLUE = (59, 130, 246)
PURPLE = (139, 92, 246)
RED = (239, 68, 68)
GREEN = (34, 197, 94)
GRAY = (156, 163, 175)
WHITE = (255, 255, 255)
LIGHT_GRAY = (243, 244, 246)

# 데이터
candidates = ['윤건영', '김성근', '김진균', '조동욱', '신문규']
news_count = [72, 18, 23, 20, 20]
news_pos = [48, 14, 12, 10, 15]
news_neg = [5, 0, 3, 6, 4]
community = [44, 14, 14, 10, 6]
yt_views = [51220, 28569, 4098, 1801, 5645]
search_vol = [16.06, 28.93, 3.64, 24.44, 1.60]

OUR = '김진균'
D_DAY = 57
ELECTION = '2026 충북 교육감'


def make_bar_chart(labels, values, colors, title, filename):
    """수평 바 차트 생성."""
    fig, ax = plt.subplots(figsize=(5, 2.2))
    fig.patch.set_facecolor('#14182a')
    ax.set_facecolor('#14182a')

    y_pos = range(len(labels))
    bars = ax.barh(y_pos, values, color=colors, height=0.6, edgecolor='none')

    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, fontsize=8, color='white')
    ax.invert_yaxis()
    ax.set_title(title, fontsize=9, fontweight='bold', color='white', pad=8)

    for i, (bar, val) in enumerate(zip(bars, values)):
        ax.text(bar.get_width() + max(values)*0.02, bar.get_y() + bar.get_height()/2,
                f'{val:,.0f}' if val > 100 else f'{val:.1f}',
                va='center', fontsize=7, color='white')

    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['bottom'].set_color('#333')
    ax.spines['left'].set_color('#333')
    ax.tick_params(colors='#888', labelsize=7)
    ax.xaxis.label.set_color('#888')

    plt.tight_layout()
    plt.savefig(filename, dpi=150, bbox_inches='tight', facecolor='#14182a')
    plt.close()


def make_sentiment_pie(pos, neg, neu, title, filename):
    """감성 도넛 차트."""
    fig, ax = plt.subplots(figsize=(2, 2))
    fig.patch.set_facecolor('#14182a')

    sizes = [pos, neg, neu]
    colors_p = ['#22c55e', '#ef4444', '#6b7280']

    wedges, _ = ax.pie(sizes, colors=colors_p, startangle=90,
                        wedgeprops=dict(width=0.4, edgecolor='#14182a'))

    total = sum(sizes)
    pos_pct = round(pos/total*100) if total > 0 else 0
    ax.text(0, 0, f'{pos_pct}%', ha='center', va='center',
            fontsize=14, fontweight='bold', color='#22c55e')

    ax.set_title(title, fontsize=8, color='white', pad=5)
    plt.tight_layout()
    plt.savefig(filename, dpi=150, bbox_inches='tight', facecolor='#14182a')
    plt.close()


class ReportA(FPDF):
    def __init__(self):
        super().__init__()
        self.add_font("K", "", FONT_R)
        self.add_font("K", "B", FONT_B)
        self.set_auto_page_break(auto=True, margin=20)

    def cover_page(self):
        """표지."""
        self.add_page()
        self.set_fill_color(*NAVY)
        self.rect(0, 0, 210, 297, 'F')

        # 상단 그라데이션 효과 (라인들)
        for i in range(80):
            alpha = max(0, 30 - i * 0.4)
            self.set_draw_color(59, 130, 246)
            self.set_line_width(0.1)
            self.line(0, 60 + i, 210, 60 + i)

        # CampAI 로고
        self.set_y(80)
        self.set_font("K", "B", 36)
        self.set_text_color(*WHITE)
        self.cell(0, 20, "CampAI", align="C", new_x="LMARGIN", new_y="NEXT")

        self.set_font("K", "", 12)
        self.set_text_color(*GRAY)
        self.cell(0, 8, "AI 선거 참모", align="C", new_x="LMARGIN", new_y="NEXT")

        self.ln(30)

        # 보고서 제목
        self.set_font("K", "B", 22)
        self.set_text_color(*WHITE)
        self.cell(0, 12, "일일 전략 보고서", align="C", new_x="LMARGIN", new_y="NEXT")

        self.ln(5)
        self.set_font("K", "", 14)
        self.set_text_color(59, 130, 246)
        self.cell(0, 10, ELECTION, align="C", new_x="LMARGIN", new_y="NEXT")

        self.ln(3)
        self.set_font("K", "B", 28)
        self.set_text_color(*WHITE)
        self.cell(0, 15, f"D-{D_DAY}", align="C", new_x="LMARGIN", new_y="NEXT")

        self.ln(3)
        self.set_font("K", "", 11)
        self.set_text_color(*GRAY)
        self.cell(0, 8, "2026년 4월 10일 (목)", align="C", new_x="LMARGIN", new_y="NEXT")

        # 하단 우리 후보
        self.set_y(230)
        self.set_font("K", "", 10)
        self.set_text_color(*GRAY)
        self.cell(0, 6, f"우리 후보: {OUR}", align="C", new_x="LMARGIN", new_y="NEXT")

        # 면책
        self.set_y(270)
        self.set_font("K", "", 7)
        self.set_text_color(80, 80, 80)
        self.cell(0, 4, "본 보고서는 AI가 수집 데이터를 기반으로 생성한 참고자료입니다.", align="C", new_x="LMARGIN", new_y="NEXT")
        self.cell(0, 4, "의사결정 전 사실 확인이 필요하며, 선거법상 [AI 생성물]에 해당합니다.", align="C", new_x="LMARGIN", new_y="NEXT")

    def page_header(self, title):
        """페이지 상단."""
        self.set_fill_color(*NAVY)
        self.rect(0, 0, 210, 297, 'F')

        # 상단 바
        self.set_fill_color(*DARK_BG)
        self.rect(0, 0, 210, 18, 'F')
        self.set_y(5)
        self.set_font("K", "B", 9)
        self.set_text_color(*BLUE)
        self.cell(90, 8, f"  CampAI | {ELECTION}")
        self.set_text_color(*GRAY)
        self.set_font("K", "", 8)
        self.cell(100, 8, f"D-{D_DAY} | 2026.04.10", align="R")

        self.ln(12)
        # 섹션 타이틀
        self.set_font("K", "B", 16)
        self.set_text_color(*WHITE)
        self.cell(0, 10, title, new_x="LMARGIN", new_y="NEXT")
        self.ln(3)

    def kpi_cards(self):
        """KPI 4개 카드."""
        cards = [
            ("미디어 노출", "23건", "5위 중 3위", RED),
            ("긍정률", "52%", "전체 평균 65%", (255, 180, 0)),
            ("유튜브", "4,098회", "5위 중 4위", BLUE),
            ("검색 트렌드", "3.6", "5위 중 5위", PURPLE),
        ]

        x_start = 15
        card_w = 42
        gap = 3

        for i, (label, value, sub, color) in enumerate(cards):
            x = x_start + i * (card_w + gap)
            y = self.get_y()

            # 카드 배경
            self.set_fill_color(30, 35, 55)
            self.rect(x, y, card_w, 28, 'F')

            # 상단 컬러 라인
            self.set_fill_color(*color)
            self.rect(x, y, card_w, 2, 'F')

            # 라벨
            self.set_xy(x + 3, y + 4)
            self.set_font("K", "", 7)
            self.set_text_color(*GRAY)
            self.cell(card_w - 6, 4, label)

            # 값
            self.set_xy(x + 3, y + 10)
            self.set_font("K", "B", 16)
            self.set_text_color(*WHITE)
            self.cell(card_w - 6, 8, value)

            # 부가 정보
            self.set_xy(x + 3, y + 20)
            self.set_font("K", "", 6)
            self.set_text_color(*GRAY)
            self.cell(card_w - 6, 4, sub)

        self.set_y(y + 33)

    def comparison_table(self):
        """후보 비교표."""
        self.set_font("K", "B", 10)
        self.set_text_color(*WHITE)
        self.cell(0, 8, "후보별 종합 비교", new_x="LMARGIN", new_y="NEXT")
        self.ln(2)

        # 테이블 헤더
        cols = [35, 22, 22, 22, 30, 28, 25]
        headers = ['후보', '뉴스', '긍정', '부정', '커뮤니티', '유튜브', '검색량']

        y = self.get_y()
        self.set_fill_color(40, 45, 70)
        self.rect(15, y, 180, 7, 'F')

        x = 15
        self.set_font("K", "B", 7)
        self.set_text_color(180, 190, 210)
        for i, h in enumerate(headers):
            self.set_xy(x, y + 1)
            self.cell(cols[i], 5, h, align="C" if i > 0 else "L")
            x += cols[i]

        self.set_y(y + 8)

        # 데이터 행
        for i, name in enumerate(candidates):
            y = self.get_y()
            is_ours = name == OUR

            if is_ours:
                self.set_fill_color(59, 130, 246, )
                self.rect(15, y, 180, 8, 'F')
                self.set_fill_color(59, 130, 246)
                self.rect(15, y, 2, 8, 'F')
            elif i % 2 == 0:
                self.set_fill_color(25, 30, 48)
                self.rect(15, y, 180, 8, 'F')

            x = 15
            self.set_font("K", "B" if is_ours else "", 7.5)
            self.set_text_color(*WHITE)

            row = [
                f'{"* " if is_ours else ""}{name}',
                str(news_count[i]),
                str(news_pos[i]),
                str(news_neg[i]),
                str(community[i]),
                f'{yt_views[i]:,}',
                f'{search_vol[i]:.1f}',
            ]

            for j, val in enumerate(row):
                self.set_xy(x, y + 1.5)
                if j == 3 and news_neg[i] >= 5:
                    self.set_text_color(*RED)
                elif j == 0 and is_ours:
                    self.set_text_color(*WHITE)
                else:
                    self.set_text_color(*WHITE if is_ours else (200, 200, 210))
                self.cell(cols[j], 5, val, align="C" if j > 0 else "L")
                x += cols[j]

            self.set_y(y + 8)

    def verdict_box(self, text, level="warning"):
        """판정 박스."""
        colors = {
            "danger": (RED, (60, 20, 20)),
            "warning": ((255, 180, 0), (50, 40, 15)),
            "good": (GREEN, (15, 50, 25)),
        }
        fg, bg = colors.get(level, colors["warning"])

        y = self.get_y()
        self.set_fill_color(*bg)
        self.rect(15, y, 180, 12, 'F')
        self.set_fill_color(*fg)
        self.rect(15, y, 3, 12, 'F')

        self.set_xy(22, y + 2)
        self.set_font("K", "B", 8)
        self.set_text_color(*fg)
        self.cell(0, 8, text)
        self.set_y(y + 15)

    def strategy_section(self):
        """AI 전략 제언."""
        strategies = [
            ("1. 뉴스 노출 긴급 확대", "현재 5명 중 3위(23건). 윤건영(72건) 대비 31% 수준. 보도자료/인터뷰 집중 필요."),
            ("2. 유튜브 조회수 극복", "4,098회로 최하위권. 쇼츠 콘텐츠 일 1건 이상 제작하여 노출 확대."),
            ("3. 부정 뉴스 대응", "부정 3건 감지. 해명 자료 준비 및 긍정 뉴스로 상쇄 전략."),
            ("4. 검색 트렌드 개선", "네이버 검색량 3.6으로 최하위. SNS 활동 + 키워드 콘텐츠로 검색 유입 강화."),
            ("5. 커뮤니티 여론전 강화", "14건으로 윤건영(44건) 대비 열세. 맘카페/교육 블로그 게시물 확대."),
        ]

        for title, desc in strategies:
            y = self.get_y()

            self.set_fill_color(30, 35, 55)
            self.rect(15, y, 180, 16, 'F')
            self.set_fill_color(*BLUE)
            self.rect(15, y, 2, 16, 'F')

            self.set_xy(20, y + 2)
            self.set_font("K", "B", 8)
            self.set_text_color(*WHITE)
            self.cell(0, 5, title)

            self.set_xy(20, y + 8)
            self.set_font("K", "", 7)
            self.set_text_color(*GRAY)
            self.cell(170, 5, desc)

            self.set_y(y + 18)


def generate():
    pdf = ReportA()

    # 표지
    pdf.cover_page()

    # 1페이지: 핵심 현황
    pdf.add_page()
    pdf.page_header("01  핵심 현황")
    pdf.kpi_cards()
    pdf.verdict_box("주의: 미디어 노출 및 검색 트렌드 최하위권 — 긴급 대응 필요", "danger")
    pdf.comparison_table()

    # 차트 생성
    tmp = tempfile.mkdtemp()
    colors = ['#3b82f6' if c == OUR else '#6b7280' for c in candidates]

    make_bar_chart(candidates, news_count, colors, '후보별 뉴스 노출', f'{tmp}/news.png')
    make_bar_chart(candidates, [v/1000 for v in yt_views], colors, '유튜브 조회수 (천)', f'{tmp}/yt.png')
    make_sentiment_pie(12, 3, 8, '김진균 감성', f'{tmp}/pie.png')

    # 2페이지: 미디어 분석
    pdf.add_page()
    pdf.page_header("02  미디어 분석")

    pdf.image(f'{tmp}/news.png', x=15, w=85)
    pdf.image(f'{tmp}/yt.png', x=105, w=85)
    pdf.ln(5)
    pdf.image(f'{tmp}/pie.png', x=15, w=40)

    # 3페이지: 위기 & 기회
    pdf.add_page()
    pdf.page_header("03  위기 & 기회")

    pdf.set_font("K", "B", 10)
    pdf.set_text_color(*RED)
    pdf.cell(0, 8, "부정 뉴스 (3건)", new_x="LMARGIN", new_y="NEXT")

    neg_articles = [
        "뉴스 기사와 댓글로 인한 문제 발생시24시간 센터로 접수해주세요.",
        "충북교육감 후보 검증 이슈 제기",
        "교육 예산 편성 논란 보도",
    ]
    for art in neg_articles:
        y = pdf.get_y()
        pdf.set_fill_color(60, 20, 20)
        pdf.rect(15, y, 180, 8, 'F')
        pdf.set_xy(18, y + 1.5)
        pdf.set_font("K", "", 7.5)
        pdf.set_text_color(255, 150, 150)
        pdf.cell(0, 5, f"[-] {art}")
        pdf.set_y(y + 9)

    pdf.ln(5)
    pdf.set_font("K", "B", 10)
    pdf.set_text_color(*GREEN)
    pdf.cell(0, 8, "대응 기회", new_x="LMARGIN", new_y="NEXT")

    opps = [
        "조동욱 부정뉴스 6건 — 차별점 부각 가능",
        "신문규 부정뉴스 4건 — 비교 콘텐츠 제작",
        "김성근 유튜브 조회수 높지만 커뮤니티 약세 — 커뮤니티 선점",
    ]
    for opp in opps:
        y = pdf.get_y()
        pdf.set_fill_color(15, 50, 25)
        pdf.rect(15, y, 180, 8, 'F')
        pdf.set_xy(18, y + 1.5)
        pdf.set_font("K", "", 7.5)
        pdf.set_text_color(150, 255, 150)
        pdf.cell(0, 5, f"[+] {opp}")
        pdf.set_y(y + 9)

    # 4페이지: AI 전략 제언
    pdf.add_page()
    pdf.page_header("04  AI 전략 제언")
    pdf.strategy_section()

    # 면책
    pdf.ln(10)
    pdf.set_font("K", "", 6.5)
    pdf.set_text_color(80, 80, 80)
    pdf.cell(0, 4, "[AI 생성물] 본 보고서는 CampAI가 수집 데이터 기반으로 자동 생성한 참고자료입니다.", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 4, "의사결정 전 반드시 사실 확인이 필요합니다. | CampAI (c) 2026", align="C", new_x="LMARGIN", new_y="NEXT")

    outpath = "/Users/jojo/pro/mybot/report_sample_A.pdf"
    pdf.output(outpath)
    print(f"A안 생성 완료: {outpath}")


if __name__ == "__main__":
    generate()
