# ElectionPulse - 선거 분석 SaaS 플랫폼

## 서비스 개요

선거 캠프를 위한 실시간 여론/미디어 분석 플랫폼.
데이터 수집 → AI 분석 → 텔레그램 실시간 보고 → 대시보드 시각화.

---

## 1. 사용자 흐름

### 고객 가입 ~ 서비스 시작

```
1) 회원가입 (이메일 + 비밀번호)
   ├── 이메일 인증 (6자리 코드)
   └── 약관 동의

2) 요금제 선택
   ├── Basic (월 30만원) - 후보 3명, 키워드 20개, 일 2회 보고
   ├── Pro (월 60만원) - 후보 5명, 키워드 50개, 일 6회 보고
   └── Enterprise (월 100만원) - 무제한, 맞춤 보고서, 전담 지원

3) 선거 기본 설정 (우리가 초기 셋팅)
   ├── 선거 유형: 대통령 / 국회의원 / 시장·군수 / 교육감 / 기타
   ├── 선거 지역: 시·도, 구·시·군
   ├── 선거일
   └── 우리 후보 정보 (이름, 정당, 주요 키워드)

4) 고객 자체 설정 (고객이 직접 추가/수정 가능)
   ├── 경쟁 후보 추가/삭제
   ├── 모니터링 키워드 추가
   ├── 모니터링 채널 선택 (네이버뉴스, 유튜브, 블로그, 커뮤니티 등)
   ├── 보고 시간표 커스터마이징
   └── 텔레그램봇 연결

5) AI 연동 (고객 자체 구독)
   ├── Claude 로그인 (claude.ai 계정)
   └── 또는 ChatGPT 로그인 (openai.com 계정)

6) 서비스 시작
   └── 자동 수집 → 분석 → 텔레그램 보고 시작
```

---

## 2. 시스템 아키텍처

```
                    ┌─────────────────────────────┐
                    │      Load Balancer (Nginx)    │
                    └──────────┬──────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼──────┐ ┌──────▼───────┐ ┌──────▼───────┐
     │  Web Frontend  │ │  API Server  │ │ Admin Panel  │
     │  (Next.js)     │ │  (FastAPI)   │ │ (Next.js)    │
     │  Port 3000     │ │  Port 8000   │ │ Port 3001    │
     └────────────────┘ └──────┬───────┘ └──────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼──────┐ ┌──────▼───────┐ ┌──────▼───────┐
     │  PostgreSQL    │ │    Redis     │ │   Celery     │
     │  (메인 DB)     │ │  (캐시/큐)   │ │  (비동기작업) │
     │  Port 5432     │ │  Port 6379   │ │  Workers     │
     └───────────────┘ └──────────────┘ └──────┬───────┘
                                               │
                          ┌────────────────────┼──────────────┐
                          │                    │              │
                 ┌────────▼──────┐   ┌────────▼────┐  ┌─────▼──────┐
                 │  수집 Worker   │   │ 분석 Worker  │  │ 보고 Worker │
                 │ (뉴스/소셜)    │   │ (감성/트렌드)│  │ (텔레그램)  │
                 └───────────────┘   └─────────────┘  └────────────┘
```

---

## 3. 핵심 모듈

### 3.1 인증/회원 (auth)
- 회원가입 (이메일 인증)
- 로그인 (JWT access + refresh token)
- 비밀번호 재설정
- 2FA (TOTP - Google Authenticator)
- 세션 관리 (동시 로그인 제한)

### 3.2 테넌트 관리 (tenants)
- 고객별 격리된 환경
- 요금제 관리
- 사용량 추적
- CLI 세션 관리 (Claude/ChatGPT)

### 3.3 선거 설정 (elections)
- 선거 유형별 템플릿
- 후보자 CRUD (우리 후보 + 경쟁 후보)
- 키워드 관리
- 모니터링 채널 설정

### 3.4 데이터 수집 (collectors)
- 네이버 뉴스/블로그/카페
- 유튜브 영상/댓글
- 검색 트렌드 (네이버 DataLab)
- 커뮤니티 (맘카페, 지역커뮤니티)
- 여론조사 데이터
- 과거 선거 데이터

