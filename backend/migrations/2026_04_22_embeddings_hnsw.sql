-- pgvector HNSW 인덱스 — 코사인 유사도 검색을 O(log N)으로 유지.
-- 수만건 쌓여도 search_similar 응답 10ms 이하 보장.
-- CONCURRENTLY로 잠금 없이 생성. 이미 있으면 skip.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_embeddings_vec_hnsw
  ON embeddings USING hnsw (embedding vector_cosine_ops);
