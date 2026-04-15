-- mybot(ElectionPulse) 분석 SaaS와의 SSO 연결 컬럼 추가
-- tenant_id: mybot tenants.id 와 1:1 매핑 (NULL이면 homepage 단독 사용자)
-- election_id: mybot elections.id — RAG 임베딩 시 공유 데이터 식별용

ALTER TABLE "users" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "users" ADD COLUMN "election_id" UUID;

CREATE UNIQUE INDEX "users_tenant_id_key" ON "users"("tenant_id");
