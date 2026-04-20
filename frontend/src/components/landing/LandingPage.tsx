'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';

// Airtable 영감 디자인 (DESIGN.md)
// - 흰 캔버스 + 깊은 네이비(#181d26) + Airtable Blue(#1b61c9)
// - 절제된 그라데이션 메시 + 그리드 패턴 (Vercel/Linear 톤)
// - 아이콘 0개. 강조는 색·타이포·모형 UI 로만.

type Plan = {
  name: string;
  price?: number;
  priceLabel?: string;
  custom?: boolean;
  desc: string;
  badge?: string;
  highlights: string[];
};

const PLANS: Plan[] = [
  {
    name: '베이직',
    price: 59,
    desc: '소형 캠프, 첫 도입',
    highlights: [
      '후보 1명 + 경쟁 후보 2명',
      '뉴스·커뮤니티·유튜브 자동 수집 (일 2회)',
      '매일 텔레그램 브리핑',
      '주간 전략 보고서 1회',
      '기본 모바일 홈페이지 (5개 섹션)',
      'ai.on1.kr/이름 주소',
      'AI 챗 월 30만 토큰',
    ],
  },
  {
    name: '프로',
    price: 129,
    desc: '실전 운영, 본격 분석',
    badge: '가장 많이 선택',
    highlights: [
      '베이직 모든 기능 +',
      '일일 종합 보고서 PDF (매일 18시)',
      '토론 대본 자동 생성',
      'SNS 멀티톤 콘텐츠 (페북·블로그·인스타)',
      'AI 챗 월 100만 토큰',
      '홈페이지 디자인 커스터마이징 (색·폰트·배치)',
      '커스텀 도메인 연결 (예: kim2026.kr)',
    ],
  },
  {
    name: '프리미엄',
    price: 269,
    desc: '경합 지역, 위기 대응',
    highlights: [
      '프로 모든 기능 +',
      'AI 챗 무제한 (공정 사용 정책)',
      '위기 즉시 알림 (감성 급락 시 텔레그램)',
      '갤러리 무제한 + 다중 페이지',
      'SSL 자동 + 트래픽 무제한',
      '전담 우선 지원',
      '선거법 자동 검증 (공직선거법 10개 조항)',
      'API 접근 (캠프 자체 시스템 연동)',
    ],
  },
  {
    name: '엔터프라이즈',
    custom: true,
    priceLabel: '세팅 800만원~ + 월 250만원~',
    desc: '국회의원·광역단체장급 · 전용 인프라',
    highlights: [
      '프리미엄 모든 기능 +',
      '전용 서버 + 완전 데이터 격리',
      '고객 본인 Anthropic/OpenAI API 키 연동 (비용·사용량 투명)',
      '홈페이지 100% 커스텀 디자인 (당일 세팅)',
      '기업 도메인 연결 + SLA 보장',
      '전담 기술 지원 · 실시간 장애 대응',
      '맞춤 기능 개발 (별도 견적)',
    ],
  },
];

const COMPARE = [
  { item: '홈페이지 제작 외주', sum: '100~300만원 (1회)', us: '3분 자동 (포함)' },
  { item: '미디어 모니터링 직원 1명', sum: '월 200~400만원', us: '24시간 자동 (포함)' },
  { item: '일일 보고서 외주', sum: '월 100~200만원', us: '매일 자동 PDF (포함)' },
  { item: 'SNS 카피라이터', sum: '월 100~200만원', us: '멀티톤 자동 (프로~)' },
  { item: '토론 컨설턴트', sum: '회당 30~100만원', us: '대본 자동 (프로~)' },
];

// 가상 캠프 — 사회적 증거 마키 (실명 X)
const FAKE_CAMPS = [
  '강남구청장 캠프',
  '충북교육감 예비후보',
  '서초구의원 캠프',
  '부산시장 예비후보',
  '경기도지사 캠프',
  '대구 동구청장',
  '인천 남동구 캠프',
  '광주광역시의원',
];

function CountUp({ end, duration = 1500 }: { end: number; duration?: number }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let start: number | null = null;
    let raf = 0;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      setVal(Math.floor(end * p));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [end, duration]);
  return <>{val.toLocaleString()}</>;
}

