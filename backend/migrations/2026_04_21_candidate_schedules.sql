-- 2026-04-21: 후보자 일정 관리 v2 (Candidate Schedules)
-- Phase 1 — 핵심 입력·회고
-- 참고: PLAN.md L85 이후 전체 섹션

-- ──────────────── ENUMs ────────────────────────────────────────────────────

DO $$ BEGIN
    CREATE TYPE schedule_category AS ENUM (
        'rally',       -- 유세
        'street',      -- 거리인사
        'debate',      -- 토론·간담회
        'broadcast',   -- 방송출연
        'interview',   -- 인터뷰
        'meeting',     -- 회의
        'supporter',   -- 지지자모임
        'voting',      -- 투표일정
        'internal',    -- 내부일정
        'other'        -- 기타
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE schedule_visibility AS ENUM ('public', 'internal');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE schedule_status AS ENUM ('planned', 'in_progress', 'done', 'canceled');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────── candidate_schedules ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS candidate_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- 내용
    title VARCHAR(200) NOT NULL,
    description TEXT,

    -- 위치
    location VARCHAR(300),
    location_url TEXT,                           -- 카카오맵 링크 (자동 생성)
    location_lat DOUBLE PRECISION,               -- 지오코딩 결과 (비동기 백필)
    location_lng DOUBLE PRECISION,
    admin_sido VARCHAR(30),                      -- 히트맵용 ("충청북도")
    admin_sigungu VARCHAR(50),                   -- ("청주시 상당구")
    admin_dong VARCHAR(50),                      -- ("용암동")
    admin_ri VARCHAR(50),                        -- 시골 읍면 전용

    -- 시간
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    all_day BOOLEAN NOT NULL DEFAULT false,

    -- 분류 및 상태
    category schedule_category NOT NULL DEFAULT 'other',
    visibility schedule_visibility NOT NULL DEFAULT 'internal',
    status schedule_status NOT NULL DEFAULT 'planned',

    -- 결과 (완료 후 캠프 입력)
    result_summary TEXT,                         -- 한 줄 자유 입력
    result_mood VARCHAR(10),                     -- good | normal | bad (퀵 선택)
    attended_count INT,
    media_coverage JSONB NOT NULL DEFAULT '[]'::jsonb,  -- Phase 3 AI 자동 매칭

    -- 반복 일정
    recurrence_rule TEXT,                        -- RRULE, 예: "FREQ=WEEKLY;BYDAY=TU"
    parent_schedule_id UUID REFERENCES candidate_schedules(id) ON DELETE CASCADE,

    -- 일괄 붙여넣기 그룹 식별 (취소/롤백용)
    source_input_id UUID,

    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 주요 인덱스
CREATE INDEX IF NOT EXISTS idx_cs_election_time
    ON candidate_schedules (election_id, starts_at DESC);

CREATE INDEX IF NOT EXISTS idx_cs_candidate_time
    ON candidate_schedules (candidate_id, starts_at DESC);

CREATE INDEX IF NOT EXISTS idx_cs_visibility_time
    ON candidate_schedules (visibility, ends_at)
    WHERE visibility = 'public' AND status != 'canceled';

CREATE INDEX IF NOT EXISTS idx_cs_status_ends
    ON candidate_schedules (status, ends_at)
    WHERE status IN ('planned', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_cs_admin_dong
    ON candidate_schedules (candidate_id, admin_dong)
    WHERE admin_dong IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cs_source_input
    ON candidate_schedules (source_input_id)
    WHERE source_input_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cs_tenant_time
    ON candidate_schedules (tenant_id, starts_at DESC);

-- ──────────────── 캠프 설정 (홈페이지 자동 공개 기본값) ────────────────────

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS schedule_default_public BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.schedule_default_public IS
    '새 일정을 자동으로 홈페이지 공개할지 (기본 false). 캠프 설정에서 1회 결정';

-- ──────────────── updated_at 자동 갱신 트리거 ─────────────────────────────

CREATE OR REPLACE FUNCTION candidate_schedules_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_candidate_schedules_updated_at ON candidate_schedules;
CREATE TRIGGER trg_candidate_schedules_updated_at
    BEFORE UPDATE ON candidate_schedules
    FOR EACH ROW
    EXECUTE FUNCTION candidate_schedules_set_updated_at();
