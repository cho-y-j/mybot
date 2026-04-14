# ElectionPulse 수정 플랜 & 체크리스트

**최근 갱신**: 2026-04-14
**현재 단계**: Phase 3 완료 → Phase 4 진행 중
**검수 대상**: Tenant `5403b830` / Election `e0eacdb9` (우리=김진균, 경쟁=조동욱/김성근/신문규/윤건영)

## 현재 상태 요약 (2026-04-13)

### 서버 배포 완료 (Docker + GitHub Actions + Watchtower)
- [x] GitHub Actions CI/CD: push → Docker 이미지 빌드 → GHCR push
- [x] Watchtower: 60초마다 새 이미지 자동 pull & 재시작
- [x] Nginx Proxy Manager: ai.on1.kr → ep_frontend:3000 (SSL)
- [x] Docker에 Claude CLI 설치 + 호스트 ~/.claude 인증 마운트
- [x] system_cli로 Sonnet/Opus 2단계 파이프라인 정상 작동 확인

### 데이터 파이프라인 수정 완료
- [x] is_relevant 필드 추가 (3개 테이블) + 대시보드 쿼리 23개 필터 적용
- [x] 날짜 정렬 published_at 기준 통일
- [x] 기존 데이터 526건 동명이인/무관 → is_relevant=false 마킹
- [x] 수집 → AI 스크리닝 → DB 저장 순서 변경 (instant.py)
- [x] ai_screening.py 모듈 신규 작성
- [x] homonym_filters를 AI 프롬프트에 명시적 전달
- [x] analyze_all_media 3매체 병렬 실행 (asyncio.gather)
- [x] 콘텐츠 생성 모델 Sonnet → Opus(premium) 변경

### 해결 완료 (2026-04-13)
- [x] 챗 대화 이력 저장 + 세션 관리 (ChatGPT 스타일)
- [x] 수집 데이터 삭제 + 캐시 무효화 + 보고서 삭제
- [x] tasks.py AI 스크리닝 적용 + 중복 수집 방지
- [x] 텔레그램 중복 알림 방지 (Redis URL 수정)
- [x] CLI 선거 콘텐츠 거부 해결 (SaaS 맥락 자동 추가)
- [x] 다크모드 글씨 안 보이는 문제
- [x] 콘텐츠 히스토리 탭 통합 + 별도 페이지 삭제

---

# Phase 3 — 현재 진행 중

## P3-01. 챗 대화 이력 저장 — 완료 (2026-04-13)
- [x] ChatMessage 모델 생성 (`backend/app/chat/models.py`)
- [x] /chat/send 엔드포인트에서 질문+응답 DB 저장
- [x] /chat/history: 이전 대화 불러오기 (페이지 재진입 시 복원)
- [x] /chat/message/{id} DELETE: 개별 메시지 삭제
- [x] /chat/history DELETE: 전체 대화 초기화
- [x] 프론트엔드: 대화 초기화 버튼 + 개별 삭제 버튼
- [ ] **미완료**: 이전 대화를 AI 컨텍스트에 포함 (최근 N개) — 개별 맞춤 AI 작업 시 함께 처리

## P3-02. 수집 데이터 삭제 기능 — 완료 (2026-04-13)
- [x] DELETE /analysis/news/{id}, community/{id}, youtube/{id}
- [x] 삭제 시 audit_log 기록
- [x] 프론트엔드: 뉴스/유튜브/커뮤니티 목록 + 위기 영상에 삭제 버튼
- [x] "AI 자동수집 데이터입니다. 오류 발견 시 삭제해주세요" 안내 문구

## P3-03. Celery 스케줄 수집에 AI 스크리닝 적용 — 완료 (2026-04-13)
- [x] tasks.py의 collect_news/community/youtube에 ai_screening 적용
- [x] 같은 election 중복 수집 방지 (1시간 내 다른 캠프 수집 시 스킵)

## P3-04. 개별 맞춤 AI (캠프 전용 AI 어시스턴트)
- [x] 챗 세션 목록 (ChatGPT 스타일) — 새 대화/기존 대화 클릭/삭제
- [x] 이전 대화 이력을 AI 컨텍스트에 포함 (최근 10개)
- [ ] 생성된 콘텐츠/보고서를 다음 대화/생성 시 참조

