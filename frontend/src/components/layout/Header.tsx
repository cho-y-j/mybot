'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/services/api';

export default function Header() {
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
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      <div />
      <div className="flex items-center gap-4">
        {user && (
          <span className="text-sm text-gray-600">
            {user.name} ({user.role})
          </span>
        )}
        <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-gray-700">
          로그아웃
        </button>
      </div>
    </header>
  );
}
