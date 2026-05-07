# ElectionPulse — 구조화 요구사항 (CLAUDE.md)

**이 문서는 ElectionPulse 프로젝트에서 작업하는 모든 세션이 반드시 준수해야 하는 절대 규칙과 구조적 요구사항이다. 새 세션은 작업 전에 이 문서를 먼저 읽는다.**

---

## 0. 프로젝트 정체성

- **무엇**: 한국 선거 캠프(후보자)용 AI 분석 SaaS 플랫폼
- **도메인**: 한국 지방선거·교육감 선거·국회의원 선거 (한국어 전용)
- **사용자**: 각 선거 캠프(테넌트) — 후보자가 가입하면 즉시 모든 분석 자동 가동
- **핵심 가치**: 매일 "오늘 일어난 일"을 후보 관점에서 정확하게 분석하여 전략·대응·콘텐츠로 연결

---

## 1. 절대 룰 (Never Violate — 위반 시 시스템 약속이 무너짐)

### 1.0. **수정 재수정 금지 — 허락 필수 (2026-04-15 사용자 명시)**
**원칙**: 이미 한 번 수정한 코드/기능을 **다시 수정**해야 할 일이 생기면 **반드시 사용자 허락을 먼저 받는다**.
- "지난번에 고쳤다" = 같은 파일·같은 증상 재수정 금지 (허락 없이)
- 이유: 같은 버그 반복 → 사용자 시간 낭비 + 신뢰 훼손
- 대신: **근본 원인 전체 추적 보고 → 사용자 확인 → 수정 시작**
- **모든 수정은 반드시 기록**: commit 메시지 + `memory/project_fix_*.md` 파일
- **테스트 없이 완료 선언 금지**: 핫패치 주입 → curl/브라우저 실제 호출 검증 → 사용자에게 "시도해보세요" 요청 → 성공 확인 후 commit

**위반 사례 방지**: CLAUDE.md, memory/feedback_regression_log.md, memory/project_fix_*.md 를 매 세션 시작 시 확인.

### 1.1. 보여주기식 금지
모든 코드는 **실제로 작동**해야 한다. UI에 숫자를 찍어놓고 백엔드는 비어있는 식의 가짜 구현 금지. 수정했다고 주장하기 전에 반드시 실제 데이터로 검증한다.

### 1.2. AI 실호출 원칙 — 키워드 카운트를 AI 분석이라 부르지 말 것
- "감성 분석"이라는 이름의 함수가 실제로는 단어 매칭만 하는 경우 즉시 제거
- `_keyword_analysis_conservative()` 같은 폴백을 메인 경로에 두지 말 것
- 모든 분석은 **AI가 본문을 읽고** → 요약 + 감성 + 관련성 + 4사분면 + 액션을 **한 번의 호출**에서 반환해야 함

### 1.3. 모델 Tier 고정 (변경 금지)
- **fast = Haiku**: 사용 금지 (한국어 선거 뉴스 오분류율 26~40%, 무관 항목 필터링조차 못 함). 단순 키워드 추출·이슈 분류 등 극히 제한된 용도만.
- **standard = Sonnet**: 감성 분석·콘텐츠 생성·브리핑·챗 기본
- **premium = Opus**: 감성 검증·일일 보고서·토론 대본·심층 전략
- "모델을 낮추면 비용이..." 같은 제안 금지. 확실하지 않으면 대답하지 말 것.

### 1.4. AI 호출 경로 단일화
모든 AI 호출은 **`app.services.ai_service.call_claude()`** 또는 **`call_claude_text()`** 경유.
- `asyncio.create_subprocess_exec()` 직접 호출 금지
- `subprocess.run()` 직접 호출 금지
- 이유: 고객 API키 → 관리자 CLI 계정 → 시스템 CLI 자동 전환이 여기서만 작동함

### 1.5. AI 계정 운용 전략 (변경 금지)
1순위: 고객 본인의 Anthropic/OpenAI API 키 (저장되어 있으면 항상 먼저 사용)
2순위: 관리자가 등록한 Claude/ChatGPT CLI 계정 풀 (`CLAUDE_CONFIG_DIR` 환경변수로 전환)
3순위: 시스템 기본 CLI

Rate limit / down 감지 시 자동으로 다음 순위로 전환. `ai_accounts.status = 'blocked'` 자동 업데이트.

### 1.6. Sonnet → Opus 2단계 파이프라인
- 1단계: Sonnet으로 수집 직후 배치 분석 (요약·감성·관련성·4사분면·액션)
- 2단계: Opus로 positive/negative 검증 + 4사분면 재확인 (`sentiment_verified = TRUE`)
- neutral은 Opus 검증 스킵 (비용 절약)
- 검증 없이 보고서 작성 금지

### 1.7. 수집 시점 게이트 (저장 전 필터)
수집된 모든 아이템은 저장 전에 다음 게이트를 통과해야 한다:
1. **날짜 컷오프**: `published_at >= now() - 7 days`. 파싱 실패 시 `collected_at` **만 필터 판정에 참고**하고 **저장값은 NULL로 남긴다** (뒤 1.12 참고). 2022 같은 옛날 기사 절대 저장 금지.
2. **관련성**: 후보 이름 substring + `homonym_filters` 통과
3. **품질**: YouTube는 `views >= 50` 이상, 네이버는 광고/쓰레기 패턴 차단
4. **AI 관련성 판정**: `is_relevant = false` 로 판정된 항목은 저장하지 않음 (DB를 더럽히지 않음)