## P3-05. 보고서 품질 개선 — 완료 (2026-04-13)
- [x] REPORT_PROMPT_WEEKLY 작성 (4파트 20섹션, 4000자)
- [x] PDF 차트 생성 Docker 작동 확인 (matplotlib + NanumGothic)
- [x] PDF 경로를 Docker 볼륨으로 변경 (/app/data/reports/)
- [x] 일일 보고서 PDF: Opus 4000자+ 6페이지 차트 포함 — 검증 완료
  - 김진균: 88초, Opus, 4058자, 144KB PDF
  - 서승우: 92초, Opus, 4984자, 148KB PDF
- [x] router.py에서 보고서 생성 시 PDF 자동 생성
- [x] 보고서 삭제 기능 (프론트엔드 + 백엔드)
- [x] Opus 우선 (600초) + Sonnet 폴백 (300초)

미완료:
- [ ] 주간 보고서 실제 생성 테스트 (Opus 타임아웃 확인)
- [ ] 보고서 PDF 다운로드 프론트엔드 확인
- [ ] 캠프별 RAG: 수집 데이터 + 대화 이력 + 생성 콘텐츠 통합 검색

## P3-07. 스케줄 구조 개선 + PDF 품질 통일 — 완료 (2026-04-13)
- [x] task_time_limit 600초 → 1800초 (full_with_briefing 타임아웃 방지)
- [x] 스케줄 분리: 17:30 마감 수집 (full_collection) + 18:00 일일 보고서 (briefing only)
- [x] 기존 5개 테넌트 DB 스케줄 업데이트 + onboarding 템플릿 반영
- [x] PDF D-day 누락 수정 (router.py 3곳 — election_date에서 직접 계산)
- [x] PDF 차트+비교표 누락 수정 (router.py 3곳 — _collect_pdf_candidates 추가)
- [x] 07:00 스케줄 실패 원인 분석 (2026-04-14) — 3가지 원인 발견 및 수정

## P3-09. 인프라 안정화 — 완료 (2026-04-14)
- [x] **보안**: PostgreSQL/Redis 포트 localhost 바인딩 (외부 브루트포스 차단)
  - 원인: `0.0.0.0:5440` 노출 → admin 브루트포스 29회 → DB 인증 간헐 실패 → 500 에러
  - 수정: `127.0.0.1:5440`, `127.0.0.1:6380`으로 변경
- [x] **보안**: `.claude` 마운트 `:ro` → `:rw` (토큰 갱신 허용)
  - 원인: read-only 마운트 → 컨테이너 CLI가 만료 토큰 갱신 불가 → AI 전체 실패
- [x] **안정성**: Claude CLI 토큰 keep-alive (4시간 주기 Celery beat)
- [x] **안정성**: Claude CLI 실패 시 stderr 로깅 + 1회 재시도
- [x] **버그**: SQLAlchemy 세션 상태 에러 수정 (rollback 실패 방어)
- [x] **근본 원인**: Docker DNS 충돌 수정 (`postgres` → `ep_postgres`, `redis` → `ep_redis`)
  - 같은 네트워크에 ep_postgres + mk_postgres 공존 → DNS 랜덤 반환 → 간헐적 500
  - 10/10 연결 성공 확인
- [x] **배포**: docker-compose 변경사항 서버 반영 완료

## P3-10. 코드 버그 수정 — 완료 (2026-04-14)
- [x] ORM 모델 action_* 필드 누락 수정 (토론 생성 500 에러)
  - NewsArticle, CommunityPost, YouTubeVideo에 action_type/priority/summary, is_about_our_candidate 추가
- [x] content/router.py `func` import 누락 수정 (콘텐츠 상황 분석 에러)
- [x] 콘텐츠 영문 출력 수정 — `--system-prompt` 추가 + `[시스템]` 프리픽스 제거
- [x] AI 타임아웃 대폭 확대 (Opus 60초→300초, 토론 120초→600초 등)
- [x] 온보딩 선거명에 시군구 포함 (기초단체장)
  - `2026 충북 시장 선거` → `2026 충북 청주시 시장 선거`

## P3-08. 온보딩 선거 중복 생성 방지 — 완료 (2026-04-13)
- [x] apply_setup에서 election_type + region + date로 기존 선거 검색
- [x] 시도 단위 선거(교육감/도지사)는 sigungu 무시하고 매칭
- [x] 기존 선거 있으면 tenant_elections에 연결만 추가
- [x] 윤건영 중복 선거(7d84f58e) 정리 완료

## P3-06. 슈퍼관리자 고객 관리 강화

