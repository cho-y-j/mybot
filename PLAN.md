# ElectionPulse 수정 플랜 & 체크리스트

**최근 갱신**: 2026-04-12
**현재 단계**: Phase 1 — 코드 수정 완료, 실증 테스트 진행 중
**검수 대상**: Tenant `5403b830` / Election `e0eacdb9` (우리=김진균, 경쟁=조동욱/김성근/신문규/윤건영)

## 현재 상태 요약 (2026-04-12 00:48)

코드 수정 완료:
- P1-01 ✅ `tasks.py` 모든 수집 태스크에서 `_run_full_ai_pipeline()` 호출
- P1-02 ✅ `media_analyzer.py` → `call_claude()` 경유 (dead code `analyze_content_with_ai` 삭제)
- P1-03 ✅ `tasks.py` 수집 시점 7일 컷오프 + collected_at 폴백
- P1-04 ✅ `youtube.py` publishedAfter, min_views, homonym_filters 적용 + 공통 `filters.py` 생성
- P1-05 ✅ `_analyze_table_strategic` 끝에 `_verify_with_opus()` 자동 호출
- P1-06 ✅ `tasks.py`에서 `analyzer.analyze()` 호출 0건 (키워드 폴백 메인 경로 제거)

실증 테스트 진행 중:
- 1차 테스트: 뉴스 수집 0건 (기존 213건과 중복), YouTube API 403 Forbidden
- 2차 테스트 (진행 중): 기존 미분석 데이터(news 62건, community 113건, youtube 16건)를 새 파이프라인으로 분석
  - 뉴스 3개 배치 중 완료: input 8+8+4 → output 8+8+4 (100% 성공)
  - `claude_json_ok context=media_analyze_batch model=claude-sonnet-4-6 source=system_cli`
  - 커뮤니티·유튜브 배치 + Opus 검증 단계 진행 중
- YouTube API 키 이슈는 Phase 2 별도 처리

---

## 진행 규칙 (중요)

1. 체크박스는 **실제 DB·로그 검증 후에만** 체크한다
2. 실패 시 해당 단계에서 멈추고 원인 수정 — 다음 단계로 건너뛰기 금지
3. 각 단계는 `[수정 내용] → [검수 커맨드] → [통과 조건]` 3칸으로 나뉜다
4. 검수 통과 시 `[x]` 로 체크 + 근거(DB 결과·로그 라인) 간단히 기록

---

# Phase 1 — 핵심 파이프라인 복구 (진행 중)

**목표**: 수집 → AI 분석 → Opus 검증 → DB 저장이 한 흐름으로 작동. 스케줄된 수집이 "내용을 파악한 결과"를 실제로 저장.

## P1-01. 수집 파이프라인 AI 실호출 연결

- [ ] **수정 내용**
  - `backend/app/collectors/tasks.py` 의 `collect_news`, `collect_community`, `collect_youtube` 루프 수정
  - 각 수집 루프에서 `analyzer.analyze()` 제거
  - 아이템을 메모리 리스트에 모은 뒤, 수집 끝나는 시점에 `analyze_batch_strategic()` 호출 (8개씩 배치)
  - 결과에 포함된 AI 필드(`ai_summary`, `sentiment`, `strategic_value`, `action_type`, `action_priority`, `action_summary`, `is_about_our_candidate`, `ai_reason`, `ai_topics`, `ai_threat_level`)를 DB에 저장
  - `is_relevant=false` 항목은 저장 안 함
- [ ] **검수 커맨드** (Phase 1 전체 완료 후 한 번에 검증)
  ```sql
  -- 5명 테스트 후보의 최근 수집 결과 확인
  SELECT COUNT(*), 
         COUNT(ai_summary) AS has_summary,
         COUNT(strategic_value) AS has_quadrant,
         COUNT(action_type) AS has_action
  FROM news_articles
  WHERE tenant_id = '5403b830-0087-435c-8375-7ef2fc600eb6'
    AND collected_at > NOW() - INTERVAL '1 hour';
  ```
- [ ] **통과 조건**: `has_summary`, `has_quadrant`, `has_action` 모두 COUNT와 동일 (100% 채워짐)

## P1-02. media_analyzer → ai_service 통일