### 1.12. 가짜 날짜 저장 절대 금지 (2026-04-12 재확인)
`published_at` 컬럼에는 **소스 시스템이 반환한 실제 작성·업로드·게시 시각**만 저장한다.
이 두 종류의 시간을 절대 혼동·대체하지 않는다:
- `published_at` = 작성·업로드·게시 시각 (네이버 pubDate, YouTube publishedAt, 블로그 postdate)
- `collected_at` = 우리 시스템이 가져온 시각 (DB default NOW())

**금지 패턴 (과거 세션에서 반복된 오류)**:
```python
# ❌ 절대 금지
published_at=pub_at or datetime.now()
published_at=pub_at or collected_at
# ❌ DB 백필 금지
UPDATE youtube_videos SET published_at = collected_at WHERE published_at IS NULL
```

**올바른 패턴**:
```python
# ✓ 파싱 실패 시 NULL로 저장 — 정직하게
pub_at = parse_published_at(api_response.get("publishedAt"))
session.add(YouTubeVideo(..., published_at=pub_at))  # None이면 NULL 저장
```

필터 판정(7일 컷오프)과 저장값 결정은 **서로 다른 결정**이다:
- 필터는 `_check_pub_cutoff(pub_at, collected_fallback)` 사용 — `(pub_to_save, should_keep)` 튜플 반환
- `pub_to_save`는 진짜 `pub_at`이거나 `None` (collected_at으로 위조 금지)
- `should_keep`는 `pub_at` 또는 `collected_at` 중 하나라도 7일 이내면 True

**정렬 규칙**:
- UI에 표시할 때: `ORDER BY published_at DESC NULLS LAST, collected_at DESC`
- 날짜 불명 항목은 목록 하단에 수집 시각 역순으로 나열 (정직한 표시)
- 프론트엔드는 NULL이면 "날짜 없음" 라벨 또는 수집일 prefix("수집: ...") 사용

**왜 중요한가**: 2026-04-12 세션에서 278건 YouTube + 554건 community의 `published_at`을 `collected_at`으로 백필했다가 사용자에게 "수집 시각이 업로드 날짜처럼 보이는" 혼란을 야기. 모든 아이템이 동일한 시각으로 찍혀 정렬 의미 상실. 이후 되돌리고 이 룰로 명문화.

**YouTube 복원 스크립트**: `backend/scripts/restore_yt_dates.py`
- YouTube Data API v3 `videos.list` 사용 (1 unit/call, 50개씩 배치 → 278건에 6 units)
- 실행 시점: API 쿼터가 리셋된 후 (한국 시간 오후 4~5시경 KST, Pacific 자정 기준)
- 쿼터 초과(403) 시 즉시 중단 + 미처리 건 로그

**스크래퍼 날짜 추출 원칙**:
- `pub_date: None` 으로 하드코딩 금지. 반드시 HTML에서 날짜 추출을 시도해야 한다.
- 네이버 검색 결과는 `sds-comps-*` 디자인 시스템을 쓰며 CSS class가 자주 바뀐다. 고정 CSS selector 대신 **ancestor walking** 방식 사용:
  ```python
  from app.collectors.filters import extract_naver_result_date
  pub_date = extract_naver_result_date(a_tag)  # node의 조상 체인을 10단계까지 올라가며 날짜 텍스트 탐색
  ```
- `_parse_korean_date_text()` 가 다음 패턴 모두 처리:
  - 절대: "2026.04.10." / "2026-04-10" / "2026/04/10"
  - 상대: "N시간 전", "N일 전", "N분 전", "N주 전", "어제", "오늘", "방금"
- 새 스크래퍼 추가 시 이 헬퍼 사용 필수. 2026-04-12 이전에 4곳이 `pub_date: None`으로 하드코딩되어 커뮤니티 1260건이 NULL로 저장되는 사고 발생.

**중복 수집 시 NULL 백필**:
- `ON CONFLICT DO UPDATE SET published_at = COALESCE(existing, EXCLUDED.published_at)` 패턴으로 기존 NULL 행을 자동 백필.
- YouTube는 `exists.published_at is None and new_pub is not None:` 조건으로 explicit 업데이트.
- 이렇게 하면 다음 수집에서 같은 URL을 다시 만났을 때 자동으로 날짜가 채워진다.

### 1.8. 정렬 규칙
시간 기반 목록은 **`published_at` 역순 ONLY**. 우리 후보 가중치 / 우선 표시 금지. 필터는 필터 UI로 분리.

### 1.9. 사건(event) vs 행동(action) 분류
4사분면 분류 핵심 룰:
- **우리 후보 능동 발표·해명·항의·주장·공개** → `strength` (사건이 부정적이어도 우리 행동은 강점)
- **우리 후보가 외부에 의해 비판/논란/의혹** → `weakness` (실제 위기)
- **경쟁 후보 약점 노출** → `opportunity`
- **경쟁 후보 성과·발표** → `threat`
- **제3자/일반** → `neutral`

### 1.10. 멀티테넌트 공용 데이터 공유 원칙 (2026-04-14 정공법 구현 완료)
- **공용 (tenant_id 없음)**: `election_law_sections`, `PastElection`, 공공 `Survey`, `NEC` 데이터
- **election-shared (election_id 기반, tenant_id nullable)**: 같은 선거의 원본 수집 데이터 (news_articles / community_posts / youtube_videos)
  - `UNIQUE (election_id, url)` — 같은 URL 중복 저장 금지, 모든 캠프 공유
  - 공유 필드: title, content_snippet, sentiment, ai_summary, ai_reason, is_relevant, published_at 등
