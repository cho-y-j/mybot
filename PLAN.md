# ElectionPulse 수정 플랜 & 체크리스트

**최근 갱신**: 2026-04-20
**검수 대상**: Tenant `5403b830` / Election `e0eacdb9` (우리=김진균, 경쟁=조동욱/김성근/신문규/윤건영)
**원칙**: 모든 수정 한꺼번에 완료 → **1회 빌드 → GHCR push → 배포 → 실제 검증** (하나씩 빌드 금지)

---

## 2026-04-20 세션 — 완료

### ✅ 뉴스 페이지 디자인 톤 통일
- 아이템 카드 전체 tint(`bg-red-500/5`/`bg-green-500/5`) 제거 → 좌측 3px 색상 바로 대체
- "대응" 인라인 배지 제거 (sentiment 태그로 중복)
- 상단 3카드 tint border 제거 → 무색 카드 + 숫자 색상만 (유튜브 페이지와 동일)
- 날짜 헤더 mt-4 → mt-2 (간격 과잉 완화)
- 파일: `frontend/src/app/dashboard/news/page.tsx`

### ✅ B-1 하드코딩 다크 색 확인
- dashboard / easy / components 내부 hex 하드코딩 **0건** (grep 확인)
- 남은 hex는 LandingPage(Airtable 팔레트 의도), 로그인/가입(다크 팔레트 의도) — 치환 대상 아님

### ✅ 네이버 API 근본 rate limit 대응 (2026-04-20)
- **2차 API 키 로테이션**: `NAVER_CLIENT_ID_2/SECRET_2` 추가, 429/SE06/SE09 감지 시 자동 전환, 12시간 후 재시도. 일일 한도 25,000 → **50,000회**
- **Redis 전역 토큰 버킷**: `naver:rate:{epoch_second}` incr. 모든 Celery worker + backend 공유. 초당 8회 강제 (안전 마진 2회)
- **일일 사용량 카운터**: `naver:usage:YYYY-MM-DD` 증가. 80% 도달 시 `naver_usage_80pct` 경보
- **키워드 dedup + blog/cafe 병렬**: 여러 후보가 같은 키워드 등록 시 1회만 호출, blog/cafe는 `asyncio.gather`
- 기사 matched_candidate를 본문 기반 재할당 (정확도 향상)
- 실측 검증: 2개 키 로드, Redis key 생성, 일일 카운터 증가 확인
- 파일: `backend/app/collectors/{naver,tasks,instant}.py`, `backend/app/config.py`, `docker/.env.server`

---

## 이전 완료 (~2026-04-20)

### 대시보드 / AI 파이프라인
- 과거 선거 UnifiedHistoryView 전면 재설계 + 진영 4-tier 해결기
- YouTube 쿼터 관리 + 2차 API 키 로테이션 (일일 20,000 unit)
- 동명이인 2-tier 자동 차단 (`excluded_identifiers` + AI block_type)
- RAG 임베딩 훅 복구 (instant.py 3곳 + celery 1곳)
- 여론조사 전면 재설계(Option A) + 데이터 섞임 치명 버그 + momentum=None + DB 캐시
- 후보 비교 역대선거 블록 제거 + 선차트 connectNulls
- 홈페이지 admin 배색 통일 (Airtable 팔레트 + Iconify)
- '지금 수집' UX (스케줄 페이지 이동 + 1시간 쿨다운)

### 인프라 / 세션
- Route Handler 쿠키 `applySessionCookies()` 헬퍼 (CLAUDE.md 1.20)
- NPM 라우팅 homepage 전용 분리 (CLAUDE.md 1.23)
- 컨테이너 `TZ=Asia/Seoul` (CLAUDE.md 1.21)
- 보고서 PDF 정책 (CLAUDE.md 1.22 — 일일/주간만 PDF)

### 법률 / UI
- 선거법 표현 전수 치환 ("공격/공략" → "대응/차별점")
- 전략 4사분면 SVG 아이콘 + FloatingAssistant 복구
- 이모지 전량 제거 + 단색 라인 SVG 교체

---

## 남은 작업

### ⏳ 별도 세션 (근본 설계 필요)
- 쉬운 모드 나머지 페이지 디자인 개선
- 전역 hover 효과 검토