### 백엔드 API — 완료 (2026-04-13)
- [x] PUT /admin/tenants/{id} — 캠프 정보 수정 (이름, 요금제, 제한값, 활성/비활성)
- [x] PUT /admin/users/{id}/role — 사용자 역할 변경 (admin/analyst/viewer)
- [x] PUT /admin/users/{id}/tenant — 사용자 캠프 이동
- [ ] GET/POST/DELETE /admin/ai-accounts — AI CLI 계정 풀 관리
- [ ] POST /admin/tenants/{id}/assign-ai — 캠프에 AI 계정 배정

### 프론트엔드 — 캠프 관리 — 완료 (2026-04-13)
- [x] 캠프 상세에서 요금제 변경 (basic/pro/premium/enterprise 드롭다운)
- [x] 캠프 활성/비활성 토글
- [ ] 캠프 이름 수정 (API 완료, 프론트 미구현)
- [ ] 캠프 제한값 수정 (API 완료, 프론트 미구현)

### 프론트엔드 — 사용자 관리 — 완료 (2026-04-13)
- [x] 사용자 역할 변경 드롭다운 (admin/analyst/viewer) — 캠프 상세 + 전체 회원
- [x] 사용자 캠프 이동 (드롭다운으로 캠프 선택) — 전체 회원
- [x] 사용자 비밀번호 확인 (PW 표시) + 변경
- [x] 사용자 본인 비밀번호 변경 (설정 페이지)

### 프론트엔드 — AI 계정 관리 — 미착수
- [ ] AI CLI 계정 목록 (provider, name, status, 배정된 캠프)
- [ ] 계정 추가/삭제
- [ ] 캠프에 계정 배정/해제
- [ ] rate limit blocked 자동 감지 표시

---

# Phase 4 — 슈퍼관리자 패널 재구축

**목표**: 고객 관리 + 시스템 모니터링 + 운영이 가능한 실전 관리자 패널
**현재**: 한 페이지에 기본 CRUD만 있음. 접속 로그, 검색, 바로가기, 로그아웃 없음.
**원칙**: 각 단계마다 백엔드 API → 프론트 UI → 실제 데이터 검수 후 다음 단계로.

## P4-01. 관리자 레이아웃 + 네비게이션 — 완료 (2026-04-14)
- [x] 사이드바 레이아웃 (대시보드/캠프/회원/모니터링/스케줄/시스템/셋팅)
- [x] 로그아웃 + 고객 사이트 바로가기
- [x] 687줄 단일파일 → 7개 페이지 분리
- [x] 비관리자 접근 차단

## P4-02. 관리자 대시보드 — 완료 (2026-04-14)
- [x] 요약 카드 (시스템/활성캠프/회원/오늘접속/승인대기/선거)
- [x] 최근 활동 로그 (audit_logs 기반)
- [x] 가입 승인 대기 + 빠른 승인/거절
- [x] 스케줄 현황 요약

## P4-03. 캠프 관리 — 완료 (2026-04-14)
- [x] 검색 + 요금제/상태 필터
- [x] 캠프 상세: 요금제 변경, 활성/비활성, 멤버 관리, 선거명 수정
- [x] 캠프 대시보드 바로가기 링크
- [x] 캠프 생성/삭제
- [x] PUT /admin/elections/{id} API (선거명 수정)

## P4-04. 회원 관리 — 완료 (2026-04-14)
- [x] 테이블형 레이아웃 (이름/이메일/캠프/역할/상태/가입일)
- [x] 검색 + 역할/캠프/상태 필터
- [x] 인라인 역할 변경, 캠프 이동, 비밀번호 변경, 활성/정지, 삭제

## P4-05. 모니터링 — 완료 (2026-04-14)
- [x] 접속 현황 바 차트 (14일)
- [x] 스케줄 실행 통계 (7일, 캠프별)
- [x] 에러 로그 (실패 스케줄 목록)
- [x] 전체 활동 로그 테이블 (30건)
- [x] 백엔드: /admin/access-stats, /admin/ai-usage, /admin/error-logs API

## P4-06. 스케줄 관리 — 완료 (2026-04-14)
- [x] 전체 스케줄 테이블 (캠프/유형/시간/상태/마지막실행)
- [x] 전체 정지/재개 버튼
- [x] 캠프별 정지/재개
- [x] 수동 수집 트리거 버튼 (캠프별)
- [x] POST /admin/trigger-collection/{tenant_id} API

## P4-07. 시스템 상태 — 완료 (2026-04-14)
- [x] 서비스 상태 (DB/Redis 연결)
- [x] 리소스 요약 (캠프/회원/선거)
- [x] 인프라 설정 정보
- [x] 데이터 통계

