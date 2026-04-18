#!/usr/bin/env bash
# scripts/deploy.sh — 로컬 검증 → Docker 빌드 → GHCR push → 컨테이너 recreate → git push 자동화
#
# 사용법:
#   ./scripts/deploy.sh homepage                         # 로컬 빌드 + hot-swap (빠른 검증)
#   ./scripts/deploy.sh homepage --full                  # + Docker 빌드 + push + recreate
#   ./scripts/deploy.sh homepage --full --commit "msg"   # + git commit + push
#   ./scripts/deploy.sh frontend --full
#   ./scripts/deploy.sh backend --full                   # backend는 hot-swap 없음
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SERVICE="${1:-}"
FULL=false
NO_CACHE=false
COMMIT_MSG=""

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --full)      FULL=true; shift ;;
    --no-cache)  NO_CACHE=true; shift ;;
    --rebuild)   NO_CACHE=true; shift ;;
    --commit)    COMMIT_MSG="${2:-}"; shift 2 ;;
    *)           echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$SERVICE" ]]; then
  cat <<'USAGE'
사용법: ./scripts/deploy.sh <service> [--full] [--rebuild] [--commit "msg"]
  service:    homepage | frontend | backend
  --full:     Docker 빌드 + GHCR push + 컨테이너 recreate
  --rebuild:  --no-cache 로 강제 재빌드 (기본은 캐시 활용 = 빠름)
  --commit:   git commit + main push

예:
  ./scripts/deploy.sh homepage                                # 로컬 + hot-swap만 (10초)
  ./scripts/deploy.sh homepage --full                         # 캐시 활용 빌드 (60초~2분)
  ./scripts/deploy.sh homepage --full --rebuild               # 캐시 무시 완전 재빌드 (5~8분)
  ./scripts/deploy.sh homepage --full --commit "fix: ..."     # 배포 + git push
USAGE
  exit 1
fi

log()  { printf '\033[1;36m[deploy:%s]\033[0m %s\n' "$SERVICE" "$*"; }
fail() { printf '\033[1;31m[deploy:%s FAIL]\033[0m %s\n' "$SERVICE" "$*" >&2; exit 1; }

# ───────── 1. 로컬 빌드 (homepage / frontend 만) ─────────
if [[ "$SERVICE" == "homepage" || "$SERVICE" == "frontend" ]]; then
  DIR="$ROOT/$SERVICE"
  [[ -d "$DIR" ]] || fail "디렉토리 없음: $DIR"
  log "로컬 next build (TypeScript/빌드 에러 차단)"
  (cd "$DIR" && ./node_modules/.bin/next build >/tmp/deploy_build.log 2>&1) || {
    echo "--- 빌드 로그 tail ---"; tail -20 /tmp/deploy_build.log; fail "next build 실패"
  }
  log "✓ next build 통과"
fi

# ───────── 2. Hot-swap (homepage 전용, 즉시 서버 반영 — Docker 재빌드 없이) ─────────
if [[ "$SERVICE" == "homepage" ]]; then
  CN="ep_homepage"
  log "Hot-swap: $CN 에 빌드 결과 복사"
  docker exec -u 0 "$CN" rm -rf /app/.next/static >/dev/null 2>&1 || true
  docker exec -u 0 "$CN" mkdir -p /app/.next/static >/dev/null
  docker cp "$ROOT/homepage/.next/standalone/server.js" "$CN:/app/server.js" >/dev/null
  docker cp "$ROOT/homepage/.next/standalone/.next/." "$CN:/app/.next/" >/dev/null
  docker cp "$ROOT/homepage/.next/static/." "$CN:/app/.next/static/" >/dev/null
  docker restart "$CN" >/dev/null
  sleep 4
  HTTP=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3201/)
  [[ "$HTTP" == "200" ]] || fail "Hot-swap 후 HTTP $HTTP (200 기대)"
  log "✓ Hot-swap + HTTP 200"
fi
if [[ "$SERVICE" == "frontend" ]]; then
  # frontend는 standalone 구조가 다르므로 일단 full 빌드만 지원
  if [[ "$FULL" != "true" ]]; then
    log "frontend hot-swap 미지원 — --full 로 Docker 빌드 진행 필요"
    exit 0
  fi
fi

# ───────── 3. Full 모드: Docker 빌드 + push + recreate ─────────
if [[ "$FULL" == "true" ]]; then
  if [[ "$NO_CACHE" == "true" ]]; then
    log "Docker 이미지 빌드 (--no-cache, 5~8분 소요)"
    BUILD_ARGS="--no-cache"
  else
    log "Docker 이미지 빌드 (캐시 활용, 60초~2분 예상)"
    BUILD_ARGS=""
  fi
  (cd "$ROOT/docker" && DOCKER_BUILDKIT=0 docker compose build $BUILD_ARGS "$SERVICE" > /tmp/deploy_docker.log 2>&1) || {
    echo "--- Docker 빌드 로그 tail ---"; tail -20 /tmp/deploy_docker.log; fail "Docker 빌드 실패"
  }
  log "✓ Docker 빌드 완료"

  log "GHCR push"
  (cd "$ROOT/docker" && docker compose push "$SERVICE" > /tmp/deploy_push.log 2>&1) || {
    tail -10 /tmp/deploy_push.log; fail "GHCR push 실패"
  }
  log "✓ GHCR push"

  log "컨테이너 recreate"
  if [[ "$SERVICE" == "backend" ]]; then
    (cd "$ROOT/docker" && docker compose up -d --no-deps --force-recreate backend celery-worker celery-beat > /tmp/deploy_up.log 2>&1)
  else
    (cd "$ROOT/docker" && docker compose up -d --no-deps --force-recreate "$SERVICE" > /tmp/deploy_up.log 2>&1)
  fi
  sleep 5
  log "✓ 컨테이너 재기동"
fi

# ───────── 4. git commit + push ─────────
if [[ -n "$COMMIT_MSG" ]]; then
  log "git add / commit / push main"
  git add -A
  if git diff --cached --quiet; then
    log "변경사항 없음 — commit 생략"
  else
    git commit -m "$COMMIT_MSG

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>" > /tmp/deploy_commit.log 2>&1 || { tail -5 /tmp/deploy_commit.log; fail "git commit 실패"; }
    git push origin main > /tmp/deploy_push_git.log 2>&1 || { tail -5 /tmp/deploy_push_git.log; fail "git push 실패"; }
    log "✓ git main push — GitHub Actions 자동 빌드 트리거됨"
  fi
fi

log "━━━ 완료 ━━━"
echo ""
echo "체크리스트:"
[[ "$FULL" == "true" ]] && echo "  • 프로덕션 이미지: ghcr.io/cho-y-j/mybot-$SERVICE:latest"
[[ -n "$COMMIT_MSG" ]] && echo "  • GitHub Actions: https://github.com/cho-y-j/mybot/actions"
echo "  • 브라우저 확인: https://ai.on1.kr/ (강한 새로고침)"
