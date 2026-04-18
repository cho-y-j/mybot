# ElectionPulse 수정 플랜 & 체크리스트

**최근 갱신**: 2026-04-18
**현재 단계**: 기능·디자인 전면 점검 (이전 빌드 미반영 복구 포함)
**검수 대상**: Tenant `5403b830` / Election `e0eacdb9` (우리=김진균, 경쟁=조동욱/김성근/신문규/윤건영)

**근본 문제**: 이전 세션에서 수정한 코드가 Docker 빌드 캐시 + Watchtower 자동 복원으로 반영 안 됨.
**원칙**: 모든 수정 한꺼번에 완료 → **1회 빌드 → GHCR push → 배포 → 실제 검증** (하나씩 빌드 금지)
**Watchtower**: 현재 정지 중 (2026-04-16). GHCR push 완료 후 재시작.

---

## Phase A. 기능 수정 (우선순위순)

### A-1. [법률] 선거법 위반 표현 전수 검토 ★★★
- **증상**: "상대 공략", "공격", "약점 공략" 같은 직접 표현이 UI/AI 프롬프트에 존재
- **법적 근거**: 공직선거법 제251조(비방 금지), 제110조(허위사실 유포 금지)
- **검토 범위**:
  - [ ] 프론트엔드 전체 텍스트 grep ("공격", "공략", "attack", "약점")
  - [ ] 백엔드 AI 프롬프트 (ai_service, media_analyzer, ai_screening, ai_report, debate, content)
  - [ ] 4사분면 라벨 + action_type enum
  - [ ] 토론 대본/콘텐츠 생성 프롬프트
- **치환 예시**:
  - "상대 공략" → "경쟁 후보 대응 전략"
  - "공격" / "attack" → "적극 대응" / "counter"
  - "약점 공략" → "차별점 부각"
- [ ] 전수 검색 목록 작성
- [ ] UI 텍스트 치환
- [ ] AI 프롬프트 치환
- [ ] DB action_type enum 체크
- [ ] 검증

### A-2. [기능] 과거 선거 분석 — 정렬/연동/색
- **이전 커밋**: `26a382c` (2026-04-15) — 이미 수정했으나 빌드 미반영 가능성
- **증상 3건**:
  1. 정렬: 청주시 구별로 흩어짐 → 시도→시군구 정렬 필요
  2. 지역 클릭(drilldown) 시 진영 색 사라짐
  3. 22년→18년 선거년도 변경 시 데이터 갱신 안 됨
- **파일**: `frontend/src/app/dashboard/history/page.tsx`, `backend/app/elections/history_router.py`
- [ ] 커밋 코드 vs 현재 코드 비교 (26a382c 반영됐는지)
- [ ] 구역별 정렬
- [ ] drilldown 색 유지
- [ ] 년도 변경 연동
- [ ] 검증

### A-3. [기능] 여론조사 분석 — 정렬/중복/라벨
- **증상 3건**:
  1. 전체 리스트가 투표율 순 → 선거별(교육감/도지사/시장) 그룹핑 필요
  2. 해당 선거구 블록이 2번 반복됨
  3. 1개가 "도지사"로 잘못 표기 (교육감인데)
- **파일**: `frontend/src/app/dashboard/surveys/page.tsx`
- [ ] 선거별 그룹핑 정렬
- [ ] 중복 제거
- [ ] 라벨 매핑 수정
- [ ] 검증

### A-4. [기능] 후보 비교 — 차트 + 불필요 섹션
- **이전 커밋**: `712147c` (2026-04-15) — 빌드 미반영 가능성
- **증상 2건**:
  1. 여론조사 선차트 연결선 안 보임 (점만 찍힘)
  2. 역대 선거 결과 블록 → 과거 선거 페이지에 있어야. 후보 비교에서 제거
- **파일**: `frontend/src/app/dashboard/candidates/page.tsx`
- [ ] 커밋 코드 vs 현재 코드 비교
- [ ] 선차트 connectNulls + type 확인
- [ ] 역대 선거 블록 제거
- [ ] 검증

### A-5. [기능] 홈페이지 편집 세션 유지 안 됨
- **증상**: admin 로그인 후 다른 탭 클릭 시 재로그인 요구
- **원인 추정**: `mh_session` 쿠키 path/SameSite 설정, middleware 세션 검증
- **파일**: `homepage/src/lib/auth.ts`, `homepage/src/middleware.ts`
- [ ] 쿠키 path=/ 확인
- [ ] middleware 세션 검증 로직 점검
- [ ] 수정 + 검증

---

## Phase B. 디자인 정리

### B-1. 하드코딩 다크 색 일괄 정리
- `bg-[#0b0e1a]`, `bg-[#0f1117]` 등 → var(--background) 치환
- 컬러 클래스 중 장식용 → 단색 토큰으로
- [ ] grep 후 일괄 치환
- [ ] 차트 색 라이트 배경 가독성 확인

### B-2. 이모지 잔존 전수 제거
- easy/content, easy/reports 내 일부 남음 (📄, ✨ 등)
- dashboard 전체 이모지 grep
- [ ] 전수 검색 + 제거

### B-3. 모바일 반응형 전 페이지 점검
- 보고서 목록 짤림 (수정 완료)
- 나머지 페이지 확인 (후보 비교 표, 여론조사 차트 등)
- [ ] Playwright 모바일 viewport 캡처

---

## Phase C. 빌드/배포

- [ ] 모든 수정 완료 후 **1회** `DOCKER_BUILDKIT=0 docker build --no-cache` (frontend + homepage)
- [ ] `docker push` (GHCR 동기화)
- [ ] `docker stop/rm + compose up --no-deps --no-build`
- [ ] 컨테이너 내부 코드 직접 확인 (`docker exec`)
- [ ] 실제 URL curl + 브라우저 검증
- [ ] Watchtower 재시작 (`docker start watchtower`)
- [ ] git commit + push

---

## 이전 세션 완료 사항 (2026-04-16)

- ✅ /api/auth/* rate limit 제거 (NAT 공유 IP 문제)
- ✅ refresh_token jti 추가 (500 에러 해결)
- ✅ homepage 비번 = mybot 비번 동기화
- ✅ /{code}/api/auth/login 신규 라우트 (NPM /api 충돌 회피)
- ✅ /easy/settings 4탭 페이지 신설
- ✅ homepage assetPrefix '/_mh_assets' (CSS 404 해결)
- ✅ 메인 랜딩 전면 재디자인 (Airtable 톤 + 모형 대시보드 + 데모 캠프)
- ✅ Paperlogy 폰트 전역 + homepage 적용
- ✅ SVG 아이콘 opacity 0.75 전역 (시선 분산 방지)
- ✅ ThemeProvider defaultTheme="light" + 다크 토글 활성
- ✅ easy/dashboard 사이드바 단색 SVG + active 좌측 인디케이터
- ✅ easy 이모지 → 단색 SVG 교체 (사이드바/홈)
- ✅ 보고서 PDF → 새 탭에서 열기 + 모바일 목록 overflow 수정
- ✅ 가상 demo 캠프 DB 생성 (홍길동 강남구청장)
- ✅ homepage 자동 채우기 (학력/경력/공약 WebSearch 수집)