### ⏳ 기능
- SMTP 실제 값 설정 + 메일 발송 검증

### ⏳ 낮은 우선순위
- `_run_full_ai_pipeline` SQLAlchemy async session 중복 사용 에러
- B-3 모바일 반응형 전 페이지 점검

---

## Phase C. 빌드/배포 (작업 누적 후 1회 실행)

- [ ] `DOCKER_BUILDKIT=0 docker build --no-cache` (frontend + backend)
- [ ] `docker push` (GHCR 동기화)
- [ ] `docker compose up --no-deps --no-build`
- [ ] 컨테이너 내부 코드 직접 확인 (`docker exec`)
- [ ] 실제 URL curl + 브라우저 검증
- [ ] Watchtower 재시작 (`docker start watchtower`)
- [ ] git commit + push

---

# 후보자 일정 관리 통합 (Candidate Schedule) — v2 (2026-04-21 재설계)

> **목표**: 40대 보좌관이 카톡으로 받은 하루 일정을 3초 만에 입력 → AI가 시간대·위치 컨텍스트로 활용 → 홈페이지 자동 노출 → 지도에서 "덜 간 동네" 시각화.
> **주 사용자**: 40대 보좌관 (PC+모바일, 일정 툴 익숙하지만 "정보 많으면 복잡해한다"는 피드백).
> **UX 원칙** (사용자 피드백 반영):
> 1. **첫 화면 = 오늘 + 다음 3개만 크게**. 전체 리스트는 "더 보기" 뒤에 숨김
> 2. 카테고리·반복·공개 토글 등 고급 옵션은 **접힌 상태**. 기본값만으로도 저장 가능
> 3. **1페이지 = 1행동**. 일정 추가·결과 입력·히트맵은 같은 화면에 섞지 않음 (탭 분리)
> **결정 근거**: 한 줄 받아쓰기만으로는 시간별 하루 관리·회고 부족 → **3가지 입력 방식 + 어제 회고 섹션** 추가.

## 결정 사항 (사전 확정 — 결정 부담 0)

| 항목 | 결정 | 이유 |
|---|---|---|
| 카테고리 enum (10개) | 유세 / 거리인사 / 토론·간담회 / 방송출연 / 인터뷰 / 회의 / 지지자모임 / 투표일정 / 내부일정 / 기타 | 한국 캠프 실무 카테고리. 자유텍스트 금지 |
| 반복 일정 | **Phase 1 포함**. RRULE (RFC 5545) 표준, 자연어→RRULE 파싱도 AI 담당 | 매주 화 거리인사 같은 케이스 흔함 |
| 테이블 위치 | `public.candidate_schedules` (mybot 스키마), homepage 가 read-only | mybot 이 도메인 주체 |
| 시간 정확도 | `starts_at TIMESTAMPTZ`, `ends_at TIMESTAMPTZ` 필수. all_day 는 명시 필드 | AI 매칭·히트맵 좌표 정확도의 근본 |
| visibility 기본값 | **캠프 설정으로 결정** (기본 internal, 캠프가 "홈페이지 공개 기본 ON" 토글 가능) | 매번 묻지 않고 1회 설정 |
| 과거 일정 자동 처리 | `ends_at < NOW()` → status='done' 자동 + 다음 오전 브리핑에 "결과 미입력 N건" 배너 | 회고 누락 방지 |
| 지오코딩 | 카카오맵 API (현재 계정 재사용) — 입력 시 비동기 백필 | 위경도 확보 → 히트맵·지도링크 |
| 히트맵 경계 | **읍면동** 기본 + 줌인 시 통·리 + 투표소 핀 토글 | 전국 표준, GeoJSON 공공데이터 확보 가능 |

---

## Phase 1 — 핵심 입력·회고 (예상 3일)

### DB 스키마

`backend/migrations/2026_04_XX_candidate_schedules.sql`:

```sql
CREATE TYPE schedule_category AS ENUM (
  'rally', 'street', 'debate', 'broadcast', 'interview',
  'meeting', 'supporter', 'voting', 'internal', 'other'
);
CREATE TYPE schedule_visibility AS ENUM ('public', 'internal');
CREATE TYPE schedule_status AS ENUM ('planned', 'in_progress', 'done', 'canceled');

CREATE TABLE candidate_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  title VARCHAR(200) NOT NULL,
  description TEXT,
  location VARCHAR(300),
  location_url TEXT,                     -- 카카오맵 링크 (자동 생성)
  location_lat DOUBLE PRECISION,         -- 지오코딩 결과 (비동기 채움)
  location_lng DOUBLE PRECISION,
  admin_sido VARCHAR(30),                -- 히트맵용 역지오코딩 ("충청북도")
  admin_sigungu VARCHAR(50),             -- ("청주시 상당구")
  admin_dong VARCHAR(50),                -- ("용암동")
  admin_ri VARCHAR(50),                  -- (시골 읍면의 경우)

  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  all_day BOOLEAN NOT NULL DEFAULT false,

  category schedule_category NOT NULL DEFAULT 'other',
  visibility schedule_visibility NOT NULL DEFAULT 'internal',
  status schedule_status NOT NULL DEFAULT 'planned',

  result_summary TEXT,                   -- 완료 후 한 줄 회고 (좋음/보통/별로 + 자유 입력)
  result_mood VARCHAR(10),               -- good|normal|bad (퀵 입력)
  attended_count INT,
  media_coverage JSONB DEFAULT '[]'::jsonb,  -- Phase 3 AI 자동 매칭

  recurrence_rule TEXT,                  -- RRULE, "FREQ=WEEKLY;BYDAY=TU"
  parent_schedule_id UUID REFERENCES candidate_schedules(id) ON DELETE CASCADE,

  source_input_id UUID,                  -- 일괄 붙여넣기 그룹 식별 (취소/롤백용)
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cs_election_time ON candidate_schedules (election_id, starts_at DESC);
CREATE INDEX idx_cs_candidate_time ON candidate_schedules (candidate_id, starts_at DESC);
CREATE INDEX idx_cs_visibility_time ON candidate_schedules (visibility, ends_at)
  WHERE visibility = 'public' AND status != 'canceled';
CREATE INDEX idx_cs_status_ends ON candidate_schedules (status, ends_at)
  WHERE status IN ('planned', 'in_progress');
CREATE INDEX idx_cs_admin_dong ON candidate_schedules (candidate_id, admin_dong)
  WHERE admin_dong IS NOT NULL;         -- 히트맵 집계용

-- 캠프 설정 (홈페이지 자동 공개 기본값)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS schedule_default_public BOOLEAN DEFAULT false;
```

### Backend (FastAPI)

`backend/app/schedules_v2/` 신규:
- `models.py` — ORM
- `schemas.py` — Pydantic
- `router.py`:
  - `GET /api/candidate-schedules/{election_id}?from=&to=&candidate_id=&category=` — 범위 조회
  - `POST /api/candidate-schedules/{election_id}` — 단건 생성
  - `POST /api/candidate-schedules/{election_id}/parse` — **자연어 → 구조화 (단건 또는 복수)** ⭐
  - `PATCH /api/candidate-schedules/{id}?scope=single|future|all` — 수정
  - `DELETE /api/candidate-schedules/{id}` — 취소(soft) status='canceled'
  - `POST /api/candidate-schedules/{id}/result` — 결과(mood + 한 줄) 입력
  - `GET /api/candidate-schedules/{election_id}/yesterday` — 어제 회고용 목록
- `recurrence.py` — `python-dateutil` rrule 파싱
- `parser.py` — **자연어 → 구조화 AI 파서** ⭐
  - 단건: "내일 오후 3시 청주시청 앞 유세"
  - 복수(라인별): `09:00 시청 조회 / 10:30 봉명동 거리인사 / ...`
  - 반복: "매주 화 아침 시청 앞 거리인사" → RRULE
  - AI tier: **Sonnet** (빠르고 저렴, 한국어 시간 표현 정확)
  - 응답: `[{title, starts_at, ends_at, location, category, visibility, recurrence_rule?}, ...]` + `confidence`
  - confidence < 0.8 → 프론트가 "확인 화면"에서 수정 요구
- `geocode.py` — 카카오맵 주소→좌표 + 역지오코딩(좌표→읍면동). 생성 직후 Celery 비동기 호출
- 권한: 기존 `require_election_access(election_id, tenant_id)` 재사용