- **camp-private**: 캠프별 4사분면/action 관점 분석은 신규 테이블 `*_strategic_views`에 저장
  - `news_strategic_views`, `community_strategic_views`, `youtube_strategic_views`
  - `UNIQUE (source_id, tenant_id)` — 같은 데이터에 대한 캠프별 관점 분석
  - 필드: strategic_quadrant, action_type, action_priority, action_summary, is_about_our_candidate
- **수집/조회 룰**:
  - 수집: `pg_insert().on_conflict_do_update(constraint="uq_*_per_election")` 사용
  - 조회: raw 데이터는 `WHERE election_id = X`만, 관점 필요 시 LEFT JOIN + `COALESCE(sv.x, raw.x)`
  - 같은 election 60분 내 다른 캠프가 수집했으면 스킵 (race-shared), 관점 분석은 캠프별 생성

### 1.14. RAG 벡터 검색 (2026-04-14 구축)
- **임베딩 모델**: Ollama `bge-m3` (1024차원, 한국어 지원, 로컬, 무료)
- **벡터 저장**: PostgreSQL `pgvector` 확장 (`pgvector/pgvector:pg16` 이미지)
- **embeddings 테이블**: tenant_id × source_type × source_id
- **자동 임베딩 훅**:
  - 수집 파이프라인 완료 후 (`_run_full_ai_pipeline`)
  - 보고서 생성 직후 (`reports/router.py`)
- **챗 컨텍스트**: RAG 검색 최우선 (질문 관련 상위 10건) + 의도별 보충 (감성/트렌드/여론조사/법조문)
- **토큰 절약**: 기존 ~33,000 → RAG ~3,000 (90% 절감)
- **단일 진입점**: `app.services.embedding_service` (create_embedding, store_embedding, search_similar, embed_existing_data)

### 1.15. AI 자동 동명이인 감지 + 학습 (2026-04-14)
- 가입자는 homonym_filters 입력 불필요 — AI가 문맥으로 자동 감지
- AI 스크리닝/분석 프롬프트에 `homonym_detected` 필드 요청
  - 예: "야구감독", "국회의원 서천", "대학교수"
- 감지 시 `candidates.homonym_filters` jsonb 배열에 자동 누적 (최대 20개)
- 다음 분석부터 프롬프트에 포함되어 정확도 향상 (누적 학습)
- 캠프별 격리 (tenant_id × name 기준 업데이트)

### 1.16. 출처 각주 + WebSearch + 사실 기반 답변 (2026-04-15)
- **항상 WebSearch 허용** — ai_service.call_claude(web_search=True)
  - CLI 옵션: `--permission-mode default --allowedTools WebSearch,WebFetch`
  - 내부 DB에 없는 정보는 AI가 직접 웹 검색하여 사실 확인
- **출처 각주 필수**:
  - 내부 데이터: `[ref-rag-1]`, `[ref-rt-1]` 등 태그
  - 웹 검색: `[web](URL)` 형식
  - NEC 공식: `[ref-nec-xxx]`
- **citations 배열 응답**: id, type, title, url, source, published_at, preview
- **클릭 팝업**: components/chat/CitationBadge.tsx — 원문 링크 + 요약 표시

### 1.17. 후보자 공식 프로필 (info.nec.go.kr) (2026-04-15)
- `candidate_profiles` 테이블: 학력/경력/재산/병역/납세/전과/선관위공약/생년월일/주소
- DB 캐시 있으면 즉시 답변, 없으면 AI가 WebSearch로 info.nec.go.kr 조회
- 챗/토론/콘텐츠 모두 활용

### 1.18. 일일 보고서 자기 재귀 금지 (2026-04-15)
**ai_report.py는 camp_memory 호출 시 max_reports=0, max_briefings=0 필수.**
- Why: 보고서 생성 프롬프트에 이전 보고서를 다시 넣으면 AI가 혼동 → "작성 완료" 메타답변 (500자)
- 챗/토론/콘텐츠는 정상 작동 (자기 자신 재귀 아님)
- 연속성은 `prev_reports` 300자 요약 주입으로 대체

### 1.19. 쉬운 모드 + 전문가 모드 (2026-04-15)
- 두 모드 공존: `/easy/*` (비전문가) + `/dashboard/*` (전문가)
- localStorage `preferred_mode` = "easy" | "expert"
- 신규 가입자 기본값: `/easy`
- 전환 버튼: 쉬운 모드 상단 sticky 헤더 / 전문가 헤더 우측
- `/easy/{news,candidates,surveys,trends,youtube,debate,schedules}` 는 dashboard 컴포넌트 재사용
- `/easy` 레이아웃: 2단계 사이드바 + FloatingAssistant (모든 페이지 우하단 챗)

### 1.20. Next.js 쿠키 세팅 — `NextResponse.cookies.set()` 필수 (2026-04-18)
**Route Handler에서 `cookies().set()` 금지. 반드시 `response.cookies.set()` 사용.**
- Why: App Router에서 `NextResponse.json()` 또는 `NextResponse.redirect()`로 새 응답을 생성해 반환하면, `cookies().set()`의 쿠키가 응답 Set-Cookie 헤더에 **누락되는 사례**가 있음.
- 2026-04-18 사고: homepage `/sso`, `/api/auth/{login,register}`, `/{code}/api/auth/login` 4곳이 `cookies().set()`으로 `mh_session` 설정 → 실제 응답에 쿠키 안 붙음 → 로그인/SSO 직후 재로그인 루프 (수 회 신고됨).
- **통합 헬퍼 사용 필수**: `homepage/src/lib/auth.ts`의 `applySessionCookies(response, sessionId, userType, code, rememberMe)`.
- 검수는 grep만으로 불충분. **실제 `curl -i`로 Set-Cookie 헤더 확인** 또는 브라우저 DevTools Network 탭 확인.

