'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/services/api';

export default function CreateCampaignPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!api.isAuthenticated()) {
      router.replace('/login');
      return;
    }
    // 이미 캠프가 있으면 바로 온보딩으로
    api.getProfile().then(me => {
      if (me.tenant_id) {
        router.replace('/onboarding');
      }
    }).catch(() => router.replace('/login'));
  }, [router]);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('캠프 이름을 입력하세요');
      return;
    }
    setCreating(true);
    setError('');
    try {
      // slug 자동 생성 (이름 영문/숫자만 유지)
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `camp-${Date.now()}`;
      await api.createTenant({ name: name.trim(), slug, plan: 'basic' });
      // 캠프 생성 성공 → 온보딩으로 이동
      router.replace('/onboarding');
    } catch (e: any) {
      setError(e?.message || '캠프 생성 실패');
    } finally { setCreating(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-500/5 to-indigo-500/5 p-4">
      <div className="card max-w-md w-full">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold mb-2">선거 캠프 만들기</h1>
          <p className="text-sm text-[var(--muted)]">
            ElectionPulse를 시작하려면 먼저 캠프를 만들어주세요.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-[var(--muted)] block mb-1">캠프 이름</label>
            <input
              className="input-field w-full"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="예: 김진균 선거캠프, 청주시장 캠프"
              autoFocus
            />
            <p className="text-[10px] text-[var(--muted)] mt-1">
              나중에 변경 가능합니다.
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-500">
              {error}
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? '생성 중...' : '캠프 만들기'}
          </button>

          <div className="text-center">
            <button
              onClick={() => { api.logout(); router.replace('/login'); }}
              className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              로그아웃
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
