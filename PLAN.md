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

# 후보자 일정 관리 통합 (Candidate Schedule)

> **목표**: 캠프가 시간 단위로 후보 활동(유세·토론·회의·방송)을 입력 → mybot 캘린더에서 관리 + homepage 자동 노출 + AI 분석에 시간대 컨텍스트 주입.
> **현재 문제**: `homepage.schedules` 가 `date` 만 있고 `time` 이 자유텍스트 ("오전 6시 ~ 오후"). 캘린더 뷰 불가, AI 시간 매칭 불가, 상태/카테고리/결과 필드 0.
> **결정 근거**: 사용자 요청 (2026-04-20) — "기존이 너무 허술. 시간/날짜/달력으로 보고 한일 확인까지". 모든 결정값은 한국 선거 캠프 실무 기준으로 사전 확정 — 시간 날 때 그대로 따라 진행 가능.

## 결정 사항 (사전 확정 — 결정 부담 0)

| 항목 | 결정 | 이유 |
|---|---|---|
| 카테고리 enum (10개) | 유세 / 거리인사 / 토론·간담회 / 방송출연 / 인터뷰 / 회의 / 지지자모임 / 투표일정 / 내부일정 / 기타 | 한국 캠프 실무 카테고리. 자유텍스트 금지 (필터/통계 위해) |
| 반복 일정 | **Phase 1 포함**. RRULE (RFC 5545) 표준 | 매주 화 거리인사 같은 케이스 흔함. python-dateutil 이미 deps |
| 첨부파일 (사진·영상) | **Phase 4로 미룸** | 스토리지 설계 별도 필요. Phase 1은 텍스트 result_summary 만 |
| 외부 캘린더 | **Phase 4 export-only (iCal)** | 양방향 sync 충돌 처리 복잡, 캠프 실수 위험 |
| 테이블 위치 | **`public.candidate_schedules`** (mybot 스키마), homepage 가 read-only | mybot 이 도메인 주체. homepage 는 표시 레이어 |
| 시간 정확도 | `starts_at TIMESTAMPTZ`, `ends_at TIMESTAMPTZ` 필수. all_day 일 때만 시간 무시 | AI 매칭 정확도의 근본 |
| visibility 기본값 | `internal` (캠프 내부) | 모든 일정 자동 공개 시 사고 위험. 캠프가 명시적으로 "공개" 체크 |
| 과거 일정 자동 처리 | `ends_at < NOW()` → status='완료' 자동 + "결과 한 줄 입력" 토스트 | 결과 기록 누락 방지. AI 가 result_summary 활용 |

---

## Phase 1 — 핵심 (예상 1.5일)

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
  location_url TEXT,                  -- 네이버지도/카카오맵 링크

  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  all_day BOOLEAN NOT NULL DEFAULT false,

  category schedule_category NOT NULL DEFAULT 'other',
  visibility schedule_visibility NOT NULL DEFAULT 'internal',
  status schedule_status NOT NULL DEFAULT 'planned',

  result_summary TEXT,                -- 완료 후 캠프 입력 (AI 가 사용)
  attended_count INT,
  media_coverage JSONB DEFAULT '[]'::jsonb,   -- [{url, title, sentiment}, ...] AI 자동 매칭

  recurrence_rule TEXT,               -- RRULE, 예: "FREQ=WEEKLY;BYDAY=TU"
  parent_schedule_id UUID REFERENCES candidate_schedules(id) ON DELETE CASCADE,
                                      -- 반복 일정 인스턴스의 부모 참조

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
```

### Backend (FastAPI)

`backend/app/schedules_v2/` 신규 (기존 `schedules` 는 데이터 수집용이라 충돌 회피):
- `models.py` — ORM
- `schemas.py` — Pydantic
- `router.py`:
  - `GET /api/candidate-schedules/{election_id}?from=&to=&candidate_id=&category=` — 범위 조회
  - `POST /api/candidate-schedules/{election_id}` — 생성 (반복 시 향후 90일치 자동 펼침)
  - `PATCH /api/candidate-schedules/{id}?scope=single|future|all` — 수정
  - `DELETE /api/candidate-schedules/{id}` — 취소(soft) status='canceled'
  - `POST /api/candidate-schedules/{id}/result` — 결과 메모 + attended_count 입력
- `recurrence.py` — `python-dateutil` rrule 파싱
- 권한: 기존 `require_election_access(election_id, tenant_id)` 재사용

Celery 잡 `tasks.py` 추가:
- `auto_complete_past_schedules` (매시간) — `status='planned' AND ends_at < NOW()` → `status='done'`
- `expand_recurring_schedules` (매일 03:00 KST) — recurrence_rule 보유 일정의 향후 90일 인스턴스 미리 생성

### Frontend (Next.js + FullCalendar)

```
npm install @fullcalendar/react @fullcalendar/daygrid @fullcalendar/timegrid \
  @fullcalendar/list @fullcalendar/interaction @fullcalendar/rrule
