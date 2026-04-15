-- 2026-04-15: strategic_views UNIQUE 제약조건 이름 변경
-- 2026_04_14_election_shared_data.sql에서 생성할 때 명시적 이름 없이 UNIQUE만 지정
-- → PostgreSQL이 자동으로 {table}_{col}_{col}_key 형식으로 생성
-- ORM은 uq_news_sv_per_tenant 같은 이름을 기대하므로 이름 맞춤

ALTER TABLE news_strategic_views 
  RENAME CONSTRAINT news_strategic_views_news_id_tenant_id_key TO uq_news_sv_per_tenant;

ALTER TABLE community_strategic_views 
  RENAME CONSTRAINT community_strategic_views_post_id_tenant_id_key TO uq_comm_sv_per_tenant;

ALTER TABLE youtube_strategic_views 
  RENAME CONSTRAINT youtube_strategic_views_video_id_tenant_id_key TO uq_yt_sv_per_tenant;