### 3.5 분석 엔진 (analysis)
- 감성 분석 (긍정/부정/중립)
- 트렌드 감지 (급상승/급하락)
- 경쟁자 비교 분석
- 이슈 자동 분류
- AI 전략 제안

### 3.6 보고서 (reports)
- 일일 브리핑 (오전/오후/마감)
- 주간 종합 보고서
- 긴급 알림 (위기 감지)
- PDF/DOCX 생성
- 커스텀 보고서 템플릿

### 3.7 텔레그램 서비스 (telegram_service)
- 고객별 봇 관리
- 실시간 보고 발송
- 명령어 처리
- 파일/이미지 전송

### 3.8 관리자 (admin)
- 고객 목록/상태 관리
- 초기 셋팅 대행
- 시스템 모니터링
- 수동 보고서 발송

### 3.9 결제 (billing)
- 요금제 관리
- 결제 연동 (토스페이먼츠)
- 청구서 자동 발행
- 사용량 기반 추가 과금

---

## 4. 데이터베이스 스키마 (PostgreSQL)

### 공통 테이블 (전체 시스템)
- users: 사용자 계정
- tenants: 고객사(테넌트)
- tenant_members: 테넌트-사용자 매핑 (역할 포함)
- subscriptions: 구독/요금제
- payments: 결제 기록
- audit_logs: 감사 로그

### 테넌트별 테이블 (RLS 적용)
- elections: 선거 정보
- candidates: 후보자
- keywords: 모니터링 키워드
- news_articles: 뉴스 기사
- community_posts: 커뮤니티 게시물
- youtube_videos: 유튜브 영상
- search_trends: 검색 트렌드
- surveys: 여론조사
- survey_crosstabs: 교차분석
- sentiment_daily: 일별 감성 집계
- reports: 생성된 보고서
- schedule_configs: 스케줄 설정
- schedule_runs: 실행 기록
- alerts: 알림 기록
- past_elections: 과거 선거 데이터
- telegram_configs: 텔레그램 설정

---

## 5. API 설계 (주요 엔드포인트)

### 인증
- POST /api/auth/register - 회원가입
- POST /api/auth/verify-email - 이메일 인증
- POST /api/auth/login - 로그인
- POST /api/auth/refresh - 토큰 갱신
- POST /api/auth/forgot-password - 비밀번호 재설정
- POST /api/auth/reset-password - 비밀번호 변경

### 선거 설정
- GET/POST /api/elections - 선거 목록/생성
- GET/PUT /api/elections/{id} - 선거 상세/수정
- GET/POST /api/elections/{id}/candidates - 후보자 관리
- GET/POST /api/elections/{id}/keywords - 키워드 관리
- GET/PUT /api/elections/{id}/schedules - 스케줄 관리

### 데이터 조회
- GET /api/data/news - 뉴스 목록 (필터/페이징)
- GET /api/data/community - 커뮤니티 게시물
- GET /api/data/youtube - 유튜브 영상
- GET /api/data/trends - 검색 트렌드
- GET /api/data/surveys - 여론조사
- GET /api/data/sentiment - 감성 분석 결과

### 대시보드
- GET /api/dashboard/overview - 종합 현황
- GET /api/dashboard/candidate-comparison - 후보 비교
- GET /api/dashboard/trend-chart - 트렌드 차트
- GET /api/dashboard/alerts - 알림 목록

### 보고서
- GET /api/reports - 보고서 목록
- GET /api/reports/{id} - 보고서 상세
- GET /api/reports/{id}/download - PDF/DOCX 다운로드
- POST /api/reports/generate - 수동 보고서 생성

### 텔레그램
- POST /api/telegram/connect - 봇 연결
- GET /api/telegram/status - 연결 상태
- POST /api/telegram/test - 테스트 메시지

