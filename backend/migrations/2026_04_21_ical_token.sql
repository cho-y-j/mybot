-- Phase 4 iCal export — 캠프별 캘린더 구독 토큰
-- 2026-04-21

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ical_token TEXT;
CREATE INDEX IF NOT EXISTS idx_tenants_ical_token ON tenants(ical_token)
  WHERE ical_token IS NOT NULL;

COMMENT ON COLUMN tenants.ical_token IS
  '캠프 전용 iCal 구독 토큰. 외부 캘린더(Google/Apple)에서 /api/ical/{token}.ics 구독';
