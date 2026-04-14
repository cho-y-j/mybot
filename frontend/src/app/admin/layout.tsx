'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import clsx from 'clsx';

const adminNav = [
  { href: '/admin', label: '대시보드', icon: '📊' },
  { href: '/admin/tenants', label: '캠프 관리', icon: '🏢' },
  { href: '/admin/users', label: '회원 관리', icon: '👥' },
  { href: '/admin/monitoring', label: '모니터링', icon: '📈' },
  { href: '/admin/schedules', label: '스케줄', icon: '⏰' },
  { href: '/admin/system', label: '시스템', icon: '⚙️' },
  { href: '/admin/setup', label: '초기 셋팅', icon: '🔧' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        if (!user.is_superadmin) {
          router.replace('/dashboard');
          return;
        }
        setAdminName(user.name || user.email || 'Admin');
        setAuthorized(true);
      } catch {
        router.replace('/dashboard');
      }
    } else {
      router.replace('/login');
    }
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    router.replace('/login');
  };

  if (!authorized) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const isActive = (href: string) => {
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen bg-gray-900 flex">
      {/* 사이드바 */}
      <aside className={clsx(
        'bg-gray-800 border-r border-gray-700 flex flex-col transition-all duration-200',
        sidebarOpen ? 'w-52' : 'w-14'
      )}>
        {/* 로고 */}
        <div className="p-3 border-b border-gray-700 flex items-center justify-between">
          {sidebarOpen && <span className="text-white font-bold text-sm">EP Admin</span>}
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-gray-400 hover:text-white text-lg">
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        {/* 네비게이션 */}
        <nav className="flex-1 py-2">
          {adminNav.map((item) => (
            <Link key={item.href} href={item.href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 text-sm transition-colors',
                isActive(item.href)
                  ? 'bg-blue-600/20 text-blue-400 border-r-2 border-blue-400'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              )}>
              <span className="text-base">{item.icon}</span>
              {sidebarOpen && <span>{item.label}</span>}
            </Link>
          ))}
        </nav>

        {/* 하단 */}
        <div className="border-t border-gray-700 p-3 space-y-2">
          <Link href="/dashboard"
            className="flex items-center gap-2 text-xs text-gray-400 hover:text-green-400 transition-colors">
            <span>🌐</span>
            {sidebarOpen && <span>고객 사이트</span>}
          </Link>
          <div className="flex items-center gap-2">
            {sidebarOpen && <span className="text-xs text-gray-500 truncate">{adminName}</span>}
            <button onClick={handleLogout}
              className="text-xs text-red-400 hover:text-red-300 transition-colors ml-auto">
              {sidebarOpen ? '로그아웃' : '🚪'}
            </button>
          </div>
        </div>
      </aside>

      {/* 메인 콘텐츠 */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