### 관리자 (admin only)
- GET /api/admin/tenants - 고객 목록
- POST /api/admin/tenants/{id}/setup - 초기 셋팅
- GET /api/admin/system/health - 시스템 상태
- POST /api/admin/tenants/{id}/activate - 서비스 활성화

---

## 6. 보안 설계

### 인증/인가
- bcrypt (cost=12) 비밀번호 해싱
- JWT (RS256) access token (15분) + refresh token (7일)
- RBAC: super_admin / admin / analyst / viewer
- 2FA 지원 (TOTP)
- 로그인 실패 5회 → 계정 잠금 (30분)
- IP 기반 rate limiting

### 데이터 격리
- PostgreSQL Row-Level Security (RLS)
- 모든 쿼리에 tenant_id 강제
- 테넌트 간 데이터 접근 완전 차단

### 통신 보안
- HTTPS 전용 (TLS 1.3)
- CSRF 토큰
- CORS 화이트리스트
- SQL 파라미터 바인딩 100%
- XSS 방지 (입출력 이스케이프)

### 감사
- 모든 로그인/로그아웃 기록
- 데이터 변경 이력 (audit_logs)
- API 호출 로그
- 관리자 작업 별도 기록

---

## 7. 기술 스택

| 영역 | 기술 | 이유 |
|------|------|------|
| Backend | FastAPI (Python 3.11+) | 비동기, 타입 안전, 자동 문서화 |
| Frontend | Next.js 14 + TypeScript | SSR, 빠른 로딩, 풍부한 생태계 |
| DB | PostgreSQL 16 | RLS, JSONB, 풀텍스트 검색 |
| Cache | Redis 7 | 세션, 캐시, Celery 브로커 |
| Task Queue | Celery | 수집/분석 비동기 처리 |
| Auth | JWT (RS256) + bcrypt | 업계 표준, 검증됨 |
| PDF | WeasyPrint | Python 네이티브, HTML→PDF |
| Container | Docker + Docker Compose | 개발/배포 일관성 |
| Monitoring | Prometheus + Grafana | 시스템 메트릭, 알림 |
| CI/CD | GitHub Actions | 자동 테스트, 배포 |

---

## 8. 요금제 설계

| | Basic | Pro | Enterprise |
|--|-------|-----|------------|
| 월 가격 | 30만원 | 60만원 | 100만원+ |
| 선거 수 | 1개 | 3개 | 무제한 |
| 후보 수 | 3명 | 5명 | 무제한 |
| 키워드 | 20개 | 50개 | 무제한 |
| 보고 횟수 | 일 2회 | 일 6회 | 실시간 |
| 수집 채널 | 뉴스+검색 | +소셜+유튜브 | +커스텀 |
| 대시보드 | 기본 | 고급 차트 | 맞춤 대시보드 |
| 팀원 수 | 1명 | 5명 | 무제한 |
| 텔레그램 | 1봇 | 3봇 | 무제한 |
| PDF 보고서 | 주 1회 | 일 1회 | 무제한 |
| 과거 선거 분석 | ❌ | ✅ | ✅ |
| 전담 매니저 | ❌ | ❌ | ✅ |

---

## 9. 구현 우선순위

### Sprint 1 (2주): 기반 + 인증
- FastAPI 프로젝트 셋업
- PostgreSQL 스키마 + 마이그레이션
- 회원가입/로그인/JWT
- 기본 테넌트 생성

### Sprint 2 (2주): 선거 설정 + 대시보드
- 선거 CRUD API
- 후보자/키워드 관리
- 기본 대시보드 (Next.js)
- 관리자 패널 기초

### Sprint 3 (2주): 데이터 수집
- 네이버 뉴스/블로그 수집기
- 유튜브 수집기
- 검색 트렌드 수집기
- Celery 비동기 처리

### Sprint 4 (2주): 분석 + 보고서
- 감성 분석 엔진
- 일일 보고서 생성
- PDF/DOCX 출력
- 텔레그램 연동

### Sprint 5 (2주): 완성도
- 결제 연동
- 과거 선거 데이터
- 여론조사 관리
- 보안 강화 + 테스트