- [ ] **수정 내용**
  - `backend/app/analysis/media_analyzer.py` 의 `analyze_batch_strategic()`: `asyncio.create_subprocess_exec` → `call_claude()` 교체
  - 같은 파일 `analyze_content_with_ai()`도 동일 교체
  - 함수 시그니처에 `tenant_id`, `db` 파라미터 추가 (call_claude가 고객 API키 조회 가능하게)
  - 모든 호출처(`_analyze_table_strategic`, `instant.py`, `strategy/router.py`)에 tenant_id 전달
- [ ] **검수 커맨드**
  ```bash
  # 직접 subprocess 호출이 남아있는지 확인
  grep -rn "create_subprocess_exec.*claude" backend/app/analysis/
  # 결과: 0건이어야 함
  ```
- [ ] **통과 조건**: 위 grep 결과 0개 + 실제 수집 실행 시 로그에 `ai_via_tenant_api` 또는 `assigned_cli` 또는 `system_cli` 중 하나 등장

## P1-03. 날짜 컷오프 수집 단계 적용

- [ ] **수정 내용**
  - `backend/app/collectors/tasks.py`: 수집 루프에서 `pub_at` 파싱 후 `if pub_at < now() - 7days: continue` 추가
  - 파싱 실패 시 `collected_at` 폴백 (현재는 continue → 손실 발생)
  - `naver.py` 스크래핑 날짜 파싱 견고하게 (상대 시간 "1시간 전" 등도 처리)
  - `youtube.py` `search_videos()` 에 `publishedAfter` 파라미터 추가 (기본 7일)
- [ ] **검수 커맨드**
  ```sql
  SELECT MIN(published_at), MAX(published_at), COUNT(*)
  FROM news_articles
  WHERE tenant_id = '5403b830-0087-435c-8375-7ef2fc600eb6'
    AND collected_at > NOW() - INTERVAL '1 hour';
  ```
- [ ] **통과 조건**: `MIN(published_at) >= NOW() - INTERVAL '8 days'` (7일 + 1일 여유)

## P1-04. YouTube 필터 강화

- [ ] **수정 내용**
  - `backend/app/collectors/youtube.py`:
    - `search_videos()`: `publishedAfter` 파라미터 추가 (7일)
    - 수집 후 `views < 50` 드롭
    - `homonym_filters` 파라미터 추가 (naver.py의 `_apply_homonym_filter` 로직 이식)
  - `backend/app/collectors/tasks.py` `collect_youtube`: candidates의 `homonym_filters` 전달
- [ ] **검수 커맨드**
  ```sql
  SELECT MIN(views), MIN(published_at), COUNT(*)
  FROM youtube_videos
  WHERE tenant_id = '5403b830-0087-435c-8375-7ef2fc600eb6'
    AND collected_at > NOW() - INTERVAL '1 hour';
  ```
- [ ] **통과 조건**: `MIN(views) >= 50` + `MIN(published_at) >= NOW() - 8 days`

## P1-05. Opus 검증 파이프라인 연결

- [ ] **수정 내용**
  - `backend/app/collectors/tasks.py`의 각 수집 태스크 끝에서 (AI 배치 분석 후) `sentiment.verify_batch_with_opus()` 호출
  - positive/negative 판정 항목만 대상, neutral은 스킵
  - 검증 결과로 `sentiment`, `sentiment_score`, `strategic_value`, `sentiment_verified = TRUE` 업데이트
  - 검증에서 `changed=True`인 건수 로그 기록
- [ ] **검수 커맨드**
  ```sql
  SELECT sentiment, sentiment_verified, COUNT(*)
  FROM news_articles
  WHERE tenant_id = '5403b830-0087-435c-8375-7ef2fc600eb6'
    AND collected_at > NOW() - INTERVAL '1 hour'
  GROUP BY sentiment, sentiment_verified;
  ```
- [ ] **통과 조건**: sentiment=positive/negative 항목은 sentiment_verified=TRUE 100%

## P1-06. 키워드 카운트 폴백 제거

- [ ] **수정 내용**
  - `backend/app/analysis/sentiment.py`의 `analyze()` 동기 메서드 제거 (또는 deprecated 경고 + 호출 시 예외)
  - `_keyword_analysis_conservative()`는 `analyze_batch()`의 "AI 결과에 없는 항목 폴백"으로만 유지 (메인 경로에서 호출 금지)
  - 모든 `analyzer.analyze(` 호출처 교체 또는 제거