// Hero 안 모형 대시보드 — 가짜 분석 화면
function MockDashboard() {
  return (
    <div
      className="relative rounded-[16px] bg-white border border-[#e0e2e6] overflow-hidden"
      style={{
        boxShadow:
          'rgba(15,48,106,0.08) 0px 24px 48px, rgba(45,127,249,0.18) 0px 4px 12px, rgba(0,0,0,0.04) 0px 0px 0px 1px',
      }}
    >
      {/* 브라우저 chrome */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#e0e2e6] bg-[#f8fafc]">
        <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        <div className="ml-3 flex-1 px-3 py-1 rounded-md bg-white text-[11px] text-[#181d26]/60 border border-[#e0e2e6]" style={{ letterSpacing: '0.07px' }}>
          ai.on1.kr/easy
        </div>
      </div>

      {/* 본문 — 좌측 사이드바 + 우측 콘텐츠 */}
      <div className="grid grid-cols-[180px_1fr] min-h-[360px] bg-white">
        {/* 사이드바 */}
        <div className="bg-[#fafbfc] border-r border-[#e0e2e6] py-4 px-3 space-y-1">
          {['오늘 브리핑', '뉴스 분석', '경쟁 후보', '여론조사', 'AI 비서', '보고서', '설정'].map((m, i) => (
            <div
              key={m}
              className={`px-3 py-2 rounded-[8px] text-[12px] ${
                i === 0 ? 'bg-[#1b61c9]/10 text-[#1b61c9] font-semibold' : 'text-[#181d26]/70'
              }`}
              style={{ letterSpacing: '0.07px' }}
            >
              {m}
            </div>
          ))}
        </div>

        {/* 콘텐츠 */}
        <div className="p-5 space-y-4">
          {/* 헤더 */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-[#1b61c9] font-bold mb-1" style={{ letterSpacing: '0.18px' }}>오늘 04월 16일</p>
              <h3 className="text-[15px] font-bold text-[#181d26]" style={{ letterSpacing: '0.10px' }}>
                오전 종합 브리핑
              </h3>
            </div>
            <span className="text-[10px] px-2 py-1 rounded-full bg-[#1b61c9]/10 text-[#1b61c9] font-medium" style={{ letterSpacing: '0.07px' }}>
              자동 생성됨
            </span>
          </div>

          {/* 4사분면 mini 카드 */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: '강점 (긍정)', val: 18, color: '#0d7a3f', bg: '#e6f4ec' },
              { label: '기회 (경쟁자 약점)', val: 7, color: '#1b61c9', bg: '#e8f0fc' },
              { label: '약점 (논란)', val: 3, color: '#a8410f', bg: '#fdeee2' },
              { label: '위협 (경쟁자 부상)', val: 5, color: '#7a1d1d', bg: '#fae8e8' },
            ].map((q) => (
              <div key={q.label} className="px-3 py-2.5 rounded-[10px]" style={{ backgroundColor: q.bg }}>
                <div className="text-[9px] font-medium" style={{ color: q.color, letterSpacing: '0.16px' }}>
                  {q.label}
                </div>
                <div className="text-[20px] font-bold mt-0.5" style={{ color: q.color, letterSpacing: '-0.3px' }}>
                  {q.val}건
                </div>
              </div>
            ))}
          </div>

          {/* 라인 차트 (감성 추이) */}
          <div>
            <p className="text-[10px] text-[#181d26]/70 mb-2" style={{ letterSpacing: '0.16px' }}>
              지난 7일 감성 추이
            </p>
            <svg viewBox="0 0 280 60" className="w-full h-[50px]">
              <defs>
                <linearGradient id="grad" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#1b61c9" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#1b61c9" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d="M0,40 L40,30 L80,35 L120,20 L160,15 L200,18 L240,8 L280,12 L280,60 L0,60 Z"
                fill="url(#grad)"
              />
              <path
                d="M0,40 L40,30 L80,35 L120,20 L160,15 L200,18 L240,8 L280,12"
                fill="none"
                stroke="#1b61c9"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {[40, 30, 35, 20, 15, 18, 8, 12].map((y, i) => (
                <circle key={i} cx={i * 40} cy={y} r="2.5" fill="#1b61c9" />
              ))}
            </svg>
          </div>

          {/* AI 추천 액션 */}
          <div className="rounded-[10px] border border-[#e0e2e6] p-3 bg-[#fafbfc]">
            <p className="text-[10px] font-bold text-[#1b61c9] mb-1.5" style={{ letterSpacing: '0.18px' }}>
              AI 추천 액션
            </p>
            <p className="text-[11px] text-[#181d26] leading-[1.55]" style={{ letterSpacing: '0.16px' }}>
              경쟁 후보 A의 교통정책 발표 직후 부정 반응 32% 증가 — 우리 후보의 교통 공약을 페이스북에 게시할 적기.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// 모형 모바일 폰 — 데모 섹션
function MockPhone() {
  return (
    <div
      className="relative mx-auto w-[260px] h-[520px] rounded-[40px] bg-[#181d26] p-3"
      style={{ boxShadow: 'rgba(15,48,106,0.18) 0px 32px 64px, rgba(0,0,0,0.04) 0px 0px 0px 1px inset' }}
    >
      {/* 스피커 */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 w-16 h-1.5 rounded-full bg-black/40" />

      <div className="w-full h-full rounded-[32px] bg-white overflow-hidden flex flex-col">
        {/* hero */}
        <div className="px-5 pt-8 pb-6 text-white" style={{ background: 'linear-gradient(180deg, #1b61c9 0%, #0d3b7a 100%)' }}>
          <div className="flex gap-2 mb-3">
            <span className="text-[8px] px-2 py-0.5 rounded-full bg-white/20 font-medium" style={{ letterSpacing: '0.16px' }}>
              시민당
            </span>
            <span className="text-[8px] px-2 py-0.5 rounded-full bg-white/20 font-medium" style={{ letterSpacing: '0.16px' }}>
              D-48
            </span>
          </div>
          <p className="text-[8px] tracking-widest opacity-80 mb-1" style={{ letterSpacing: '0.18px' }}>
            강남구 시장 예비후보
          </p>
          <h3 className="text-[20px] font-bold tracking-tight">홍길동</h3>
          <p className="text-[10px] mt-2 opacity-90" style={{ letterSpacing: '0.16px' }}>
            "시민과 함께 만드는 강남"
          </p>
          <div className="mt-3 flex gap-1.5">
            <button className="text-[8px] px-2.5 py-1 rounded-full bg-white text-[#1b61c9] font-bold" style={{ letterSpacing: '0.07px' }}>
              공약 보기
            </button>
            <button className="text-[8px] px-2.5 py-1 rounded-full border border-white/40 text-white" style={{ letterSpacing: '0.07px' }}>
              후보 소개
            </button>
          </div>
        </div>

        {/* 공약 미리보기 */}
        <div className="px-5 py-4 flex-1 overflow-hidden">
          <p className="text-[9px] font-bold text-[#1b61c9] mb-2" style={{ letterSpacing: '0.18px' }}>
            핵심 공약
          </p>
          {[
            '01 청년 주거 지원 1만호',
            '02 교통혼잡 30% 감축',
            '03 안전한 통학로 100%',
            '04 지역 상권 활성화 펀드',
          ].map((p) => (
            <div key={p} className="flex items-start gap-2 py-1.5 border-b border-[#e0e2e6] last:border-0">
              <span className="text-[8px] text-[#181d26]/82" style={{ letterSpacing: '0.16px' }}>{p}</span>
            </div>
          ))}
        </div>

        {/* 하단 nav */}
        <div className="grid grid-cols-4 px-2 py-2 border-t border-[#e0e2e6] bg-[#fafbfc]">
          {['홈', '소개', '공약', '연락'].map((l, i) => (
            <div key={l} className={`text-center text-[8px] font-medium ${i === 2 ? 'text-[#1b61c9]' : 'text-[#181d26]/60'}`} style={{ letterSpacing: '0.07px' }}>
              {l}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');

  return (
    <div className="min-h-screen bg-white text-[#181d26]" style={{ fontFamily: '"Paperlogy", "Pretendard", -apple-system, system-ui, sans-serif' }}>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-[#e0e2e6]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="text-[20px] font-bold tracking-tight text-[#181d26]">
            CampAI
          </Link>
          <nav className="hidden lg:flex items-center gap-7 text-[15px] text-[#181d26]/82">
            <a href="#how" className="hover:text-[#1b61c9] transition-colors">작동 방식</a>
            <a href="#compare" className="hover:text-[#1b61c9] transition-colors">사람 vs CampAI</a>
            <a href="#pricing" className="hover:text-[#1b61c9] transition-colors">요금</a>
            <a href="#demo" className="hover:text-[#1b61c9] transition-colors">데모</a>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/login" className="text-[14px] sm:text-[15px] text-[#181d26]/82 hover:text-[#181d26] px-2 sm:px-3 py-2">
              로그인
            </Link>
            <Link
              href="/apply"
              className="text-[14px] sm:text-[15px] font-medium px-4 sm:px-5 py-2 sm:py-2.5 rounded-[12px] bg-[#181d26] text-white hover:bg-[#0a0e16] transition-colors"
              style={{
                letterSpacing: '0.08px',
                boxShadow: 'rgba(45,127,249,0.28) 0px 1px 3px, rgba(0,0,0,0.06) 0px 0px 0px 0.5px inset',
              }}
            >
              가입하기
            </Link>
          </div>
        </div>
      </header>

      {/* Hero — 그라데이션 메시 + 그리드 + 모형 대시보드 */}
      <section className="relative overflow-hidden border-b border-[#e0e2e6]">
        {/* 배경 그리드 */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.5]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(24,29,38,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(24,29,38,0.04) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
            maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 80%)',
          }}
        />
        {/* 그라데이션 블러 */}
        <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(closest-side, rgba(27,97,201,0.12), transparent)' }} />
        <div className="absolute top-[10%] right-[-150px] w-[500px] h-[500px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(closest-side, rgba(124,58,237,0.08), transparent)' }} />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-16 pb-20 sm:pt-24 sm:pb-28 lg:pt-28 lg:pb-32 grid lg:grid-cols-[6fr_5fr] gap-10 lg:gap-12 items-center">
          {/* 좌측 텍스트 */}
          <div>
            <p className="inline-flex items-center gap-2 text-[13px] font-medium text-[#1b61c9] mb-6 px-3 py-1 rounded-full bg-[#1b61c9]/10" style={{ letterSpacing: '0.18px' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-[#1b61c9] animate-pulse" />
              2026 지방선거 전용 운영 플랫폼
            </p>
            <h1 className="text-[34px] sm:text-[44px] lg:text-[56px] xl:text-[60px] font-bold text-[#181d26] leading-[1.15]" style={{ letterSpacing: '-0.7px' }}>
              선거 캠프의 일주일을
              <br />
              <span
                style={{
                  background: 'linear-gradient(90deg, #1b61c9 0%, #7c3aed 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                3분으로 줄입니다.
              </span>
            </h1>
            <p className="mt-7 text-[18px] sm:text-[19px] text-[#181d26]/82 leading-[1.6] max-w-lg" style={{ letterSpacing: '0.18px' }}>
              여론 분석, 전략 보고서, 모바일 홈페이지까지.
              <br />
              가입 즉시 자동 가동되는 선거 전용 AI 플랫폼.
            </p>

            <div className="mt-9 flex flex-col sm:flex-row gap-3">
              <Link
                href="/apply"
                className="px-7 py-3.5 rounded-[12px] bg-[#181d26] text-white text-[16px] font-medium hover:bg-[#0a0e16] transition-all hover:translate-y-[-1px]"
                style={{
                  letterSpacing: '0.08px',
                  boxShadow: 'rgba(45,127,249,0.32) 0px 4px 12px, rgba(0,0,0,0.06) 0px 0px 0px 0.5px inset',
                }}
              >
                지금 가입하기 →
              </Link>
              <a
                href="#demo"
                className="px-7 py-3.5 rounded-[12px] bg-white text-[#181d26] text-[16px] font-medium border border-[#181d26]/15 hover:border-[#181d26]/40 transition-colors text-center"
                style={{ letterSpacing: '0.08px' }}
              >
                데모 캠프 둘러보기
              </a>
            </div>

            <p className="mt-6 text-[13px] text-[#181d26]/60" style={{ letterSpacing: '0.07px' }}>
              가입 후 3분 내 모든 분석 자동 가동 · 선거 종료 시 자동 종료
            </p>
          </div>

          {/* 우측 모형 대시보드 */}
          <div className="relative">
            <MockDashboard />
          </div>
        </div>

        {/* 사회적 증거 마키 */}
        <div className="relative border-t border-[#e0e2e6] py-7 bg-white/50">
          <p className="text-center text-[12px] text-[#181d26]/60 mb-4 uppercase font-bold" style={{ letterSpacing: '1.2px' }}>
전국 선거 캠프가 사용 가능
          </p>
          <div className="overflow-hidden relative" style={{ maskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)' }}>
            <div className="flex gap-12 marquee whitespace-nowrap">
              {[...FAKE_CAMPS, ...FAKE_CAMPS].map((c, i) => (
                <span key={i} className="text-[15px] text-[#181d26]/50 font-semibold flex-shrink-0" style={{ letterSpacing: '0.10px' }}>
                  {c}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 라이브 카운터 */}
      <section className="py-20 bg-[#fafbfc] border-b border-[#e0e2e6]">
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { v: 12847, suffix: '건', l: '오늘 분석된 기사' },
              { v: 24, suffix: '시간', l: '자동 미디어 수집' },
              { v: 3, suffix: '분', l: '가입 후 가동까지' },
              { v: 99, suffix: '%', l: '브리핑 정시 발송률' },
            ].map((s) => (
              <div key={s.l}>
                <div className="text-[40px] sm:text-[48px] font-bold text-[#181d26]" style={{ letterSpacing: '-0.5px' }}>
                  <CountUp end={s.v} />
                  <span className="text-[24px] text-[#1b61c9] ml-1">{s.suffix}</span>
                </div>
                <p className="mt-2 text-[14px] text-[#181d26]/82" style={{ letterSpacing: '0.07px' }}>
                  {s.l}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 작동 방식 */}
      <section id="how" className="py-24">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-[13px] font-bold text-[#1b61c9] mb-3 uppercase" style={{ letterSpacing: '1.2px' }}>
              작동 방식
            </p>
            <h2 className="text-[36px] sm:text-[44px] font-bold text-[#181d26]" style={{ letterSpacing: '-0.5px', lineHeight: 1.15 }}>
              가입하면 즉시,
              <br className="sm:hidden" />
              <span className="text-[#1b61c9]"> 모든 게 자동입니다.</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                step: '01',
                title: '가입 신청',
                desc: '후보 이름·지역·선거 유형만 입력. 결제 정보 없이 가입하기.',
                accent: '#1b61c9',
              },
              {
                step: '02',
                title: '자동 부트스트랩',
                desc: '선관위 데이터로 학력·경력·공약·일정 자동 수집. 모바일 홈페이지 자동 생성.',
                accent: '#7c3aed',
              },
              {
                step: '03',
                title: '매일 자동 보고',
                desc: '뉴스·여론·경쟁자 동향 분석 → 텔레그램 브리핑 + 일일 PDF 보고서.',
                accent: '#0d7a3f',
              },
            ].map((s) => (
              <div
                key={s.step}
                className="relative p-7 rounded-[16px] bg-white border border-[#e0e2e6] hover:border-[#181d26]/40 hover:translate-y-[-2px] transition-all"
                style={{ boxShadow: 'rgba(15,48,106,0.04) 0px 2px 8px' }}
              >
                <div className="flex items-baseline gap-3 mb-4">
                  <span
                    className="text-[44px] font-black leading-none"
                    style={{ color: s.accent, letterSpacing: '-1px' }}
                  >
                    {s.step}
                  </span>
                  <div className="h-[1px] flex-1 bg-[#e0e2e6]" />
                </div>
                <h3 className="text-[20px] font-bold text-[#181d26] mb-2" style={{ letterSpacing: '0.10px' }}>
                  {s.title}
                </h3>
                <p className="text-[15px] text-[#181d26]/82 leading-[1.6]" style={{ letterSpacing: '0.16px' }}>
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 비교 표 */}
      <section id="compare" className="py-24 bg-[#fafbfc] border-y border-[#e0e2e6]">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[13px] font-bold text-[#1b61c9] mb-3 uppercase" style={{ letterSpacing: '1.2px' }}>
              비용 비교
            </p>
            <h2 className="text-[36px] sm:text-[44px] font-bold text-[#181d26]" style={{ letterSpacing: '-0.5px', lineHeight: 1.15 }}>
              사람이 하면 월 500만원.
              <br />
              <span className="text-[#1b61c9]">CampAI는 59만원부터.</span>
            </h2>
            <p className="mt-4 text-[16px] text-[#181d26]/82 max-w-2xl mx-auto" style={{ letterSpacing: '0.16px' }}>
              실제 한국 선거 캠프 외주 단가 기준입니다.
            </p>
          </div>

          <div
            className="rounded-[16px] bg-white border border-[#e0e2e6] overflow-hidden"
            style={{ boxShadow: 'rgba(15,48,106,0.05) 0px 2px 12px' }}
          >
            <div className="grid grid-cols-3 px-6 py-4 bg-[#181d26] text-white text-[14px] font-medium" style={{ letterSpacing: '0.16px' }}>
              <div>업무</div>
              <div>외주·인건비</div>
              <div>CampAI</div>
            </div>
            {COMPARE.map((c, i) => (
              <div
                key={c.item}
                className={`grid grid-cols-3 px-6 py-5 text-[15px] hover:bg-[#fafbfc] transition-colors ${
                  i !== COMPARE.length - 1 ? 'border-b border-[#e0e2e6]' : ''
                }`}
              >
                <div className="text-[#181d26] font-medium" style={{ letterSpacing: '0.08px' }}>
                  {c.item}
                </div>
                <div className="text-[#181d26]/82" style={{ letterSpacing: '0.16px' }}>
                  {c.sum}
                </div>
                <div className="text-[#1b61c9] font-medium" style={{ letterSpacing: '0.08px' }}>
                  {c.us}
                </div>
              </div>
            ))}
            <div className="grid grid-cols-3 px-6 py-5 bg-[#fafbfc] text-[16px] font-bold border-t-2 border-[#181d26]">
              <div className="text-[#181d26]">합계</div>
              <div className="text-[#181d26]">월 500~1,000만원+</div>
              <div className="text-[#1b61c9]">월 59만원~</div>
            </div>
          </div>

          <p className="mt-8 text-center text-[14px] text-[#181d26]/60" style={{ letterSpacing: '0.07px' }}>
            6개월 캠프 기준 누적 외주 비용 3,000만~6,000만원 → CampAI 354만원 (베이직)
          </p>
        </div>
      </section>

      {/* 데모 — 모형 폰 */}
      <section id="demo" className="py-20 sm:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-[1fr_auto] gap-12 lg:gap-14 items-center">
          <div>
            <p className="text-[13px] font-bold text-[#1b61c9] mb-3 uppercase" style={{ letterSpacing: '1.2px' }}>
              데모 캠프
            </p>
            <h2 className="text-[36px] sm:text-[44px] font-bold text-[#181d26]" style={{ letterSpacing: '-0.5px', lineHeight: 1.15 }}>
              실제 캠프가 어떻게 보이는지,
              <br />
              <span className="text-[#1b61c9]">3분 안에 확인하세요.</span>
            </h2>
            <p className="mt-5 text-[16px] text-[#181d26]/82 max-w-lg leading-[1.6]" style={{ letterSpacing: '0.16px' }}>
              가상의 후보 <strong className="text-[#181d26]">"홍길동 (강남구청장)"</strong>의 자동 생성된 모바일 홈페이지를 둘러볼 수 있습니다.
              실제 가입 시 같은 방식으로 학력·경력·공약·일정이 자동 채워집니다.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <a
                href="/demo"
                target="_blank"
                rel="noopener noreferrer"
                className="px-7 py-3.5 rounded-[12px] bg-[#181d26] text-white text-[16px] font-medium hover:bg-[#0a0e16] transition-all hover:translate-y-[-1px] text-center"
                style={{
                  letterSpacing: '0.08px',
                  boxShadow: 'rgba(45,127,249,0.32) 0px 4px 12px',
                }}
              >
                데모 홈페이지 열기 →
              </a>
              <Link
                href="/apply"
                className="px-7 py-3.5 rounded-[12px] bg-white text-[#181d26] text-[16px] font-medium border border-[#181d26]/15 hover:border-[#181d26]/40 transition-colors text-center"
                style={{ letterSpacing: '0.08px' }}
              >
                내 캠프 만들기
              </Link>
            </div>
          </div>

          <div className="flex justify-center lg:justify-end">
            <MockPhone />
          </div>
        </div>
      </section>

      {/* 가격제 */}
      <section id="pricing" className="py-24 bg-[#fafbfc] border-y border-[#e0e2e6]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[13px] font-bold text-[#1b61c9] mb-3 uppercase" style={{ letterSpacing: '1.2px' }}>
              요금제
            </p>
            <h2 className="text-[36px] sm:text-[44px] font-bold text-[#181d26]" style={{ letterSpacing: '-0.5px', lineHeight: 1.15 }}>
              모든 플랜에
              <span className="text-[#1b61c9]"> 모바일 홈페이지 포함.</span>
            </h2>
            <p className="mt-4 text-[16px] text-[#181d26]/82" style={{ letterSpacing: '0.16px' }}>
              선거 종료 시 자동 종료 · 가입하기 · 부가세 별도
            </p>

            <div className="mt-7 inline-flex p-1 bg-white rounded-[12px] border border-[#e0e2e6]" style={{ boxShadow: 'rgba(15,48,106,0.04) 0px 1px 4px' }}>
              <button
                onClick={() => setBilling('monthly')}
                className={`px-5 py-2 text-[14px] font-medium rounded-[8px] transition-all ${
                  billing === 'monthly' ? 'bg-[#181d26] text-white' : 'text-[#181d26]/82 hover:text-[#181d26]'
                }`}
                style={{ letterSpacing: '0.08px' }}
              >
                월 결제
              </button>
              <button
                onClick={() => setBilling('yearly')}
                className={`px-5 py-2 text-[14px] font-medium rounded-[8px] transition-all ${
                  billing === 'yearly' ? 'bg-[#181d26] text-white' : 'text-[#181d26]/82 hover:text-[#181d26]'
                }`}
                style={{ letterSpacing: '0.08px' }}
              >
                6개월 (15% 할인)
              </button>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {PLANS.map((p) => {
              const yearly = p.price ? Math.round(p.price * 6 * 0.85) : 0;
              const isPro = p.name === '프로';
              const isEnt = p.custom === true;
              return (
                <div
                  key={p.name}
                  className={`relative p-8 rounded-[16px] bg-white transition-all hover:translate-y-[-2px] ${
                    isPro ? 'border-2 border-[#1b61c9]' :
                    isEnt ? 'border-2 border-[#181d26]' :
                    'border border-[#e0e2e6]'
                  }`}
                  style={
                    isPro
                      ? { boxShadow: 'rgba(27,97,201,0.18) 0px 12px 32px, rgba(45,127,249,0.10) 0px 4px 12px' }
                      : isEnt
                        ? { boxShadow: 'rgba(15,48,106,0.12) 0px 8px 24px' }
                        : { boxShadow: 'rgba(15,48,106,0.04) 0px 2px 8px' }
                  }
                >
                  {p.badge && (
                    <span
                      className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-[#1b61c9] text-white text-[12px] font-bold rounded-full"
                      style={{ letterSpacing: '0.16px', boxShadow: 'rgba(27,97,201,0.32) 0px 4px 8px' }}
                    >
                      {p.badge}
                    </span>
                  )}
                  <h3 className="text-[22px] font-bold text-[#181d26]" style={{ letterSpacing: '0.10px' }}>
                    {p.name}
                  </h3>
                  <p className="mt-1 text-[14px] text-[#181d26]/82" style={{ letterSpacing: '0.16px' }}>
                    {p.desc}
                  </p>

                  {!isEnt && p.price != null && (
                    <>
                      <div className="mt-6 flex items-baseline gap-2">
                        <span className="text-[44px] font-bold text-[#181d26]" style={{ letterSpacing: '-0.5px' }}>
                          {billing === 'monthly' ? p.price : yearly}
                        </span>
                        <span className="text-[16px] text-[#181d26]/82">
                          만원 / {billing === 'monthly' ? '월' : '6개월'}
                        </span>
                      </div>
                      {billing === 'yearly' && (
                        <p className="mt-1 text-[13px] text-[#1b61c9] font-medium" style={{ letterSpacing: '0.07px' }}>
                          월 {Math.round(yearly / 6)}만원 (15% 할인)
                        </p>
                      )}
                    </>
                  )}
                  {isEnt && (
                    <div className="mt-6">
                      <div className="text-[18px] font-bold text-[#181d26] leading-[1.4]" style={{ letterSpacing: '0.10px' }}>
                        {p.priceLabel}
                      </div>
                      <p className="mt-2 text-[13px] text-[#181d26]/60" style={{ letterSpacing: '0.07px' }}>
                        기능·인프라 범위에 따라 별도 견적
                      </p>
                    </div>
                  )}

                  <Link
                    href={isEnt ? '/apply?plan=enterprise' : '/apply'}
                    className={`mt-7 block text-center px-5 py-3 rounded-[12px] text-[15px] font-medium transition-all ${
                      isPro
                        ? 'bg-[#181d26] text-white hover:bg-[#0a0e16]'
                        : isEnt
                          ? 'bg-[#181d26] text-white hover:bg-[#0a0e16]'
                          : 'bg-white text-[#181d26] border border-[#181d26]/15 hover:border-[#181d26]/40'
                    }`}
                    style={{
                      letterSpacing: '0.08px',
                      boxShadow: (isPro || isEnt) ? 'rgba(45,127,249,0.32) 0px 4px 12px' : undefined,
                    }}
                  >
                    {isEnt ? '상담 문의' : '가입 신청'}
                  </Link>

                  <ul className="mt-8 space-y-3">
                    {p.highlights.map((h, i) => (
                      <li
                        key={i}
                        className="text-[14px] text-[#181d26]/82 leading-[1.55] pl-5 relative"
                        style={{ letterSpacing: '0.16px' }}
                      >
                        <span className="absolute left-0 top-[8px] w-2 h-2 bg-[#1b61c9] rounded-full" />
                        {h}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 마무리 CTA */}
      <section className="py-28 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(27,97,201,0.06), transparent)' }} />
        <div className="relative max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-[36px] sm:text-[52px] font-bold text-[#181d26]" style={{ letterSpacing: '-0.5px', lineHeight: 1.15 }}>
            선거가 시작되기 전에,
            <br />
            <span style={{
              background: 'linear-gradient(90deg, #1b61c9, #7c3aed)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              준비를 끝내세요.
            </span>
          </h2>
          <p className="mt-6 text-[18px] text-[#181d26]/82" style={{ letterSpacing: '0.18px' }}>
            가입 후 3분이면 모든 분석이 자동 가동됩니다.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/apply"
              className="px-8 py-4 rounded-[12px] bg-[#181d26] text-white text-[16px] font-medium hover:bg-[#0a0e16] transition-all hover:translate-y-[-1px]"
              style={{
                letterSpacing: '0.08px',
                boxShadow: 'rgba(45,127,249,0.32) 0px 8px 24px',
              }}
            >
              지금 가입하기 →
            </Link>
            <a
              href="/demo"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 rounded-[12px] bg-white text-[#181d26] text-[16px] font-medium border border-[#181d26]/15 hover:border-[#181d26]/40 transition-colors"
              style={{ letterSpacing: '0.08px' }}
            >
              데모 먼저 보기
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#e0e2e6] py-10 bg-[#fafbfc]">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-[14px] text-[#181d26]/82">
            <span className="font-bold text-[#181d26]">CampAI</span> · 선거 캠프 운영 자동화 플랫폼
          </div>
          <p className="text-[13px] text-[#181d26]/60" style={{ letterSpacing: '0.07px' }}>
            © 2026 CampAI. All rights reserved.
          </p>
        </div>
      </footer>

      {/* 모션 keyframes */}
      <style jsx global>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .marquee {
          animation: marquee 30s linear infinite;
        }
      `}</style>
    </div>
  );
}
