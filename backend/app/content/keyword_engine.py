"""
ElectionPulse - 범용 키워드/해시태그 엔진
선거 유형 + 지역 + 후보자 기반 자동 생성 (모든 선거 유형 지원)
"""
from app.elections.korea_data import ELECTION_ISSUES, REGIONS

# ──────── 선거 유형별 블로그 태그 카테고리 (범용) ──────────

BLOG_TAG_CATEGORIES = {
    "superintendent": {
        "학교운영": ["학교급식", "돌봄교실", "방과후학교", "학교안전", "통학버스", "늘봄학교"],
        "교육과정": ["교육과정", "고교학점제", "자유학기제", "AI교육", "디지털교육", "코딩교육"],
        "입시진로": ["입시", "수시", "정시", "수능", "진로교육", "직업교육"],
        "학생복지": ["학교폭력", "학폭예방", "학생인권", "급식", "무상급식", "친환경급식"],
        "교권교사": ["교권보호", "교사처우", "교원복지", "기간제교사", "교원수급"],
        "학부모관심": ["사교육", "학원비", "학급당학생수", "과밀학급", "교육격차"],
        "특수교육": ["특수교육", "장애학생", "통합교육", "특수학교"],
        "유아교육": ["유치원", "유아교육", "사립유치원", "어린이집", "보육"],
        "지역교육": ["농산어촌교육", "소규모학교", "학교통폐합", "교육격차해소"],
    },
    "mayor": {
        "도시개발": ["재개발", "재건축", "도시재생", "신도시", "역세권개발"],
        "교통": ["대중교통", "버스노선", "지하철", "도로확장", "주차장", "자전거도로"],
        "주거": ["아파트", "공공임대", "주택공급", "집값", "전세", "월세"],
        "복지": ["노인복지", "아동복지", "장애인복지", "보육", "다문화"],
        "경제일자리": ["기업유치", "소상공인", "전통시장", "청년일자리", "창업지원"],
        "환경": ["미세먼지", "녹지", "공원", "하수처리", "폐기물"],
        "안전": ["CCTV", "방범", "소방", "재난대비", "어린이보호구역"],
        "문화관광": ["축제", "관광명소", "체육시설", "도서관", "문화센터"],
        "생활인프라": ["상하수도", "쓰레기", "분리수거", "가로등", "도로보수"],
    },
    "congressional": {
        "경제": ["물가", "경기침체", "성장률", "투자", "주식", "금리"],
        "부동산": ["집값", "전세", "종부세", "임대차", "재건축"],
        "복지": ["기본소득", "국민연금", "건강보험", "실업급여", "아동수당"],
        "일자리": ["최저임금", "비정규직", "청년고용", "공공일자리"],
        "안보외교": ["안보", "북한", "국방", "한미관계", "한중관계"],
        "지역발전": ["균형발전", "SOC", "국비확보", "지역경제", "혁신도시"],
        "미래산업": ["반도체", "AI", "바이오", "신재생에너지", "탄소중립"],
        "사회": ["저출생", "고령화", "인구절벽", "다문화", "성평등"],
    },
    "governor": {
        "지역경제": ["기업유치", "투자유치", "경제특구", "산업단지", "일자리"],
        "교통인프라": ["광역교통", "KTX", "공항", "고속도로", "철도"],
        "복지보건": ["공공의료", "지역의료", "보육", "노인복지", "저출생"],
        "관광문화": ["관광", "축제", "문화시설", "스포츠", "MICE"],
        "균형발전": ["도농격차", "낙후지역", "인구유출", "지역소멸", "귀농"],
        "환경안전": ["탄소중립", "신재생에너지", "재난관리", "치안"],
        "행정": ["재정건전성", "도정운영", "행정혁신", "공무원"],
    },
    "council": {
        "생활민원": ["도로보수", "주차", "가로등", "CCTV", "인도"],
        "복지시설": ["경로당", "어린이집", "놀이터", "복지관", "주민센터"],
        "교통": ["버스노선", "버스정류장", "통학로", "스쿨존"],
        "환경": ["소음", "악취", "쓰레기", "분리수거", "녹지"],
        "지역개발": ["재건축", "용도변경", "상가", "전통시장"],
        "의정활동": ["조례", "예산", "의정활동", "의회", "상임위"],
    },
}


