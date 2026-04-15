# MyHome 1단계 MVP 개발 체크리스트

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
