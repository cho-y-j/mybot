-- ========================================================================
-- Candidate 테이블 election 단위 통합 (2026-04-15)
-- ========================================================================
-- 목적: 같은 선거의 같은 이름 후보는 1개 레코드만 존재 → 모든 캠프 공유
-- 원리: news_articles와 동일 (election-shared)
-- ========================================================================
-- 단계:
-- 1. 같은 election + name으로 그룹화하여 canonical 후보 1개 선정 (최초 생성)
-- 2. tenant_elections.our_candidate_id를 canonical로 업데이트
-- 3. 모든 FK 테이블의 candidate_id를 canonical로 업데이트
-- 4. 중복 candidate 행 삭제
-- 5. 스키마 변경: tenant_id nullable, UNIQUE(election_id, name)
-- ========================================================================

BEGIN;

-- 1. canonical candidate 선정 (election_id + name 조합으로 MIN created_at)
CREATE TEMP TABLE canonical_cands AS
SELECT DISTINCT ON (election_id, name)
    id AS canonical_id,
    election_id,
    name
FROM candidates
ORDER BY election_id, name, created_at NULLS LAST, id;

-- 2. 매핑 테이블 (old_id → canonical_id)
CREATE TEMP TABLE cand_mapping AS
SELECT c.id AS old_id,
       cc.canonical_id,
       c.tenant_id,
       c.is_our_candidate,
       cc.election_id,
       c.name
FROM candidates c
JOIN canonical_cands cc ON cc.election_id = c.election_id AND cc.name = c.name;

-- 3. FK 테이블들 업데이트 (candidate_id 재배정)

-- news_articles
UPDATE news_articles na
SET candidate_id = cm.canonical_id
FROM cand_mapping cm
WHERE na.candidate_id = cm.old_id
  AND na.candidate_id != cm.canonical_id;

-- community_posts
UPDATE community_posts cp
SET candidate_id = cm.canonical_id
FROM cand_mapping cm
WHERE cp.candidate_id = cm.old_id
  AND cp.candidate_id != cm.canonical_id;

-- youtube_videos
UPDATE youtube_videos yv
SET candidate_id = cm.canonical_id
FROM cand_mapping cm
WHERE yv.candidate_id = cm.old_id
  AND yv.candidate_id != cm.canonical_id;

-- news_strategic_views
UPDATE news_strategic_views sv
SET candidate_id = cm.canonical_id
FROM cand_mapping cm
WHERE sv.candidate_id = cm.old_id
  AND sv.candidate_id != cm.canonical_id;

-- community_strategic_views
UPDATE community_strategic_views sv
SET candidate_id = cm.canonical_id
FROM cand_mapping cm
WHERE sv.candidate_id = cm.old_id
  AND sv.candidate_id != cm.canonical_id;

-- youtube_strategic_views
UPDATE youtube_strategic_views sv
SET candidate_id = cm.canonical_id
FROM cand_mapping cm
WHERE sv.candidate_id = cm.old_id
  AND sv.candidate_id != cm.canonical_id;

-- sentiment_daily
UPDATE sentiment_daily sd
SET candidate_id = cm.canonical_id
FROM cand_mapping cm
WHERE sd.candidate_id = cm.old_id
  AND sd.candidate_id != cm.canonical_id;

-- ad_campaigns
UPDATE ad_campaigns ac
SET candidate_id = cm.canonical_id
FROM cand_mapping cm
WHERE ac.candidate_id = cm.old_id
  AND ac.candidate_id != cm.canonical_id;

-- keywords
UPDATE keywords k
SET candidate_id = cm.canonical_id
FROM cand_mapping cm
WHERE k.candidate_id = cm.old_id
  AND k.candidate_id != cm.canonical_id;

-- 4. tenant_elections.our_candidate_id 업데이트 — 각 캠프의 "내 후보" (is_our_candidate=true) 레코드의 canonical
UPDATE tenant_elections te
SET our_candidate_id = cm.canonical_id
FROM cand_mapping cm
WHERE cm.tenant_id = te.tenant_id
  AND cm.election_id = te.election_id
  AND cm.is_our_candidate = true;

-- elections.our_candidate_id도 동일하게 (legacy)
UPDATE elections e
SET our_candidate_id = cm.canonical_id
FROM cand_mapping cm
WHERE cm.tenant_id = e.tenant_id
  AND cm.election_id = e.id
  AND cm.is_our_candidate = true;

-- 5. canonical이 아닌 중복 candidate 삭제
DELETE FROM candidates c
WHERE c.id NOT IN (SELECT canonical_id FROM canonical_cands);

-- 6. homonym_filters 병합 — 모든 캠프 버전을 union (canonical 하나로 통합됐지만 혹시 모를 잔여)
-- canonical 후보에 다른 캠프가 갖고 있던 homonym_filters 병합은 이미 삭제됐으므로 생략

-- 7. 스키마 변경
ALTER TABLE candidates ALTER COLUMN tenant_id DROP NOT NULL;

-- 기존 UNIQUE (tenant_id, election_id, name)이 있으면 제거 후 신규 추가
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_candidate_per_election_tenant') THEN
        ALTER TABLE candidates DROP CONSTRAINT uq_candidate_per_election_tenant;
    END IF;
END $$;

ALTER TABLE candidates ADD CONSTRAINT uq_candidate_per_election UNIQUE (election_id, name);

COMMIT;

-- 검증
SELECT 'candidates' as t, COUNT(*) as total,
       COUNT(DISTINCT election_id) as elections,
       COUNT(DISTINCT (election_id, name)) as unique_name_per_election
FROM candidates;

SELECT e.name as election, c.name, c.is_our_candidate, c.tenant_id
FROM candidates c
JOIN elections e ON e.id = c.election_id
ORDER BY e.name, c.priority;