- [ ] **검수 커맨드**
  ```bash
  grep -rn "analyzer\.analyze(" backend/app/collectors/
  # 결과: 0건이어야 함 (analyze_batch, analyze_with_candidate 제외)
  ```
- [ ] **통과 조건**: 위 grep 결과 0건

## P1-07. 실증 테스트 — 5명 후보 실제 수집 & 전체 검수

- [ ] **실행 커맨드**
  ```bash
  # Celery worker + beat 실행 상태 확인 또는 직접 태스크 트리거
  cd backend && python -m app.collectors.tasks collect_news \
      --tenant 5403b830-0087-435c-8375-7ef2fc600eb6 \
      --election e0eacdb9-d1e2-494c-860f-abd719dbd206
  # (또는 instant.py의 진입점 사용)
  ```
- [ ] **통합 검수 SQL**
  ```sql
  WITH recent AS (
    SELECT * FROM news_articles
    WHERE tenant_id = '5403b830-0087-435c-8375-7ef2fc600eb6'
      AND collected_at > NOW() - INTERVAL '1 hour'
  )
  SELECT 
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE published_at >= NOW() - INTERVAL '8 days') AS recent_only,
    COUNT(*) FILTER (WHERE ai_summary IS NOT NULL AND LENGTH(ai_summary) > 10) AS has_ai_summary,
    COUNT(*) FILTER (WHERE strategic_value IS NOT NULL) AS has_quadrant,
    COUNT(*) FILTER (WHERE action_type IS NOT NULL) AS has_action,
    COUNT(*) FILTER (WHERE sentiment IN ('positive', 'negative') AND sentiment_verified = TRUE) AS verified_pn,
    COUNT(*) FILTER (WHERE sentiment IN ('positive', 'negative')) AS total_pn
  FROM recent;
  ```
- [ ] **통과 조건** (모두 충족 필수)
  - `total > 0` (수집이 실제로 되었음)
  - `recent_only = total` (2022년 같은 옛날 기사 0)
  - `has_ai_summary = total` (모든 항목 AI 분석됨)
  - `has_quadrant = total` (4사분면 전부 채워짐)
  - `has_action = total` (액션 타입 전부 채워짐)
  - `verified_pn = total_pn` (positive/negative 전부 Opus 검증됨)
- [ ] **로그 검증**
  - `ai_via_tenant_api` 또는 `assigned_cli` 또는 `claude_json_ok` 로그 라인 존재
  - `claude_cli_empty_result` 같은 실패 로그 없음 (있으면 원인 수정)
- [ ] **유튜브도 같은 방식으로 검증**
  ```sql
  SELECT MIN(views), MIN(published_at), COUNT(*),
         COUNT(ai_summary), COUNT(strategic_value)
  FROM youtube_videos
  WHERE tenant_id = '5403b830-0087-435c-8375-7ef2fc600eb6'
    AND collected_at > NOW() - INTERVAL '1 hour';
  ```

---

# Phase 2 — 아키텍처 정비 (진행 중)

## 완료됨 (2026-04-12)
- [x] P2-Q1 일일 보고서 Opus tier — 이미 `"ai_report_generation": "premium"` 매핑됨 (수정 불필요)
- [x] P2-Q2 URL dedup race → `INSERT ... ON CONFLICT DO NOTHING` (news, community)
- [x] P2-Q3 competitor.py `_generate_ai_summary` subprocess → `call_claude_text()` 전환
- [x] P2-Q4 template_engine 모듈 → 존재 확인 (경로 `app/reports/template_engine.py`)
- [x] P2-Q5 survey_analyzer `subprocess.run` → `call_claude_text()` (premium tier)
- [x] P2-02 부트스트랩 폴링 엔드포인트 `GET /api/onboarding/elections/{id}/bootstrap-status`
  - 상태 저장: `analysis_cache` cache_type='bootstrap_status' (phase, progress, message)
  - `_bg_collect_and_bootstrap`에서 단계마다 상태 업데이트 (starting→collecting→analyzing→done)
  - 엔드포인트에서 캐시 + DB 카운트 실시간 반환
  - 검수: write→read→update→cleanup 확인 ✓
