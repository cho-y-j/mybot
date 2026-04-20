-- 2026-04-20: 이메일 브리핑 수신자 테이블
-- 기존: tenant owner 1명에게만 자동 발송 (get_tenant_email_sync)
-- 신규: 복수 수신자 등록 + 타입별 on/off

CREATE TABLE IF NOT EXISTS email_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    receive_morning BOOLEAN NOT NULL DEFAULT true,
    receive_afternoon BOOLEAN NOT NULL DEFAULT true,
    receive_daily BOOLEAN NOT NULL DEFAULT true,
    receive_weekly BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS ix_email_recipients_tenant ON email_recipients(tenant_id);
