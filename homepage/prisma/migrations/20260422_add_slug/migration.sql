-- Add slug column (사용자 지정 공개 URL) and slug_changed_at (쿨다운 기준)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "slug" VARCHAR(30);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "slug_changed_at" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = current_schema()
       AND indexname = 'users_slug_key'
  ) THEN
    CREATE UNIQUE INDEX "users_slug_key" ON "users"("slug");
  END IF;
END$$;
