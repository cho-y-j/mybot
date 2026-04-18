'use client';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { api } from '@/services/api';
import FloatingAssistant from '@/components/easy/FloatingAssistant';
import ThemeToggle from '@/components/ThemeToggle';

// 단색 SVG path (heroicons 스타일 — currentColor 기반)
const ICON = {
  home: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  report: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  chat: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  edit: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  users: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  chart: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  news: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z',
  play: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  trend: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
  history: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  settings: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
};

// 일상
const MENU_DAILY = [
  { href: '/easy', label: '홈', icon: ICON.home },
  { href: '/easy/reports', label: '보고서', icon: ICON.report },
  { href: '/easy/assistant', label: 'AI 비서', icon: ICON.chat },
];

// 생성 (토론 대본 포함 — 콘텐츠 만들기 내부 유형으로 통합됨)
const MENU_CREATE = [
  { href: '/easy/content', label: '콘텐츠 만들기', icon: ICON.edit },
];

// 분석 (과거 선거 포함)
const MENU_ANALYSIS = [
  { href: '/easy/candidates', label: '후보 비교', icon: ICON.users },
  { href: '/easy/surveys', label: '여론조사', icon: ICON.chart },
  { href: '/easy/news', label: '뉴스 분석', icon: ICON.news },
  { href: '/easy/youtube', label: '미디어 분석', icon: ICON.play },
  { href: '/easy/trends', label: '키워드 트렌드', icon: ICON.trend },
  { href: '/easy/history', label: '과거 선거', icon: ICON.history },
];

// 설정
const MENU_MISC = [
  { href: '/easy/settings', label: '설정', icon: ICON.settings },
];

function HomepageLink() {
  // 페이지 로드 시 code/public_url만 조회. 비번은 가입 시 mybot 비번과 동기화되어
  // 있으므로 편집 버튼은 그냥 admin/login으로 새 탭 열기 — 같은 비번 1회 입력하면 끝.
  const [info, setInfo] = useState<{ exists: boolean; code?: string; public_url?: string } | null>(null);

  useEffect(() => {
    const token = (sessionStorage.getItem('access_token') || localStorage.getItem('access_token'));
    if (!token) return;
    fetch('/api/sso/homepage', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => data && setInfo({ exists: data.exists, code: data.code, public_url: data.public_url }))
      .catch(() => {});
  }, []);

  if (!info?.exists || !info.code) return null;

  return (
    <div className="mb-2 px-4 py-3 border-b border-[var(--card-border)]">
      <div className="text-[10px] text-[var(--muted)] mb-1 uppercase tracking-wider">내 홈페이지</div>
      <a href={`/${info.code}/admin/login`} target="_blank" rel="noopener noreferrer"
        className="block w-full text-left text-sm font-bold text-[var(--foreground)] hover:opacity-80">
        홈페이지 편집 →
      </a>
      <a href={info.public_url} target="_blank" rel="noopener noreferrer"
        className="block text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] mt-1 truncate">
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
            <div className="font-bold text-lg tracking-tight">CampAI</div>
            <div className="text-xs text-[var(--muted)] mt-0.5">{user?.name || '로그인됨'}</div>
          </div>
          <button onClick={() => setMobileOpen(false)} className="lg:hidden text-[var(--muted)] hover:text-[var(--foreground)] text-lg"></button>
        </div>

        <nav className="flex-1 py-2 overflow-y-auto">
          <HomepageLink />

          {(() => {
            const isActive = (href: string) =>
              href === '/easy'
                ? pathname === '/easy'
                : pathname === href || pathname.startsWith(href + '/');
            const linkClass = (active: boolean) =>
              `relative flex items-center gap-3 px-4 py-2.5 text-sm transition ${
                active
                  ? 'bg-[var(--muted-bg)] text-[var(--foreground)] font-semibold'
                  : 'text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]'
              }`;
            const Divider = () => (
              <div className="my-2 mx-4 border-t border-[var(--card-border)]" />
            );
            const handleNav = (href: string) => (e: React.MouseEvent) => {
              if (pathname === href || pathname.startsWith(href + '/')) {
                e.preventDefault();
                router.push(`${href}?_r=${Date.now()}`);
              }
            };
            const renderItem = (item: { href: string; label: string; icon: string }) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={handleNav(item.href)}
                  className={linkClass(active)}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[18px] rounded-r bg-[var(--foreground)]" />
                  )}
                  <svg className="w-[16px] h-[16px] flex-shrink-0 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                  {item.label}
                </Link>
              );
            };
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
            className="w-full text-xs px-3 py-2 text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--muted-bg)] rounded transition-colors">
            전문가 모드로 전환
          </button>
          <button onClick={handleLogout}
            className="w-full text-xs px-3 py-2 text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--muted-bg)] rounded transition-colors">
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
            <div className="text-sm font-semibold text-[var(--foreground)] truncate">쉬운 모드</div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button onClick={switchToExpert}
              className="text-xs px-3 py-1.5 border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--muted-bg)] rounded-lg transition-colors font-medium whitespace-nowrap">
              <span className="hidden sm:inline">전문가 모드로 전환</span>
              <span className="sm:hidden">전문가</span>
            </button>
          </div>
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
