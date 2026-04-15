#!/bin/bash
set -e

echo "=== MyHome 개발 환경 설정 ==="

# Check for Docker
if ! command -v docker &> /dev/null; then
  echo "ERROR: Docker가 설치되지 않았습니다. Docker를 먼저 설치해주세요."
  exit 1
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js가 설치되지 않았습니다. Node.js를 먼저 설치해주세요."
  exit 1
fi

echo "Docker: $(docker --version)"
echo "Node.js: $(node --version)"
echo "npm: $(npm --version)"

# Copy .env.example to .env if not exists
if [ ! -f .env ]; then
  echo ".env 파일이 없습니다. .env.example에서 복사합니다..."
  cp .env.example .env
  echo ".env 파일이 생성되었습니다. 필요한 값을 수정해주세요."
else
  echo ".env 파일이 이미 존재합니다."
fi

# Start DB and Redis
echo "Docker 서비스 시작 (db, redis)..."
docker compose up -d db redis

# Wait for DB to be ready
echo "데이터베이스 준비 대기 중..."
until docker compose exec -T db pg_isready -U myhome 2>/dev/null; do
  sleep 2
done
echo "데이터베이스가 준비되었습니다."

# Install dependencies
echo "npm 패키지 설치 중..."
npm install

# Run migrations
echo "데이터베이스 마이그레이션 실행 중..."
npx prisma migrate deploy

# Seed database
echo "초기 데이터 시드 중..."
npx prisma db seed

echo ""
echo "=== 설정 완료! ==="
echo "개발 서버 시작: npm run dev"
echo "관리자 페이지: http://localhost:3000/super-admin/login"
