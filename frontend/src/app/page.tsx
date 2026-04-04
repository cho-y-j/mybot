'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/services/api';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      if (!api.isAuthenticated()) {
        router.replace('/login');
        return;
      }
      try {
        // 선거가 있으면 대시보드, 없으면 온보딩
        const elections = await api.getElections();
        if (elections.length > 0) {
          router.replace('/dashboard');
        } else {
          router.replace('/onboarding');
        }
      } catch {
        router.replace('/onboarding');
      }
    })();
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" />
    </div>
  );
}