---

# Phase 5 — AI 고도화 + 데이터 공유 구조 (2026-04-14 진행)

## P5-01. 캠프 학습 데이터 강화 — 완료 (2026-04-14)
- [x] 이전: 보고서 2개 × 500자(1,000자) 참조 → 이후: 보고서 5 + 브리핑 6개 전문 (~30,000자)
- [x] camp_context.py 리팩터 (REPORT_TYPES / BRIEFING_TYPES / CONTENT_TYPES 분리)
- [x] 챗/콘텐츠/토론/보고서 모두 적용

## P5-02. 선거법 검증 AI 기반 전환 — 완료 (2026-04-14)
- [x] 이전: 키워드 패턴 매칭 (거짓말→비방, 경품→기부행위)
- [x] 이후: 공직선거법 10개 주요 조항 전문을 AI에 전달 → 맥락 기반 법적 판단
- [x] 챗에 "law" 의도 추가 → 선거법 질문 시 조항 자동 포함
- [x] 포함 조항: 제82조의8 (AI/딥페이크), 제250조 (허위사실), 제110조 (비방),
      제112조 (기부행위), 제93조 (문서배부), 제82조의7 (인터넷), 제108조 (여론조사),
      제59조 (운동기간), 제86조 (홍보물), 제82조의5 (문자)

## P5-03. RAG 벡터 검색 구현 — 완료 (2026-04-14)
- [x] Ollama bge-m3 임베딩 모델 설치 (1024차원, 한국어 지원)
- [x] pgvector 확장 설치 (postgres:16 → pgvector/pgvector:pg16)
- [x] embeddings 테이블 (tenant_id × source_type × source_id)
- [x] embedding_service.py: 임베딩 생성/저장/검색/배치 모듈
- [x] 기존 795건 일괄 임베딩 완료 (김진균 395 + 윤건영 227 + 서승우 164 + 김성근 9)
- [x] 자동 임베딩 훅: 수집 파이프라인 + 보고서 생성 직후
- [x] context_builder.py: RAG 검색 최우선 + 의도별 보충 (하이브리드)
- [x] 토큰 ~33,000 → ~3,000 (90% 절약)
- [x] 검색 정확도 검증: 급식→0.747, 공약→0.689 의미 기반 검색 성공

## P5-04. Election 단위 데이터 공유 구조 (정공법 리팩터) — 완료 (2026-04-14)
- [x] 기존 구조 문제: news_articles에 tenant_id NOT NULL → 같은 선거 데이터를 캠프마다 복제
- [x] 신규 구조:
  - 원본 데이터 (news/community/youtube): election_id 기반 공유, tenant_id nullable
  - 관점 분석 (4사분면, action_type): 신규 테이블 `*_strategic_views` (tenant × source)
- [x] DB 마이그레이션 (2026_04_14_election_shared_data.sql)
- [x] 23개 파일 리팩터링:
  - ORM: NewsArticle/CommunityPost/YouTubeVideo + NewsStrategicView/CommunityStrategicView/YouTubeStrategicView
  - 수집: election 단위 upsert (pg_insert().on_conflict_do_update)
  - 분석: 공유 필드는 raw, 관점 필드는 strategic_views
  - 조회: election_id 기반, 관점 필요 시 LEFT JOIN COALESCE(sv.x, raw.x)
  - 신규 헬퍼: analysis/strategic_views.py (upsert 헬퍼)
- [x] 검증:
  - 김성근 캠프 415건 공유 뉴스 조회 (이전 0건)
  - 김진균/김성근 같은 election_id 415건 동일 공유
  - 전략 관점은 캠프별 분리 유지

## P5-05. AI 자동 동명이인 감지 + 학습 — 완료 (2026-04-14)
- [x] 이전: 가입자가 homonym_filters 수동 입력 (불가능)
- [x] 이후: AI가 문맥으로 자동 감지 → candidate.homonym_filters에 자동 누적
- [x] 프롬프트 강화:
  - ai_screening.py + media_analyzer.py
  - "힌트에 없어도 문맥상 다른 직업/지역/선거면 동명이인 자동 판정"
  - homonym_detected 필드 추가 (예: "야구감독", "국회의원 서천")
- [x] 자동 학습 로직: is_relevant=false + homonym_detected → homonym_filters jsonb 배열 누적 (최대 20개)
- [x] 캠프별 격리 (tenant_id × name)

