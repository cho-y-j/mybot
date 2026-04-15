-- mybot(ElectionPulse) 분석 SaaS와의 SSO 연결 컬럼 추가
-- tenant_id: mybot tenants.id 와 1:1 매핑 (NULL이면 homepage 단독 사용자)
-- election_id: mybot elections.id — RAG 임베딩 시 공유 데이터 식별용

ALTER TABLE "users" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "users" ADD COLUMN "election_id" UUID;

CREATE UNIQUE INDEX "users_tenant_id_key" ON "users"("tenant_id");

-- 자동 피드 숨김/순서 조정 (AI 뉴스, 유튜브, 외부 블로그 공통)
CREATE TABLE "feed_overrides" (
  "id"         SERIAL PRIMARY KEY,
  "user_id"    INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "feed_type"  VARCHAR(20) NOT NULL,    -- ai_news | youtube | blog
  "source_key" VARCHAR(500) NOT NULL,   -- URL 또는 videoId
  "hidden"     BOOLEAN NOT NULL DEFAULT false,
  "pin_order"  INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "uq_feed_override" UNIQUE ("user_id", "feed_type", "source_key")
);
CREATE INDEX "feed_overrides_user_id_feed_type_idx" ON "feed_overrides"("user_id", "feed_type");
