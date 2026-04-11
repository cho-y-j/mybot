-- ==========================================================================
-- P2-01 Race-Shared 데이터 분리 — 스키마 마이그레이션
--
-- 목적: 같은 선거에 여러 캠프가 가입했을 때 뉴스/유튜브/커뮤니티를 중복
--      수집하는 낭비를 제거. race(election) 단위 공유 풀 + 캠프별 분석 관점.
--
-- 실행:
--   psql -h localhost -p 5440 -U electionpulse -d electionpulse \
--        -f backend/scripts/p2_01_race_shared_migration.sql
--
-- 롤백: 이 스크립트는 BEGIN/COMMIT으로 묶여 있으므로 실패 시 자동 롤백.
--      성공 후 되돌리려면 DROP TABLE race_* 만 실행.
-- ==========================================================================

BEGIN;

\echo '===== 1. race_news_articles 테이블 생성 ====='

CREATE TABLE IF NOT EXISTS race_news_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,

    -- 원본 데이터 (tenant 중립)
    title VARCHAR(500) NOT NULL,
    url VARCHAR(1000) NOT NULL,
    source VARCHAR(200),
    summary TEXT,
    platform VARCHAR(50),
    published_at TIMESTAMPTZ,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Race-level AI 분석 (tenant 중립적인 팩트 요약)
    ai_summary TEXT,
    ai_topics JSONB DEFAULT '[]'::jsonb,
    ai_threat_level VARCHAR(20),
    sentiment VARCHAR(20),
    sentiment_score FLOAT,
    sentiment_verified BOOLEAN DEFAULT FALSE,
    ai_analyzed_at TIMESTAMPTZ,

    CONSTRAINT uq_race_news_url_per_election UNIQUE (election_id, url)
);

CREATE INDEX IF NOT EXISTS ix_race_news_election_date
    ON race_news_articles(election_id, published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS ix_race_news_ai_analyzed
    ON race_news_articles(ai_analyzed_at)
    WHERE ai_analyzed_at IS NOT NULL;

\echo '===== 2. race_news_camp_analysis 테이블 생성 ====='

-- 같은 뉴스를 캠프마다 다른 관점으로 분류
-- (같은 기사가 A캠프 관점 weakness + B캠프 관점 opportunity)
CREATE TABLE IF NOT EXISTS race_news_camp_analysis (
    race_news_id UUID NOT NULL REFERENCES race_news_articles(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id UUID,  -- FK 제약은 후보 삭제 시 자동 정리

    -- Camp-specific 분류 (4사분면이 캠프마다 다를 수 있음)
    is_about_our_candidate BOOLEAN DEFAULT FALSE,
    strategic_quadrant VARCHAR(20),
    strategic_value VARCHAR(20),
    action_type VARCHAR(20),
    action_priority VARCHAR(10),
    action_summary TEXT,
    ai_reason TEXT,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (race_news_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS ix_rnca_tenant_quadrant
    ON race_news_camp_analysis(tenant_id, strategic_quadrant);
CREATE INDEX IF NOT EXISTS ix_rnca_candidate
    ON race_news_camp_analysis(candidate_id) WHERE candidate_id IS NOT NULL;

\echo '===== 3. 기존 news_articles → race_news_articles 이관 ====='

-- URL + election_id 단위 중복 제거, 가장 최신 분석 결과 선택
INSERT INTO race_news_articles (
    id, election_id, title, url, source, summary, platform,
    published_at, collected_at,
    ai_summary, ai_topics, ai_threat_level,
    sentiment, sentiment_score, sentiment_verified, ai_analyzed_at
)
SELECT DISTINCT ON (election_id, url)
    gen_random_uuid(),
    election_id,
    title, url, source, summary, platform,
    published_at, collected_at,
    ai_summary, ai_topics, ai_threat_level,
    sentiment, sentiment_score, sentiment_verified, ai_analyzed_at
FROM news_articles
WHERE election_id IS NOT NULL AND url IS NOT NULL
ORDER BY election_id, url,
    ai_analyzed_at DESC NULLS LAST,
    collected_at DESC
ON CONFLICT (election_id, url) DO NOTHING;

SELECT COUNT(*) AS race_news_rows FROM race_news_articles;

\echo '===== 4. 캠프별 분석 결과를 race_news_camp_analysis로 이관 ====='

-- 각 tenant의 원본 news_articles 관점을 camp_analysis로 복사
INSERT INTO race_news_camp_analysis (
    race_news_id, tenant_id, candidate_id,
    is_about_our_candidate, strategic_quadrant, strategic_value,
    action_type, action_priority, action_summary, ai_reason
)
SELECT
    rna.id,
    na.tenant_id,
    na.candidate_id,
    COALESCE(na.is_about_our_candidate, FALSE),
    na.strategic_quadrant,
    na.strategic_value,
    na.action_type,
    na.action_priority,
    na.action_summary,
    na.ai_reason
FROM news_articles na
JOIN race_news_articles rna
    ON rna.election_id = na.election_id
   AND rna.url = na.url
WHERE na.tenant_id IS NOT NULL
ON CONFLICT (race_news_id, tenant_id) DO NOTHING;

SELECT COUNT(*) AS camp_analysis_rows FROM race_news_camp_analysis;

\echo '===== 5. 중복 제거 효과 측정 ====='

-- 원본 news_articles 수 vs race_news_articles 수
WITH stats AS (
    SELECT
        (SELECT COUNT(*) FROM news_articles) AS original_rows,
        (SELECT COUNT(*) FROM race_news_articles) AS dedup_rows,
        (SELECT COUNT(*) FROM race_news_camp_analysis) AS camp_analyses
)
SELECT
    original_rows,
    dedup_rows,
    original_rows - dedup_rows AS deduplicated,
    ROUND(100.0 * (original_rows - dedup_rows) / NULLIF(original_rows, 0), 1) AS dedup_pct,
    camp_analyses
FROM stats;

\echo '===== 6. 검증: 선거별 분포 ====='

SELECT
    e.name AS election_name,
    COUNT(DISTINCT rna.id) AS unique_articles,
    COUNT(DISTINCT rnca.tenant_id) AS camps_analyzing,
    COUNT(rnca.race_news_id) AS total_analyses
FROM race_news_articles rna
LEFT JOIN race_news_camp_analysis rnca ON rnca.race_news_id = rna.id
LEFT JOIN elections e ON e.id = rna.election_id
GROUP BY e.id, e.name
ORDER BY unique_articles DESC;

COMMIT;

\echo '===== 완료 ====='
\echo '다음 단계: collectors/tasks.py 와 media_analyzer.py를 새 테이블 사용하도록 수정'
\echo '기존 news_articles는 deprecation 대기 상태로 유지 (바로 삭제 금지)'
