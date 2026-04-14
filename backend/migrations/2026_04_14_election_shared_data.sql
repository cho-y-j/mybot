-- ========================================================================
-- Election-shared 데이터 구조 리팩터링 (2026-04-14)
-- ========================================================================
-- 목적: 같은 선거의 원본 수집 데이터를 캠프간 공유, 전략 분석만 캠프별 분리
-- 적용 대상: news_articles, community_posts, youtube_videos
--
-- 변경 사항:
-- 1. 원본 데이터: election_id 기반, 같은 URL은 1건만 저장
-- 2. 전략 분석: 신규 테이블 *_strategic_views (tenant_id × source_id)
-- 3. 기존 중복 데이터 통합 + 캠프별 관점 데이터 이관
-- ========================================================================

BEGIN;

-- ──────────────── 1. NEWS_ARTICLES ────────────────────────────────

-- 1-1. 전략 분석 뷰 테이블 (캠프별 관점)
CREATE TABLE IF NOT EXISTS news_strategic_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    news_id UUID NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    candidate_id UUID REFERENCES candidates(id),
    strategic_quadrant VARCHAR(50),         -- strength|weakness|opportunity|threat|neutral
    strategic_value VARCHAR(20),
    action_type VARCHAR(20),                -- promote|defend|attack|monitor|ignore
    action_priority VARCHAR(10),            -- high|medium|low
    action_summary VARCHAR(300),
    is_about_our_candidate BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (news_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_news_sv_tenant ON news_strategic_views(tenant_id);
CREATE INDEX IF NOT EXISTS idx_news_sv_election ON news_strategic_views(election_id);

-- 1-2. 기존 캠프별 strategic 데이터 → 신규 테이블로 이관
INSERT INTO news_strategic_views
    (news_id, tenant_id, election_id, candidate_id,
     strategic_quadrant, strategic_value, action_type, action_priority,
     action_summary, is_about_our_candidate)
SELECT id, tenant_id, election_id, candidate_id,
       strategic_quadrant, strategic_value, action_type, action_priority,
       action_summary, is_about_our_candidate
FROM news_articles
WHERE strategic_quadrant IS NOT NULL
   OR action_type IS NOT NULL
   OR is_about_our_candidate IS NOT NULL
ON CONFLICT (news_id, tenant_id) DO NOTHING;

-- 1-3. 중복 제거 — 같은 election_id + url 중 가장 먼저 수집된 1건만 남김
DELETE FROM news_articles a
USING news_articles b
WHERE a.election_id = b.election_id
  AND a.url = b.url
  AND a.collected_at > b.collected_at;

-- 1-4. 스키마 변경
ALTER TABLE news_articles DROP CONSTRAINT IF EXISTS uq_news_url_per_tenant;
ALTER TABLE news_articles ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE news_articles ADD CONSTRAINT uq_news_url_per_election UNIQUE (election_id, url);

-- 1-5. 인덱스 재구성
DROP INDEX IF EXISTS ix_news_tenant_date;
DROP INDEX IF EXISTS ix_news_sentiment;
DROP INDEX IF EXISTS ix_news_threat;
CREATE INDEX IF NOT EXISTS ix_news_election_date ON news_articles(election_id, collected_at);
CREATE INDEX IF NOT EXISTS ix_news_election_sentiment ON news_articles(election_id, sentiment);
CREATE INDEX IF NOT EXISTS ix_news_election_relevant ON news_articles(election_id, is_relevant);


-- ──────────────── 2. COMMUNITY_POSTS ────────────────────────────────

CREATE TABLE IF NOT EXISTS community_strategic_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    candidate_id UUID REFERENCES candidates(id),
    strategic_quadrant VARCHAR(50),
    action_type VARCHAR(20),
    action_priority VARCHAR(10),
    action_summary VARCHAR(300),
    is_about_our_candidate BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (post_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_comm_sv_tenant ON community_strategic_views(tenant_id);
CREATE INDEX IF NOT EXISTS idx_comm_sv_election ON community_strategic_views(election_id);

INSERT INTO community_strategic_views
    (post_id, tenant_id, election_id, candidate_id,
     strategic_quadrant, action_type, action_priority,
     action_summary, is_about_our_candidate)
SELECT id, tenant_id, election_id, candidate_id,
       strategic_quadrant, action_type, action_priority,
       action_summary, is_about_our_candidate
FROM community_posts
WHERE strategic_quadrant IS NOT NULL
   OR action_type IS NOT NULL
   OR is_about_our_candidate IS NOT NULL
ON CONFLICT (post_id, tenant_id) DO NOTHING;

DELETE FROM community_posts a
USING community_posts b
WHERE a.election_id = b.election_id
  AND a.url = b.url
  AND a.collected_at > b.collected_at;

ALTER TABLE community_posts DROP CONSTRAINT IF EXISTS uq_community_url_per_tenant;
ALTER TABLE community_posts ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE community_posts ADD CONSTRAINT uq_community_url_per_election UNIQUE (election_id, url);

DROP INDEX IF EXISTS ix_community_tenant_date;
CREATE INDEX IF NOT EXISTS ix_community_election_date ON community_posts(election_id, collected_at);


-- ──────────────── 3. YOUTUBE_VIDEOS ────────────────────────────────

CREATE TABLE IF NOT EXISTS youtube_strategic_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID NOT NULL REFERENCES youtube_videos(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    candidate_id UUID REFERENCES candidates(id),
    strategic_quadrant VARCHAR(50),
    action_type VARCHAR(20),
    action_priority VARCHAR(10),
    action_summary VARCHAR(300),
    is_about_our_candidate BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (video_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_yt_sv_tenant ON youtube_strategic_views(tenant_id);
CREATE INDEX IF NOT EXISTS idx_yt_sv_election ON youtube_strategic_views(election_id);

INSERT INTO youtube_strategic_views
    (video_id, tenant_id, election_id, candidate_id,
     strategic_quadrant, action_type, action_priority,
     action_summary, is_about_our_candidate)
SELECT id, tenant_id, election_id, candidate_id,
       strategic_quadrant, action_type, action_priority,
       action_summary, is_about_our_candidate
FROM youtube_videos
WHERE strategic_quadrant IS NOT NULL
   OR action_type IS NOT NULL
   OR is_about_our_candidate IS NOT NULL
ON CONFLICT (video_id, tenant_id) DO NOTHING;

DELETE FROM youtube_videos a
USING youtube_videos b
WHERE a.election_id = b.election_id
  AND a.video_id = b.video_id
  AND a.collected_at > b.collected_at;

ALTER TABLE youtube_videos DROP CONSTRAINT IF EXISTS uq_youtube_per_tenant;
ALTER TABLE youtube_videos ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE youtube_videos ADD CONSTRAINT uq_youtube_per_election UNIQUE (election_id, video_id);

DROP INDEX IF EXISTS ix_youtube_tenant_date;
CREATE INDEX IF NOT EXISTS ix_youtube_election_date ON youtube_videos(election_id, collected_at);

COMMIT;

-- ========================================================================
-- 검증
-- ========================================================================
SELECT 'news_articles' as table_name,
       COUNT(*) as total,
       COUNT(DISTINCT election_id) as elections,
       COUNT(DISTINCT url) as unique_urls
FROM news_articles
UNION ALL
SELECT 'news_strategic_views', COUNT(*), COUNT(DISTINCT election_id), COUNT(DISTINCT tenant_id)
FROM news_strategic_views
UNION ALL
SELECT 'community_posts', COUNT(*), COUNT(DISTINCT election_id), COUNT(DISTINCT url)
FROM community_posts
UNION ALL
SELECT 'community_strategic_views', COUNT(*), COUNT(DISTINCT election_id), COUNT(DISTINCT tenant_id)
FROM community_strategic_views
UNION ALL
SELECT 'youtube_videos', COUNT(*), COUNT(DISTINCT election_id), COUNT(DISTINCT video_id)
FROM youtube_videos
UNION ALL
SELECT 'youtube_strategic_views', COUNT(*), COUNT(DISTINCT election_id), COUNT(DISTINCT tenant_id)
FROM youtube_strategic_views;
