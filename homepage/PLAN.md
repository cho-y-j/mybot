# MyHome 개발 체크리스트

> **진행 상황**: Phase 0~9 완료 (MVP 기능 완성). 현재 Phase 10 디자인 통일·UX 정련 진행 예정.

---

## Phase 0 — 메인 랜딩페이지 (완료)
- [x] 프로젝트 초기화 (Next.js 14 + Tailwind)
- [x] 메인 랜딩페이지 디자인 (Supanova 기반 9개 섹션)

## Phase 2 — DB 스키마 + 마이그레이션
- [x] **Step 1:** 의존성 설치 + Prisma/Docker 초기화 (DB:5435, Redis:6399)
- [x] **Step 2:** Prisma 스키마 20개 모델 + 마이그레이션 + 시드 (Prisma 5)

## Phase 3 — 인증 시스템
- [x] **Step 3:** Prisma 클라이언트 + 인증 라이브러리 + 타입
- [x] **Step 4:** 인증 API 4개 + 미들웨어

## Phase 4 — 슈퍼 관리자
- [x] **Step 5:** 로그인 + 레이아웃 + 대시보드
- [x] **Step 6:** 사용자 CRUD API
- [x] **Step 7:** 사용자 관리 UI

## Phase 5 — 고객 홈페이지
- [x] **Step 8:** 공개 API + 선거 템플릿 SSR (11개 섹션)
- [x] **Step 9:** 고객 관리자 로그인 + 레이아웃

## Phase 6 — 고객 관리자 콘텐츠
- [x] **Step 10:** 콘텐츠 CRUD API (7개 리소스, 18개 라우트)
- [x] **Step 11:** 콘텐츠 관리 UI (9탭, 4탭 완전 구현)

## Phase 7 — 파일 업로드
- [x] **Step 12:** 파일 업로드 API + Sharp 이미지 처리

## Phase 8 — 방문자 추적
- [x] **Step 13:** 방문/이벤트 추적 + 분석 API
- [x] **Step 14:** 트래킹 클라이언트 + 분석 대시보드 UI

## Phase 9 — Docker 배포
- [x] **Step 15:** 프로덕션 Docker 구성
- [x] **Step 16:** 환경 설정 + 최종 통합 테스트
- [x] **사고 복기 (2026-04-18):** 쿠키·NPM 라우팅·TZ·SSO 4가지 핵심 이슈 해결 — 자세한 내용은 `CLAUDE.md` 배포 워크플로우 섹션 참조

---

## Phase 10 — 디자인 통일 · UX 정련 (진행 예정)

> **목적**: mybot 분석 플랫폼과 homepage admin을 **같은 디자인 언어**로 통일. 사용자 피드백(2026-04-19) 반영.
>
> **기준 페이지**: mybot `/dashboard/surveys` (CSS 변수 93개, 하드코딩 0개)
>
> **디자인 원칙**: `CLAUDE.md` "★ 디자인 절대 원칙" 섹션 필수 준수

### Step 17 — 사전 진단 (착수 전 필수)
- [ ] Admin 배색 현황 측정
  ```bash
  for f in homepage/src/app/\[code\]/admin/**/page.tsx homepage/src/app/\[code\]/admin/**/*.tsx; do
    legacy=$(grep -oE "bg-(gray|slate|zinc)-(50|100|200|300)|text-gray-[0-9]+" "$f" | wc -l)
    var_token=$(grep -oE "var\(--(muted|card|foreground|background)" "$f" | wc -l)
    echo "$f : legacy=$legacy  var=$var_token"
  done
  ```
- [ ] 이모지 잔존 확인 — 0이어야 함
  ```bash
  grep -rE "🎯|🔥|💡|📊|📈|📉|⚠️|✅|💬|📅|⏰|📹|📝|🏷️|💎|🚨|🤖|🏆|🎤" homepage/src/ | wc -l
  ```
