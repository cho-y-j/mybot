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

### 1.10. 멀티테넌트 공용 데이터 공유 원칙
- **공용 (tenant_id 없음)**: `election_law_sections`, `PastElection`, 공공 `Survey`, `NEC` 데이터
- **race-shared (election_id 기반, tenant_id 없음)**: 같은 선거의 뉴스/미디어는 race 단위로 한 번만 수집하는 것이 목표 (Phase 2)
- **camp-private (tenant_id)**: 캠프 내부 메모, 커스텀 키워드, 사설 여론조사, 4사분면 관점 분석

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
- **DB 포트**: 5440 (localhost)
- **Redis 포트**: 6380 (localhost)

### 2.2. 정상 수집 → 분석 파이프라인 (이대로 되어야 함)
```
[스케줄러] 
    ↓ (선거·캠프별 트리거)
[Collector] naver.py / youtube.py / community_collector.py
    ↓
[수집 시점 게이트]
   - 날짜 컷오프 (7일)
   - homonym_filters
   - 품질 필터 (views, 광고 패턴)
    ↓
[AI 배치 분석] media_analyzer.analyze_batch_strategic() 
   - 8~10개씩 Sonnet 호출 (call_claude 경유)
   - 반환: is_relevant, summary, reason, sentiment, 
           sentiment_score, strategic_value, action_type,
           action_priority, action_summary, topics, threat_level
    ↓
[관련성 드롭] is_relevant=false 저장 안 함
    ↓
[Opus 검증] sentiment.verify_batch_with_opus()
   - positive/negative 5개씩 재확인
   - sentiment_verified = TRUE 기록
    ↓
[DB 저장]
    ↓
[후속 트리거]
   - ScheduleRun 기록
   - 텔레그램 브리핑
   - 일일 보고서 큐
```

**수집과 분석은 분리되지 않는다.** 수집 직후 같은 태스크 안에서 분석이 끝나야 하며, DB에 저장되는 시점에는 모든 AI 필드가 채워져 있어야 한다.

### 2.3. 모델 Tier 매핑 (`ai_service.py` `DEFAULT_TIER`)
변경 금지. 추가는 가능.

### 2.4. 데이터 저장 필드 (수집물 공통)
- `tenant_id`, `election_id`, `candidate_id`, `url`, `title`, `platform`
- `published_at` (필수, NULL 금지), `collected_at`
- **AI 필드** (모두 수집 시점에 채워져야 함):
  - `ai_summary`, `ai_reason`, `ai_topics`, `ai_threat_level`
  - `sentiment`, `sentiment_score`, `sentiment_verified`
  - `strategic_value` (strength/weakness/opportunity/threat/neutral)
  - `action_type` (promote/defend/attack/monitor/ignore)
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

---

## 5. 참고 — 주요 파일 위치

### Backend 핵심
- `backend/app/services/ai_service.py` — 모든 AI 호출의 단일 진입점
- `backend/app/collectors/tasks.py` — Celery 스케줄 수집 태스크 (1700+줄, 분리 예정)
- `backend/app/collectors/instant.py` — 사용자 트리거 즉시 수집
- `backend/app/collectors/naver.py` — 네이버 뉴스/블로그/카페
- `backend/app/collectors/youtube.py` — YouTube Data API
- `backend/app/analysis/sentiment.py` — 감성 분석 (SentimentAnalyzer)
- `backend/app/analysis/media_analyzer.py` — 4사분면 배치 분석
- `backend/app/elections/onboarding.py` — 캠프 가입 자동화
- `backend/app/elections/bootstrap.py` — 초기 분석 파이프라인
- `backend/app/elections/models.py` — ORM 모델

### Frontend
- `frontend/src/app/dashboard/` — 주요 대시보드 페이지
- `frontend/src/app/admin/setup/` — 가입 온보딩 UI

---

## 6. 메모리 시스템

자세한 결정 이력·사용자 피드백·세션별 컨텍스트는 다음 경로의 메모리 파일에 누적되어 있다:
`/Users/jojo/.claude/projects/-Users-jojo-pro-mybot/memory/`

- `MEMORY.md` (인덱스)
- 각 주제별 `*.md` 파일

이 CLAUDE.md는 **아키텍처와 절대 룰**만 담고, 세션별 진행 상황은 메모리 시스템이 관리한다.
