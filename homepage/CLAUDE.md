# CLAUDE.md — MyHome 개발 지침

> Claude CLI가 이 프로젝트를 작업할 때 반드시 읽어야 하는 문서입니다.

## 프로젝트 개요
- **이름:** MyHome — 원페이지 홍보 사이트 + 분석 SaaS 플랫폼
- **목적:** 선거 후보 / 개인 명함 / 소상공인용 홍보 사이트를 생성·관리하는 플랫폼
- **핵심 문서:** SYSTEM_DESIGN.md (전체 아키텍처, DB 스키마, API 설계, 기능 상세)

## 기술 스택
- **프레임워크:** Next.js 14 (App Router, TypeScript)
- **스타일링:** Tailwind CSS + Supanova Design Skill (고급 랜딩 디자인)
- **ORM:** Prisma
- **DB:** PostgreSQL 16
- **캐시:** Redis 7
- **파일처리:** Sharp (이미지 압축/리사이즈)
- **차트:** Chart.js 4 또는 Recharts
- **배포:** Docker Compose → 자체 VPS

## 개발 규칙

### 코드 스타일
- TypeScript strict mode 사용
- 컴포넌트: 함수형 + React hooks
- 파일명: kebab-case (예: `user-list.tsx`)
- API Route: Route Handlers (app/api/ 디렉토리)
- 에러 처리: try-catch + 일관된 에러 응답 형태 `{ success: false, error: "message" }`
- 성공 응답: `{ success: true, data: {...} }`

### 디자인 원칙 (Supanova Design Skill 기반)
- 다크 모드 기반 프리미엄 관리자 UI
- 고객 홈페이지는 밝은 테마 (커스텀 가능)
- Pretendard 폰트 (한국어 최적화)
- 그라데이션, 글래스모피즘은 절제된 사용
- 모바일 퍼스트 반응형

### DB 작업
- 스키마 변경 시 반드시 `npx prisma migrate dev --name 변경_설명`
- SYSTEM_DESIGN.md 섹션 3의 스키마를 Prisma 형태로 변환
- 모든 쿼리는 Prisma 클라이언트 사용 (Raw SQL 지양)

### 보안
- 모든 API는 인증 미들웨어 거치기
- 슈퍼 관리자 API: `requireSuperAdmin()` 미들웨어
- 고객 API: `requireUser()` + 자기 데이터만 접근 가능
- 파일 업로드: MIME 타입 + 확장자 + 매직바이트 3중 검증
- 비밀번호: bcrypt (saltRounds: 12)

### 파일 구조
- SYSTEM_DESIGN.md 섹션 8의 디렉토리 구조를 정확히 따를 것
- 새 파일 생성 시 해당 구조에 맞는 위치에 배치
- 공용 컴포넌트는 src/components/ui/
- 템플릿 관련은 src/components/templates/{type}/

## 자주 참조하는 섹션
- DB 스키마: SYSTEM_DESIGN.md 섹션 3
- 슈퍼 관리자 기능: SYSTEM_DESIGN.md 섹션 4
- 고객 홈페이지: SYSTEM_DESIGN.md 섹션 5
- 고객 관리자: SYSTEM_DESIGN.md 섹션 6
- API 엔드포인트: SYSTEM_DESIGN.md 섹션 7
- 디렉토리 구조: SYSTEM_DESIGN.md 섹션 8

## 개발 순서 (1단계 MVP)
1. 프로젝트 초기화 (Next.js + Prisma + Tailwind + Docker)
2. DB 스키마 작성 + 마이그레이션
3. 인증 시스템 (로그인/세션/미들웨어)
4. 슈퍼 관리자 UI + API
5. 고객 홈페이지 렌더링 (선거 템플릿 SSR)
6. 고객 관리자 UI + API (콘텐츠 CRUD)
7. 파일 업로드 시스템
8. 방문자 추적 시스템
9. Docker 배포 구성

## 참고 프로젝트
- 기존 votesite: https://votesite-phi.vercel.app/ssw/ (선거 홍보 사이트 참고)
- mybot_ver2: /Users/jojo/pro/mybot_ver2(영진_클로드용)/ (분석 엔진 참고, 2단계 이후)
