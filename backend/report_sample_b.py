"""
보고서 B안: 대시보드 스타일 (모닝컨설트형)
비주얼 중심, 차트 많은, 컬러풀한 인포그래픽
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

# 데이터
candidates = ['윤건영', '김성근', '김진균', '조동욱', '신문규']
news_count = [72, 18, 23, 20, 20]
news_pos = [48, 14, 12, 10, 15]
news_neg = [5, 0, 3, 6, 4]
community = [44, 14, 14, 10, 6]
yt_views = [51220, 28569, 4098, 1801, 5645]
search_vol = [16.06, 28.93, 3.64, 24.44, 1.60]

OUR = '김진균'
OUR_IDX = 2
D_DAY = 57
ELECTION = '2026 충북 교육감'

# 후보별 컬러
CAND_COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4']
OUR_COLOR = '#f59e0b'  # 김진균 = amber


def make_radar_chart(filename):
    """후보별 레이더 차트."""
    fig, ax = plt.subplots(figsize=(4, 4), subplot_kw=dict(polar=True))
    fig.patch.set_facecolor('#0f1225')
    ax.set_facecolor('#0f1225')

    categories = ['뉴스', '긍정률', '커뮤니티', '유튜브', '검색량']
    n = len(categories)
    angles = [x / float(n) * 2 * np.pi for x in range(n)] + [0]

    # 정규화 (최대값 기준 0~100)
    max_vals = [max(news_count), 100, max(community), max(yt_views), max(search_vol)]

    for i, name in enumerate(candidates[:3]):  # 상위 3명만
        vals = [
            news_count[i] / max_vals[0] * 100,
            news_pos[i] / max(news_count[i], 1) * 100,
            community[i] / max_vals[2] * 100,
            yt_views[i] / max_vals[3] * 100,
            search_vol[i] / max_vals[4] * 100,
        ]
        vals += [vals[0]]

        color = CAND_COLORS[i]
        ax.plot(angles, vals, 'o-', linewidth=1.5, color=color, markersize=3)
        ax.fill(angles, vals, alpha=0.1, color=color)

    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(categories, fontsize=7, color='white')
    ax.set_ylim(0, 100)
    ax.set_yticklabels([])
    ax.grid(color='#333', linewidth=0.5)
    ax.spines['polar'].set_color('#333')

    # 범례
    legend = ax.legend(candidates[:3], loc='upper right', bbox_to_anchor=(1.3, 1.1),
                       fontsize=7, facecolor='#0f1225', edgecolor='#333',
                       labelcolor='white')

    plt.tight_layout()
    plt.savefig(filename, dpi=150, bbox_inches='tight', facecolor='#0f1225')
    plt.close()


def make_stacked_bar(filename):
    """긍정/부정/중립 스택 바 차트."""
    fig, ax = plt.subplots(figsize=(5, 2.5))
    fig.patch.set_facecolor('#0f1225')
    ax.set_facecolor('#0f1225')

    y = range(len(candidates))
    neu = [news_count[i] - news_pos[i] - news_neg[i] for i in range(len(candidates))]

    ax.barh(y, news_pos, color='#22c55e', height=0.5, label='긍정')
    ax.barh(y, neu, left=news_pos, color='#4b5563', height=0.5, label='중립')
    ax.barh(y, news_neg, left=[news_pos[i]+neu[i] for i in range(len(candidates))],
            color='#ef4444', height=0.5, label='부정')

    ax.set_yticks(y)
    ax.set_yticklabels(candidates, fontsize=8, color='white')
    ax.invert_yaxis()
    ax.set_title('후보별 뉴스 감성 분포', fontsize=9, fontweight='bold', color='white', pad=8)
    ax.legend(fontsize=6, loc='lower right', facecolor='#0f1225', edgecolor='#333', labelcolor='white')

    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['bottom'].set_color('#333')
    ax.spines['left'].set_color('#333')
    ax.tick_params(colors='#888', labelsize=7)

    plt.tight_layout()
    plt.savefig(filename, dpi=150, bbox_inches='tight', facecolor='#0f1225')
    plt.close()


def make_score_gauge(score, max_score, label, filename):
    """점수 게이지."""
    fig, ax = plt.subplots(figsize=(2, 1.2))
    fig.patch.set_facecolor('#0f1225')
    ax.set_facecolor('#0f1225')

    # 반원 게이지
    theta = np.linspace(np.pi, 0, 100)
    r_outer, r_inner = 1, 0.7

    # 배경
    ax.fill_between(theta, r_inner, r_outer, color='#1f2937', alpha=0.5)

    # 값
    pct = score / max_score
    theta_val = np.linspace(np.pi, np.pi - np.pi * pct, int(100 * pct))
    color = '#ef4444' if pct < 0.3 else '#f59e0b' if pct < 0.6 else '#22c55e'
    ax.fill_between(theta_val, r_inner, r_outer, color=color)

    ax.set_xlim(-1.3, 1.3)
    ax.set_ylim(-0.1, 1.2)
    ax.axis('off')

    ax.text(0, 0.3, f'{score}', ha='center', va='center', fontsize=18, fontweight='bold', color='white')
    ax.text(0, -0.05, label, ha='center', va='center', fontsize=7, color='#9ca3af')

    plt.tight_layout()
    plt.savefig(filename, dpi=150, bbox_inches='tight', facecolor='#0f1225')
    plt.close()


class ReportB(FPDF):
    def __init__(self):
        super().__init__()
        self.add_font("K", "", FONT_R)
        self.add_font("K", "B", FONT_B)
        self.set_auto_page_break(auto=True, margin=15)

    def dark_page(self):
        """다크 배경 페이지."""
        self.add_page()
        self.set_fill_color(15, 18, 37)
        self.rect(0, 0, 210, 297, 'F')

    def top_bar(self):
        """상단 정보 바."""
        self.set_fill_color(20, 24, 45)
        self.rect(0, 0, 210, 14, 'F')
        self.set_y(3)
        self.set_font("K", "B", 8)
        self.set_text_color(59, 130, 246)
        self.cell(70, 8, "  CampAI")
        self.set_text_color(255, 255, 255)
        self.set_font("K", "", 8)
        self.cell(70, 8, ELECTION, align="C")
        self.set_text_color(156, 163, 175)
        self.cell(55, 8, f"D-{D_DAY} | 2026.04.10  ", align="R")
        self.set_y(18)

    def section_title(self, num, title):
        """섹션 제목."""
        y = self.get_y()
        self.set_fill_color(59, 130, 246)
        self.rect(15, y, 4, 10, 'F')
        self.set_xy(22, y)
        self.set_font("K", "B", 12)
        self.set_text_color(255, 255, 255)
        self.cell(0, 10, f"{num}  {title}")
        self.set_y(y + 14)

    def kpi_row(self):
        """KPI 카드 가로 배치."""
        kpis = [
            ("종합 순위", "3위/5명", "#ef4444"),
            ("뉴스 노출", "23건", "#f59e0b"),
            ("긍정률", "52%", "#f59e0b"),
            ("유튜브", "4,098회", "#ef4444"),
            ("커뮤니티", "14건", "#f59e0b"),
        ]

        card_w = 34
        gap = 2.5
        x_start = 15
        y = self.get_y()

        for i, (label, value, color) in enumerate(kpis):
            x = x_start + i * (card_w + gap)

            # 카드
            self.set_fill_color(25, 30, 50)
            self.rect(x, y, card_w, 24, 'F')

            # 값
            self.set_xy(x + 2, y + 3)
            self.set_font("K", "B", 13)
            r, g, b = int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16)
            self.set_text_color(r, g, b)
            self.cell(card_w - 4, 8, value)

            # 라벨
            self.set_xy(x + 2, y + 14)
            self.set_font("K", "", 6.5)
            self.set_text_color(156, 163, 175)
            self.cell(card_w - 4, 5, label)

        self.set_y(y + 28)

    def mini_table(self, data, col_widths, headers):
        """컬러풀한 미니 테이블."""
        y = self.get_y()

        # 헤더
        self.set_fill_color(35, 40, 65)
        self.rect(15, y, sum(col_widths), 6, 'F')
        x = 15
        self.set_font("K", "B", 6.5)
        self.set_text_color(140, 150, 180)
        for i, h in enumerate(headers):
            self.set_xy(x, y + 0.5)
            self.cell(col_widths[i], 5, h, align="C" if i > 0 else "L")
            x += col_widths[i]
        y += 7

        # 행
        for ri, row in enumerate(data):
            is_ours = row[0].strip('* ') == OUR or row[0].startswith('*')
            bg = (40, 60, 100) if is_ours else (22, 26, 44) if ri % 2 == 0 else (28, 32, 52)
            self.set_fill_color(*bg)
            self.rect(15, y, sum(col_widths), 6, 'F')

            if is_ours:
                self.set_fill_color(59, 130, 246)
                self.rect(15, y, 2, 6, 'F')

            x = 15
            for i, val in enumerate(row):
                self.set_xy(x, y + 0.5)
                self.set_font("K", "B" if (i == 0 and is_ours) else "", 6.5)
                self.set_text_color(255, 255, 255)
                self.cell(col_widths[i], 5, str(val), align="C" if i > 0 else "L")
                x += col_widths[i]
            y += 6.5

        self.set_y(y + 3)

    def action_cards(self):
        """행동 지침 카드."""
        actions = [
            ("URGENT", "#ef4444", "뉴스 노출 3배 확대", "윤건영 72건 vs 김진균 23건. 보도자료+인터뷰 집중."),
            ("URGENT", "#ef4444", "유튜브 쇼츠 일 1건", "조회수 4,098 → 최소 20,000 목표. 교육 이슈 쇼츠."),
            ("ACTION", "#f59e0b", "커뮤니티 공세 강화", "맘카페/교육 블로그 14건 → 30건. 정책 홍보 게시물."),
            ("WATCH", "#3b82f6", "조동욱 부정뉴스 6건", "차별점 부각 콘텐츠 준비. 비교 분석 자료 제작."),
            ("WATCH", "#3b82f6", "검색 트렌드 최하위", "SNS 해시태그 캠페인으로 검색 유입 유도."),
        ]

        for tag, color, title, desc in actions:
            y = self.get_y()
            r, g, b = int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16)

            self.set_fill_color(25, 30, 50)
            self.rect(15, y, 180, 14, 'F')
            self.set_fill_color(r, g, b)
            self.rect(15, y, 3, 14, 'F')

            # 태그
            self.set_xy(21, y + 1)
            self.set_fill_color(r, g, b)
            self.set_font("K", "B", 5.5)
            self.set_text_color(255, 255, 255)
            tag_w = self.get_string_width(tag) + 4
            self.rect(21, y + 1, tag_w, 4.5, 'F')
            self.cell(tag_w, 4.5, tag, align="C")

            # 제목
            self.set_xy(21 + tag_w + 2, y + 1)
            self.set_font("K", "B", 7.5)
            self.cell(0, 4.5, title)

            # 설명
            self.set_xy(21, y + 7)
            self.set_font("K", "", 6.5)
            self.set_text_color(156, 163, 175)
            self.cell(170, 5, desc)

            self.set_y(y + 16)


def generate():
    tmp = tempfile.mkdtemp()

    # 차트 생성
    make_radar_chart(f'{tmp}/radar.png')
    make_stacked_bar(f'{tmp}/stacked.png')
    make_score_gauge(48, 100, '종합 점수', f'{tmp}/gauge.png')

    pdf = ReportB()

    # ── 1페이지: 종합 현황 ──
    pdf.dark_page()
    pdf.top_bar()

    # 큰 제목
    pdf.set_font("K", "B", 20)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(0, 12, "일일 전략 보고서", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("K", "", 9)
    pdf.set_text_color(156, 163, 175)
    pdf.cell(0, 6, f"{OUR} 후보 | {ELECTION}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(5)

    pdf.section_title("01", "핵심 지표")
    pdf.kpi_row()
    pdf.ln(2)

    # 점수 게이지
    pdf.image(f'{tmp}/gauge.png', x=80, w=50)
    pdf.ln(3)

    pdf.section_title("02", "후보 비교")
    table_data = []
    for i, name in enumerate(candidates):
        marker = "* " if name == OUR else "  "
        pos_rate = round(news_pos[i] / max(news_count[i], 1) * 100)
        table_data.append([
            f"{marker}{name}", str(news_count[i]), f"{pos_rate}%",
            str(community[i]), f"{yt_views[i]:,}", f"{search_vol[i]:.1f}"
        ])
    pdf.mini_table(table_data, [35, 20, 20, 25, 35, 25],
                   ['후보', '뉴스', '긍정률', '커뮤니티', '유튜브', '검색량'])

    # ── 2페이지: 비주얼 분석 ──
    pdf.dark_page()
    pdf.top_bar()

    pdf.section_title("03", "미디어 분석")
    pdf.image(f'{tmp}/radar.png', x=15, w=85)
    pdf.image(f'{tmp}/stacked.png', x=105, w=90)

    pdf.ln(5)
    pdf.section_title("04", "핵심 판정")

    # 판정 박스
    y = pdf.get_y()
    pdf.set_fill_color(60, 20, 20)
    pdf.rect(15, y, 180, 18, 'F')
    pdf.set_fill_color(239, 68, 68)
    pdf.rect(15, y, 4, 18, 'F')
    pdf.set_xy(22, y + 2)
    pdf.set_font("K", "B", 10)
    pdf.set_text_color(255, 100, 100)
    pdf.cell(0, 6, "경고: 전 채널 열세 — 긴급 대응 필요")
    pdf.set_xy(22, y + 9)
    pdf.set_font("K", "", 7.5)
    pdf.set_text_color(200, 160, 160)
    pdf.cell(0, 6, "뉴스 3위, 유튜브 4위, 검색 5위. 윤건영 대비 전 지표 30~50% 수준. 즉각적인 미디어 노출 확대 전략 필요.")
    pdf.set_y(y + 22)

    # ── 3페이지: 행동 지침 ──
    pdf.dark_page()
    pdf.top_bar()

    pdf.section_title("05", "AI 전략 제언")
    pdf.action_cards()

    # 면책
    pdf.ln(10)
    pdf.set_font("K", "", 6)
    pdf.set_text_color(80, 80, 80)
    pdf.cell(0, 4, "[AI 생성물] 본 보고서는 CampAI가 수집 데이터 기반으로 자동 생성한 참고자료입니다.", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 4, "의사결정 전 반드시 사실 확인이 필요합니다. | CampAI (c) 2026", align="C", new_x="LMARGIN", new_y="NEXT")

    outpath = "/Users/jojo/pro/mybot/report_sample_B.pdf"
    pdf.output(outpath)
    print(f"B안 생성 완료: {outpath}")


if __name__ == "__main__":
    generate()
