-- ElectionPulse - PostgreSQL Initial Setup
-- Row-Level Security (RLS) 설정

-- 확장 모듈
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- RLS 설정용 변수 (테넌트 격리)
-- 각 세션에서 SET app.current_tenant_id = 'xxx' 로 설정

-- RLS 활성화 함수 (테넌트 데이터 격리)
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS TEXT AS $$
BEGIN
    RETURN current_setting('app.current_tenant_id', true);
END;
$$ LANGUAGE plpgsql;

-- 테이블 생성 후 RLS 정책 적용 예시 (Alembic 마이그레이션에서 실행)
-- ALTER TABLE news_articles ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY tenant_isolation ON news_articles
--     USING (tenant_id::text = current_tenant_id());

-- 초기 슈퍼 관리자 계정은 애플리케이션 시작 시 자동 생성
