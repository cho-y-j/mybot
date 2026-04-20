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
