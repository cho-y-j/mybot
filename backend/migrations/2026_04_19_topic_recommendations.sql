-- 추천 주제 캐시 (election × tenant 별 최신 1건)
-- Why: AI가 이번 주 콘텐츠 주제를 10개 자동 추천 → 담당자가 출근하자마자 오늘 할 일 받음
-- 24시간 재사용, 이후 재생성. 여론조사/뉴스 데이터 변경 시 signature로 stale 감지.

CREATE TABLE IF NOT EXISTS topic_recommendations_cache (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id  UUID NOT NULL,
  tenant_id    UUID NOT NULL,
  topics       JSONB NOT NULL,                         -- [{keyword, reason, relevance, format, priority, ...}]
  context_summary JSONB,                                -- 어떤 입력으로 생성했는지 스냅샷
  inputs_signature TEXT NOT NULL DEFAULT '',           -- stale 비교용 (뉴스수/서베이수 해시)
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (election_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_topic_reco_election_tenant
  ON topic_recommendations_cache (election_id, tenant_id);