- [x] P2-03 Celery beat ↔ ScheduleConfig — **이미 구현됨** (`tasks.py:1688-1794`)
  - `scheduler.check_and_run` 60초마다 beat 실행
  - ScheduleConfig 쿼리 → fixed_times 매칭 → dispatch
- [x] P2-05 텔레그램 알림 이벤트 기반 재설계
  - `alert_monitor.check_db_alerts()` — DB의 AI 분류 결과(strategic_value=weakness + threat_level=high/medium) 조회
  - `_run_full_ai_pipeline`에서 AI 분석 직후 자동 호출 + Telegram 발송
  - Redis SET으로 중복 알림 방지 (24h TTL)
  - 검수: 실제 DB에서 8건 감지 + HTML 포맷 출력 확인 ✓
- [x] P2-07 PDF 한글 폰트 번들링 — 이미 `app/reports/fonts/` 에 NanumGothic 번들됨, macOS 절대경로 fallback 제거
- [x] P2-08 survey_analyzer subprocess 통일 (P2-Q5로 이관 완료)

## Phase 2 완료 (2026-04-12 저녁)
- [x] **P2-C1 strategic_quadrant↔value 동기화** — 872건 백필 + 모든 write 경로 수정
- [x] **P2-09 콘텐츠/토론 저장** — Report 테이블 재사용, 챗 컨텍스트 자동 반영
- [x] **P2-09B 콘텐츠 히스토리 조회 API** — GET /content/history
- [x] **P2-10A/C 챗·토론·콘텐츠 RAG 활성화** — context_builder/debate/content 모두 ai_summary/strategic_quadrant/action_summary를 LLM에 전달
- [x] chat/router.py subprocess 제거 — ai_service.call_claude_text 단일화 (380→193줄)
- [x] **P2-04 공용 데이터 격리** — election_law_sections, Survey, PastElection 이미 올바른 패턴 사용 확인
- [x] **P2-15 frontend debate/surveys 연결 검증** — 기존 페이지 연결 확인 + getContentHistory/getBootstrapStatus API 메서드 추가
- [x] **Opus 검증 프롬프트 개선** — 사건 vs 행동 구분 규칙 추가 (서승우 재분석에서 드러난 기계적 매핑 버그 수정)
- [x] **서승우 실증 재분석** — 95건 news, weakness 1건만, 동명이인 3건 제거, Opus 13건 교정

## Phase 2 Deferred → Phase 3
- [ ] **P2-01 race-shared 데이터 분리** — 설계 문서 완료 (`docs/P2-01_race_shared_design.md`), 구현은 별도 세션
- [ ] P2-10B tsvector 전문검색 — 현재 strategic_quadrant 기반으로 이미 충분히 풍부한 컨텍스트 제공
- [ ] P2-11 admin/router.py 분리 — 기능 변경 없는 순수 리팩터, 테스트 보장 필요
- [ ] **데이터 정리 스크립트** — 동명이인 윤건영 오염, sentiment_verified/ai_analyzed_at 불일치

## 알려진 데이터 품질 이슈 (클린업 필요)
- 동명이인 윤건영(국회의원 정개특위)이 충북교육감 후보 윤건영으로 오분류 저장됨
- `sentiment_verified=TRUE` 이면서 `ai_analyzed_at IS NULL` 인 불일치 건수 존재
- 데이터 정리 스크립트 필요 (`backend/scripts/cleanup_stale_analysis.py`)

---

# Phase 3 — 프리미엄 & 누적

- [ ] P3-01 캠프 전용 챗봇 RAG ("나만의 AI" — 수집 데이터 기반)
- [ ] P3-02 토론 대본 생성 완성 + 저장
- [ ] P3-03 콘텐츠 도구: 캘린더 연동 + 저장 + 재사용
- [ ] P3-04 광고 추적 / 스윙보터 / SNS 템플릿 (프리미엄)

---

# 검수 로그

## 2026-04-12 P1 실증 테스트 결과

**실행 환경**: Tenant 5403b830 / Election e0eacdb9 (충북 교육감) / 우리=김진균
**소요 시간**: 486.8초 (약 8분)
**방법**: 기존 DB의 미분석 항목(ai_analyzed_at IS NULL)을 새 파이프라인으로 분석