Celery 잡 (`app/schedules_v2/tasks.py`):
- `auto_complete_past_schedules` (매시간) — `status='planned' AND ends_at < NOW()` → `status='done'`
- `expand_recurring_schedules` (매일 03:00 KST) — RRULE 일정 향후 90일 인스턴스 생성
- `geocode_schedule` (이벤트 구동, 생성/장소수정 시) — location 텍스트 → lat/lng + admin_dong 채움
- `morning_result_reminder` (매일 07:00 KST) — 어제 `status=done AND result_summary IS NULL` 개수 → 오전 브리핑 배너용 데이터 캐시

### Frontend — `/dashboard/calendar` (전문가 모드)

**구조: 3개 탭 (1페이지 1행동 원칙)**
1. **오늘** (기본) — 하루 타임라인 + 다음 일정 3개 크게 + 어제 회고 섹션
2. **이번주** — 주간 리스트 (요일별 그룹)
3. **지도** (Phase 3에서 히트맵 추가)

**"오늘" 탭 레이아웃**:
```
┌──────────────────────────────────────────────────┐
│ [어제 회고 ▼]  완료 4 · 결과 미입력 2  [바로 입력] │  ← 접힘 기본
├──────────────────────────────────────────────────┤
│ [+ 일정 추가 ▼]                                    │  ← 상단 1버튼
│                                                    │
│ 다음 일정   14:00  청주시청 유세           D-0 2h │  ← 3개 크게
│ 다음 일정   16:00  봉명동 거리인사         D-0 4h │
│ 다음 일정   18:30  후원회                   D-0 6h │
│                                                    │
│ [하루 타임라인 ▼]                                  │  ← 접힘 기본
│   06 ─                                             │
│   08 ─ [시청 조회]                                 │
│   10 ─                                             │
│   ...                                              │
└──────────────────────────────────────────────────┘
```

**일정 추가 버튼** — 클릭 시 확장 (모달 아님, 인라인):
```
┌ 한 줄 / 여러 줄 / 수동 입력 ──────────────┐  ← 3가지 탭
│                                            │
│ [내일 오후 3시 청주시청 유세]  [🎤]  [파싱] │
│                                            │
│ (파싱 결과 확인)                            │
│ ✓ 제목: 청주시청 유세                       │
│ ✓ 시간: 2026-04-22 15:00~16:00  [수정]     │
│ ✓ 장소: 청주시청 앞                         │
│ ✓ 카테고리: 유세                            │
│ ☐ 홈페이지 공개                            │
│                       [저장]               │
└────────────────────────────────────────────┘
```

**여러 줄 모드** — 같은 구조, textarea + 파싱 결과는 복수 카드:
```
09:00 시청 조회
10:30 봉명동 거리인사
14:00~16:00 상당구청 간담회
18:00 후원회
            ↓ [파싱]
[ 4건 파싱됨 — 전부 확인 후 [일괄 저장] ]
```

**일정 카드 탭 → 하단 시트 (bottom sheet)**:
- 시간·장소·카테고리·공개 토글 즉시 수정
- 결과 입력 섹션 (status=done일 때만): [좋음 / 보통 / 별로] 1번 탭 + 한 줄 입력

**어제 회고 섹션** (최상단, 접힌 상태 기본, 미입력 있으면 자동 펼침):
- ✓ 완료 + 결과 입력됨 (초록 체크)
- ⚠ 완료했지만 결과 미입력 (빨간 배지) — 탭하면 퀵 입력 바텀시트
- ✗ 취소/미수행

**반복 일정**:
- 자연어 입력 시 AI가 RRULE 변환: "매주 화 아침 시청 앞 거리인사"
- 편집 시 범위 선택 (이 일정만 / 이후 전부 / 전체)

### Frontend — `/easy/calendar` (쉬운 모드)

전문가 모드와 동일 구조지만 더 큰 폰트·버튼. 기본 뷰는 "오늘" 탭, 상단 sticky 헤더에 "오늘 일정 N개 · 다음 일정 D-X 시간".

### 사이드바 메뉴

