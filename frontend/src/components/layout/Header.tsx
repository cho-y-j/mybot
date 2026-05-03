'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/services/api';

export default function Header({ onMenuClick }: { onMenuClick?: () => void } = {}) {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    api.getProfile().then(setUser).catch(() => {});
  }, []);

  const handleLogout = async () => {
    await api.logout();
    router.push('/login');
  };

  return (
    <header className="h-14 border-b flex items-center justify-between px-4 lg:px-6 bg-[var(--card-bg)] border-[var(--card-border)]">
      <button onClick={onMenuClick}
        aria-label="메뉴 열기"
        className="lg:hidden flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--card-border)] text-[var(--foreground)] hover:bg-[var(--muted-bg)] active:scale-95 transition">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
        </svg>
        <span className="text-sm font-semibold">메뉴</span>
      </button>
      <div className="flex-1" />
      <div className="flex items-center gap-3">
        <button onClick={() => { localStorage.setItem('preferred_mode', 'easy'); router.push('/easy'); }}
          className="text-xs px-3 py-1.5 bg-blue-500/10 text-blue-500 rounded-lg hover:bg-blue-500/20 transition-colors font-medium">
           쉬운 모드
        </button>
        {user && (
          <span className="text-sm text-[var(--muted)] hidden sm:inline">
            {user.name} <span className="text-xs opacity-60">({user.role})</span>
          </span>
        )}
        <button onClick={handleLogout} className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
          로그아웃
        </button>
      </div>
    </header>
  );
}