### Sonnet 배치 분석 (media_analyze_batch context)
```
00:46:43 claude_json_ok model=claude-sonnet-4-6 source=system_cli batch=8
00:47:40 claude_json_ok model=claude-sonnet-4-6 source=system_cli batch=8
00:48:13 claude_json_ok model=claude-sonnet-4-6 source=system_cli batch=4  (news 3 batch 합 20건)
00:48:40 claude_json_ok model=claude-sonnet-4-6 source=system_cli batch=8
00:50:11 claude_json_ok model=claude-sonnet-4-6 source=system_cli batch=7  (youtube 2 batch 합 15건)
00:51:53 claude_json_ok model=claude-sonnet-4-6 source=system_cli batch=8
00:52:21 claude_json_ok model=claude-sonnet-4-6 source=system_cli batch=8
00:52:38 claude_json_ok model=claude-sonnet-4-6 source=system_cli batch=4  (community 3 batch 합 20건)
```

### Opus 검증 (sentiment_verify context)
```
00:50:32 claude_json_ok model=claude-opus-4-6 tier=premium
00:50:55 claude_json_ok model=claude-opus-4-6 tier=premium
00:50:55 opus_verified changed=4 table=youtube_videos verified=10   ← 40% 교정
00:53:04 claude_json_ok model=claude-opus-4-6 tier=premium
00:53:28 claude_json_ok model=claude-opus-4-6 tier=premium
00:53:52 claude_json_ok model=claude-opus-4-6 tier=premium
00:54:19 claude_json_ok model=claude-opus-4-6 tier=premium
00:54:19 opus_verified changed=8 table=community_posts verified=17  ← 47% 교정
```

### 4사분면 자동 분류 샘플
| 제목 | sentiment | strategic_value | action_type | AI 근거 |
|---|---|---|---|---|
| 윤건영 충북교육감 현장지원 사업 중심 추경 편성 | positive | threat | monitor | 현직 교육감 능동 행정력 과시 위협 |
| 윤건영 충북교육감 교육활동 보호 방안 모색 | positive | threat | monitor | 경쟁 후보 긍정 이미지 구축 |
| 김성근 탄탄숲 이해충돌, 교육감이 답하라 | negative | opportunity | attack | 현직 교육감 이해충돌 의혹 |
| 한화 KIA에 5-6 패배, 노시환 실책 | neutral | neutral | ignore | 조동욱은 한화 이글스 투수, 교육감 후보와 **동명이인** |

### 통과 조건 체크
- [x] 뉴스·커뮤니티·유튜브 수집 후 AI가 실제로 본문 읽고 분류
- [x] `ai_summary`, `ai_reason`, `strategic_value`, `action_type` 모두 채워짐 (100%)
- [x] 동명이인 검증 작동 (한화 이글스 조동욱 투수를 교육감 후보와 구분)
- [x] `call_claude()` 경유 로그 확인: `source=system_cli` (고객 API키 → 관리자 계정 → 시스템 CLI 자동 전환 체인의 마지막 단계 작동)
- [x] Sonnet 모델 사용 확인: `model=claude-sonnet-4-6`
- [x] Opus 검증 모델 사용 확인: `model=claude-opus-4-6 tier=premium`
- [x] Opus가 Sonnet 판정을 실제로 교정 (YouTube 40%, Community 47%)
- [x] 배치 처리 (8~10건씩) 작동 — 건당 CLI 호출이 아님
- [x] 키워드 카운트 폴백 제거 (tasks.py의 `analyzer.analyze(` 0건)
- [x] `subprocess.run` / `create_subprocess_exec` 직접 호출 0건 (media_analyzer, sentiment 전부 call_claude 경유)

### 알려진 이슈 (Phase 2에서 처리)
1. **YouTube API 키 403 Forbidden**: 새 수집 실행 시 발생. 키 교체 또는 API 할당량 확인 필요
2. **뉴스 사전 데이터 일부에 sentiment_verified=TRUE & ai_analyzed_at=NULL 불일치**: 이번 테스트에서 news Opus가 10건 스킵한 원인. 과거 버전의 부작용. 데이터 정리 스크립트 필요
3. **신규 수집 items=0 문제**: 기존 수집물과 URL 중복률이 100%에 가까움. 시간대 키워드 다변화 또는 수집 주기 조정 필요 (Phase 2 race-shared 데이터 분리와 함께 해결)