### 1.21. 컨테이너 TZ=Asia/Seoul 고정 (2026-04-18)
**ep_backend, ep_celery_worker, ep_celery_beat 환경변수에 `TZ=Asia/Seoul` 필수.**
- Why: Docker 기본 TZ는 UTC. `date.today()`, `datetime.now()`(naive)가 UTC 기준 반환 → KST 오전 09:00 이전 실행되는 브리핑/스케줄이 **어제 날짜로 저장**되는 버그 (사용자가 "오늘 오전 브리핑이 어제 날짜로 표기" 라고 보고).
- 위치: `docker/docker-compose.yml`의 backend/celery-* 서비스 `environment:` 섹션.
- 코드 내 `datetime.now(timezone.utc)`는 명시적 UTC라 OK. 문제는 naive `date.today()`와 `datetime.now()`.

### 1.23. NPM 라우팅 — homepage 전용 API 분리 (2026-04-18)
**두 Next.js 앱(mybot frontend + homepage)이 같은 `ai.on1.kr` 도메인에 공존하므로 `/api/*` 라우팅이 충돌한다.**

- mybot backend: `/api/auth/login`, `/api/auth/refresh` 등 대시보드용 API
- homepage: `/api/site/*`, `/api/analytics/*`, `/api/auth/me`, `/api/auth/logout` 등 관리자 편집용

**NPM custom conf 라우팅 규칙 (`/data/nginx/custom/server_proxy.conf`)**:
- `^~ /api/site/` → ep_homepage (homepage admin UI 데이터 + auth/me/logout)
- `^~ /api/analytics/` → ep_homepage
- `^~ /api/public/` → ep_homepage (후보 홈페이지 렌더링용 공개 API)
- `^~ /api/` (나머지) → ep_backend (mybot 분석 API — auth/me/logout 포함)

**왜 이 순서가 중요한가**: nginx `^~` prefix는 **길이순 우선 매칭**. `^~ /api/site/` 가 `^~ /api/` 보다 구체적이므로 먼저 매칭됨.

**핵심 룰 (2026-04-20 정정)**: **두 앱이 같은 path를 공유하면 안 된다.** 같은 path를 공유하면 NPM이 한쪽으로만 라우팅 → 반대쪽은 항상 401 → 무한 refresh 루프 → 세션 만료. homepage 자체 path는 모두 `/api/site/*` prefix 또는 `/api/public/*` prefix 아래로 격리할 것. 

**증상 1 (2026-04-18 사고)**: homepage admin 페이지에서 좌측 메뉴 클릭 → 내부 API(`/api/site/blocks` 등) 호출 → NPM이 모두 mybot backend로 보냄 → mybot에 해당 route 없음 → 404/403 → UI 깨짐. 해결: homepage 전용 `/api/site/*` prefix 추가.

**증상 2 (2026-04-20 사고)**: 위 사고 대응으로 `= /api/auth/me`, `= /api/auth/logout` 도 homepage 전용 룰로 박았음. 그러나 mybot dashboard `Header.tsx`도 같은 `/api/auth/me` 호출 → homepage가 Bearer JWT 모름 → 401 → frontend 가 refresh 시도 → 새 토큰으로 retry → 또 homepage로 가서 401 → `_redirectToLogin()` → "세션 만료" 페이지로 강제 이동. 사용자: "전문가 모드 들어가면 무조건 세션 만료". 해결: homepage `/api/auth/{me,logout}` route를 `/api/site/auth/{me,logout}` 으로 이동, NPM의 exact-match 룰 제거.

**새 API 추가 시 체크리스트**:
1. homepage가 `/api/X` 새로 만들면 → 반드시 `/api/site/*` 또는 `/api/public/*` prefix 안에 만들 것. 두 앱이 path를 공유하면 안 됨.
2. mybot 신규 path가 homepage path와 충돌 안 하는지 확인.
3. NPM 룰에 `= /api/...` exact-match 추가는 **금지** — 한 앱이 path 점유하는 형태가 되어 다른 앱이 동일 path 호출 시 위 증상 2 재현.

### 1.25. 배포 즉시 반영 — Next.js 정적 캐시 금지 (2026-04-20)
**Next.js App Router 기본 `s-maxage=31536000`(1년 CDN 캐시)이 브라우저에 전파되어 "배포해도 안 바뀌어 보임" 문제가 반복됨.** 근본 차단:
- `/app/layout.tsx` 에 `export const dynamic = 'force-dynamic'` + `export const revalidate = 0` (Root 서버 컴포넌트)
- `next.config.js` `headers()`로 `/:path((dashboard|easy|admin|onboarding)(/.*)?)`에 `Cache-Control: no-cache, no-store, must-revalidate` 강제
- 인증 페이지는 사용자별 데이터라 정적 캐시 이득이 없음 — 무조건 fresh 서빙이 맞다.
- 새 인증 라우트 추가 시 `next.config.js` source 정규식에 포함시켜야 함.

**검증**: `curl -I https://ai.on1.kr/easy/news` 응답 헤더에 `Cache-Control: no-cache, no-store` 있어야 함. 만약 `s-maxage=31536000`이 찍히면 설정이 안 먹은 것.

