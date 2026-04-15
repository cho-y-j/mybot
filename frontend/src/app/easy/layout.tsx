'use client';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { api } from '@/services/api';
import FloatingAssistant from '@/components/easy/FloatingAssistant';

// 일상
const MENU_DAILY = [
  { href: '/easy', label: '🏠 홈' },
  { href: '/easy/reports', label: '📊 보고서' },
  { href: '/easy/assistant', label: '💬 AI 비서' },
];

// 생성 (토론 대본 포함 — 콘텐츠 만들기 내부 유형으로 통합됨)
const MENU_CREATE = [
  { href: '/easy/content', label: '📝 콘텐츠 만들기' },
];

// 분석 (과거 선거 포함)
const MENU_ANALYSIS = [
  { href: '/easy/candidates', label: '👥 후보 비교' },
  { href: '/easy/surveys', label: '📋 여론조사' },
  { href: '/easy/news', label: '📰 뉴스 분석' },
  { href: '/easy/youtube', label: '📺 미디어 분석' },
  { href: '/easy/trends', label: '🔍 키워드 트렌드' },
  { href: '/easy/history', label: '🏛️ 과거 선거' },
];

// 기타
const MENU_MISC = [
  { href: '/easy/schedules', label: '⏰ 스케줄' },
];

function HomepageLink() {
  const [info, setInfo] = useState<{ exists: boolean; code?: string; url?: string; public_url?: string } | null>(null);

  useEffect(() => {
    const token = (sessionStorage.getItem('access_token') || localStorage.getItem('access_token'));
    if (!token) return;
    fetch('/api/sso/homepage', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => data && setInfo(data))
      .catch(() => {});
  }, []);

  if (!info?.exists) return null;

  return (
    <div className="mb-2 px-4 py-3 border-b border-[var(--card-border)] bg-gradient-to-br from-emerald-500/10 to-blue-500/10">
      <div className="text-[10px] text-[var(--muted)] mb-1">📢 내 홈페이지</div>
      <a href={info.url} target="_blank" rel="noopener noreferrer"
        className="block text-sm font-bold text-emerald-500 hover:text-emerald-400">
        🏠 홈페이지 편집 →
      </a>
      <a href={info.public_url} target="_blank" rel="noopener noreferrer"
        className="block text-[10px] text-[var(--muted)] hover:text-blue-500 mt-1 truncate">
        공개 URL: ai.on1.kr{info.public_url}
      </a>
    </div>
  );
}

export default function EasyLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const u = (sessionStorage.getItem('user') || localStorage.getItem('user'));
    if (u) {
      try { setUser(JSON.parse(u)); } catch {}
    }
    localStorage.setItem('preferred_mode', 'easy');
  }, []);

  // 페이지 이동 시 모바일 사이드바 닫기
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const switchToExpert = () => {
    localStorage.setItem('preferred_mode', 'expert');
    router.push('/dashboard');
  };

  const handleLogout = async () => {
    try { await api.logout(); } catch {}
    router.replace('/login');
  };

  return (
    <div className="min-h-screen bg-[var(--background)] flex">
      {/* 모바일 오버레이 */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* 좌측 사이드바 — 데스크톱 항상 표시, 모바일 토글 */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 w-56 bg-[var(--card-bg)] border-r border-[var(--card-border)]
        flex flex-col transform transition-transform lg:transform-none
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-4 border-b border-[var(--card-border)] flex items-center justify-between">
          <div>
            <div className="font-bold text-lg">🗳️ 캠프 AI</div>
            <div className="text-xs text-[var(--muted)] mt-0.5">{user?.name || '로그인됨'}</div>
          </div>
          <button onClick={() => setMobileOpen(false)} className="lg:hidden text-[var(--muted)] hover:text-white text-lg">✕</button>
        </div>

        <nav className="flex-1 py-2 overflow-y-auto">
          <HomepageLink />

          {(() => {
            const isActive = (href: string) =>
              href === '/easy'
                ? pathname === '/easy'
                : pathname === href || pathname.startsWith(href + '/');
            const linkClass = (active: boolean) =>
              `flex items-center gap-3 px-4 py-2.5 text-sm transition ${
                active
                  ? 'bg-blue-500/20 text-blue-500 border-r-4 border-blue-500 font-semibold'
                  : 'text-[var(--foreground)] hover:bg-[var(--muted-bg)]'
              }`;
            const Divider = () => (
              <div className="my-2 mx-4 border-t border-[var(--card-border)]" />
            );
            // 현재 페이지 재클릭 시 강제 리셋 (step 초기화 등)
            const handleNav = (href: string) => (e: React.MouseEvent) => {
              if (pathname === href || pathname.startsWith(href + '/')) {
                e.preventDefault();
                router.push(`${href}?_r=${Date.now()}`);
              }
            };
            const renderItem = (item: { href: string; label: string }) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={handleNav(item.href)}
                className={linkClass(isActive(item.href))}
              >
                {item.label}
              </Link>
            );
            return (
              <>
                {MENU_DAILY.map(renderItem)}
                <Divider />
                {MENU_CREATE.map(renderItem)}
                <Divider />
                {MENU_ANALYSIS.map(renderItem)}
                <Divider />
                {MENU_MISC.map(renderItem)}
              </>
            );
          })()}
        </nav>

        <div className="border-t border-[var(--card-border)] p-3 space-y-2">
          <button onClick={switchToExpert}
            className="w-full text-xs px-3 py-2 bg-gray-700/30 text-[var(--foreground)] rounded hover:bg-gray-700/50">
            🔬 전문가 모드로 전환
          </button>
          <button onClick={handleLogout}
            className="w-full text-xs px-3 py-2 text-red-400 hover:bg-red-500/10 rounded">
            로그아웃
          </button>
        </div>
      </aside>

      {/* 메인 콘텐츠 */}
      <main className="flex-1 overflow-auto min-w-0">
        {/* 상단 모드 토글 헤더 — 모바일 햄버거 포함 */}
        <div className="h-12 border-b border-[var(--card-border)] bg-[var(--card-bg)] flex items-center justify-between px-3 lg:px-6 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setMobileOpen(true)} className="lg:hidden p-2 -ml-2 rounded hover:bg-[var(--muted-bg)]">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
              </svg>
            </button>
            <div className="text-sm font-semibold text-blue-500 truncate">😊 쉬운 모드</div>
          </div>
          <button onClick={switchToExpert}
            className="text-xs px-2 lg:px-3 py-1.5 bg-gray-700/30 hover:bg-gray-700/50 text-[var(--foreground)] rounded-lg transition font-medium whitespace-nowrap">
            🔬 <span className="hidden sm:inline">전문가 모드로 전환</span>
            <span className="sm:hidden">전문가</span>
          </button>
        </div>
        <div className="max-w-5xl mx-auto p-3 lg:p-6">
          {children}
        </div>
      </main>

      {/* 부동 AI 비서 */}
      <FloatingAssistant />
    </div>
  );
}
