-- ==========================================================================
-- P2-01 Race-Shared 확장 — Community + YouTube
--
-- 이전 마이그레이션: p2_01_race_shared_migration.sql (news 완료)
-- 이번 작업: race_community_posts + race_youtube_videos + 각 camp_analysis
--
-- 실행:
--   psql -h localhost -p 5440 -U electionpulse -d electionpulse \
--        -f backend/scripts/p2_01_race_shared_community_youtube.sql
-- ==========================================================================

BEGIN;

-- ──────────────── Community ────────────────

\echo '===== 1. race_community_posts 테이블 생성 ====='

CREATE TABLE IF NOT EXISTS race_community_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,

    -- 원본 데이터 (tenant 중립)
    title VARCHAR(500) NOT NULL,
    url VARCHAR(1000) NOT NULL,
    source VARCHAR(200),
    content_snippet TEXT,
    platform VARCHAR(50),
    issue_category VARCHAR(100),
    engagement JSONB,
    published_at TIMESTAMPTZ,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Race-level AI 분석
    ai_summary TEXT,
    ai_topics JSONB DEFAULT '[]'::jsonb,
    ai_threat_level VARCHAR(20),
    sentiment VARCHAR(20),
    sentiment_score FLOAT,
    sentiment_verified BOOLEAN DEFAULT FALSE,
    ai_analyzed_at TIMESTAMPTZ,

    CONSTRAINT uq_race_community_url_per_election UNIQUE (election_id, url)
);

CREATE INDEX IF NOT EXISTS ix_race_community_election_date
    ON race_community_posts(election_id, published_at DESC NULLS LAST);

\echo '===== 2. race_community_camp_analysis 테이블 생성 ====='