### 1.24. 외부 API rate limit은 Redis 전역 (2026-04-20)
**프로세스 로컬 throttle은 거짓 안전감. 여러 Celery worker 병렬이면 합산 초과 가능.**
- 외부 API에 rate limit 있으면 반드시 **Redis 공유 토큰 버킷** 기반. `{api}:rate:{epoch_second}` incr + TTL 3초 패턴.
- 키 로테이션 지원 시 `_exhausted_at` 클래스 변수 + `_mark_exhausted_and_rotate()` (YouTube/Naver 패턴 동일).
- 일일 사용량 카운터 `{api}:usage:YYYY-MM-DD` + 80%/100% 경보 로그 필수.
- 2차 키는 `{KEY_NAME}_2` 컨벤션. Config에 필드 + .env.server에 값 + Collector 생성자에 전달.
- 2026-04-20 네이버 근본 해결 참고 — 프로세스 로컬 `_throttle_naver` → Redis `naver:rate:*` 전환.

### 1.22. 보고서/브리핑 PDF 정책 (2026-04-18 확정)
| 시간(KST) | 타입 | 텍스트 | 텔레그램 | 메일 | PDF |
|---|---|---|---|---|---|
| 07:00 | 오전 브리핑 | ✓ | ✓ | ✓ (SMTP 설정 시) | ✗ |
| 13:00 | 오후 브리핑 | ✓ | ✓ | ✓ | ✗ |
| 18:00 | 일일 보고서 | ✓ | ✓ | ✓ | ✓ |
| 월 09:00 | 주간 보고서 | ✓ | ✓ | ✓ | ✓ |

- PDF는 `tasks.py` `_run_briefing`의 `if briefing_type == "daily"` + `_run_weekly_report` 두 경로에서만 생성.
- 오전/오후는 의도적으로 PDF 제외 — 모바일 텔레그램/메일로 빠르게 훑는 용도.

### 1.13. 온보딩 시 선거 중복 생성 금지 (2026-04-13)
가입 시 동일한 선거가 이미 존재하면 **새로 만들지 않고 기존 election을 재사용**한다.
- 매칭 키: `election_type + region_sido + region_sigungu + election_date`
- **시도 단위 선거** (교육감 `superintendent`, 도지사 `governor`): `region_sigungu` 무시하고 매칭
- 기초 단위 선거 (시장, 구청장, 의원 등): `region_sigungu` 포함 매칭
- 기존 선거 있으면 → `tenant_elections`에 연결만 추가 + 후보 생성
- 없으면 → 새 Election 생성 (기존 동작)
- **election_name**: 프론트엔드에서 자동 생성 (`2026 {시도} {선거유형} 선거`), 사용자 자유 입력 금지

### 1.11. 검증 없이 완료 선언 금지
수정 작업은 반드시 다음 순서로 진행:
1. 코드 수정
2. **실제 데이터로 CLI 실행** (5명 테스트 후보 대상)
3. **DB 쿼리로 결과 확인** (숫자·필드·조건 검증)
4. **로그 확인** (`ai_via_tenant_api` / `assigned_cli` / `claude_json_ok` 나오는지)
5. 4가지 모두 OK일 때만 "완료" 선언 가능

실패하면 "다음 단계로 가서 어떻게든 되게 한다" 금지. 원인 찾아서 고친다.

---

## 2. 아키텍처 요구사항

### 2.1. 기술 스택 (고정)
- **Backend**: FastAPI (async) + Celery (beat + workers) + PostgreSQL + Redis
- **Frontend**: Next.js, **포트 3100** (3000/3001 금지)
- **AI**: Claude CLI subprocess (기본) + Anthropic API (고객 키 사용 시)
- **DB 포트**: 5440 (**127.0.0.1 only** — 외부 노출 금지)
- **Redis 포트**: 6380 (**127.0.0.1 only** — 외부 노출 금지)
- **Docker 배포**: GitHub Actions → GHCR → Watchtower 자동 배포 (2026-04-12 구축)
  - Dockerfile.api에 Node.js + Claude CLI 포함
  - 호스트 `~/.claude-server` → 컨테이너 마운트 (**:rw** — 토큰 갱신 필요)
    - **중요 (2026-05-07)**: 호스트 cho 본인의 `~/.claude`와 **반드시 분리**. 같은 디렉토리 공유 시 컨테이너 keepalive(4h)가 OAuth refresh token을 회전시켜 호스트 cho의 Claude Code가 자꾸 로그아웃됨 (rotation 충돌).
    - `.claude-server/.credentials.json` 만 있으면 됨. settings.json은 선택. projects/sessions/는 컨테이너가 자체 생성.
  - Nginx Proxy Manager: `ai.on1.kr` → `ep_frontend:3000`
  - **포트 바인딩 룰**: `ports: "127.0.0.1:PORT:PORT"` 형식 필수 (2026-04-14 보안 사고)
  - **DB/Redis 호스트명**: `ep_postgres`, `ep_redis` 사용 (서비스명 `postgres`/`redis` 금지 — 같은 네트워크의 mk_postgres와 DNS 충돌, 2026-04-14)
  - Claude CLI 토큰 keep-alive: Celery beat 4시간 주기 (`system.claude_token_keepalive`)

