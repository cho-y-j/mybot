# 배포 자동화 & 체크리스트 — 2026-04-18 신설

모든 수정·배포가 **로컬 검증 → 자동화 배포**로 흐르도록 표준화.
이 문서는 매 세션 시작 시 체크리스트로 활용.

---

## 🔐 자격증명 관리

| 파일 | 역할 | git 추적 | 백업 |
|---|---|---|---|
| `docker/.env.server` | SMTP, Naver, Google, NEC 등 API 키 | ❌ (`.gitignore`) | 수동 — 서버에만 |
| `~/.docker/config.json` | GHCR 로그인 토큰 | ❌ | 재로그인 가능 |
| `backend/keys/jwt_*.pem` | JWT 서명 키 | ❌ | **서버 분실 시 복구 불가 — 별도 백업 필수** |

**SMTP 변경 시**: `docker/.env.server` 편집 → `docker compose up -d --force-recreate backend celery-worker celery-beat` (재시작으로 env 재로딩). 코드 변경 불필요.

---

## 🚀 배포 플로우 (표준)

```
[코드 수정] → [로컬 빌드] → [Hot-swap 검증] → [Playwright 검증] → [Docker 빌드] → [GHCR push] → [컨테이너 recreate] → [git commit/push] → [GitHub Actions 자동 빌드]
```

**자동화 스크립트**: `scripts/deploy.sh` 참조 (아래 섹션).

### 표준 배포 — homepage / frontend
```bash
./scripts/deploy.sh homepage          # 기본: 로컬 빌드 + hot-swap (빠른 검증)
./scripts/deploy.sh homepage --full   # Docker 빌드 + push + recreate (완전 배포)
./scripts/deploy.sh homepage --commit "feat: 메시지"  # git commit + push도 함께
```

### 표준 배포 — backend (파이썬, next build 없음)
```bash
./scripts/deploy.sh backend --full    # Docker 빌드 + push + recreate
```

---

## 📋 오늘 (2026-04-18) 남은 작업 체크리스트

### 🔴 핵심 기능
- [x] Phase A: YouTube 채널 등록 + 개별 영상 수동 추가 빌더 UI
- [x] NPM /api/public/ homepage 라우팅
- [x] 뉴스 AI 자동수집 엄격 필터
- [x] Hero 슬로건 편집 가능화
- [x] SMTP 자격증명 저장 (pcon1613@gmail.com)
- [ ] **메일 발송 서비스** (aiosmtplib) — 브리핑·보고서 연결
- [ ] 블로그 블록 신규 (Videos 구조 복사)
- [ ] AI 자동 채널 감지 품질 개선 (prompt + 파싱)

### 🟡 운영 품질
- [ ] 기존 5개 캠프 자동감지 백필
- [ ] 쉬운 모드 나머지 페이지 디자인 통일
- [ ] Homepage admin 배색 (Airtable 팔레트로)

### 🟢 인프라
- [ ] Watchtower 복구 (git push만으로 자동 배포)
- [ ] Docker BuildKit 캐시 활용 (빌드 8분→60초)

### 🔵 대규모 재작업
- [ ] 여론조사 3단 계층 재설계 (별도 세션)

---

## ✅ 배포 전 체크리스트 (매 수정 시 필수)

1. [ ] 로컬 `next build` 통과 (homepage/frontend)
2. [ ] Hot-swap 적용 후 HTTP 200
3. [ ] Playwright로 변경 화면 DOM 확인 (자동 스크립트 또는 Claude 직접)
4. [ ] 사용자 관점 스모크 테스트 (핵심 플로우 1~2개 실제 조작)
5. [ ] TypeScript/ESLint 에러 없음
6. [ ] DB 마이그레이션 있으면 백업 먼저
7. [ ] `.env.server`에 비밀키 노출 안 됨 (git status 확인)
8. [ ] Docker 빌드 성공
9. [ ] GHCR push 성공
10. [ ] 배포된 컨테이너 헬스체크 통과
11. [ ] git commit — 메시지에 "Why" 포함
12. [ ] git push → GitHub Actions 빌드 시작 확인

---

## 🛑 배포 중단 기준

다음 중 하나라도 발생하면 **즉시 중단**하고 원인 파악:
- 로컬 빌드 실패
- Playwright 검증 실패
- HTTP 5xx 응답
- 브라우저 콘솔에 red error 새로 생김
- DB 데이터 유실 징후

---

## 📚 참고

- **CLAUDE.md** — 프로젝트 전체 절대 룰
- **homepage/CLAUDE.md** — 배포 워크플로우 상세
- **PLAN.md** — 작업 진행 체크리스트