CREATE TABLE IF NOT EXISTS race_community_camp_analysis (
    race_community_id UUID NOT NULL REFERENCES race_community_posts(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id UUID,

    is_about_our_candidate BOOLEAN DEFAULT FALSE,
    strategic_quadrant VARCHAR(20),
    strategic_value VARCHAR(20),
    action_type VARCHAR(20),
    action_priority VARCHAR(10),
    action_summary TEXT,
    ai_reason TEXT,
    relevance_score FLOAT,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (race_community_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS ix_rcca_tenant_quadrant
    ON race_community_camp_analysis(tenant_id, strategic_quadrant);

-- ──────────────── YouTube ────────────────

\echo '===== 3. race_youtube_videos 테이블 생성 ====='

CREATE TABLE IF NOT EXISTS race_youtube_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,

    -- 원본 데이터
    video_id VARCHAR(50) NOT NULL,
    title VARCHAR(500) NOT NULL,
    channel VARCHAR(200),
    description_snippet TEXT,
    thumbnail_url VARCHAR(500),
    views INT DEFAULT 0,
    likes INT DEFAULT 0,
    comments_count INT DEFAULT 0,
    published_at TIMESTAMPTZ,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Race-level AI 분석
    ai_summary TEXT,
    ai_topics JSONB DEFAULT '[]'::jsonb,
    ai_threat_level VARCHAR(20),
    sentiment VARCHAR(20),
    sentiment_score FLOAT,
    sentiment_verified BOOLEAN DEFAULT FALSE,
    ai_analyzed_at TIMESTAMPTZ,

    CONSTRAINT uq_race_youtube_video_per_election UNIQUE (election_id, video_id)
);

CREATE INDEX IF NOT EXISTS ix_race_youtube_election_date
    ON race_youtube_videos(election_id, published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS ix_race_youtube_views
    ON race_youtube_videos(election_id, views DESC);

\echo '===== 4. race_youtube_camp_analysis 테이블 생성 ====='

CREATE TABLE IF NOT EXISTS race_youtube_camp_analysis (
    race_youtube_id UUID NOT NULL REFERENCES race_youtube_videos(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id UUID,

    is_about_our_candidate BOOLEAN DEFAULT FALSE,
    strategic_quadrant VARCHAR(20),
    strategic_value VARCHAR(20),
    action_type VARCHAR(20),
    action_priority VARCHAR(10),
    action_summary TEXT,
    ai_reason TEXT,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (race_youtube_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS ix_ryca_tenant_quadrant
    ON race_youtube_camp_analysis(tenant_id, strategic_quadrant);

-- ──────────────── 데이터 이관 ────────────────

\echo '===== 5. community_posts → race_community_posts 이관 ====='

INSERT INTO race_community_posts (
    id, election_id, title, url, source, content_snippet, platform,
    issue_category, engagement, published_at, collected_at,
    ai_summary, ai_topics, ai_threat_level,
    sentiment, sentiment_score, sentiment_verified, ai_analyzed_at
)
SELECT DISTINCT ON (election_id, url)
    gen_random_uuid(),
    election_id,
    title, url, source, content_snippet, platform,
    issue_category, engagement, published_at, collected_at,
    ai_summary, ai_topics, ai_threat_level,
    sentiment, sentiment_score, sentiment_verified, ai_analyzed_at
FROM community_posts
WHERE election_id IS NOT NULL AND url IS NOT NULL
ORDER BY election_id, url,
    ai_analyzed_at DESC NULLS LAST,
    collected_at DESC
ON CONFLICT (election_id, url) DO NOTHING;

SELECT COUNT(*) AS race_community_rows FROM race_community_posts;

\echo '===== 6. community camp analysis 이관 ====='

INSERT INTO race_community_camp_analysis (
    race_community_id, tenant_id, candidate_id,
    is_about_our_candidate, strategic_quadrant, strategic_value,
    action_type, action_priority, action_summary, ai_reason, relevance_score
)
SELECT
    rcp.id,
    cp.tenant_id,
    cp.candidate_id,
    COALESCE(cp.is_about_our_candidate, FALSE),
    cp.strategic_quadrant,
    cp.strategic_value,
    cp.action_type,
    cp.action_priority,
    cp.action_summary,
    cp.ai_reason,
    cp.relevance_score
FROM community_posts cp
JOIN race_community_posts rcp
    ON rcp.election_id = cp.election_id
   AND rcp.url = cp.url
WHERE cp.tenant_id IS NOT NULL
ON CONFLICT (race_community_id, tenant_id) DO NOTHING;

SELECT COUNT(*) AS community_camp_analyses FROM race_community_camp_analysis;

\echo '===== 7. youtube_videos → race_youtube_videos 이관 ====='

INSERT INTO race_youtube_videos (
    id, election_id, video_id, title, channel, description_snippet,
    thumbnail_url, views, likes, comments_count,
    published_at, collected_at,
    ai_summary, ai_topics, ai_threat_level,
    sentiment, sentiment_score, sentiment_verified, ai_analyzed_at
)
SELECT DISTINCT ON (election_id, video_id)
    gen_random_uuid(),
    election_id, video_id, title, channel, description_snippet,
    thumbnail_url, views, likes, comments_count,
    published_at, collected_at,
    ai_summary, ai_topics, ai_threat_level,
    sentiment, sentiment_score, sentiment_verified, ai_analyzed_at
FROM youtube_videos
WHERE election_id IS NOT NULL AND video_id IS NOT NULL
ORDER BY election_id, video_id,
    ai_analyzed_at DESC NULLS LAST,
    collected_at DESC
ON CONFLICT (election_id, video_id) DO NOTHING;

SELECT COUNT(*) AS race_youtube_rows FROM race_youtube_videos;

\echo '===== 8. youtube camp analysis 이관 ====='

INSERT INTO race_youtube_camp_analysis (
    race_youtube_id, tenant_id, candidate_id,
    is_about_our_candidate, strategic_quadrant, strategic_value,
    action_type, action_priority, action_summary, ai_reason
)
SELECT
    ryv.id,
    yv.tenant_id,
    yv.candidate_id,
    COALESCE(yv.is_about_our_candidate, FALSE),
    yv.strategic_quadrant,
    yv.strategic_value,
    yv.action_type,
    yv.action_priority,
    yv.action_summary,
    yv.ai_reason
FROM youtube_videos yv
JOIN race_youtube_videos ryv
    ON ryv.election_id = yv.election_id
   AND ryv.video_id = yv.video_id
WHERE yv.tenant_id IS NOT NULL
ON CONFLICT (race_youtube_id, tenant_id) DO NOTHING;

SELECT COUNT(*) AS youtube_camp_analyses FROM race_youtube_camp_analysis;

\echo '===== 9. 이관 통계 ====='

SELECT
    (SELECT COUNT(*) FROM community_posts) AS legacy_community,
    (SELECT COUNT(*) FROM race_community_posts) AS race_community,
    (SELECT COUNT(*) FROM race_community_camp_analysis) AS community_analyses,
    (SELECT COUNT(*) FROM youtube_videos) AS legacy_youtube,
    (SELECT COUNT(*) FROM race_youtube_videos) AS race_youtube,
    (SELECT COUNT(*) FROM race_youtube_camp_analysis) AS youtube_analyses;

COMMIT;

\echo '===== 완료 ====='
