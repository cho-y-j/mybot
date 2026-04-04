"""
ElectionPulse - 한국 지역/선거 마스터 데이터
지역 선택 시 키워드, 커뮤니티, 언론, 스케줄 자동 생성에 사용
"""

# ──────────────── 17개 시도 + 시군구 ──────────────────────────

REGIONS = {
    "서울특별시": {"short": "서울", "districts": ["종로구","중구","용산구","성동구","광진구","동대문구","중랑구","성북구","강북구","도봉구","노원구","은평구","서대문구","마포구","양천구","강서구","구로구","금천구","영등포구","동작구","관악구","서초구","강남구","송파구","강동구"]},
    "부산광역시": {"short": "부산", "districts": ["중구","서구","동구","영도구","부산진구","동래구","남구","북구","해운대구","사하구","금정구","강서구","연제구","수영구","사상구","기장군"]},
    "대구광역시": {"short": "대구", "districts": ["중구","동구","서구","남구","북구","수성구","달서구","달성군","군위군"]},
    "인천광역시": {"short": "인천", "districts": ["중구","동구","미추홀구","연수구","남동구","부평구","계양구","서구","강화군","옹진군"]},
    "광주광역시": {"short": "광주", "districts": ["동구","서구","남구","북구","광산구"]},
    "대전광역시": {"short": "대전", "districts": ["동구","중구","서구","유성구","대덕구"]},
    "울산광역시": {"short": "울산", "districts": ["중구","남구","동구","북구","울주군"]},
    "세종특별자치시": {"short": "세종", "districts": ["조치원읍","한솔동","새롬동","나성동","다정동","보람동","소담동","고운동","아름동"]},
    "경기도": {"short": "경기", "districts": ["수원시","성남시","고양시","용인시","부천시","안산시","안양시","남양주시","화성시","평택시","의정부시","시흥시","파주시","김포시","광명시","광주시","군포시","하남시","오산시","이천시","안성시","양평군","여주시","동두천시","과천시","구리시","포천시","양주시"]},
    "충청북도": {"short": "충북", "districts": ["청주시","충주시","제천시","보은군","옥천군","영동군","증평군","진천군","괴산군","음성군","단양군"]},
    "충청남도": {"short": "충남", "districts": ["천안시","공주시","보령시","아산시","서산시","논산시","계룡시","당진시","금산군","부여군","서천군","청양군","홍성군","예산군","태안군"]},
    "전라북도": {"short": "전북", "districts": ["전주시","군산시","익산시","정읍시","남원시","김제시","완주군","진안군","무주군","장수군","임실군","순창군","고창군","부안군"]},
    "전라남도": {"short": "전남", "districts": ["목포시","여수시","순천시","나주시","광양시","담양군","곡성군","구례군","고흥군","보성군","화순군","장흥군","강진군","해남군","영암군","무안군","함평군","영광군","장성군","완도군","진도군","신안군"]},
    "경상북도": {"short": "경북", "districts": ["포항시","경주시","김천시","안동시","구미시","영주시","영천시","상주시","문경시","경산시","의성군","청송군","영양군","영덕군","청도군","고령군","성주군","칠곡군","예천군","봉화군","울진군","울릉군"]},
    "경상남도": {"short": "경남", "districts": ["창원시","진주시","통영시","사천시","김해시","밀양시","거제시","양산시","의령군","함안군","창녕군","고성군","남해군","하동군","산청군","함양군","거창군","합천군"]},
    "강원특별자치도": {"short": "강원", "districts": ["춘천시","원주시","강릉시","동해시","태백시","속초시","삼척시","홍천군","횡성군","영월군","평창군","정선군","철원군","화천군","양구군","인제군","고성군","양양군"]},
    "제주특별자치도": {"short": "제주", "districts": ["제주시","서귀포시"]},
}

# ──────────────── 지역별 언론 ──────────────────────────────────

LOCAL_MEDIA = {
    "서울특별시": ["서울신문","서울경제","내일신문","TBS"],
    "부산광역시": ["부산일보","국제신문","KNN"],
    "대구광역시": ["매일신문","영남일보","대구일보","TBC"],
    "인천광역시": ["경인일보","인천일보","기호일보","OBS"],
    "광주광역시": ["광주일보","전남일보","무등일보","KBC"],
    "대전광역시": ["대전일보","중도일보","충청투데이","TJB"],
    "울산광역시": ["울산매일","울산신문","경상일보"],
    "세종특별자치시": ["세종포스트","세종의소리","금강일보"],
    "경기도": ["경기일보","경인일보","기호일보","수원일보","OBS"],
    "충청북도": ["충청일보","중부매일","충북일보","동양일보","충청타임즈","CJB"],
    "충청남도": ["충남일보","충청신문","홍성신문","아산신문","TJB"],
    "전라북도": ["전북일보","전북도민일보","새전북신문","JTV"],
    "전라남도": ["전남일보","무등일보","남도일보","여수신문"],
    "경상북도": ["경북일보","경북매일","대경일보","TBC"],
    "경상남도": ["경남일보","경남신문","경남도민일보","KNN"],
    "강원특별자치도": ["강원일보","강원도민일보","G1"],
    "제주특별자치도": ["제주일보","한라일보","제민일보","JIBS"],
}

