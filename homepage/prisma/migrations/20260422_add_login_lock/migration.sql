-- 계정별 로그인 잠금 (IP 기반 제한 대신) — mybot 과 동일 패턴
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "failed_login_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locked_until" TIMESTAMP(3);