def generate_hashtags(
    election_type: str,
    region_short: str,
    candidate_name: str,
    candidate_party: str | None = None,
    competitors: list[str] | None = None,
    sigungu: str | None = None,
) -> dict:
    """
    선거 유형 + 지역 + 후보자 기반 해시태그 자동 생성.
    모든 선거 유형에 범용 적용.
    """
    type_label = ELECTION_ISSUES.get(election_type, {}).get("label", "선거")
    issues = ELECTION_ISSUES.get(election_type, {}).get("issues", [])

    # 1. 캠페인 해시태그 (필수 — 후보 브랜딩)
    campaign = [
        f"#{candidate_name}",
        f"#{candidate_name}_{type_label}",
        f"#{region_short}{type_label}",
        f"#{region_short}{type_label}선거",
        f"#2026지방선거",
        f"#{region_short}_{candidate_name}",
    ]
    if candidate_party:
        campaign.append(f"#{candidate_party}")
    if sigungu:
        campaign.append(f"#{sigungu}_{candidate_name}")

    # 2. 이슈 기반 해시태그 (상위 이슈)
    issue_tags = []
    for issue in issues[:12]:
        issue_tags.append(f"#{issue}")
        issue_tags.append(f"#{region_short}_{issue}")

    # 3. SNS 트렌딩 (범용 — 플랫폼별)
    sns_trending = [
        f"#{type_label}선거", f"#{region_short}선거",
        f"#투표", f"#선거공약", f"#유권자",
        f"#{region_short}발전", f"#{region_short}미래",
    ]

    # 4. 블로그 SEO (검색 유입용)
    blog_seo = [f"#{region_short} {type_label}"]
    for issue in issues[:8]:
        blog_seo.append(f"#{region_short} {issue}")
    blog_seo.append(f"#{candidate_name} 공약")
    blog_seo.append(f"#{candidate_name} 프로필")

    # 5. 유튜브 해시태그
    youtube = [
        f"#{region_short}{type_label}선거",
        f"#{candidate_name}",
        f"#선거공약", f"#후보토론",
        f"#{region_short}뉴스",
    ]
    for issue in issues[:5]:
        youtube.append(f"#{issue}")

    return {
        "campaign": campaign,
        "issue_based": issue_tags,
        "sns_trending": sns_trending,
        "blog_seo": blog_seo,
        "youtube": youtube,
    }


def generate_blog_tags(
    election_type: str,
    region_short: str,
    candidate_name: str,
) -> dict:
    """
    블로그 관리용 태그 추천 (카테고리별).
    """
    categories = BLOG_TAG_CATEGORIES.get(election_type, {})
    result = {}

    for cat_name, keywords in categories.items():
        tags = []
        for kw in keywords:
            tags.append({
                "tag": kw,
                "variations": [
                    kw,
                    f"{region_short} {kw}",
                    f"{candidate_name} {kw}",
                ],
            })
        result[cat_name] = tags

    return result


def generate_content_suggestions(
    election_type: str,
    region_short: str,
    candidate_name: str,
    candidate_party: str | None = None,
) -> list[dict]:
    """
    콘텐츠 제안 — 블로그/SNS에 쓸 수 있는 주제 추천.
    """
    type_label = ELECTION_ISSUES.get(election_type, {}).get("label", "선거")
    issues = ELECTION_ISSUES.get(election_type, {}).get("issues", [])

    suggestions = [
        {
            "type": "blog",
            "title": f"{candidate_name} 후보 핵심 공약 정리",
            "description": "후보의 주요 공약을 알기 쉽게 정리한 블로그 포스트",
            "tags": [candidate_name, type_label, "공약", region_short],
            "priority": "high",
        },
        {
            "type": "blog",
            "title": f"{region_short} {type_label} 후보 비교 분석",
            "description": "각 후보의 공약과 경력을 객관적으로 비교",
            "tags": [f"{region_short}{type_label}", "후보비교", "공약비교"],
            "priority": "high",
        },
        {
            "type": "sns",
            "title": f"오늘의 {type_label} 선거 이슈",
            "description": "매일 주요 이슈를 카드뉴스 형태로 공유",
            "tags": [f"{region_short}선거", "이슈", "카드뉴스"],
            "priority": "medium",
        },
        {
            "type": "youtube",
            "title": f"{candidate_name} 후보 현장 방문 영상",
            "description": "지역 현장을 방문하는 모습을 영상으로 기록",
            "tags": [candidate_name, "현장방문", region_short],
            "priority": "medium",
        },
    ]

    # 이슈 기반 콘텐츠 제안
    for issue in issues[:5]:
        suggestions.append({
            "type": "blog",
            "title": f"{region_short} {issue} 현황과 {candidate_name} 후보의 해결책",
            "description": f"{issue} 관련 지역 현황을 분석하고 후보의 공약을 소개",
            "tags": [issue, region_short, candidate_name],
            "priority": "medium",
        })

    return suggestions
