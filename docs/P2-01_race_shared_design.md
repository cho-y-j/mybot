# P2-01 Race-Shared 데이터 분리 설계 문서

**상태**: 설계 완료 — 구현 미시작 (Phase 3 또는 별도 세션에서 진행)
**작성일**: 2026-04-12
**우선순위**: 높음 (멀티테넌트 중복 수집 문제 해결)

---

## 1. 문제 정의

### 현재 구조 (문제 있음)
- 같은 선거(예: 청주시장 선거)에 5개 캠프가 가입하면 **같은 뉴스를 5번 수집**한다
- `news_articles` 테이블에 동일 URL이 `tenant_id`별로 5개 row 생성
- API 호출 5배, 저장공간 5배, AI 분석 5배 비용

### 증상 (실측 데이터)
- 5403b830(교육감)과 d50bda94(윤건영캠프)가 같은 선거 관련 기사를 중복 수집
- 동일 URL이 tenant별로 존재

### 목표 상태
- **수집·저장은 선거(race) 단위**: 한 선거의 뉴스/유튜브/커뮤니티는 1회만 수집·저장
- **AI 분석은 selectively race 또는 camp 단위**: race 단위 기본 분석 + 캠프별 관점 overlay
- **접근 권한은 캠프별**: 같은 race에 속한 캠프는 데이터 공유

---

## 2. 아키텍처 옵션

### 옵션 A: 새 race_news 테이블 (권장)
```sql
CREATE TABLE race_news_articles (
    id UUID PRIMARY KEY,
    election_id UUID NOT NULL REFERENCES elections(id),  -- race 단위
    -- tenant_id 없음!
    title TEXT,
    url TEXT UNIQUE,
    published_at TIMESTAMPTZ,
    collected_at TIMESTAMPTZ DEFAULT NOW(),
    -- 원본 데이터
    summary TEXT,
    source VARCHAR(200),
    platform VARCHAR(50),
    -- Race-level AI 분석 (tenant 중립)
    ai_summary TEXT,
    ai_topics JSONB,
    ai_threat_level VARCHAR(20),
    sentiment VARCHAR(20),
    sentiment_score FLOAT,
    sentiment_verified BOOLEAN DEFAULT FALSE,
    ai_analyzed_at TIMESTAMPTZ
);

CREATE TABLE race_news_camp_analysis (
    race_news_id UUID REFERENCES race_news_articles(id),
    tenant_id UUID NOT NULL,
    -- Camp-specific 4사분면 (관점 다름)
    strategic_quadrant VARCHAR(20),  -- 이 캠프 관점에서
    is_about_our_candidate BOOLEAN,
    candidate_id UUID,  -- 이 캠프의 후보 매칭
    action_type VARCHAR(20),
    action_priority VARCHAR(10),
    action_summary TEXT,
    PRIMARY KEY (race_news_id, tenant_id)
);
```

**장점**: 깔끔한 분리, race 수집 1회, 캠프별 관점 overlay
**단점**: 새 테이블 + 전면 마이그레이션

### 옵션 B: 기존 테이블 재사용 (점진적)
```sql
-- news_articles.tenant_id를 nullable로 변경
-- 수집 시 tenant_id = NULL (race-level)
-- 분석 시 별도 news_camp_analysis 테이블에 tenant_id와 관점 저장
```

**장점**: 작은 마이그레이션
**단점**: tenant_id NULL/NOT NULL 혼재로 쿼리 복잡, 기존 코드 전부 수정

### 옵션 C: View + Trigger (하이브리드)
```sql
-- 기존 news_articles 유지
-- 신규 수집은 race_news_articles에만
-- news_articles_view로 합쳐서 조회
```

**장점**: 기존 코드 최소 변경
**단점**: View 성능, 복잡도

**결론: 옵션 A 권장** — 장기적으로 가장 깔끔.

---

## 3. 구현 단계 (권장 순서)

### Phase 3.1: 스키마 준비
1. `race_news_articles` 테이블 생성 (마이그레이션)
2. `race_news_camp_analysis` 테이블 생성
3. `tenant_elections` 테이블 검증 (이미 존재함 — shared election mapping)

### Phase 3.2: 수집 경로 전환 (뉴스부터 PoC)
4. `tasks.py` `collect_news`: `NewsArticle` → `RaceNewsArticle`로 변경
5. 수집 시 `election_id` 기반, URL UNIQUE 제약으로 자동 dedupe
6. AI 분석: race-level 기본 분석 (Sonnet + Opus) → `race_news_articles.ai_*` 필드
7. 캠프별 관점 분석: 새 `_analyze_camp_perspective()` 함수

### Phase 3.3: 조회 경로 전환
8. `strategy/router.py` 4사분면 조회: race_news_articles JOIN race_news_camp_analysis
9. `chat/context_builder.py`: 동일
10. `analysis/router.py` 통계: 동일

### Phase 3.4: 마이그레이션
11. 기존 `news_articles` 데이터를 `race_news_articles` + `race_news_camp_analysis`로 이관
   - URL 기준 dedupe
   - 각 tenant의 분석 결과를 race_news_camp_analysis로 분리
12. 검증 후 기존 `news_articles` deprecation

### Phase 3.5: community/youtube 확장
13. community_posts, youtube_videos 동일 패턴 적용

---

## 4. 마이그레이션 SQL (초안)

