#!/bin/bash
# ElectionPulse - Development Setup Script

set -e

echo "================================================"
echo "  ElectionPulse - Development Setup"
echo "================================================"

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# 1. Python 가상환경
echo ""
echo "[1/5] Python 가상환경 생성..."
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
echo "  ✅ Python 패키지 설치 완료"

# 2. .env 파일 생성
if [ ! -f .env ]; then
    echo ""
    echo "[2/5] .env 파일 생성..."
    cp .env.example .env
    # 랜덤 시크릿 키 생성
    SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
    sed -i '' "s/change-this-to-random-64-char-string/$SECRET/" .env 2>/dev/null || true
    echo "  ✅ .env 파일 생성됨 (반드시 값을 수정해주세요!)"
else
    echo "[2/5] .env 파일이 이미 존재합니다"
fi

# 3. JWT RSA 키 생성
echo ""
echo "[3/5] JWT RSA 키 생성..."
mkdir -p keys
if [ ! -f keys/jwt_private.pem ]; then
    openssl genrsa -out keys/jwt_private.pem 2048 2>/dev/null
    openssl rsa -in keys/jwt_private.pem -pubout -out keys/jwt_public.pem 2>/dev/null
    echo "  ✅ JWT 키 생성 완료"
else
    echo "  JWT 키가 이미 존재합니다"
fi

# 4. Docker 서비스 시작
echo ""
echo "[4/5] Docker 서비스 시작 (PostgreSQL + Redis)..."
cd "$PROJECT_DIR/docker"
docker compose up -d postgres redis
echo "  ✅ DB + Redis 시작됨"

# 5. DB 마이그레이션
echo ""
echo "[5/5] 대기 중... (DB 준비)"
sleep 3

cd "$PROJECT_DIR/backend"
# Alembic 마이그레이션 (추후)
# alembic upgrade head

# 개발 서버로 테이블 자동 생성
echo "  ✅ 개발 모드: 서버 시작 시 자동 테이블 생성"

echo ""
echo "================================================"
echo "  Setup 완료!"
echo ""
echo "  서버 시작: cd backend && uvicorn app.main:app --reload"
echo "  API 문서: http://localhost:8000/api/docs"
echo "  Docker:   cd docker && docker compose up"
echo "================================================"
