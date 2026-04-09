'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/services/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needs2FA, setNeeds2FA] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await api.login(email, password, totpCode || undefined);
      api.setTokens(data);
      if (data?.user?.is_superadmin) {
        router.push('/admin');
      } else {
        router.push('/');
      }
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('2FA')) {
        setNeeds2FA(true);
        setError('');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b0e1a]">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-gradient-to-b from-blue-600/15 via-purple-600/10 to-transparent rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-md px-6">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold">
              C
            </div>
            <span className="text-3xl font-bold text-white tracking-tight">CampAI</span>
          </Link>
          <p className="text-gray-500 mt-2">AI 선거 참모</p>
        </div>

        <div className="p-8 rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-sm">
          <h2 className="text-xl font-semibold text-white mb-6">로그인</h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">이메일</label>
              <input
                type="email"
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">비밀번호</label>
              <input
                type="password"
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {needs2FA && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">2FA 인증 코드</label>
                <input
                  type="text"
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="6자리 코드"
                  maxLength={6}
                  autoFocus
                />
              </div>
            )}

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-xl">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold hover:from-blue-500 hover:to-purple-500 transition-all disabled:opacity-50 shadow-lg shadow-blue-600/20"
            >
              {loading ? '로그인 중...' : '로그인'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-500">
            계정이 없으신가요?{' '}
            <Link href="/apply" className="text-blue-400 hover:text-blue-300 font-medium transition-colors">
              가입 신청
            </Link>
          </div>
        </div>

        <div className="mt-6 text-center">
          <Link href="/" className="text-sm text-gray-600 hover:text-gray-400 transition-colors">
            메인으로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}