- 좌측 사이드바 "일정" 메뉴 추가 (dashboard + easy 양쪽)
- 기존 `/dashboard/schedules` (데이터 수집 스케줄) → `/dashboard/schedules/collection` 로 경로 이동 + redirect (혼동 방지)

### Phase 1 검증

- [ ] "내일 오후 3시 청주시청 유세" 한 줄 → 10초 내 저장 (AI 파싱 5초 + 확인 5초)
- [ ] 카톡 4줄 붙여넣기 → 4건 일괄 저장
- [ ] "매주 화 아침 시청 앞 거리인사" → RRULE 자동 생성 + 90일 인스턴스 펼침
- [ ] 음성 입력 (크롬 모바일) → STT → 파싱 성공
- [ ] 어제 status='done' 자동 + 오늘 오전 "결과 미입력 N건" 배너 표시
- [ ] ⚠ 배지 탭 → 퀵 결과 입력 (좋음/보통/별로 + 한 줄) 3초 내 완료
- [ ] 일정 저장 직후 카카오맵 지오코딩 완료 (백그라운드) → admin_dong 채움
- [ ] Playwright: 김진균 캠프로 5개 일정 (단건/복수/반복/취소/완료+결과) 전 과정 작동

---

## Phase 2 — 홈페이지 연동 + 월간 뷰 (예상 1일)

### 홈페이지 표시

`homepage/src/app/[code]/page.tsx` 일정 섹션:
- 기존 `homepage.schedules` 조회 → mybot DB `candidate_schedules` 조회로 교체
- 쿼리:
  ```sql
  WHERE candidate_id = $1
    AND visibility = 'public'
    AND status != 'canceled'
    AND ends_at >= NOW()
  ORDER BY starts_at LIMIT 10
  ```
- 카테고리 색상 칩, 정확한 시간 ("5월 12일 화 14:00 ~ 16:00")
- 반복 일정은 펼쳐진 인스턴스 단위로 표시
- **오늘/내일 일정은 홈페이지 상단 띠**: "오늘 14:00 청주시청 유세 — 와주세요" (자동 노출)

`homepage/src/app/[code]/admin/schedules/page.tsx`:
- 안내 페이지: "일정은 이제 mybot 대시보드 캘린더에서 관리합니다 [이동]"

### 캠프 설정

`/dashboard/settings` 에 추가:
- `□ 새 일정을 기본적으로 홈페이지에 공개` 토글 (tenants.schedule_default_public)
- OFF면 일정 입력 시 visibility=internal, 캠프가 명시 체크해야 public
- ON이면 visibility=public, 캠프가 명시 체크 해제해야 internal

### 옛 데이터 마이그레이션

`backend/scripts/migrate_homepage_schedules.py`:
- `homepage.schedules` 5건 읽기
- 자유텍스트 `time` best-effort 파싱 ("오전 6시 ~ 오후" → 06:00~18:00)
- 파싱 실패 시 all_day=true
- candidate_id 매핑: `homepage.users.code` ↔ `tenants.id` ↔ election 우리 후보
- 새 테이블 INSERT, 옛 행 보존 (Phase 3 끝나고 DROP)

### 월간 달력 뷰

`/dashboard/calendar` "이번주" 탭 우측에 "월" 토글 추가:
- `@fullcalendar/daygrid` 만 import (4뷰 전부는 금지)
- 읽기 전용 + 클릭 → 해당 날짜의 "오늘" 탭으로 이동
- **편집은 "오늘" 탭에서만** (동선 단순화)

### Phase 2 검증

- [ ] mybot에서 "공개" 일정 추가 → 30초 내 홈페이지 표시
- [ ] 캠프 설정 "공개 기본 ON" → 이후 입력 일정 자동 홈페이지 노출
- [ ] 홈페이지 상단 띠에 오늘 일정 노출
- [ ] 옛 홈페이지 5건 마이그레이션 + 표시 정상
- [ ] 월간 달력 뷰 표시 · 클릭 → "오늘" 탭 네비게이션

---

## Phase 3 — AI 통합 + 지도 히트맵 (예상 2일)

### 지도 히트맵 "지도" 탭

`/dashboard/calendar` 에 3번째 탭 "지도" 추가.