## P5-06. 온보딩 안정화 — 완료 (2026-04-14)
- [x] apply_setup 완료 검증 추가
  - 우리 후보 1명 이상, tenant_elections 연결 필수
  - 실패 시 rollback + 500 에러 (재시도 유도)
- [x] 기존 부분 완료 캠프 복구:
  - 신용한: tenant_elections 연결 추가
  - 김성근/윤건영: 후보 5명 등록 + homonym_filters 복사

## P5-07. Candidate 테이블 election 단위 통합 — 완료 (2026-04-15)
- [x] 기존 문제: 캠프마다 candidate 레코드 복제 → candidate_id 매칭 실패 (모든 캠프 통합분석 0건)
- [x] 신규: UNIQUE(election_id, name) — 같은 선거의 같은 이름 후보 1개 레코드
- [x] FK 테이블 10개 candidate_id 재배정 (news/community/youtube/strategic_views/sentiment_daily/ad_campaigns/keywords/tenant_elections/elections)
- [x] 15명 → 10명 (3개 선거, 중복 제거)
- [x] "내 후보" 판정: `tenant_elections.our_candidate_id` 기준
- [x] 신규 헬퍼: common/election_access.py (list_election_candidates, get_or_create_candidate)
- [x] 20+ 파일 리팩터 (onboarding, router, analysis_service, chat/context_builder 등)

## P5-08. 챗 마크다운 표 렌더링 — 완료 (2026-04-15)
- [x] react-markdown + remark-gfm 설치 (GitHub Flavored Markdown)
- [x] @tailwindcss/typography 플러그인
- [x] 시스템 프롬프트 강화: "비교/수치 데이터는 반드시 표로"
- [x] ⚠️💡 이모지로 위험/기회 강조

## P5-09. 챗 과거 선거 NEC 데이터 자동 포함 — 완료 (2026-04-15)
- [x] history/strategy/competitor/candidate/일반 질문 시 모두 포함
- [x] _build_history_context 강화: 역대 당선자 상위 5명 + 정당 우세도 + 투표율 평균 + 과거 공약
- [x] 챗 예시 질문 4개 추가 (역대 선거, 공약 차별화, 선거법 검토)

---

# Phase 6 — 최고 수준 AI 품질 — 완료 (2026-04-15)

## P6-01. 네이버 실시간 검색 — 완료
- [x] services/realtime_search.py (48시간 이내 네이버 뉴스)
- [x] 챗 context_builder에 통합

## P6-02. 출처 각주 시스템 — 완료
- [x] RAG/실시간 결과에 [ref-xxx] 태그
- [x] CitationBadge 컴포넌트 (인라인 배지 + 모달)
- [x] 타입별 아이콘 (📰 💬 📺 📋 ⚡️ 🏛️)

## P6-03. Claude CLI WebSearch + 자기 검증 — 완료
- [x] ai_service.py web_search 파라미터
- [x] Max 계정 WebSearch 정상 동작 확인
- [x] 항상 WebSearch 허용 (AI가 필요 판단)
- [x] 프롬프트: "내부 우선, 부족하면 WebSearch, 추측 금지"

## P6-04. 후보자 공식 프로필 (info.nec.go.kr) — 완료
- [x] candidate_profiles 테이블 (학력/경력/재산/병역/납세/전과/공약)
- [x] context_builder "profile" 의도
- [x] _build_profile_context (DB 있으면 인용, 없으면 WebSearch)
- [x] 챗 예시 3개 추가

## P6-05. 토론/콘텐츠 생성에 챗 수준 AI 적용 — 완료
- [x] services/rich_context.py (공용 컨텍스트 빌더)
- [x] LEGAL_SAFETY_PROMPT (선거법 준수)
- [x] debate_service + content/router 모두 web_search=True
- [x] 프론트엔드 citations 표시
- [x] AI 생성물 + 선거법 안내 UI 강화

---

# Phase 7 — 쉬운 모드 UI (2026-04-15 시작)

**목표**: 비전문가(캠프 실장)도 쓸 수 있는 "Today's Action" 중심 UI
**전략**: 기존 `/dashboard/*`는 그대로, 신규 `/easy/*`로 두 버전 공존 → A/B 비교

## P7-01. 쉬운 모드 기초 구조
- [ ] /easy/layout.tsx — 사이드바(2단계 메뉴), 상단 모드 토글
- [ ] 기본 4개 메뉴: 🏠 홈 / 💬 AI 비서 / 📝 콘텐츠 / 📊 보고서
- [ ] "전문가 메뉴" 펼침 (뉴스/감성/트렌드/여론조사/토론/과거선거)
- [ ] localStorage에 선택 저장