```

`frontend/src/app/dashboard/calendar/page.tsx`:
- 4뷰 토글: 월/주/일/리스트
- 드래그로 시간 변경 (`PATCH` 호출)
- 날짜·시간 클릭 → 일정 추가 모달
- 카테고리별 색상 (10개 사전 정의)
- 우측 사이드 필터: 후보별 / 카테고리별 / visibility 별
- 일정 클릭 → 상세 패널: 제목/시간/장소/지도링크/설명/카테고리/visibility 토글/반복규칙
- 완료 일정 (status=done) 흐림 처리 + result_summary 미입력이면 강조 배지 "결과 입력 필요"

`frontend/src/app/easy/calendar/page.tsx`:
- 기본 리스트 뷰 (오늘 → 이번주 → 이번달 그룹화)
- "오늘 일정 N개", "다음 일정까지 D-X" 헤더 카드
- 한손 입력 모달 (제목/시간/장소만, 카테고리 default=유세)

좌측 사이드바에 "일정" 메뉴 추가 (mybot dashboard + easy 양쪽).

기존 `/dashboard/schedules` (데이터 수집 스케줄) → `/dashboard/schedules/collection` 으로 이동 (혼동 방지) + redirect.

### Phase 1 검증

- [ ] 일정 추가 → 30초 내 캘린더 반영
- [ ] 반복 일정 (매주 화 거리인사) → 향후 90일 자동 펼침 + 단일 인스턴스 수정 가능
- [ ] 과거 일정 Celery 매시간 → 자동 status='done'
- [ ] 시간 충돌 경고 (UI에서 같은 candidate_id 시간 겹치면 빨간 배지)
- [ ] Playwright: 김진균 캠프로 로그인 → 캘린더 진입 → 5개 일정 (예정/완료/반복/취소/하루종일) 정상 표시

---

## Phase 2 — homepage 연동 (예상 0.5일)

### homepage 변경

`homepage/src/app/[code]/page.tsx` 일정 섹션:
- 기존 `homepage.schedules` 조회 → mybot DB `candidate_schedules` 조회로 교체
- 쿼리: `WHERE candidate_id = (해당 user 의 election 의 our_candidate) AND visibility='public' AND status != 'canceled' AND ends_at >= NOW() ORDER BY starts_at LIMIT 10`
- 카테고리 색상 칩, 정확한 시간 표시 ("5월 12일 화 14:00 ~ 16:00")
- 반복 일정은 인스턴스 단위로 표시

`homepage/src/app/[code]/admin/schedules/page.tsx`:
- "이 페이지는 mybot 대시보드 캘린더로 통합되었습니다 → 이동" 안내 + 링크
- 또는 read-only 미러 표시 + 편집은 mybot 으로 유도

### 옛 데이터 마이그레이션

`backend/scripts/migrate_homepage_schedules.py`:
- `homepage.schedules` 5건 읽기
- 자유텍스트 `time` best-effort 파싱 ("오전 6시 ~ 오후" → starts_at = date 06:00, ends_at = date 18:00)
- 파싱 실패 시 all_day=true
- candidate_id 매핑: `homepage.users.code` ↔ `tenants.id` ↔ election 의 우리 후보
- 새 테이블에 INSERT, 옛 행은 보존 (롤백 대비, Phase 3 끝나고 DROP)

### Phase 2 검증

- [ ] mybot 캘린더에 "공개" 일정 추가 → 30초 내 homepage 에 표시
- [ ] homepage 에서 캠프가 옛 admin/schedules 들어가면 "mybot 으로 이동" 안내
- [ ] 옛 5건 모두 새 테이블로 이전 + 표시 정상

---

## Phase 3 — AI 통합 (예상 1일, 진짜 가치)

### context_builder 통합

`backend/app/chat/context_builder.py`, `backend/app/reports/ai_report.py`:
- 기존 컨텍스트에 `recent_schedules` 블록 추가 (최근 7일 + 향후 7일)
- 일일 보고서: 어제 완료된 일정 → 같은 시간 ±2h 윈도우의 SNS·뉴스 반응 자동 매칭
- 챗: 사용자 질문에 시간 표현 ("지난주", "토론 후") 있으면 schedules.starts_at 으로 슬라이싱

### media_coverage 자동 채우기

`backend/app/services/schedule_media_matcher.py` (Celery 매시간):
- status='done' AND media_coverage IS NULL 인 일정 대상
- 각 일정의 starts_at ±3h 시간대 + 후보 이름 매칭 뉴스/SNS 자동 추출 (최대 5건)
- AI (Sonnet) 가 "이 일정과 정말 관련 있나" 판정 → 통과 건만 `media_coverage` JSON 에 저장
- 캠프는 캘린더에서 일정 클릭 → 관련 뉴스 즉시 확인

### 콘텐츠 prep 추천

`backend/app/services/today_actions.py` 에 추가:
- 24h 내 예정 일정 있으면 "내일 ○○ 행사 30분 전 SNS 포스팅 초안" 액션 자동 생성
- 사용자가 클릭하면 `/dashboard/content` 로 이동 + schedule_id 컨텍스트 주입

### 충돌·공백 감지

- 같은 candidate 시간 겹침 → 캘린더 빨간 외곽선 + 알림
- D-30 이하 + 주말 빈 슬롯 (이틀 연속 일정 0개) → "유세 일정 추가 권장" 액션

### Phase 3 검증

- [ ] 어제 14시 유세 일정 입력 → 오늘 일일 보고서에 "14시 ±2h SNS 반응" 자동 분석
- [ ] 챗 "지난주 토론 후 여론 변화" → schedules 기반 시간대 자동 슬라이싱
- [ ] 과거 완료 일정 → 30분 내 media_coverage 자동 채움

---

## Phase 4 — 외부 연동 (선택, 예상 1일)

- [ ] iCal export: `GET /api/candidate-schedules/{election_id}/ical?token=<캠프토큰>` → Google/Apple Calendar 구독 URL
- [ ] 텔레그램 알림: 일정 시작 30분 전 자동 알림 (캠프 봇)
- [ ] 첨부파일 (사진/영상) — 일정 완료 후 사진 업로드 → result 자료
- [ ] 양방향 Google Calendar sync (사용자 요청 시만 — 충돌 처리 별도 설계)

---

## 작업 순서 체크리스트

### Phase 1 — 핵심
- [ ] DB 마이그레이션 작성 + 적용
- [ ] backend `schedules_v2/` 라우터 + 권한 + 반복규칙
- [ ] Celery 잡 (auto_complete + expand_recurring)
- [ ] frontend `/dashboard/calendar` (FullCalendar 4뷰)
- [ ] frontend `/easy/calendar` (리스트 뷰)
- [ ] 사이드바 메뉴 추가 + 기존 `/dashboard/schedules` → `/collection` 이동
- [ ] Playwright 검증 (생성/수정/삭제/반복/충돌)

### Phase 2 — homepage 연동
- [ ] homepage 표시 섹션 mybot DB 조회로 교체
- [ ] homepage admin/schedules 안내 페이지
- [ ] 옛 5건 마이그레이션 스크립트
- [ ] Playwright 검증 (mybot ↔ homepage 동기화)

### Phase 3 — AI 통합
- [ ] context_builder + ai_report 에 schedules 블록
- [ ] schedule_media_matcher Celery 잡
- [ ] today_actions 에 일정 prep 액션
- [ ] 충돌·공백 감지 UI
- [ ] 검증 (보고서/챗 시간대 매칭)

### Phase 4 — 외부 연동 (선택)
- [ ] iCal export + 구독 URL 발급
- [ ] 텔레그램 30분 전 알림
- [ ] 첨부파일 업로드