**3단계 레이어 + 토글**:
1. **읍면동** (기본) — 읍면동 경계 폴리곤 + 방문 횟수 기반 색상 그라데이션 (밝음=많이 감, 빨강=덜 감)
2. **통·리** — 줌 레벨 14 이상 자동 노출. 통·리 경계 데이터는 공공데이터포털 (별도 수집)
3. **투표소 핀** — 토글 버튼으로 on/off. 선관위 투표소 데이터

**기능**:
- 후보 선택 드롭다운 (우리/경쟁자별로 방문 분포 비교)
- 기간 선택 (이번주 / 이번달 / D-30 / D-7 / 전체)
- 동 클릭 → 패널: "봉명동 — 방문 3회 · 마지막 방문 12일 전 · 인구 18,400 · 최근 뉴스 5건"
- 패널에 **[이 동에 일정 추가]** 버튼 → 오늘 탭으로 이동 + location 프리필
- 사각지대 동(방문 0 · 이번달 0) 자동 "TOP 5 소외 지역" 사이드바 리스트

**데이터 소스**:
- 읍면동 경계: 행정안전부 공공데이터 GeoJSON (TopoJSON 압축)
- 인구: 주민등록 인구 통계 (읍면동별)
- 투표소: 중앙선거관리위원회 (선거별 데이터)
- 뉴스 건수: 기존 `news_articles` + admin_dong 기반 매칭 (Phase 3.5)

**파일**:
- `frontend/src/components/calendar/HeatmapMap.tsx` — Leaflet 또는 MapLibre (네이버/카카오 지도 SDK도 검토)
- `backend/app/schedules_v2/heatmap.py` — 읍면동별 집계 쿼리
- `backend/data/geo/` — TopoJSON 정적 리소스

### AI 컨텍스트 통합

`backend/app/chat/context_builder.py`, `backend/app/reports/ai_report.py`:
- `recent_schedules` 블록 추가 (최근 7일 + 향후 7일, 최대 30건)
- 일일 보고서에 "어제 완료한 일정·결과 요약" 섹션 자동 생성
- 챗 질문에 시간 표현 ("지난주", "토론 후") 있으면 schedules로 시간대 슬라이싱

### media_coverage 자동 매칭

`backend/app/services/schedule_media_matcher.py` (Celery 매시간):
- `status='done' AND media_coverage='[]'` 대상
- 각 일정의 `starts_at ±3h` + 후보 이름 기반 뉴스/커뮤니티 최대 5건 추출
- AI (Sonnet) 가 "이 일정과 정말 관련 있나" 판정
- 통과 건만 `media_coverage` JSON 저장
- 일정 카드에 "관련 뉴스 3건" 배지 표시

### AI 자동 일정 추천 (push, 브리핑 통합)

`backend/app/services/today_actions.py`:
- 매일 07:00 브리핑에 포함:
  - 오늘 빈 슬롯 (`planned` 일정 없는 2시간 이상 공백)
  - 소외 지역 TOP 3 (이번달 방문 0회 + 인구 많은 순)
  - 추천 메시지: "내일 14~16시 비어있음 — 추천: ①봉명동(마지막 23일 전, 인구 18,000) ②사창동(이번달 0회)"
- 수락 1번 클릭 → 해당 시간·동 프리필로 일정 추가 화면

### 24h 콘텐츠 prep

`today_actions` 에 추가:
- 24h 내 예정 일정 있으면 "내일 ○○ 행사 30분 전 SNS 포스팅 초안" 액션
- 클릭 → `/dashboard/content` 이동 + schedule_id 컨텍스트

### 충돌·공백 감지

- 같은 candidate 시간 겹침 → 카드에 빨간 외곽선 + 상단 배너
- D-30 이하 + 이틀 연속 일정 0개 → "유세 일정 추가 권장" today action

### Phase 3 검증