## P7-02. Today's Action 홈 (`/easy`)
- [ ] 상단 인사 + D-day
- [ ] "오늘 꼭 해야 할 일" 3개 자동 추천 카드
  - 위기 대응 (negative 뉴스 집중 → 해명 콘텐츠 버튼)
  - 기회 포착 (opportunity → SNS 포스팅 버튼)
  - 브리핑 확인 (최근 미확인 브리핑 → 읽기 버튼)
- [ ] AI 비서 빠른 입력
- [ ] 숫자 요약 (클릭 시 상세)
- [ ] 빠른 생성 버튼 (블로그/SNS/토론)
- 백엔드: GET /api/actions/today/{election_id} — 우선순위 액션 추천

## P7-03. 부동 AI 비서 위젯
- [ ] 모든 페이지 우하단 부동 버튼
- [ ] 클릭 시 우측 슬라이드 패널로 챗
- [ ] "이 페이지 설명해줘" 컨텍스트 버튼

## P7-04. 콘텐츠 마법사
- [ ] 3단계: 유형 선택 → 주제 선택(AI 추천) → 완성
- [ ] AI 추천 주제 5개 자동 생성
- [ ] 생성 후 "바로 보내기" / "수정" / "저장"

## P7-05. AI 비서 페이지 (`/easy/assistant`)
- [ ] 챗 중심 풀스크린 + 빠른 질문 카드
- [ ] "오늘 뭐해야 돼?" / "경쟁자 공세 있나?" 등

## P7-06. 보고서 단순화 (`/easy/reports`)
- [ ] 최신 브리핑 즉시 표시
- [ ] "다음 액션" 버튼 (SNS 만들기 / AI 질문)

## P7-07. 모드 토글 + 온보딩
- [ ] 상단 헤더 토글 버튼
- [ ] 첫 로그인 시 "어떤 모드로 시작?" 선택

---

# Phase 5 미완료 (다음)
- [ ] 이메일 알림 (SMTP 키 발급 필요)
- [ ] 랜딩 페이지 (ai.on1.kr 접속 시 소개 페이지)
- [ ] 결제/요금제 연동 (Toss)
- [ ] 주간 보고서 실제 생성 테스트
- [ ] AI CLI 계정 풀 관리 (관리자 UI)
- [ ] 모바일 반응형 전체 페이지 점검 (보고서는 완료)

---

# Phase 5 미완료 (다음)
- [ ] 이메일 알림 (SMTP 키 발급 필요)
- [ ] 랜딩 페이지 (ai.on1.kr 접속 시 소개 페이지)
- [ ] 결제/요금제 연동 (Toss)
- [ ] 주간 보고서 실제 생성 테스트
- [ ] AI CLI 계정 풀 관리 (관리자 UI)
- [ ] 모바일 반응형 전체 페이지 점검 (보고서는 완료)

---

# Phase 1 — 완료 (2026-04-12)

(이전 Phase 1 내용은 모두 완료됨 — 상세 내역은 git history 참조)

# Phase 2 — 완료 (2026-04-12~13)

(이전 Phase 2 내용은 모두 완료됨 — 상세 내역은 git history 참조)

---

# 검수 로그

## 2026-04-13 서버 Docker 배포 + AI 파이프라인 검증

**환경**: Docker (ep_backend, ep_celery_worker, ep_celery_beat)
**Claude CLI**: 2.1.104 (컨테이너 내 설치, 호스트 인증 마운트)

### AI 분석 작동 확인
```
claude_json_ok context=media_analyze_batch model=claude-sonnet-4-6 source=system_cli
ai_batch_done input=7 output=7
claude_json_ok context=sentiment_verify model=claude-opus-4-6 source=system_cli
opus_verified changed=0 table=youtube_videos verified=4
```
- Sonnet 1차 분석 + Opus 2차 검증 정상 작동
- 교육감 테스트: analyzed=27, irrelevant=12 (동명이인 필터 정상)

### is_relevant 필터 적용 결과
| 유형 | 전체 | 무관 (is_relevant=false) | 유효 |
|---|---|---|---|
| 뉴스 | 930 | 154 (17%) | 776 |
| 커뮤니티 | 1419 | 349 (25%) | 1070 |
| 유튜브 | 328 | 23 (7%) | 305 |