# ──────────────── 지역별 커뮤니티 검색 키워드 ─────────────────

COMMUNITY_KEYWORDS = {
    "서울특별시": ["서울맘","강남맘카페","송파맘","노원맘","서울학부모","서울교육"],
    "부산광역시": ["부산맘","해운대맘","부산맘카페","부산학부모","부산교육"],
    "대구광역시": ["대구맘","수성구맘","대구맘카페","대구학부모","대구교육"],
    "인천광역시": ["인천맘","송도맘","부평맘","인천학부모","인천교육"],
    "광주광역시": ["광주맘","광산구맘","광주맘카페","광주학부모"],
    "대전광역시": ["대전맘","유성맘","대전맘카페","대전학부모"],
    "울산광역시": ["울산맘","울산맘카페","울산학부모"],
    "세종특별자치시": ["세종맘","세종시맘카페","세종학부모"],
    "경기도": ["경기맘","수원맘","분당맘","일산맘","동탄맘","용인맘","경기학부모"],
    "충청북도": ["충북맘","청주맘","청주맘카페","충북학부모","충북교육"],
    "충청남도": ["충남맘","천안맘","아산맘","충남학부모"],
    "전라북도": ["전북맘","전주맘","전주맘카페","전북학부모"],
    "전라남도": ["전남맘","여수맘","순천맘","전남학부모"],
    "경상북도": ["경북맘","포항맘","구미맘","경북학부모"],
    "경상남도": ["경남맘","창원맘","김해맘","경남학부모"],
    "강원특별자치도": ["강원맘","춘천맘","원주맘","강원학부모"],
    "제주특별자치도": ["제주맘","제주맘카페","제주학부모"],
}

# ──────────────── 선거 유형별 이슈 키워드 ─────────────────────

ELECTION_ISSUES = {
    "superintendent": {
        "label": "교육감",
        "issues": [
            "급식","무상급식","돌봄","늘봄학교","학폭","학교폭력",
            "교권","교권보호","방과후","입시","학력","기초학력",
            "교육예산","디지털교육","AI교육","유치원","유아교육",
            "특수교육","학교안전","교육격차","사교육","학원",
            "학급당학생수","교원복지","혁신학교",
        ],
    },
    "mayor": {
        "label": "시장/군수/구청장",
        "issues": [
            "도시개발","재개발","재건축","교통","대중교통","도로",
            "복지","노인복지","아동복지","일자리","기업유치",
            "환경","주거","아파트","공공임대","상권","전통시장",
            "안전","CCTV","공원","주차","관광","인구유출",
        ],
    },
    "congressional": {
        "label": "국회의원",
        "issues": [
            "경제","물가","부동산","집값","세금","복지",
            "일자리","최저임금","지역발전","국비확보",
            "교육","저출생","고령화","환경","외교","안보",
            "디지털","AI","반도체","청년정책",
        ],
    },
    "governor": {
        "label": "시도지사",
        "issues": [
            "지역경제","기업유치","교통인프라","광역교통",
            "복지","관광","산업유치","균형발전","환경",
            "안전","재난관리","의료","공공의료","청년정책",
            "인구유출","지역소멸","행정혁신",
        ],
    },
    "council": {
        "label": "시의원/도의원",
        "issues": [
            "민원","도로","주차","공원","주거환경","생활편의",
            "CCTV","가로등","버스","통학로","스쿨존",
            "전통시장","노인복지","어린이집","예산","의정활동",
        ],
    },
}

# ──────────────── 정당 정보 ───────────────────────────────────

PARTIES = {
    "국민의힘": {"short": "국힘", "alignment": "conservative", "color": "#E61E2B"},
    "더불어민주당": {"short": "민주당", "alignment": "progressive", "color": "#004EA2"},
    "조국혁신당": {"short": "혁신당", "alignment": "progressive", "color": "#00B0F0"},
    "개혁신당": {"short": "개혁신당", "alignment": "centrist", "color": "#FF6B00"},
    "진보당": {"short": "진보당", "alignment": "progressive", "color": "#D6001C"},
    "녹색정의당": {"short": "녹색정의", "alignment": "progressive", "color": "#44B244"},
    "무소속": {"short": "무소속", "alignment": "independent", "color": "#808080"},
}


