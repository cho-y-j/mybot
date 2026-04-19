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

---

## ★ 배포 워크플로우 (2026-04-18 확정) — 반드시 준수

**Docker 매번 --no-cache 빌드는 8분 이상 소요. 함부로 빌드 돌리지 말 것.**

### 필수 순서
1. **코드 수정** (homepage/src/...)
2. **로컬 `next build`**: `cd homepage && ./node_modules/.bin/next build` — 컴파일 에러 차단
3. **로컬 Hot-swap 검증** (Docker 재빌드 없이):
   ```
   docker cp .next/standalone/server.js ep_homepage:/app/server.js
   docker cp .next/standalone/.next/. ep_homepage:/app/.next/
   docker cp .next/static ep_homepage:/app/.next/static
   docker restart ep_homepage
   ```
4. **Playwright MCP로 실제 렌더링 검증** — 사용자에게 스크린샷 요청 금지. Claude가 직접 확인:
   - `mcp__playwright__browser_navigate` → 해당 페이지
   - `mcp__playwright__browser_evaluate` → DOM 상태·값 확인
   - 필요 시 임시 비번 주입(`bcrypt.hashpw(b'TEST_PW_temp', gensalt(12))`) + 원본 백업 + 테스트 후 복원
5. **문제 없음 확인 후에만** Docker `--no-cache` 빌드 + `docker compose push` + `compose up --force-recreate`
6. **git commit + push** (main) → GitHub Actions가 자동으로 빌드·GHCR push 수행 — **이게 영구 배포 상태**
7. **최종 검증**: Playwright로 배포 후 한 번 더 확인

### 하지 말 것
- ❌ 로컬 검증 없이 Docker 빌드 먼저 돌리기 (8분 낭비)
- ❌ grep 검수만 하고 "수정 완료" 선언 (실제 렌더링 확인 필수)
- ❌ 사용자에게 "브라우저에서 확인해주세요" 요청 — Playwright MCP가 있으면 Claude가 직접 확인
- ❌ git commit 없이 Docker push만 → Watchtower 재시작 시 GHCR에서 pull 해서 덮어써짐. git이 진실(source of truth).

### Why (2026-04-18 사고 복기)
- 한 세션에서 Docker 빌드를 6회 이상 돌려 50분 이상 낭비
- 실제 원인은 NPM 라우팅 + 쿠키 set 방식 — Docker 빌드는 무관
- Playwright로 10초면 DOM 확인 가능한데 사용자에게 반복 테스트 요청 → 분노
- 이후 모든 UI 변경은 **로컬 build → hot-swap → Playwright 검증 → Docker 빌드 → git push** 순서 엄수

---

## ★ 디자인 절대 원칙 (2026-04-19 확정) — 반드시 준수

### 1. 이모지·무분별한 아이콘 금지
사용자가 반복적으로 강하게 요구한 사항. **어떤 UI에도 이모지를 넣지 말 것**:
- ❌ 금지: 🎯 🔥 💡 📅 ⏰ 📊 📈 📉 ⚠️ ✅ 💬 📹 📝 💎 🏷️ 🏆 🥇 🥈 🥉 🎤 📱 🏛 ⭐ 📰 🔻 💪 🚨 🤖 등 **모든 이모지**
- 강조가 필요하면: **색상 (ring/border/bg 투명도)** + **폰트 굵기** + **배지/pill** + **단색 라인 SVG** (lucide-react 등) 사용
- 섹션 헤더는 색상 텍스트 + `uppercase tracking-wider` 로 계층화
- 커밋 직전 반드시 grep 검사:
  ```
  grep -rE "🎯|🔥|💡|⚠️|✅|📹|📝|💬|📊|📈|📉|🚨|🏷️|💎|💪|🔻|🏆|🥇|🥈|🥉|🎤|📱|🏛|⭐|📅|⏰|📰|🤖" homepage/src/
  ```
  → 0이어야 함
- **예외**: 사용자가 명시적으로 "이모지 써도 된다"고 허락한 경우만

### 2. 디자인 토큰 통일 (CSS 변수 기반)
mybot `/dashboard/surveys` 기준으로 통일된 토큰을 쓴다:

**허용 패턴**:
- 배경: `bg-[var(--muted-bg)]`, `bg-blue-500/5`, `bg-green-500/5`, `bg-red-500/5`, `bg-amber-500/10`
- 테두리: `border-[var(--card-border)]`, `border-blue-500/20`, `border-red-500/30`
- 텍스트: `text-[var(--foreground)]`, `text-[var(--muted)]`
- 강조: `ring-1 ring-blue-500/30 bg-blue-500/5`
- 솔리드: 차트 바·뱃지만 (`bg-red-500 text-white` 같은 강조 pill)

**금지 패턴** (고정 명도 = 다크모드 안 됨):
- ❌ `bg-gray-50/100/200`, `bg-blue-50/100/200`, `bg-red-50/100`, `bg-green-50/100`, `bg-amber-50/100`
- ❌ `text-gray-400/500/600/700/800/900`
- ❌ `bg-slate-50/100`, `bg-zinc-50/100`

### 3. 서술형 → 시각적 진단 원칙
사용자가 "직관적"이라 부르는 것은 **텍스트/테이블이 아니라 시각화**.

**비교·경쟁 분석 UI 구조**:
1. **종합 KPI 카드** — 점수 + 순위 + 차이 (3초 인식)
2. **레이더 차트 or 차트** — 다차원 지표를 면적/선으로 (전반 강약 한눈)
3. **갭 바** — 경쟁 평균 대비 (-/+) 즉시 식별
4. **히트맵** — 전체 매트릭스 조감
5. **AI 자동 약점 진단 + 대응 버튼** — 바로 행동 연결
6. **상세 숫자 테이블은 `<details>` 접기 기본** — 검증용

### 4. 정보 중복 금지
같은 지표를 **한 페이지 내 2곳 이상 표시하지 말 것**:
- 시각화에 있으면 카드/테이블에서 제거
- 테이블에 있으면 프로필 카드 stats 제거
- 차트에 있으면 그 위 서술문에서 제거

### 5. 기간 토글이 있으면 영향받는 섹션 명확히
- 기간별로 값이 바뀌는 섹션에만 토글 적용 표시
- 기간 무관 섹션(여론조사 최신 1건 등)은 **"최신 1건"** 같은 명시적 라벨로 구분

---

## ★ 공용 기준 페이지

디자인 기준은 **mybot `/dashboard/surveys`** (CSS 변수 93개, 하드코딩 0개).  
homepage에서도 같은 토큰·같은 구조를 유지.

새 컴포넌트 작성 후 검증:
```
grep -oE "bg-(gray|slate|zinc)-(50|100|200|300)|text-gray-[0-9]+|bg-(blue|red|green|amber|purple|pink)-(50|100|200)[^/]" 파일.tsx
# → 0이어야 함
```
