# ElectionPulse 수정 플랜 & 체크리스트

**최근 갱신**: 2026-04-13
**현재 단계**: Phase 2 완료 → Phase 3 진행 중
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
- [ ] 콘텐츠 생성 시 영문 출력 간헐 발생 — CLI 모드 관련 추적 필요

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
