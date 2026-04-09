'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/services/api';
import LandingPage from '@/components/landing/LandingPage';

export default function Home() {
  const router = useRouter();
  const [showLanding, setShowLanding] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      if (!api.isAuthenticated()) {
        setShowLanding(true);
        setChecking(false);
        return;
      }
      try {
        const me = await api.getProfile();
        if (me.is_superadmin) {
          router.replace('/admin');
          return;
        }
        if (!me.tenant_id) {
          router.replace('/onboarding/create-campaign');
          return;
        }
        const elections = await api.getElections();
        if (elections.length > 0) {
          router.replace('/dashboard');
        } else {
          router.replace('/onboarding');
        }
      } catch {
        // Token invalid or expired — show landing
        api.clearTokens();
        setShowLanding(true);
        setChecking(false);
      }
    })();
  }, [router]);

  if (showLanding) {
    return <LandingPage />;
  }

  // Loading state while checking auth
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0b0e1a]">
      <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>
  );
}
