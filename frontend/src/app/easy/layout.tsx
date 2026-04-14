'use client';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { api } from '@/services/api';
import FloatingAssistant from '@/components/easy/FloatingAssistant';

const MENU_BASIC = [
  { href: '/easy', label: '🏠 홈', icon: '🏠' },
  { href: '/easy/assistant', label: '💬 AI 비서', icon: '💬' },
  { href: '/easy/content', label: '📝 콘텐츠 만들기', icon: '📝' },
  { href: '/easy/reports', label: '📊 보고서', icon: '📊' },
];

const MENU_ADVANCED = [
  { href: '/easy/news', label: '📰 뉴스' },
  { href: '/easy/candidates', label: '👥 후보자' },
  { href: '/easy/surveys', label: '📋 여론조사' },
  { href: '/easy/trends', label: '🔍 트렌드' },
  { href: '/easy/youtube', label: '📺 유튜브' },
  { href: '/easy/debate', label: '🎤 토론 대본' },
  { href: '/easy/schedules', label: '⏰ 스케줄' },
];

export default function EasyLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const u = localStorage.getItem('user');
    if (u) {
      try { setUser(JSON.parse(u)); } catch {}
    }
    // 쉬운 모드 기본 저장
    localStorage.setItem('preferred_mode', 'easy');
  }, []);

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
      {/* 좌측 사이드바 */}
      <aside className="w-56 bg-[var(--card-bg)] border-r border-[var(--card-border)] flex flex-col">
        <div className="p-4 border-b border-[var(--card-border)]">
          <div className="font-bold text-lg">🗳️ 캠프 AI</div>
          <div className="text-xs text-[var(--muted)] mt-0.5">{user?.name || '로그인됨'}</div>
        </div>

        <nav className="flex-1 py-2 overflow-y-auto">
          {MENU_BASIC.map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link key={item.href} href={item.href}
                className={`flex items-center gap-3 px-4 py-3 text-sm transition
                  ${active ? 'bg-blue-500/20 text-blue-500 border-r-4 border-blue-500 font-semibold'
                           : 'text-[var(--foreground)] hover:bg-[var(--muted-bg)]'}`}>
                {item.label}
              </Link>
            );
          })}

          <div className="mt-4 px-4 py-1 text-xs text-[var(--muted)] font-semibold">
            전문가 메뉴
          </div>
          <button onClick={() => setAdvancedOpen(!advancedOpen)}
            className="w-full flex items-center justify-between px-4 py-2 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)]">
            <span>{advancedOpen ? '▼' : '▶'} 더보기</span>
            <span>({MENU_ADVANCED.length})</span>
          </button>
          {advancedOpen && (
            <div className="border-l-2 border-[var(--card-border)] ml-4">
              {MENU_ADVANCED.map(item => (
                <Link key={item.href} href={item.href}
                  className="block px-3 py-2 text-xs text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--muted-bg)]">
                  {item.label}
                </Link>
              ))}
            </div>
          )}
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
      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-6">
          {children}
        </div>
      </main>

      {/* 부동 AI 비서 */}
      <FloatingAssistant />
    </div>
  );
}