# ──────────────── 자동 셋팅 엔진 ─────────────────────────────

def auto_generate_setup(
    sido: str,
    sigungu: str | None,
    election_type: str,
    our_candidate_name: str,
    our_candidate_party: str | None = None,
    competitors: list[dict] | None = None,
) -> dict:
    """
    지역 + 선거유형 + 후보자 정보로 전체 모니터링 설정 자동 생성.

    Returns: {
        "keywords": [...],
        "community_targets": [...],
        "local_media": [...],
        "schedules": [...],
        "candidate_keywords": {name: [keywords]},
        "search_trend_keywords": [...],
    }
    """
    region = REGIONS.get(sido, {})
    short = region.get("short", sido[:2])
    issues = ELECTION_ISSUES.get(election_type, {}).get("issues", [])
    type_label = ELECTION_ISSUES.get(election_type, {}).get("label", election_type)

    # 모든 후보 목록
    all_candidates = [{"name": our_candidate_name, "party": our_candidate_party, "is_ours": True}]
    if competitors:
        for c in competitors:
            all_candidates.append({"name": c["name"], "party": c.get("party"), "is_ours": False})

    # ── 1. 후보별 검색 키워드 자동 생성 ──
    candidate_keywords = {}
    for cand in all_candidates:
        name = cand["name"]
        party = cand.get("party", "")
        kws = [
            name,
            f"{name} {type_label}",
            f"{name} {short}",
            f"{name} 후보",
            f"{name} 공약",
        ]
        if party:
            kws.append(f"{name} {party}")
        if sigungu:
            kws.append(f"{name} {sigungu}")
        candidate_keywords[name] = kws

    # ── 2. 모니터링 키워드 (이슈 + 지역) ──
    monitoring_keywords = []
    # 선거 일반
    monitoring_keywords.append(f"{short} {type_label}")
    monitoring_keywords.append(f"{short} {type_label} 선거")
    if sigungu:
        monitoring_keywords.append(f"{sigungu} {type_label}")
    # 이슈 키워드 (상위 15개)
    for issue in issues[:15]:
        monitoring_keywords.append(f"{short} {issue}")

    # ── 3. 커뮤니티 타겟 ──
    community = COMMUNITY_KEYWORDS.get(sido, [])

    # ── 4. 지역 언론 ──
    media = LOCAL_MEDIA.get(sido, [])

    # ── 5. 검색 트렌드 키워드 (후보 이름 + 지역 선거) ──
    trend_keywords = [c["name"] for c in all_candidates]
    trend_keywords.append(f"{short}{type_label}")

    # ── 6. 기본 스케줄 (오전/오후/마감 3회) ──
    schedules = [
        {
            "name": "오전 수집 + 브리핑",
            "schedule_type": "news",
            "fixed_times": ["09:00"],
            "config": {"include_briefing": True, "send_telegram": True},
        },
        {
            "name": "오전 커뮤니티 + 트렌드",
            "schedule_type": "community",
            "fixed_times": ["09:30"],
            "config": {},
        },
        {
            "name": "오전 유튜브",
            "schedule_type": "youtube",
            "fixed_times": ["10:00"],
            "config": {},
        },
        {
            "name": "오후 수집 + 브리핑",
            "schedule_type": "news",
            "fixed_times": ["14:00"],
            "config": {"include_briefing": True, "send_telegram": True},
        },
        {
            "name": "오후 트렌드 + 유튜브",
            "schedule_type": "trends",
            "fixed_times": ["15:00"],
            "config": {},
        },
        {
            "name": "마감 일일 보고서",
            "schedule_type": "briefing",
            "fixed_times": ["18:00"],
            "config": {"type": "daily_full", "send_telegram": True, "send_pdf": True},
        },
    ]

    return {
        "candidate_keywords": candidate_keywords,
        "monitoring_keywords": monitoring_keywords,
        "community_targets": community,
        "local_media": media,
        "search_trend_keywords": trend_keywords,
        "schedules": schedules,
        "region_short": short,
        "election_type_label": type_label,
    }


def get_regions_list() -> list[dict]:
    """프론트엔드용 지역 목록."""
    return [
        {"sido": k, "short": v["short"], "districts": v["districts"]}
        for k, v in REGIONS.items()
    ]


def get_election_types() -> list[dict]:
    """프론트엔드용 선거 유형 목록."""
    return [
        {"value": k, "label": v["label"], "issue_count": len(v["issues"])}
        for k, v in ELECTION_ISSUES.items()
    ]


def get_parties_list() -> list[dict]:
    """프론트엔드용 정당 목록."""
    return [
        {"name": k, "short": v["short"], "alignment": v["alignment"], "color": v["color"]}
        for k, v in PARTIES.items()
    ]
