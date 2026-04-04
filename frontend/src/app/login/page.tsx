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
      router.push('/dashboard');
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-white">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">ElectionPulse</h1>
          <p className="text-gray-500 mt-2">선거 분석 플랫폼</p>
        </div>

        <div className="card">
          <h2 className="text-xl font-semibold mb-6">로그인</h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
              <input
                type="email"
                className="input-field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호</label>
              <input
                type="password"
                className="input-field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {needs2FA && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">2FA 인증 코드</label>
                <input
                  type="text"
                  className="input-field"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="6자리 코드"
                  maxLength={6}
                  autoFocus
                />
              </div>
            )}

            {error && (
              <div className="bg-danger-50 text-danger-600 text-sm p-3 rounded-lg">{error}</div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? '로그인 중...' : '로그인'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-500">
            계정이 없으신가요?{' '}
            <Link href="/register" className="text-primary-600 hover:underline font-medium">
              회원가입
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