### 2.2. 수집 → AI 스크리닝 → 분석 파이프라인 (2026-04-13 개정)
```
[스케줄러 / 수동 수집]
    ↓ (선거·캠프별 트리거)
[Collector] naver.py / youtube.py / community_collector.py
    ↓
[수집 시점 게이트 (코드 필터)]
   - 날짜 컷오프 (7일)
   - homonym_filters (GLOBAL + 후보별)
   - 품질 필터 (views, 광고 패턴)
   - 후보 이름 본문 포함 필수
    ↓
[AI 스크리닝] ai_screening.screen_collected_items() ← 2026-04-13 신규
   - 수집된 raw 데이터를 DB 저장 전에 AI로 필터링
   - 동명이인 구분 (야구감독/야구선수/국회의원 등)
   - 후보별 homonym_hints를 AI 프롬프트에 명시적 전달
   - is_relevant=false → DB에 저장하지 않음
   - 통과한 항목에 감성/전략/요약도 바로 채움
   - AI 실패 시 기존 동작 유지 (전부 통과)
    ↓
[DB 저장] is_relevant=true인 항목만 + AI 필드 채워진 상태로
    ↓
[AI 배치 분석 (미분석 보완)] media_analyzer.analyze_batch_strategic()
   - 8~10개씩 Sonnet 호출 (뉴스/유튜브/커뮤니티 3매체 병렬 — asyncio.gather)
   - homonym_hints를 프롬프트에 포함
   - is_relevant 결과를 DB에 반영
    ↓
[Opus 검증] sentiment.verify_batch_with_opus()
   - positive/negative 5개씩 재확인
   - sentiment_verified = TRUE 기록
    ↓
[후속 트리거]
   - ScheduleRun 기록
   - 텔레그램 브리핑
   - 일일 보고서 큐
```

**수집과 분석은 분리되지 않는다.** 수집 직후 같은 태스크 안에서 분석이 끝나야 하며, DB에 저장되는 시점에는 모든 AI 필드가 채워져 있어야 한다.

### 2.2.1. is_relevant 필터링 (2026-04-13 추가)
- `news_articles`, `community_posts`, `youtube_videos` 테이블에 `is_relevant BOOLEAN DEFAULT true` 컬럼
- AI 분석 시 동명이인/무관 판정 → `is_relevant = false` 업데이트
- **모든 대시보드 쿼리에 `WHERE is_relevant = true` 필터 적용** (23개 쿼리 수정됨)
- 날짜 정렬: `ORDER BY published_at DESC NULLS LAST, collected_at DESC` 통일

### 2.2.2. 데이터 삭제 기능 (2026-04-13 추가)
- 사용자가 오염된 수집 데이터를 직접 삭제 가능
- `DELETE /analysis/news/{id}`, `DELETE /analysis/community/{id}`, `DELETE /analysis/youtube/{id}`
- 삭제 시 `audit_logs`에 기록
- 프론트엔드: 모든 데이터 목록(뉴스/유튜브/커뮤니티)에 삭제 버튼 + "AI 자동수집 데이터입니다. 오류 발견 시 삭제해주세요" 안내

### 2.2.3. 챗 대화 이력 저장 (2026-04-13 추가)
- `chat_messages` 테이블: tenant_id, election_id, user_id, role(user/ai), content, model_tier, created_at
- `/chat/send` 시 질문+응답 자동 저장
- `/chat/history`: 이전 대화 불러오기 (페이지 재진입 시 복원)
- `/chat/message/{id}` DELETE: 개별 메시지 삭제
- `/chat/history` DELETE: 전체 대화 초기화

### 2.2.5. 스케줄 구조 (2026-04-13 개정)
```
07:00~20  오전 수집+브리핑 (full_with_briefing) — 수집+분석+오전 브리핑
13:00~20  오후 수집+브리핑 (full_with_briefing) — 수집+분석+오후 브리핑
17:30~50  마감 수집 (full_collection) — 수집+분석만 (보고서 전 데이터 확보)
18:00~20  일일 종합 보고서 (briefing) — 보고서+PDF+텔레그램만 (수집 안 함)
09:00~20  주간 전략 보고서 (weekly_report) — 월요일만
```
- 캠프별 0~14분 오프셋 자동 분산 (AI 부하 분산)
- `task_time_limit = 1800초` (30분)
- 같은 election에서 60분 이내 수집 완료 시 → 다른 캠프는 수집 스킵, AI 관점 분석만

### 2.2.4. 모델 Tier 배정 (2026-04-13 확인/수정)
| 기능 | 모델 | 변경 |
|---|---|---|
| 수집 AI 스크리닝 | Sonnet | - |
| 배치 분석 (4분면) | Sonnet | - |
| Opus 검증 | Opus | - |
| 보고서 생성 | Opus | - |
| 콘텐츠 생성 | **Opus** | Sonnet→Opus 변경 |
| 멀티톤 | **Opus** | Sonnet→Opus 변경 |
| 토론 대본 | Opus | - |
| 챗 기본 | Sonnet | - |
| 챗 선택 | Opus | 사용자 선택 |

### 2.3. 모델 Tier 매핑 (`ai_service.py` `DEFAULT_TIER`)
변경 금지. 추가는 가능.

### 2.4. 데이터 저장 필드 (수집물 공통) — 2026-04-14 구조 변경
**원본 테이블** (news_articles / community_posts / youtube_videos — **election-shared**):
- `election_id`, `candidate_id`, `url`, `title`, `platform`
- `tenant_id` (nullable, 첫 수집 캠프 기록용 legacy)
- `published_at` (필수, NULL 금지), `collected_at`
- `is_relevant` (BOOLEAN — AI 판별: 동명이인 등 false, 공유 필드)
- **공유 AI 필드**:
  - `ai_summary`, `ai_reason`, `ai_topics`, `ai_threat_level`
  - `sentiment`, `sentiment_score`, `sentiment_verified`
