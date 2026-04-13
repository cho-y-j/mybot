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

### 알려진 미해결 이슈
- [ ] 챗 대화 이력 저장 안 됨 (ChatMessage 테이블 없음)
- [ ] 수집 데이터 삭제 기능 없음 (오염 데이터 제거 불가)
- [ ] tasks.py (Celery 스케줄) AI 스크리닝 미적용 (instant.py만 적용됨)
- [ ] 어제 미분석 135건 재분석 필요

---

# Phase 3 — 현재 진행 중

## P3-01. 챗 대화 이력 저장
- [ ] ChatMessage 모델 생성 (tenant_id, election_id, user_id, role, content, created_at)
- [ ] /chat/send 엔드포인트에서 질문+응답 DB 저장
- [ ] 이전 대화를 AI 컨텍스트에 포함 (최근 N개)
- [ ] 대화 삭제 API + 프론트엔드 UI

## P3-02. 수집 데이터 삭제 기능
- [ ] 뉴스/커뮤니티/유튜브 개별 항목 삭제 API
- [ ] 프론트엔드: 각 목록에 삭제 버튼
- [ ] "AI 자동수집 데이터입니다. 오류 발견 시 삭제해주세요" 안내 문구
- [ ] 삭제 시 audit_log 기록

## P3-03. Celery 스케줄 수집에 AI 스크리닝 적용
- [ ] tasks.py의 collect_news/community/youtube에도 ai_screening 적용

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
