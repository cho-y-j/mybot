# MyHome — 상용화 플랫폼 시스템 설계서

> **프로젝트명:** MyHome (마이홈)
> **목적:** 선거 후보 / 개인 명함 / 소상공인용 원페이지 홍보 사이트 + 분석 플랫폼
> **기술스택:** Next.js 14 (App Router) + PostgreSQL + Tailwind CSS
> **배포환경:** 자체 VPS 서버 (Docker)
> **디자인:** Supanova Design Skill (Tailwind 기반 프리미엄 랜딩 디자인)
> **작업경로:** /Users/jojo/pro/myhome

---

## 1. 시스템 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                         MyHome Platform                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [메인 랜딩]          [슈퍼 관리자]         [API 서버]           │
│  /                    /super-admin          /api/*               │
│  마케팅 랜딩페이지     사용자 관리            REST API            │
│  서비스 소개           등급 관리              인증/권한            │
│  문의하기              결제 관리              파일 업로드          │
│                       템플릿 관리            분석 데이터          │
│                       전체 통계              웹훅/알림            │
│                                                                 │
│  [고객 홈페이지]      [고객 관리자]                              │
│  /s/{code}            /s/{code}/admin                            │
│  선거 홍보 템플릿      콘텐츠 관리 (CRUD)                        │
│  개인 명함 템플릿      이미지 업로드                              │
│  소상공인 템플릿       방문자 통계                                │
│                       GA4 연동 대시보드                           │
│                       블로그/유튜브 분석                          │
│                       주간 리포트                                 │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  [PostgreSQL]    [파일 스토리지]    [Redis]      [외부 API]      │
│  사용자 DB       로컬 or S3        세션/캐시     GA4 / Naver     │
│  콘텐츠 DB       이미지 저장       방문자 카운터  YouTube API     │
│  분석 DB         PDF 리포트        Rate Limit    Google Trends   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. URL 구조

| URL 패턴 | 용도 | 접근 권한 |
|-----------|------|-----------|
| `/` | 메인 랜딩 (마케팅 페이지) | 공개 |
| `/super-admin` | 슈퍼 관리자 대시보드 | 슈퍼 관리자만 |
| `/super-admin/users` | 사용자 목록/관리 | 슈퍼 관리자만 |
| `/super-admin/templates` | 템플릿 관리 | 슈퍼 관리자만 |
| `/super-admin/analytics` | 전체 플랫폼 통계 | 슈퍼 관리자만 |
| `/super-admin/settings` | 시스템 설정 | 슈퍼 관리자만 |
| `/s/{code}` | 고객 홈페이지 (공개) | 공개 |
| `/s/{code}/admin` | 고객 관리자 모드 | 해당 고객만 |
| `/s/{code}/admin/analytics` | 고객 분석 대시보드 | 해당 고객만 |
| `/api/*` | REST API | 인증 필요 |

---

## 3. 데이터베이스 스키마 (PostgreSQL)

### 3.1 사용자/인증 테이블

```sql
-- 슈퍼 관리자 계정
CREATE TABLE super_admins (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(50) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    name            VARCHAR(100),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 고객 (사이트 소유자)
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    code            VARCHAR(30) UNIQUE NOT NULL,       -- URL 경로 코드 (예: ssw, jdm)
    name            VARCHAR(100) NOT NULL,              -- 실명
    email           VARCHAR(255),
    phone           VARCHAR(20),
    password_hash   VARCHAR(255) NOT NULL,

    -- 등급 관리
    plan            VARCHAR(20) DEFAULT 'basic',        -- basic, premium
    plan_started_at TIMESTAMPTZ,
    plan_expires_at TIMESTAMPTZ,

    -- 템플릿 설정
    template_type   VARCHAR(30) DEFAULT 'election',     -- election, namecard, store
    template_theme  VARCHAR(30) DEFAULT 'default',      -- 색상 테마

    -- 상태
    is_active       BOOLEAN DEFAULT true,
    memo            TEXT,                                -- 관리자 메모

    -- GA4 연동
    ga_measurement_id VARCHAR(30),                       -- G-XXXXXXX

    -- 커스텀 도메인
    custom_domain   VARCHAR(255),

    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 로그인 세션
CREATE TABLE sessions (
    id              VARCHAR(64) PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id),
    user_type       VARCHAR(20) NOT NULL,               -- super_admin, user
    ip_address      VARCHAR(45),
    user_agent      TEXT,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.2 콘텐츠 테이블 (고객 사이트 데이터)

```sql
-- 사이트 기본 설정
CREATE TABLE site_settings (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,

    -- OG 태그
    og_title        VARCHAR(200),
    og_description  TEXT,
    og_image_url    TEXT,

    -- 히어로 섹션
    hero_image_url  TEXT,
    hero_slogan     VARCHAR(200),
    hero_sub_slogan VARCHAR(300),

    -- 기본 정보
    party_name      VARCHAR(50),                        -- 선거: 정당명
    position_title  VARCHAR(100),                       -- 선거: 직함
    subtitle        VARCHAR(200),                       -- 소개 부제목
    intro_text      TEXT,                               -- 소개 본문

    -- 색상 테마
    primary_color   VARCHAR(7) DEFAULT '#C9151E',       -- 메인 컬러
    accent_color    VARCHAR(7) DEFAULT '#1A56DB',       -- 강조 컬러

    -- D-Day (선거용)
    election_date   DATE,
    election_name   VARCHAR(100),

    -- 카카오 공유 설정
    kakao_app_key   VARCHAR(100),

    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

-- 프로필 (학력/경력)
CREATE TABLE profiles (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    type            VARCHAR(20) NOT NULL,               -- education, career
    title           VARCHAR(200) NOT NULL,
    is_current      BOOLEAN DEFAULT false,
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 공약 / 서비스 소개
CREATE TABLE pledges (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    icon            VARCHAR(50) DEFAULT 'fas fa-bullhorn',
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    details         JSONB DEFAULT '[]',                 -- 세부 항목 배열
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 사진첩
CREATE TABLE gallery (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    url             TEXT NOT NULL,
    alt_text        VARCHAR(200),
    category        VARCHAR(30) DEFAULT 'activity',     -- activity, campaign, event, media
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 일정
CREATE TABLE schedules (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL,
    date            DATE NOT NULL,
    time            VARCHAR(10),
    location        VARCHAR(200),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 연락처
CREATE TABLE contacts (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    type            VARCHAR(20) NOT NULL,               -- phone, email, instagram, facebook, youtube, blog, threads
    label           VARCHAR(50),
    value           VARCHAR(200) NOT NULL,
    url             TEXT,
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 관련 기사
CREATE TABLE news (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(300) NOT NULL,
    source          VARCHAR(100),                       -- 언론사
    url             TEXT,
    image_url       TEXT,
    published_date  DATE,
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 영상
CREATE TABLE videos (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    video_id        VARCHAR(20) NOT NULL,               -- YouTube 영상 ID
    title           VARCHAR(300),
    description     TEXT,
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.3 분석/통계 테이블

```sql
-- 방문자 추적 (1단계: 자체 추적)
CREATE TABLE visits (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    visitor_ip      VARCHAR(45),
    user_agent      TEXT,
    referrer        TEXT,                               -- 유입 경로
    page_path       VARCHAR(200),
    country         VARCHAR(5),
    device_type     VARCHAR(20),                        -- mobile, desktop, tablet
    visited_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 일별 방문자 집계 (빠른 조회용)
CREATE TABLE visit_daily_stats (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    date            DATE NOT NULL,
    total_visits    INTEGER DEFAULT 0,
    unique_visitors INTEGER DEFAULT 0,
    mobile_visits   INTEGER DEFAULT 0,
    desktop_visits  INTEGER DEFAULT 0,
    UNIQUE(user_id, date)
);

-- 이벤트 추적 (공유 클릭, 영상 재생, 전화 클릭 등)
CREATE TABLE events (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    event_type      VARCHAR(50) NOT NULL,               -- share_kakao, share_copy, video_play, phone_click, pledge_view
    event_data      JSONB,                              -- 추가 데이터
    visitor_ip      VARCHAR(45),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 이벤트 일별 집계
CREATE TABLE event_daily_stats (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    date            DATE NOT NULL,
    event_type      VARCHAR(50) NOT NULL,
    count           INTEGER DEFAULT 0,
    UNIQUE(user_id, date, event_type)
);

-- 블로그/유튜브 외부 채널 연동 (1단계)
CREATE TABLE external_channels (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    platform        VARCHAR(20) NOT NULL,               -- naver_blog, youtube, instagram
    channel_id      VARCHAR(200),                       -- 블로그 ID, 채널 ID 등
    channel_url     TEXT,
    is_active       BOOLEAN DEFAULT true,
    last_synced_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 외부 채널 스냅샷 (주기적 수집)
CREATE TABLE channel_snapshots (
    id              SERIAL PRIMARY KEY,
    channel_id      INTEGER REFERENCES external_channels(id) ON DELETE CASCADE,
    date            DATE NOT NULL,
    subscribers     INTEGER,                            -- 구독자/이웃 수
    total_views     INTEGER,                            -- 총 조회수
    total_posts     INTEGER,                            -- 총 게시글 수
    extra_data      JSONB,                              -- 플랫폼별 추가 지표
    UNIQUE(channel_id, date)
);

-- 주간 리포트 (생성/저장)
CREATE TABLE reports (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    report_type     VARCHAR(20) DEFAULT 'weekly',       -- daily, weekly, monthly
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    content_html    TEXT,
    pdf_path        TEXT,
    key_metrics     JSONB,                              -- 핵심 수치 요약
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.4 시스템 테이블

```sql
-- 파일 업로드 관리
CREATE TABLE files (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    original_name   VARCHAR(300),
    stored_path     TEXT NOT NULL,                       -- 서버 저장 경로
    file_type       VARCHAR(20),                        -- image, pdf, document
    mime_type       VARCHAR(100),
    file_size       INTEGER,                            -- bytes
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 활동 로그 (감사 추적)
CREATE TABLE activity_logs (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER,
    user_type       VARCHAR(20),                        -- super_admin, user
    action          VARCHAR(50) NOT NULL,               -- login, create, update, delete, upload
    target_type     VARCHAR(50),                        -- pledge, gallery, news, etc.
    target_id       INTEGER,
    details         JSONB,
    ip_address      VARCHAR(45),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 시스템 설정
CREATE TABLE system_settings (
    key             VARCHAR(100) PRIMARY KEY,
    value           JSONB NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 4. 슈퍼 관리자 (/super-admin) 상세 기능

### 4.1 대시보드 (메인)
- 전체 사용자 수 (기본/프리미엄/비활성)
- 오늘/이번 주/이번 달 전체 방문자 합계
- 최근 가입 사용자 5명
- 만료 예정 프리미엄 사용자 알림
- 전체 플랫폼 트래픽 그래프 (최근 30일)

### 4.2 사용자 관리 (/super-admin/users)
- **사용자 목록**: 검색/필터 (등급별, 템플릿별, 활성 상태별)
- **사용자 생성**:
  - 코드 (URL 경로), 이름, 이메일, 전화번호
  - 등급 선택 (basic / premium)
  - 템플릿 선택 (선거 / 명함 / 가게)
  - 초기 비밀번호 설정
  - 커스텀 도메인 설정
  - 관리자 메모
- **사용자 상세/수정**:
  - 기본 정보 수정
  - 등급 변경 + 만료일 설정
  - 활성/비활성 토글
  - 해당 사용자 사이트 바로가기 링크
  - 해당 사용자 관리자 바로가기 (대리 로그인)
  - 사용량 현황 (저장 용량, 방문자 수)
  - 활동 로그 조회

### 4.3 등급별 기능 차등

| 기능 | Basic (무료/50만원) | Premium (100~150만원) |
|------|---------------------|------------------------|
| 홈페이지 생성 | ✅ | ✅ |
| 콘텐츠 관리 (CRUD) | ✅ | ✅ |
| 이미지 업로드 | 최대 50장 | 최대 500장 |
| 저장 용량 | 100MB | 2GB |
| 방문자 기본 통계 | ✅ | ✅ |
| GA4 연동 | ❌ | ✅ |
| 블로그/유튜브 분석 | ❌ | ✅ |
| 주간 리포트 | ❌ | ✅ (자동 생성) |
| 이벤트 추적 (공유, 클릭) | 기본 | 상세 (히트맵) |
| QR 코드 | ✅ | ✅ + 커스텀 디자인 |
| 커스텀 도메인 | ❌ | ✅ |
| OG 태그 설정 | 기본 | 고급 (A/B 테스트) |
| 카카오 SDK 연동 | ❌ | ✅ |
| PDF 리포트 다운로드 | ❌ | ✅ |

### 4.4 템플릿 관리 (/super-admin/templates)
- 템플릿 목록 (선거/명함/가게 + 커스텀)
- 템플릿별 사용자 수 현황
- 템플릿 미리보기
- 향후: 새 템플릿 추가/편집 기능

### 4.5 전체 통계 (/super-admin/analytics)
- 플랫폼 전체 방문자 추이
- 사용자별 방문자 랭킹 TOP 20
- 템플릿별 사용 현황
- 등급별 사용자 분포
- 신규 가입 추이

### 4.6 시스템 설정 (/super-admin/settings)
- 슈퍼 관리자 비밀번호 변경
- 기본 등급 설정
- 파일 업로드 제한 설정
- 시스템 공지사항 (고객 관리자에 표시)
- 백업 관리

---

## 5. 고객 홈페이지 (/s/{code}) 상세

### 5.1 선거 후보 템플릿 (election)
기존 votesite 구조 유지 + 개선:

| 섹션 | 콘텐츠 | 기능 |
|------|--------|------|
| 히어로 | 포스터 이미지, D-Day, 슬로건, CTA | 자동 D-Day 카운트다운 |
| 슬로건 배너 | 핵심 키워드 3개 + 아이콘 | 스크롤 등장 애니메이션 |
| 후보 소개 | 인사말, 프로필 사진, 학력, 경력 | 타임라인 UI |
| 핵심 공약 | 공약 카드 (아이콘+제목+설명+세부) | 카드 그리드 |
| 사진첩 | 카테고리 필터 + 라이트박스 | 무한 스크롤 or 페이지네이션 |
| 일정 | 날짜별 일정 표시 | 지나간 일정 흐림 처리 |
| 관련기사 | 뉴스 카드 (썸네일+제목+매체+날짜) | 외부 링크 |
| 영상 | YouTube 썸네일 + 클릭 시 재생 | 지연 로딩 |
| 연락처 | 전화/SNS/블로그 카드 | 바로 연결 링크 |
| 공유 | 카카오톡 공유 + 링크 복사 | 토스트 알림 |
| 푸터 | 정당명, 후보명, 법적 고지 | - |

### 5.2 개인 명함 템플릿 (namecard)
| 섹션 | 콘텐츠 |
|------|--------|
| 히어로 | 프로필 사진 + 이름 + 직함 |
| 자기소개 | 한줄/여러줄 소개글 |
| 경력/이력 | 타임라인 |
| 포트폴리오/갤러리 | 작업물/활동 사진 |
| 연락처 | 전화/이메일/SNS |
| QR코드 | vCard QR |

### 5.3 소상공인/가게 템플릿 (store)
| 섹션 | 콘텐츠 |
|------|--------|
| 히어로 | 가게 대표 이미지 + 상호명 |
| 소개 | 가게 소개, 영업시간, 위치(지도) |
| 메뉴/서비스 | 카드형 메뉴판 (이미지+가격) |
| 갤러리 | 가게/음식/제품 사진 |
| 리뷰/후기 | 고객 후기 표시 |
| 연락처/예약 | 전화, SNS, 네이버 예약 링크 |

---

## 6. 고객 관리자 (/s/{code}/admin) 상세 기능

### 6.1 대시보드 (메인)
- 오늘 / 이번 주 / 이번 달 방문자 수
- 최근 7일 방문자 그래프 (Chart.js)
- 인기 이벤트 (공유 클릭, 영상 재생, 전화 클릭 수)
- 마지막 업데이트 시간
- [프리미엄] GA4 요약 위젯

### 6.2 콘텐츠 관리 탭

| 탭 | 기능 | CRUD |
|----|------|------|
| **프로필** | 소개글, 학력 추가/삭제/순서변경, 경력 추가/삭제/순서변경 | ✅ |
| **OG태그** | 카카오/SNS 공유 제목, 설명, 이미지 업로드 + 미리보기 | ✅ |
| **메인이미지** | 히어로 이미지 업로드/교체/기본복원 (드래그&드롭, 자동 압축) | ✅ |
| **사진** | 카테고리별 업로드, 순서 변경, 삭제 (다중 선택) | ✅ |
| **일정** | 날짜/시간/제목/장소 입력, 지난 일정 자동 표시 | ✅ |
| **공약** | 아이콘 선택(10종), 제목/설명/세부항목, 순서 변경 | ✅ |
| **연락처** | 타입 선택(8종), 라벨/값/URL, 순서 변경 | ✅ |
| **영상** | YouTube URL 입력 → 자동 ID 추출 + 제목 불러오기 | ✅ |
| **기사** | URL 입력 → 메타정보 자동 수집 (제목, 이미지, 언론사) | ✅ |
| **QR코드** | 자동 생성 + PNG 다운로드 | ✅ |

### 6.3 분석 탭 (/s/{code}/admin/analytics)

**[기본 — Basic 등급]**
- 방문자 수 (오늘/주간/월간)
- 최근 30일 방문자 추이 그래프
- 기기별 비율 (모바일/데스크톱)
- 유입 경로 비율 (직접/카카오/SNS/검색)

**[프리미엄 — Premium 등급]**
- 위 기본 전부 +
- GA4 실시간 연동 대시보드:
  - 실시간 접속자 수
  - 페이지별 체류 시간
  - 이탈률
  - 지역별 방문자 분포
  - 시간대별 방문 패턴
- 이벤트 상세 추적:
  - 카카오 공유 횟수
  - 링크 복사 횟수
  - 영상 재생 횟수 (영상별)
  - 전화번호 클릭 횟수
  - 공약 섹션 도달률
- 블로그/유튜브 분석:
  - 네이버 블로그: 일별 방문자, 인기 게시글, 이웃 수 추이
  - YouTube: 구독자 추이, 영상별 조회수, 시청 지속시간
- 주간 리포트:
  - 자동 생성 (매주 월요일)
  - PDF 다운로드
  - 핵심 지표 요약 + 전주 대비 변화 + 추천 액션

### 6.4 설정 탭
- 비밀번호 변경
- 사이트 기본 정보 (컬러 테마 변경)
- [프리미엄] GA4 Measurement ID 설정
- [프리미엄] 커스텀 도메인 안내
- [프리미엄] 외부 채널 연동 (네이버 블로그 URL, YouTube 채널 URL)

---

## 7. API 엔드포인트 설계

### 7.1 인증
```
POST   /api/auth/login              로그인 (user + super_admin 공용)
POST   /api/auth/logout             로그아웃
GET    /api/auth/me                 현재 세션 확인
POST   /api/auth/change-password    비밀번호 변경
```

### 7.2 슈퍼 관리자 API
```
GET    /api/super/dashboard         대시보드 요약 데이터
GET    /api/super/users             사용자 목록 (필터, 페이지네이션)
POST   /api/super/users             사용자 생성
GET    /api/super/users/:id         사용자 상세
PUT    /api/super/users/:id         사용자 수정
DELETE /api/super/users/:id         사용자 비활성화
POST   /api/super/users/:id/impersonate  대리 로그인
GET    /api/super/analytics         전체 플랫폼 통계
GET    /api/super/activity-log      활동 로그 조회
```

### 7.3 고객 콘텐츠 API (인증 필요)
```
GET    /api/site/settings           사이트 설정 조회
PUT    /api/site/settings           사이트 설정 수정

GET    /api/site/profiles           프로필(학력/경력) 목록
POST   /api/site/profiles           추가
PUT    /api/site/profiles/:id       수정
DELETE /api/site/profiles/:id       삭제
PUT    /api/site/profiles/reorder   순서 변경

# 동일 패턴: pledges, gallery, schedules, contacts, news, videos
GET    /api/site/{resource}
POST   /api/site/{resource}
PUT    /api/site/{resource}/:id
DELETE /api/site/{resource}/:id
PUT    /api/site/{resource}/reorder
```

### 7.4 파일 업로드 API
```
POST   /api/upload/image            이미지 업로드 (자동 압축/리사이즈)
POST   /api/upload/hero             히어로 이미지 업로드
POST   /api/upload/og               OG 이미지 업로드
DELETE /api/upload/:fileId          파일 삭제
```

### 7.5 공개 API (인증 불필요)
```
GET    /api/public/site/:code       사이트 전체 데이터 (SSR용)
POST   /api/public/visit/:code      방문자 기록
POST   /api/public/event/:code      이벤트 기록
GET    /api/public/og/:code         OG 메타데이터
```

### 7.6 분석 API (인증 필요)
```
GET    /api/analytics/overview      방문자 요약 (기간별)
GET    /api/analytics/visitors      방문자 상세 (일별, 기기별, 유입별)
GET    /api/analytics/events        이벤트 상세
GET    /api/analytics/channels      외부 채널 지표
GET    /api/analytics/report        주간 리포트 생성/조회
GET    /api/analytics/ga4           GA4 데이터 프록시 [프리미엄]
```

---

## 8. 프로젝트 디렉토리 구조

```
myhome/
├── SYSTEM_DESIGN.md                    # 이 문서
├── CLAUDE.md                           # Claude CLI 개발 지침
├── package.json
├── next.config.js
├── tailwind.config.js
├── docker-compose.yml                  # PostgreSQL + Redis + App
├── Dockerfile
├── .env.example
├── .env.local
│
├── prisma/                             # Prisma ORM
│   ├── schema.prisma                   # DB 스키마
│   └── migrations/                     # 마이그레이션
│
├── public/
│   ├── uploads/                        # 업로드 파일 (또는 외부 스토리지)
│   └── templates/                      # 템플릿 정적 에셋
│
├── src/
│   ├── app/                            # Next.js App Router
│   │   ├── layout.tsx                  # 루트 레이아웃
│   │   ├── page.tsx                    # 메인 랜딩 페이지
│   │   │
│   │   ├── super-admin/               # 슈퍼 관리자
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx               # 대시보드
│   │   │   ├── users/
│   │   │   │   ├── page.tsx           # 사용자 목록
│   │   │   │   └── [id]/page.tsx      # 사용자 상세
│   │   │   ├── templates/page.tsx
│   │   │   ├── analytics/page.tsx
│   │   │   └── settings/page.tsx
│   │   │
│   │   ├── s/[code]/                  # 고객 사이트
│   │   │   ├── page.tsx               # 홈페이지 (SSR)
│   │   │   └── admin/                 # 고객 관리자
│   │   │       ├── layout.tsx
│   │   │       ├── page.tsx           # 관리자 메인 (콘텐츠 관리)
│   │   │       └── analytics/page.tsx # 분석 대시보드
│   │   │
│   │   └── api/                       # API Routes
│   │       ├── auth/
│   │       ├── super/
│   │       ├── site/
│   │       ├── upload/
│   │       ├── public/
│   │       └── analytics/
│   │
│   ├── components/                     # 공용 컴포넌트
│   │   ├── ui/                        # 기본 UI (Button, Input, Card, Modal, Toast)
│   │   ├── admin/                     # 관리자 공용 컴포넌트
│   │   ├── templates/                 # 템플릿 컴포넌트
│   │   │   ├── election/             # 선거 템플릿
│   │   │   ├── namecard/             # 명함 템플릿
│   │   │   └── store/                # 가게 템플릿
│   │   └── analytics/                 # 분석 차트/위젯
│   │
│   ├── lib/                           # 유틸리티/라이브러리
│   │   ├── db.ts                      # Prisma 클라이언트
│   │   ├── auth.ts                    # 인증 유틸
│   │   ├── upload.ts                  # 파일 업로드 처리
│   │   ├── analytics.ts              # 분석 데이터 처리
│   │   ├── ga4.ts                     # GA4 API 연동
│   │   ├── image.ts                   # 이미지 압축/리사이즈
│   │   └── report.ts                 # 리포트 생성
│   │
│   ├── hooks/                         # 커스텀 React 훅
│   │   ├── useAuth.ts
│   │   ├── useSiteData.ts
│   │   └── useAnalytics.ts
│   │
│   └── types/                         # TypeScript 타입 정의
│       ├── user.ts
│       ├── site.ts
│       └── analytics.ts
│
└── scripts/                           # 유틸리티 스크립트
    ├── seed.ts                        # DB 초기 시드
    ├── migrate.ts                     # 마이그레이션
    └── collect-channels.ts            # 외부 채널 데이터 수집 (cron)
```

---

## 9. 기술 상세

### 9.1 인증 방식
- HTTP-only Cookie 기반 세션
- bcrypt 비밀번호 해싱
- 세션 만료: 7일 (remember me: 30일)
- CSRF 보호: SameSite=Strict

### 9.2 파일 업로드
- 이미지: Sharp 라이브러리로 자동 압축
  - 히어로: 최대 1600px, WebP 85%
  - 갤러리: 최대 1200px, WebP 85%
  - OG: 1200×630px 리사이즈
  - 썸네일: 400px 자동 생성
- 저장: `/public/uploads/{user_code}/{type}/` (로컬)
- 향후: S3 호환 스토리지 전환 가능

### 9.3 배포 (Docker)
```yaml
# docker-compose.yml
services:
  app:
    build: .
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: postgresql://...
      REDIS_URL: redis://redis:6379
    depends_on: [db, redis]

  db:
    image: postgres:16
    volumes: ["pgdata:/var/lib/postgresql/data"]
    environment:
      POSTGRES_DB: myhome
      POSTGRES_USER: myhome
      POSTGRES_PASSWORD: ${DB_PASSWORD}

  redis:
    image: redis:7-alpine

volumes:
  pgdata:
```

### 9.4 보안
- Rate limiting (Redis): API 요청 제한
- 파일 업로드: MIME 타입 검증 + 매직 바이트 확인
- SQL injection: Prisma ORM 파라미터 바인딩
- XSS: React 자동 이스케이프 + DOMPurify
- CORS: 허용 도메인만 설정

### 9.5 성능
- SSR: 고객 홈페이지는 서버사이드 렌더링 (SEO)
- ISR: 정적 재생성 (60초 캐시)
- 이미지: WebP 변환 + lazy loading
- DB: 인덱스 최적화 (user_id + date 복합 인덱스)
- Redis: 방문자 카운트, 세션 캐시

---

## 10. 개발 단계

### 1단계: 핵심 MVP (2주)
- [x] 프로젝트 초기화 (Next.js + Prisma + Tailwind)
- [ ] DB 스키마 + 마이그레이션
- [ ] 인증 시스템 (로그인/세션)
- [ ] 슈퍼 관리자: 사용자 CRUD + 등급 관리
- [ ] 고객 홈페이지: 선거 템플릿 렌더링 (SSR)
- [ ] 고객 관리자: 콘텐츠 CRUD 전체
- [ ] 파일 업로드 시스템
- [ ] 방문자 추적 (자체)
- [ ] Docker 배포

### 2단계: 분석 + 템플릿 확장 (2주)
- [ ] 고객 분석 대시보드 (방문자 통계 + 이벤트 추적)
- [ ] GA4 연동 (프리미엄)
- [ ] 블로그/유튜브 기본 분석 (프리미엄)
- [ ] 명함 템플릿
- [ ] 가게 템플릿
- [ ] QR코드 생성
- [ ] 주간 리포트 자동 생성

### 3단계: 고도화 (이후)
- [ ] AI 분석 엔진 이식 (mybot_ver2 → 모듈화)
- [ ] 네이버/구글 검색순위 자동 추적
- [ ] 뉴스 감성분석
- [ ] 전략 추천
- [ ] 커스텀 도메인 자동 설정
- [ ] 결제 시스템 연동

---

## 11. 환경 변수 (.env.example)

```env
# 데이터베이스
DATABASE_URL=postgresql://myhome:password@localhost:5432/myhome

# Redis
REDIS_URL=redis://localhost:6379

# 인증
SESSION_SECRET=your-random-secret-key-min-32-chars
SUPER_ADMIN_INITIAL_PASSWORD=admin1234

# 파일 업로드
UPLOAD_DIR=./public/uploads
MAX_FILE_SIZE=5242880  # 5MB

# Google Analytics (프리미엄)
GA4_SERVICE_ACCOUNT_KEY=path/to/service-account.json

# 서버
NEXT_PUBLIC_BASE_URL=https://yourdomain.com
PORT=3000
NODE_ENV=production
```

---

## 12. Claude CLI 개발 워크플로우

이 프로젝트는 Claude CLI로 오케스트레이션하여 개발합니다.
각 단계별로 Claude CLI에 지시할 때 이 문서를 참조합니다.

```bash
# 프로젝트 초기화
cd /Users/jojo/pro/myhome
claude "SYSTEM_DESIGN.md를 읽고 1단계 프로젝트 초기화를 시작해줘. Next.js 14 App Router + Prisma + Tailwind 세팅하고, prisma/schema.prisma에 전체 DB 스키마를 작성해줘."

# 기능별 개발 지시
claude "SYSTEM_DESIGN.md 섹션 4(슈퍼 관리자)를 참고해서 슈퍼 관리자 대시보드와 사용자 CRUD를 구현해줘."

# 템플릿 개발
claude "SYSTEM_DESIGN.md 섹션 5를 참고하고, supanova-design-skill로 선거 후보 템플릿을 구현해줘. 기존 votesite를 참고하되 디자인을 고급화해줘."
```