- [ ] 지도 탭 → 읍면동 히트맵 3초 내 렌더 (충북 교육감 선거 전 지역)
- [ ] 줌인 → 통·리 경계 자동 노출
- [ ] "TOP 5 소외 지역" 리스트에 방문 0회 동 정렬 정확
- [ ] 동 클릭 → [이 동에 일정 추가] → 오늘 탭 이동 + 장소 프리필
- [ ] 어제 14시 유세 입력 → 오늘 일일 보고서에 "14시 ±2h SNS 반응" 자동 분석
- [ ] 챗 "지난주 토론 후 여론 변화" → schedules 기반 시간대 자동 슬라이싱
- [ ] 과거 완료 일정 → 60분 내 media_coverage 자동 채움
- [ ] 오전 브리핑에 AI 자동 추천 "소외 지역" 나타남

---

## Phase 4 — 외부 연동 (선택, 예상 1.5일)

- [ ] iCal export: `GET /api/candidate-schedules/{election_id}/ical?token=<캠프토큰>` → Google/Apple Calendar 구독 URL (**read-only**)
- [ ] 텔레그램 30분 전 알림 (`schedule_start_reminder`, Celery every 5min)
- [ ] 텔레그램 결과 회고 질문 (일정 종료 30분 후, status=done+결과미입력 대상) — "[청주시청 유세] 어땠어요?" 버튼 카드
- [ ] **사진 EXIF 역방향 일정 생성**: 보좌관이 사진 1장 업로드 → EXIF 위경도·시간 추출 → "이 일정 맞나요?" 제안 카드
- [ ] 첨부파일 (사진/영상) — 일정 완료 후 업로드 → result 자료 (S3 또는 로컬 volume)

---

## 작업 순서 체크리스트

### Phase 1 — 핵심 입력·회고 (3일)
- [ ] DB 마이그레이션 작성 + 적용 (admin_* 필드, source_input_id, result_mood 포함)
- [ ] `schedules_v2/` 라우터 + 권한 + 반복규칙
- [ ] AI 파서 `parser.py` (단건/복수/반복, Sonnet)
- [ ] 카카오맵 지오코딩 서비스 + Celery 잡
- [ ] Celery 잡 (auto_complete + expand_recurring + morning_result_reminder)
- [ ] frontend `/dashboard/calendar` 3탭 구조 (오늘/이번주/지도placeholder)
- [ ] 일정 추가 3가지 모드 (한 줄/여러 줄/수동) UI
- [ ] 어제 회고 섹션 + 퀵 결과 입력 bottom sheet
- [ ] 하루 타임라인 뷰
- [ ] `/easy/calendar` 큰 폰트 버전
- [ ] 사이드바 메뉴 + 기존 `/dashboard/schedules` → `/collection` 이동
- [ ] Playwright 검증 (단건/복수/반복/음성/어제회고/결과입력)

### Phase 2 — 홈페이지 연동 + 월간 뷰 (1일)
- [ ] homepage 표시 섹션 mybot DB 조회로 교체
- [ ] 오늘/내일 상단 띠
- [ ] homepage admin/schedules 안내 페이지
- [ ] 캠프 설정 "공개 기본" 토글
- [ ] 옛 5건 마이그레이션 스크립트
- [ ] 월간 뷰 (daygrid only)
- [ ] Playwright 검증 (동기화)

### Phase 3 — AI 통합 + 지도 히트맵 (2일)
- [ ] 읍면동 GeoJSON 확보 + 정적 서빙
- [ ] 히트맵 컴포넌트 (3단계 레이어 + 토글)
- [ ] 동 클릭 패널 + [이 동에 일정 추가]
- [ ] TOP 5 소외 지역 리스트
- [ ] context_builder + ai_report 에 schedules 블록
- [ ] schedule_media_matcher Celery 잡
- [ ] today_actions 에 자동 추천·콘텐츠 prep
- [ ] 충돌·공백 감지 UI
- [ ] 검증 (히트맵 정확도/보고서/챗 시간대 매칭)

### Phase 4 — 외부 연동 (선택, 1.5일)
- [ ] iCal export + 구독 URL 발급
- [ ] 텔레그램 30분 전 알림 + 결과 회고 질문
- [ ] 사진 EXIF 역방향 일정 제안
- [ ] 첨부파일 업로드

---

## 총 예상 공수 (Phase 4 제외)

- Phase 1: **3일** (핵심 기능, 이것만 있어도 쓸만함)
- Phase 2: **1일**
- Phase 3: **2일**
- **합계: 6일** (Phase 4 추가 시 +1.5일)