```sql
-- 1. race_news_articles 생성
CREATE TABLE race_news_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    url VARCHAR(1000) NOT NULL,
    source VARCHAR(200),
    summary TEXT,
    published_at TIMESTAMPTZ,
    collected_at TIMESTAMPTZ DEFAULT NOW(),
    platform VARCHAR(50),
    -- Race-level AI (tenant 중립)
    ai_summary TEXT,
    ai_topics JSONB DEFAULT '[]',
    ai_threat_level VARCHAR(20),
    sentiment VARCHAR(20),
    sentiment_score FLOAT,
    sentiment_verified BOOLEAN DEFAULT FALSE,
    ai_analyzed_at TIMESTAMPTZ,
    CONSTRAINT uq_race_news_url_per_election UNIQUE (election_id, url)
);

CREATE INDEX ix_race_news_election_date ON race_news_articles(election_id, published_at DESC NULLS LAST);
CREATE INDEX ix_race_news_ai_analyzed ON race_news_articles(ai_analyzed_at) WHERE ai_analyzed_at IS NOT NULL;

-- 2. race_news_camp_analysis 생성
CREATE TABLE race_news_camp_analysis (
    race_news_id UUID NOT NULL REFERENCES race_news_articles(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    candidate_id UUID REFERENCES candidates(id) ON DELETE SET NULL,
    is_about_our_candidate BOOLEAN DEFAULT FALSE,
    strategic_quadrant VARCHAR(20),
    strategic_value VARCHAR(20),  -- 호환
    action_type VARCHAR(20),
    action_priority VARCHAR(10),
    action_summary TEXT,
    ai_reason TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (race_news_id, tenant_id)
);

CREATE INDEX ix_rnca_tenant_quadrant ON race_news_camp_analysis(tenant_id, strategic_quadrant);

-- 3. 기존 데이터 이관 (각 tenant 분석을 race_news_camp_analysis로)
INSERT INTO race_news_articles (id, election_id, title, url, source, summary,
  published_at, collected_at, platform, ai_summary, ai_topics, ai_threat_level,
  sentiment, sentiment_score, sentiment_verified, ai_analyzed_at)
SELECT DISTINCT ON (election_id, url)
  gen_random_uuid(), election_id, title, url, source, summary,
  published_at, collected_at, platform, ai_summary, ai_topics, ai_threat_level,
  sentiment, sentiment_score, sentiment_verified, ai_analyzed_at
FROM news_articles
WHERE election_id IS NOT NULL AND url IS NOT NULL
ORDER BY election_id, url, ai_analyzed_at DESC NULLS LAST;

INSERT INTO race_news_camp_analysis (race_news_id, tenant_id, candidate_id,
  is_about_our_candidate, strategic_quadrant, strategic_value,
  action_type, action_priority, action_summary, ai_reason)
SELECT rna.id, na.tenant_id, na.candidate_id, na.is_about_our_candidate,
       na.strategic_quadrant, na.strategic_value,
       na.action_type, na.action_priority, na.action_summary, na.ai_reason
FROM news_articles na
JOIN race_news_articles rna ON rna.election_id = na.election_id AND rna.url = na.url
ON CONFLICT DO NOTHING;
```

---

## 5. 코드 변경 영향 범위

### Backend (수정 필요)
- `app/elections/models.py` — 새 모델 `RaceNewsArticle`, `RaceNewsCampAnalysis`
- `app/collectors/tasks.py` — `collect_news` 쓰기 경로
- `app/collectors/instant.py` — `collect_all_now` 쓰기 경로
- `app/analysis/media_analyzer.py` — 분석 테이블/조인 조정
- `app/analysis/sentiment.py` — verify SQL 조정
- `app/strategy/router.py` — 4사분면 SELECT
- `app/chat/context_builder.py` — 뉴스 컨텍스트 SELECT
- `app/analysis/router.py` — 통계 SELECT
- `app/services/debate_service.py` — 뉴스 조회

### Frontend (영향 없음)
- API 응답 포맷은 동일하므로 프론트는 변경 불필요

---

## 6. 리스크 & 검증

### 리스크
1. **마이그레이션 실패**: 기존 데이터 손실 가능 → 백업 필수
2. **쿼리 성능 저하**: JOIN 많아짐 → 인덱스로 완화
3. **같은 뉴스의 다른 tenant 관점 불일치**: 각 캠프가 재분석 필요 — 대량 AI 호출

### 검증 계획
1. 옵션: 기존 테이블 그대로 두고 race_news_articles 병렬 운영
2. 서승우 캠프 1개를 race 구조로 먼저 이관
3. 2주 모니터링 후 전면 전환

---

## 7. 권장 진행 방식

이번 Phase 2에서는 **설계만 완료**. Phase 3에서 구현.
이유:
- 스키마 변경 + 8개 파일 수정 = 4~6시간 작업
- 마이그레이션 중 기존 데이터 손상 리스크
- 테스트 환경 분리 필요
- P1, P2 개선 효과가 아직 사용자 검증 중

**대안**: 당장 중복 수집 비용을 줄이고 싶다면, 현재 아키텍처에서 **같은 URL 수집 시 1번째 캠프만 실제 수집하고 나머지는 복사**하는 shortcut 구현 가능 (1시간 작업). 하지만 이건 기술부채를 늘리는 임시방편.

---

## 8. 참고 자료
- 현재 `tenant_elections` 테이블: 이미 여러 tenant가 한 election을 공유하는 매핑 존재
- `common/election_access.py`: shared election 접근 헬퍼 이미 있음
- CLAUDE.md 1.10: "멀티테넌트 공용 데이터 공유 원칙"에 명시