- [ ] 다크 팔레트 방향 결정 (사용자 확인 필요)
  - 옵션 A: 현행 zinc-900 기반 유지
  - 옵션 B: Airtable 팔레트 (기존 Task #11 계획)
  - 옵션 C: 라이트/다크 토글 지원

### Step 18 — CSS 변수 체계 정비
- [ ] `globals.css` 공통 변수 정의 (mybot과 동일 키: `--background`, `--foreground`, `--muted`, `--muted-bg`, `--card-bg`, `--card-border`)
- [ ] Admin 전용 vs 공개 홈페이지 구분
  - Admin: 다크 기본
  - 공개 홈페이지: 고객 설정 테마 유지
- [ ] 두 팔레트 모두 CSS 변수만 사용

### Step 19 — Admin 페이지 리팩토링
적용 순서 (크기 작은 것부터, 위험 최소화):
- [ ] `[code]/admin/login/page.tsx`
- [ ] `[code]/admin/page.tsx` (대시보드 진입)
- [ ] `[code]/admin/layout.tsx`
- [ ] `[code]/admin/analytics/page.tsx`
- [ ] `[code]/admin/settings/page.tsx`
- [ ] `[code]/admin/content/page.tsx`
- [ ] `[code]/admin/builder/page.tsx` (5,837줄 — 마지막)

각 페이지마다 체크:
- `bg-gray-*`, `text-gray-*`, `bg-{color}-50/100/200` 고정 명도 → CSS 변수 교체
- 이모지 전수 제거 → SVG 또는 색상 뱃지로
- 정보 중복 제거 (같은 값 2곳 이상 금지)
- Playwright MCP로 렌더링 검증
- 커밋 메시지에 변경 항목 명시

### Step 20 — `analytics` 대시보드 시각화 강화
- [ ] 방문자 추이 LineChart (Recharts 이미 설치됨)
- [ ] 페이지별 PV 히트맵 or 수평 바
- [ ] 이벤트 전환율 표시
- [ ] 기간 토글 (일간 · 주간 · 월간) — mybot `/dashboard/candidates` 패턴 재사용
- [ ] 종합 점수 KPI 카드 (방문·체류·전환 종합)

### Step 21 — `builder` 페이지 UX 정리
- [ ] 블록 편집기 좌측 사이드바: 이모지 → lucide-react SVG 아이콘
- [ ] 실시간 미리보기 vs 편집 영역 경계 명확화
- [ ] 다크 테마 고정 (공개 사이트와 시각 분리)
- [ ] 블록 추가/삭제 UX 개선

### Step 22 — 공개 홈페이지 (`[code]/page.tsx`) 점검
- [ ] 11개 섹션 데이터 빈 상태 그레이스풀 렌더링
- [ ] 모바일 반응형 재검증
- [ ] 이미지 lazy loading
- [ ] Core Web Vitals 점수 측정

### Step 23 — 통합 검증 + 배포
- [ ] 전체 Admin 플로우 Playwright 시나리오 (로그인 → 대시보드 → 콘텐츠 편집 → 저장 → 공개 사이트 확인)
- [ ] 라이트/다크 모두 시각 회귀 확인
- [ ] Production Docker 빌드 → GHCR push → Watchtower 자동 반영
- [ ] Git tag `homepage-design-v2` 체크포인트

---

## 향후 Phase (2단계 이후)

### Phase 11 — 다중 템플릿
- [ ] 명함·소상공인 등 선거 외 템플릿 타입 추가

### Phase 12 — 분석 SaaS 연동 심화
- [ ] mybot 분석 플랫폼과 SSO 통합 유지
- [ ] homepage 방문 이벤트 → mybot 대시보드 표시

### Phase 13 — 결제/구독
- [ ] 플랜별 기능 제한
- [ ] 결제 연동 (토스/카카오 등)

---

## 참고

- **git 체크포인트**: `checkpoint-before-design-cleanup-20260419` — 디자인 통일 작업 시작 전 기준점
- **기준 디자인**: mybot `/dashboard/surveys`, `/dashboard/candidates` (2026-04-19 재설계 완료 버전)
  - `/dashboard/candidates` — 5층 시각화 구조 (KPI 카드 + 레이더 + 갭 바 + 히트맵 + AI 진단)
- **금지사항** (CLAUDE.md 참조): 이모지 · 하드코딩 색상(bg-gray-50, text-gray-500 등) · 정보 중복 · 서술형 테이블 단독 사용