- UNIQUE 제약: `(election_id, url)` — 같은 선거의 같은 URL은 1건만 저장

**관점 테이블** (news_strategic_views / community_strategic_views / youtube_strategic_views — **camp-private**):
- `news_id` (또는 post_id, video_id) → 원본 FK
- `tenant_id`, `election_id`, `candidate_id`
- `strategic_quadrant` (strength/weakness/opportunity/threat/neutral)
- `strategic_value`, `action_type` (promote/defend/attack/monitor/ignore)
  - `action_priority` (high/medium/low)
  - `action_summary`
  - `is_about_our_candidate`
  - `ai_analyzed_at`

### 2.5. 신규 가입 자동화
- 캠프 가입 → 선거·후보·키워드·스케줄 생성 (`onboarding.apply`)
- 즉시 과거 선거 기록 로드, 즉시 첫 수집 실행
- 부트스트랩 상태를 폴링 가능한 엔드포인트 필요 (`/elections/{id}/bootstrap-status`)
- 사용자는 "가입 후 아무것도 안 해도" 모든 페이지가 채워져야 함

### 2.6. RAG / 챗 / 토론 / 콘텐츠 — 플랫폼 최종 목표
수집·분석된 모든 자료는 다음에 활용된다:
- **챗 분석**: 캠프 전용 챗봇이 저장된 데이터를 근거로 답변 ("나만의 AI")
- **토론 대본 생성**: 경쟁 후보 약점 + 우리 강점 데이터 기반
- **콘텐츠 생성**: 블로그·유튜브·SNS 주제를 실제 데이터에서 추출
- **일일 보고서·브리핑**: 감성 검증된 데이터만 반영

→ 저장 구조는 풀텍스트 검색 가능(`tsvector`)하고, 향후 임베딩 추가 가능한 형태여야 한다.

---

## 3. 작업 원칙

### 3.1. 실증 테스트 대상 (5명 후보)
- Tenant: `5403b830-0087-435c-8375-7ef2fc600eb6`
- Election: `e0eacdb9-d1e2-494c-860f-abd719dbd206`
- 우리 후보: 김진균
- 경쟁 후보: 조동욱, 김성근, 신문규, 윤건영

모든 수집·분석 관련 수정은 이 5명으로 실제 실행 후 DB 확인으로 검증한다.

### 3.2. 작업 진행 방식
1. PLAN.md 체크리스트에 따라 하나씩 진행
2. 각 단계: 코드 수정 → 실제 실행 → DB/로그 검증 → 체크 → 다음
3. 실패 시 해결 후 재검증. "안 되면 건너뛰기" 금지.
4. "자동화 작업" 시에도 각 단계마다 **명시적 검증**이 있어야 함
5. 기존 동작 자료 공간 정리하지 말 것 — 테스트 후보가 등록되어 있는 DB는 귀중한 자원

### 3.3. 플랜 / 체크리스트 위치
- **PLAN.md** (프로젝트 루트): 현재 작업 중인 전체 체크리스트
- **TaskCreate 도구**: 세션 내부 진행 상황 추적
- 두 곳이 일치해야 함

### 3.4. 코드 품질
- 불필요한 주석 금지. WHY가 비자명할 때만 한 줄.
- 불필요한 추상화 금지. 3번 반복되기 전에는 함수로 빼지 말 것.
- 사용되지 않는 함수·경로 발견 시 삭제 (특히 AI 호출 우회 경로)
- "backwards-compat" 핑계로 죽은 코드 남겨두지 말 것

### 3.5. DB 마이그레이션 원칙
- 기존 컬럼 삭제·이름 변경 전에 사용자 확인
- 새 컬럼은 NULLABLE로 추가 후 백필, 그 다음 NOT NULL 전환
- 실제 데이터가 있는 테이블은 함부로 TRUNCATE 금지

---

## 4. 자주 실수하는 패턴 (금지 목록)

- ❌ "비용 절감을 위해 Haiku로 전환하자"
- ❌ `_keyword_analysis_conservative()` 같은 폴백을 메인 경로에 연결
- ❌ `asyncio.create_subprocess_exec("claude", ...)` 로 AI 직접 호출
- ❌ `subprocess.run("claude", ...)` 로 AI 직접 호출  
- ❌ 수집과 AI 분석을 별도 job으로 분리 (사용자는 그 사이 빈/잘못된 데이터를 봄)
- ❌ published_at 없어서 drop vs collected_at으로 대체 vs 0값 넣기 — 정책 혼재
- ❌ "일단 저장하고 나중에 AI로 정리" (DB가 먼저 더러워짐)
- ❌ 가짜 완료 선언: 파일만 편집하고 실제 실행 없이 "됐습니다"
- ❌ 실패 시 해당 단계 주석 처리하고 다음 단계 진행
- ❌ Claude CLI를 API로 교체하자는 제안 (CLI subprocess가 기본 아키텍처임)
- ❌ **Route Handler에서 `cookies().set(...)`** — `NextResponse.json/redirect` 반환 시 응답에 안 붙음 (2026-04-18 재로그인 버그). 반드시 `response.cookies.set(...)` 또는 `applySessionCookies()` 헬퍼 사용.
- ❌ **일괄 이모지/치환 스크립트로 모든 .tsx 파일을 밀어버리기** — 2026-04-18 사고: `{ icon: '🎤' }` 형태를 정규식으로 일괄 삭제 → AI 비서 버튼 본문이 빈 `<button></button>`이 됨 (닫힌 상태 버튼, 닫기 X 버튼 등). 이모지 제거는 **컴포넌트별 UI 맥락 확인 후** 개별 결정: (a) 완전 제거 (b) 단색 라인 SVG로 교체 (c) 의도적 유지 (경고 문구 등). 그리고 빈 `{prop}` 참조 JSX는 반드시 제거해 레이아웃 깨지지 않게.
- ❌ **grep/정적 검수만으로 "수정 완료" 선언** — 2026-04-18 재로그인 사고: sameSite strict→lax grep 확인만으로 완료 선언했으나 실제 원인은 쿠키 전달 자체 실패. 인증/세션/쿠키 수정은 반드시 **`curl -i`로 Set-Cookie 응답 헤더** 또는 **브라우저 DevTools Network 탭**으로 실제 동작 확인.
- ❌ **컨테이너 TZ 무시** — Docker 기본 UTC에서 `date.today()` 쓰면 KST 새벽 시간대에 날짜가 하루 밀림. `TZ=Asia/Seoul` 환경변수 필수 (1.21 참조).

