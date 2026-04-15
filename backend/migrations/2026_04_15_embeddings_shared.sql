-- election-shared 임베딩 구조 전환
-- shared types (news/community/youtube): tenant_id=NULL, election_id로 1건만
-- private types (report/briefing/content): 기존대로 tenant_id별

ALTER TABLE embeddings ALTER COLUMN tenant_id DROP NOT NULL;

-- shared 타입 중복 정리: election_id+source_type+source_id 기준 1건만 남김
DELETE FROM embeddings e1
WHERE source_type IN ('news','community','youtube')
  AND EXISTS (
    SELECT 1 FROM embeddings e2
    WHERE e2.source_type = e1.source_type
      AND e2.source_id = e1.source_id
      AND e2.election_id = e1.election_id
      AND e2.id < e1.id
  );

-- shared 타입은 tenant_id를 NULL로 통일
UPDATE embeddings SET tenant_id = NULL
WHERE source_type IN ('news','community','youtube');

-- 인덱스
CREATE UNIQUE INDEX IF NOT EXISTS uq_embeddings_shared
  ON embeddings (election_id, source_type, source_id)
  WHERE tenant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_embeddings_private
  ON embeddings (tenant_id, source_type, source_id)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_embeddings_election ON embeddings (election_id);
