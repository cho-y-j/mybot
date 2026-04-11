-- ==========================================================================
-- 데이터 클린업 SQL (재분석 없이 기존 데이터 정리)
-- 실행: psql -h localhost -p 5440 -U electionpulse -d electionpulse \
--           -f backend/scripts/cleanup_stale_analysis.sql
--
-- 2026-04-12 작성. 토큰 0원 — AI 호출 없이 순수 SQL로 교정.
-- ==========================================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. sentiment_verified=TRUE 인데 ai_analyzed_at IS NULL 인 부정합 수정
--    (과거 버전에서 verify만 하고 analyze를 건너뛰었거나, reset이 부분만 된 것)
-- ──────────────────────────────────────────────────────────────────────────
\echo '===== 1. sentiment_verified 부정합 수정 ====='

SELECT 'news' tbl, COUNT(*) as inconsistent_rows
FROM news_articles
WHERE sentiment_verified = TRUE AND ai_analyzed_at IS NULL
UNION ALL
SELECT 'community', COUNT(*)
FROM community_posts
WHERE sentiment_verified = TRUE AND ai_analyzed_at IS NULL
UNION ALL
SELECT 'youtube', COUNT(*)
FROM youtube_videos
WHERE sentiment_verified = TRUE AND ai_analyzed_at IS NULL;

-- 부정합 상태를 "검증 안 됨"으로 되돌림 (데이터가 이상한 것이지 검증된 게 아님)
UPDATE news_articles SET sentiment_verified = FALSE
WHERE sentiment_verified = TRUE AND ai_analyzed_at IS NULL;

UPDATE community_posts SET sentiment_verified = FALSE
WHERE sentiment_verified = TRUE AND ai_analyzed_at IS NULL;

UPDATE youtube_videos SET sentiment_verified = FALSE
WHERE sentiment_verified = TRUE AND ai_analyzed_at IS NULL;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. strategic_quadrant ↔ strategic_value 동기화 재확인 (이미 했지만 안전)
-- ──────────────────────────────────────────────────────────────────────────
\echo '===== 2. 이중 컬럼 동기화 재확인 ====='

UPDATE news_articles SET strategic_quadrant = strategic_value
WHERE strategic_value IS NOT NULL AND strategic_quadrant IS NULL;

UPDATE news_articles SET strategic_value = strategic_quadrant
WHERE strategic_quadrant IS NOT NULL AND strategic_value IS NULL;

UPDATE community_posts SET strategic_quadrant = strategic_value
WHERE strategic_value IS NOT NULL AND strategic_quadrant IS NULL;

UPDATE community_posts SET strategic_value = strategic_quadrant
WHERE strategic_quadrant IS NOT NULL AND strategic_value IS NULL;

UPDATE youtube_videos SET strategic_quadrant = strategic_value
WHERE strategic_value IS NOT NULL AND strategic_quadrant IS NULL;

UPDATE youtube_videos SET strategic_value = strategic_quadrant
WHERE strategic_quadrant IS NOT NULL AND strategic_value IS NULL;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. 동명이인 오염 — ai_reason에 "동명이인"/"무관" 있는데 strategic_quadrant가
--    neutral이 아닌 경우 강제 neutralize (AI가 이미 판단했음)
-- ──────────────────────────────────────────────────────────────────────────
\echo '===== 3. 동명이인 오염 정리 ====='

UPDATE news_articles SET
    strategic_quadrant = 'neutral',
    strategic_value = 'neutral',
    sentiment = 'neutral',
    sentiment_score = 0.0,
    action_type = 'ignore',
    action_priority = 'low',
    is_about_our_candidate = FALSE,
    candidate_id = NULL  -- 동명이인은 후보 link 제거
WHERE ai_reason ILIKE '%동명이인%'
  AND strategic_quadrant != 'neutral';

UPDATE community_posts SET
    strategic_quadrant = 'neutral',
    strategic_value = 'neutral',
    sentiment = 'neutral',
    sentiment_score = 0.0,
    action_type = 'ignore',
    action_priority = 'low',
    is_about_our_candidate = FALSE,
    candidate_id = NULL
WHERE ai_reason ILIKE '%동명이인%'
  AND strategic_quadrant != 'neutral';

UPDATE youtube_videos SET
    strategic_quadrant = 'neutral',
    strategic_value = 'neutral',
    sentiment = 'neutral',
    sentiment_score = 0.0,
    action_type = 'ignore',
    action_priority = 'low',
    is_about_our_candidate = FALSE,
    candidate_id = NULL
WHERE ai_reason ILIKE '%동명이인%'
  AND strategic_quadrant != 'neutral';

-- ──────────────────────────────────────────────────────────────────────────
-- 4. ai_reason 기반 사건/행동 재분류 교정 (2026-04-12 서승우 패턴 확장)
--    weakness로 잘못 저장된 "능동 행동 strength", "공격 기회 opportunity" 교정
-- ──────────────────────────────────────────────────────────────────────────
\echo '===== 4. 사건/행동 재분류 교정 ====='

-- weakness → strength (능동 행동 키워드)
UPDATE news_articles SET
    strategic_quadrant = 'strength',
    strategic_value = 'strength',
    sentiment = 'positive',
    sentiment_score = 0.5,
    action_type = 'promote',
    action_priority = 'medium'
