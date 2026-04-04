'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

const adminNav = [
  { href: '/admin', label: '시스템 현황' },
  { href: '/admin/tenants', label: '고객 관리' },
  { href: '/admin/setup', label: '초기 셋팅' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-gray-900">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="text-white font-bold">ElectionPulse Admin</span>
          <nav className="flex gap-1">
            {adminNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'px-3 py-1.5 rounded text-sm',
                  pathname === item.href
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-300 hover:text-white hover:bg-gray-700'
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <Link href="/dashboard" className="text-sm text-gray-400 hover:text-white">
          고객 화면으로
        </Link>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
