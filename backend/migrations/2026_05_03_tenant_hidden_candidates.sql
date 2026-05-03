-- 캠프별 후보 숨김 (soft hide)
-- election-shared 구조에서 한 캠프가 후보를 "삭제"해도 다른 캠프는 영향 받으면 안 됨.
-- candidate row는 그대로 두고, 이 테이블에 (tenant, candidate) 를 기록하여 시야에서만 제외.
CREATE TABLE IF NOT EXISTS tenant_hidden_candidates (
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    hidden_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason       TEXT,
    hidden_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (tenant_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_thc_candidate ON tenant_hidden_candidates(candidate_id);
CREATE INDEX IF NOT EXISTS idx_thc_tenant ON tenant_hidden_candidates(tenant_id);