WHERE strategic_quadrant = 'weakness'
  AND (
      ai_reason ILIKE '%= strength%'
      OR ai_reason ILIKE '%능동%'
      OR ai_reason ILIKE '%공식 입장%'
      OR ai_reason ILIKE '%대승적%'
      OR ai_reason ILIKE '%수용 발표%'
      OR ai_reason ILIKE '%강점%'
  )
  AND ai_reason NOT ILIKE '%weakness%';

-- weakness → opportunity (반사 이익, 공격 기회)
UPDATE news_articles SET
    strategic_quadrant = 'opportunity',
    strategic_value = 'opportunity',
    sentiment = 'negative',
    sentiment_score = -0.5,
    action_type = 'attack',
    action_priority = 'medium'
WHERE strategic_quadrant = 'weakness'
  AND (
      ai_reason ILIKE '%공격 기회%'
      OR ai_reason ILIKE '%= opportunity%'
      OR ai_reason ILIKE '%반사 이익%'
      OR ai_reason ILIKE '%직접적 기회%'
      OR ai_reason ILIKE '%우리에게 기회%'
      OR ai_reason ILIKE '%경쟁자 리스크%'
      OR ai_reason ILIKE '%적 약점%'
  )
  AND ai_reason NOT ILIKE '%우리 후보%weakness%';

-- 같은 패턴 community
UPDATE community_posts SET
    strategic_quadrant = 'strength', strategic_value = 'strength',
    sentiment = 'positive', sentiment_score = 0.5,
    action_type = 'promote', action_priority = 'medium'
WHERE strategic_quadrant = 'weakness'
  AND (ai_reason ILIKE '%= strength%' OR ai_reason ILIKE '%능동%' OR ai_reason ILIKE '%대승적%');

UPDATE community_posts SET
    strategic_quadrant = 'opportunity', strategic_value = 'opportunity',
    sentiment = 'negative', sentiment_score = -0.5,
    action_type = 'attack', action_priority = 'medium'
WHERE strategic_quadrant = 'weakness'
  AND (ai_reason ILIKE '%공격 기회%' OR ai_reason ILIKE '%반사%' OR ai_reason ILIKE '%직접적 기회%');

-- 같은 패턴 youtube
UPDATE youtube_videos SET
    strategic_quadrant = 'strength', strategic_value = 'strength',
    sentiment = 'positive', sentiment_score = 0.5,
    action_type = 'promote', action_priority = 'medium'
WHERE strategic_quadrant = 'weakness'
  AND (ai_reason ILIKE '%= strength%' OR ai_reason ILIKE '%능동%' OR ai_reason ILIKE '%대승적%');

UPDATE youtube_videos SET
    strategic_quadrant = 'opportunity', strategic_value = 'opportunity',
    sentiment = 'negative', sentiment_score = -0.5,
    action_type = 'attack', action_priority = 'medium'
WHERE strategic_quadrant = 'weakness'
  AND (ai_reason ILIKE '%공격 기회%' OR ai_reason ILIKE '%반사%' OR ai_reason ILIKE '%직접적 기회%');

-- ──────────────────────────────────────────────────────────────────────────
-- 5. 대시보드 캐시 전량 삭제 (신선한 결과 반영)
-- ──────────────────────────────────────────────────────────────────────────
\echo '===== 5. 대시보드 캐시 삭제 ====='

DELETE FROM analysis_cache
WHERE cache_type LIKE 'overview%'
   OR cache_type LIKE 'media_overview%'
   OR cache_type LIKE 'community_data%'
   OR cache_type LIKE 'youtube_data%'
   OR cache_type = 'competitor_gaps'
   OR cache_type = 'strategy_quadrant';

-- ──────────────────────────────────────────────────────────────────────────
-- 6. 최종 상태 확인
-- ──────────────────────────────────────────────────────────────────────────
\echo '===== 6. 최종 4사분면 분포 (전 테넌트) ====='

SELECT strategic_quadrant, COUNT(*) FROM news_articles
WHERE strategic_quadrant IS NOT NULL
GROUP BY strategic_quadrant ORDER BY COUNT(*) DESC;

SELECT 'community' t, strategic_quadrant, COUNT(*) FROM community_posts
WHERE strategic_quadrant IS NOT NULL
GROUP BY strategic_quadrant ORDER BY COUNT(*) DESC;

SELECT 'youtube' t, strategic_quadrant, COUNT(*) FROM youtube_videos
WHERE strategic_quadrant IS NOT NULL
GROUP BY strategic_quadrant ORDER BY COUNT(*) DESC;

-- 부정합 재확인 (0이어야 정상)
SELECT 'news inconsistent' t, COUNT(*) FROM news_articles
WHERE sentiment_verified = TRUE AND ai_analyzed_at IS NULL
UNION ALL
SELECT 'community inconsistent', COUNT(*) FROM community_posts
WHERE sentiment_verified = TRUE AND ai_analyzed_at IS NULL
UNION ALL
SELECT 'youtube inconsistent', COUNT(*) FROM youtube_videos
WHERE sentiment_verified = TRUE AND ai_analyzed_at IS NULL;

COMMIT;

\echo '===== 클린업 완료. 브라우저 하드 새로고침으로 확인하세요 ====='
