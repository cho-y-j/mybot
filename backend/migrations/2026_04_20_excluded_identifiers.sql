-- 동명이인 자동 차단 리스트 (AI 판정 결과 누적)
-- 2-tier 전략:
--   1) channel_name — 개인 브랜드 YouTube 채널 (예: "윤건영TV") 통째로 차단
--   2) video_id — 언론사 등 공용 채널의 특정 영상만 차단
--   3) news_url — 언론사의 특정 동명이인 기사 URL 차단
-- 위양성 복구: 관리 UI에서 수동 삭제 가능

CREATE TABLE IF NOT EXISTS excluded_identifiers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id     UUID NOT NULL,
  candidate_id    UUID,                                -- 후보별 (NULL이면 선거 전체 적용)
  tenant_id       UUID,                                -- 기록용 (첫 판정 캠프)
  identifier_type TEXT NOT NULL,                       -- 'channel_name' | 'video_id' | 'news_url' | 'community_url'
  value           TEXT NOT NULL,                       -- 실제 값 (채널명/video_id/url)
  reason          TEXT,                                -- AI 판정 근거 (예: "야구감독 윤건영 운영 채널")
  source          TEXT NOT NULL DEFAULT 'ai',          -- 'ai' | 'manual' (관리자 수동 등록)
  match_count     INTEGER NOT NULL DEFAULT 1,          -- 이 value 가 몇 번 동명이인으로 판정됐는지
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (election_id, identifier_type, value)
);

CREATE INDEX IF NOT EXISTS idx_excluded_election_type
  ON excluded_identifiers (election_id, identifier_type);
CREATE INDEX IF NOT EXISTS idx_excluded_candidate
  ON excluded_identifiers (candidate_id, identifier_type);
