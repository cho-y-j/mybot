'use client';

import Link from 'next/link';
import Image from 'next/image';

const features = [
  {
    title: '실시간 미디어 모니터링',
    desc: '뉴스, 유튜브, 커뮤니티를 24시간 자동 수집하고 핵심 이슈를 즉시 알려드립니다.',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
      </svg>
    ),
  },
  {
    title: 'AI 전략 브리핑',
    desc: '매일 아침 위기, 기회, 해야 할 일을 자동으로 정리해 텔레그램으로 보내드립니다.',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
  },
  {
    title: '4사분면 전략 분석',
    desc: '우리 vs 경쟁자, 긍정 vs 부정을 교차 분석해 전략적 액션을 자동 추천합니다.',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    title: '토론 대본 생성기',
    desc: '상대 후보의 약점을 분석하고 공략 포인트가 담긴 토론 스크립트를 자동 생성합니다.',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
      </svg>
    ),
  },
  {
    title: 'SNS 멀티톤 콘텐츠',
    desc: '페이스북, 인스타그램, 블로그 등 플랫폼별 맞춤 톤의 콘텐츠를 자동 생성합니다.',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
      </svg>
    ),
  },
  {
    title: '여론조사 심층분석',
    desc: '교차분석, 추이 비교, 크로스탭 등 리얼미터급 여론조사 분석을 자동으로 제공합니다.',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
];

const plans = [
  {
    name: '무료 체험',
    price: '0',
    period: '14일',
    features: ['미디어 모니터링 (일 50건)', 'AI 브리핑 (일 1회)', '기본 대시보드', '후보 1명'],
    cta: '무료로 시작',
    highlighted: false,
  },
  {
    name: '프로',
    price: '290,000',
    period: '월',
    features: ['미디어 모니터링 (무제한)', 'AI 브리핑 (일 3회)', '4사분면 전략 분석', '토론 대본 생성', 'SNS 콘텐츠 자동 생성', '후보 3명', '텔레그램 알림'],
    cta: '가입 신청',
    highlighted: true,
  },
  {
    name: '엔터프라이즈',
    price: '별도 협의',
    period: '',
    features: ['프로 플랜 전체 기능', '전담 매니저 배정', '맞춤 보고서', '후보 무제한', 'API 연동', 'SLA 보장'],
    cta: '문의하기',
    highlighted: false,
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0b0e1a] text-gray-100">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#0b0e1a]/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
              C
            </div>
            <span className="text-xl font-bold text-white tracking-tight">캠프AI</span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              로그인
            </Link>
            <Link
              href="/apply"
              className="text-sm px-5 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium hover:from-blue-500 hover:to-purple-500 transition-all"
            >
              가입 신청
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-to-b from-blue-600/20 via-purple-600/10 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-5xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 text-sm text-gray-400 mb-8">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            2026 지방선거 대응 중
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-tight">
            <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-blue-400 bg-clip-text text-transparent">
              캠프AI
            </span>
          </h1>
          <p className="mt-6 text-xl sm:text-2xl text-gray-300 max-w-2xl mx-auto leading-relaxed font-medium">
            AI가 읽는 여론, 전략까지 짜주는 선거 참모
          </p>
          <p className="mt-4 text-base text-gray-500 max-w-xl mx-auto">
            뉴스, 유튜브, 커뮤니티를 실시간 분석하고
            <br className="hidden sm:block" />
            당선을 위한 전략 브리핑을 매일 자동으로 제공합니다.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/apply"
              className="px-8 py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold text-lg hover:from-blue-500 hover:to-purple-500 transition-all shadow-lg shadow-blue-600/25"
            >
              가입 신청
            </Link>
            <Link
              href="/login"
              className="px-8 py-3.5 rounded-xl border border-white/10 text-gray-300 font-medium text-lg hover:border-white/20 hover:text-white transition-all"
            >
              로그인
            </Link>
          </div>
        </div>
      </section>

      {/* Dashboard Preview */}
      <section className="relative pb-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="relative">
            {/* Glow behind the image */}
            <div className="absolute inset-0 bg-gradient-to-t from-blue-600/10 via-purple-600/5 to-transparent rounded-2xl blur-2xl" />
            <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-blue-900/20" style={{ perspective: '1200px' }}>
              <div style={{ transform: 'rotateX(2deg) rotateY(-1deg)' }}>
                <Image
                  src="/landing/dashboard.png"
                  alt="캠프AI 대시보드"
                  width={1920}
                  height={1080}
                  className="w-full h-auto"
                  priority
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">
              선거 캠프에 필요한 모든 AI 도구
            </h2>
            <p className="mt-4 text-gray-400 text-lg">
              데이터 수집부터 전략 수립, 콘텐츠 생성까지 하나의 플랫폼에서
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <div
                key={i}
                className="group p-6 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/10 transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600/20 to-purple-600/20 border border-white/5 flex items-center justify-center text-blue-400 group-hover:text-blue-300 transition-colors">
                  {f.icon}
                </div>
                <h3 className="mt-4 text-lg font-semibold text-white">{f.title}</h3>
                <p className="mt-2 text-sm text-gray-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-24 border-t border-white/5">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">요금제</h2>
            <p className="mt-4 text-gray-400 text-lg">캠프 규모에 맞는 플랜을 선택하세요</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {plans.map((plan, i) => (
              <div
                key={i}
                className={`relative p-8 rounded-2xl border transition-all duration-300 ${
                  plan.highlighted
                    ? 'border-blue-500/40 bg-gradient-to-b from-blue-600/10 to-purple-600/5 shadow-lg shadow-blue-900/20'
                    : 'border-white/5 bg-white/[0.02] hover:border-white/10'
                }`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-xs font-semibold text-white">
                    추천
                  </div>
                )}
                <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
                <div className="mt-4 flex items-baseline gap-1">
                  {plan.price === '별도 협의' ? (
                    <span className="text-2xl font-bold text-white">{plan.price}</span>
                  ) : (
                    <>
                      <span className="text-4xl font-extrabold text-white">{plan.price}</span>
                      <span className="text-gray-400 text-sm">원 / {plan.period}</span>
                    </>
                  )}
                </div>
                <ul className="mt-6 space-y-3">
                  {plan.features.map((feat, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm text-gray-300">
                      <svg className="w-4 h-4 mt-0.5 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      {feat}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/apply"
                  className={`mt-8 block text-center py-3 rounded-xl font-medium text-sm transition-all ${
                    plan.highlighted
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-500 hover:to-purple-500 shadow-md shadow-blue-600/20'
                      : 'border border-white/10 text-gray-300 hover:border-white/20 hover:text-white'
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Footer */}
      <section className="py-24 border-t border-white/5">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white">
            지금 가입 신청하세요
          </h2>
          <p className="mt-4 text-gray-400 text-lg">
            AI 선거 참모와 함께 선거 전략의 새로운 기준을 만들어보세요.
          </p>
          <Link
            href="/apply"
            className="mt-8 inline-block px-10 py-4 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold text-lg hover:from-blue-500 hover:to-purple-500 transition-all shadow-lg shadow-blue-600/25"
          >
            가입 신청
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs">
              C
            </div>
            <span className="text-sm font-medium text-gray-400">캠프AI</span>
          </div>
          <p className="text-sm text-gray-600">캠프AI &copy; 2026. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