---

## 5. 참고 — 주요 파일 위치

### Backend 핵심
- `backend/app/services/ai_service.py` — 모든 AI 호출의 단일 진입점 (`--system-prompt`, `web_search` 파라미터)
- `backend/app/services/embedding_service.py` — RAG 벡터 임베딩 (Ollama bge-m3) + 검색
- `backend/app/services/camp_context.py` — 캠프 학습 데이터 (보고서/브리핑 전문) **※ ai_report.py는 max_reports=0으로 호출 필수**
- `backend/app/services/rich_context.py` — 챗/토론/콘텐츠 공용 컨텍스트 빌더 + LEGAL_SAFETY_PROMPT
- `backend/app/services/realtime_search.py` — 네이버 뉴스 48시간 실시간 조회
- `backend/app/services/today_actions.py` — 쉬운 모드 홈 우선순위 액션 추천
- `backend/app/services/easy_router.py` — `GET /api/easy/today/{election_id}`
- `backend/app/collectors/tasks.py` — Celery 스케줄 수집 (election-shared upsert)
- `backend/app/collectors/instant.py` — 사용자 트리거 즉시 수집
- `backend/app/collectors/ai_screening.py` — 수집 단계 AI 스크리닝 + 동명이인 자동 학습
- `backend/app/analysis/media_analyzer.py` — 4사분면 배치 분석 (3매체 병렬, 동명이인 학습)
- `backend/app/analysis/strategic_views.py` — 캠프별 관점 분석 upsert 헬퍼
- `backend/app/chat/router.py` — AI 챗 + 시스템 프롬프트 (사실 기반 출처 각주 7원칙)
- `backend/app/chat/context_builder.py` — 챗 컨텍스트 (RAG + 실시간 + 과거선거 + 프로필 + 선거법)
- `backend/app/elections/onboarding.py` — 캠프 가입 + 완료 검증 (후보/선거 연결 필수)
- `backend/app/elections/models.py` — ORM: Candidate(election-shared) + CandidateProfile + *_StrategicView
- `backend/app/elections/history_router.py` — `GET /api/history/election-history/by-region/{id}` (후보 비교용)
- `backend/app/common/election_access.py` — 선거 접근 권한 + list_election_candidates 헬퍼
- `backend/app/content/compliance.py` — 선거법 10개 조항 전문 (AI 검증)
- `backend/app/reports/ai_report.py` — **max_reports=0, max_briefings=0 (자기 재귀 금지)**
- `backend/migrations/2026_04_14_election_shared_data.sql` — election-shared 구조 전환
- `backend/migrations/2026_04_15_candidates_shared.sql` — Candidate 통합

### Frontend
- `frontend/src/app/dashboard/` — 전문가 모드 (기존 모든 페이지)
- `frontend/src/app/easy/` — 쉬운 모드 (Phase 7)
  - `layout.tsx` — 2단계 사이드바 + sticky 헤더 + FloatingAssistant
  - `page.tsx` — Today's Action 홈
  - `assistant/page.tsx` — AI 비서 풀스크린
  - `content/page.tsx` — 3단계 마법사
  - `reports/page.tsx` — 유형선택 + PDF 미리보기
  - `{news,candidates,surveys,trends,youtube,debate,schedules}/page.tsx` — dashboard 컴포넌트 재사용
- `frontend/src/app/admin/` — 관리자 패널 (7개 페이지)
- `frontend/src/app/onboarding/page.tsx` — 가입 UI (기초단체장은 시군구 포함)
- `frontend/src/components/easy/FloatingAssistant.tsx` — 모든 페이지 우하단 부동 챗
- `frontend/src/components/chat/CitationBadge.tsx` — 출처 각주 인라인 배지 + 모달 팝업

---

## 6. 메모리 시스템

자세한 결정 이력·사용자 피드백·세션별 컨텍스트는 다음 경로의 메모리 파일에 누적되어 있다:
`/Users/jojo/.claude/projects/-Users-jojo-pro-mybot/memory/`

- `MEMORY.md` (인덱스)
- 각 주제별 `*.md` 파일

이 CLAUDE.md는 **아키텍처와 절대 룰**만 담고, 세션별 진행 상황은 메모리 시스템이 관리한다.
