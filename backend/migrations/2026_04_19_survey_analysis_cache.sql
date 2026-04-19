-- 여론조사 AI 심층 분석 결과 캐시 (election × tenant 별 최신 1건)
-- Why: 매번 Opus 재호출 비용 + 대기시간 → 결과 저장 후 페이지 진입 시 즉시 표시
-- 무효화: 여론조사 건수/우리 후보 변경 시 또는 7일 경과 시 stale 표시

CREATE TABLE IF NOT EXISTS survey_analysis_cache (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id  UUID NOT NULL,
  tenant_id    UUID NOT NULL,
  result       JSONB NOT NULL,                      -- analyze_survey_deep 전체 반환값
  surveys_count    INTEGER NOT NULL DEFAULT 0,      -- 캐시 시점 여론조사 건수
  questions_count  INTEGER NOT NULL DEFAULT 0,      -- 캐시 시점 질문 건수
  our_candidate_id UUID,                            -- 캐시 시점 우리 후보 id
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (election_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_survey_cache_election_tenant
  ON survey_analysis_cache (election_id, tenant_id);
