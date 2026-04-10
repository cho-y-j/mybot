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
      <button onClick={onMenuClick} className="lg:hidden p-2 rounded-lg hover:bg-[var(--muted-bg)]">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
        </svg>
      </button>
      <div className="flex-1" />
      <div className="flex items-center gap-4">
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
