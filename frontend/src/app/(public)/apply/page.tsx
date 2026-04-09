'use client';

import { useState } from 'react';
import Link from 'next/link';

const ELECTION_TYPES = [
  '교육감',
  '시장',
  '도지사',
  '군수',
  '구청장',
  '도의원',
  '시의원',
];

const POSITIONS = [
  '캠프매니저',
  '홍보담당',
  '후보자 본인',
  '기타',
];

const SIDO_LIST = [
  '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시',
  '대전광역시', '울산광역시', '세종특별자치시', '경기도', '강원특별자치도',
  '충청북도', '충청남도', '전북특별자치도', '전라남도', '경상북도',
  '경상남도', '제주특별자치도',
];

interface FormData {
  name: string;
  email: string;
  password: string;
  password_confirm: string;
  phone: string;
  organization: string;
  election_type: string;
  region_sido: string;
  region_sigungu: string;
  candidate_name: string;
  position: string;
  reason: string;
}

export default function ApplyPage() {
  const [form, setForm] = useState<FormData>({
    name: '',
    email: '',
    password: '',
    password_confirm: '',
    phone: '',
    organization: '',
    election_type: '',
    region_sido: '',
    region_sigungu: '',
    candidate_name: '',
    position: '',
    reason: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (form.password !== form.password_confirm) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }
    if (form.password.length < 8) {
      setError('비밀번호는 8자 이상이어야 합니다.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
          phone: form.phone,
          organization: form.organization,
          election_type: form.election_type,
          region: `${form.region_sido} ${form.region_sigungu}`.trim(),
          candidate_name: form.candidate_name,
          position: form.position,
          reason: form.reason,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || '신청에 실패했습니다. 다시 시도해주세요.');
      }

      setSuccess(true);
    } catch (err: any) {
      setError(err.message || '신청에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-[#0b0e1a] flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-blue-600/20 to-purple-600/20 border border-white/10 flex items-center justify-center mb-6">
            <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">가입 신청이 접수되었습니다</h1>
          <p className="text-gray-400 mb-8">
            관리자 승인 후 이용 가능합니다.
            <br />
            승인이 완료되면 이메일로 안내드리겠습니다.
          </p>
          <Link
            href="/"
            className="inline-block px-6 py-3 rounded-xl border border-white/10 text-gray-300 font-medium hover:border-white/20 hover:text-white transition-all"
          >
            메인으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0e1a] text-gray-100">
      {/* Nav */}
      <nav className="border-b border-white/5 bg-[#0b0e1a]/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
              C
            </div>
            <span className="text-xl font-bold text-white tracking-tight">CampAI</span>
          </Link>
          <Link href="/login" className="text-sm text-gray-400 hover:text-white transition-colors">
            로그인
          </Link>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-16">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-white">가입 신청</h1>
          <p className="mt-3 text-gray-400">
            캠프 정보를 입력해주세요. 관리자 확인 후 계정이 활성화됩니다.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 기본 정보 */}
          <div className="p-6 rounded-2xl border border-white/5 bg-white/[0.02] space-y-5">
            <h2 className="text-lg font-semibold text-white border-b border-white/5 pb-3">기본 정보</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">이름 *</label>
                <input
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all"
                  placeholder="홍길동"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">이메일 *</label>
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all"
                  placeholder="email@example.com"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">비밀번호 *</label>
                <input
                  type="password"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all"
                  placeholder="8자 이상"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">비밀번호 확인 *</label>
                <input
                  type="password"
                  name="password_confirm"
                  value={form.password_confirm}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all"
                  placeholder="비밀번호 재입력"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">전화번호 *</label>
              <input
                type="tel"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                required
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all"
                placeholder="010-0000-0000"
              />
            </div>
          </div>

          {/* 캠프 정보 */}
          <div className="p-6 rounded-2xl border border-white/5 bg-white/[0.02] space-y-5">
            <h2 className="text-lg font-semibold text-white border-b border-white/5 pb-3">캠프 정보</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">소속 캠프/조직 *</label>
                <input
                  type="text"
                  name="organization"
                  value={form.organization}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all"
                  placeholder="OOO 후보 캠프"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">후보자명 *</label>
                <input
                  type="text"
                  name="candidate_name"
                  value={form.candidate_name}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all"
                  placeholder="후보자 성명"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">선거 유형 *</label>
                <select
                  name="election_type"
                  value={form.election_type}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all appearance-none"
                >
                  <option value="" className="bg-[#1a1d2e]">선택하세요</option>
                  {ELECTION_TYPES.map((t) => (
                    <option key={t} value={t} className="bg-[#1a1d2e]">{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">직책/역할 *</label>
                <select
                  name="position"
                  value={form.position}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all appearance-none"
                >
                  <option value="" className="bg-[#1a1d2e]">선택하세요</option>
                  {POSITIONS.map((p) => (
                    <option key={p} value={p} className="bg-[#1a1d2e]">{p}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">시/도</label>
                <select
                  name="region_sido"
                  value={form.region_sido}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all appearance-none"
                >
                  <option value="" className="bg-[#1a1d2e]">선택하세요</option>
                  {SIDO_LIST.map((s) => (
                    <option key={s} value={s} className="bg-[#1a1d2e]">{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">시/군/구</label>
                <input
                  type="text"
                  name="region_sigungu"
                  value={form.region_sigungu}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all"
                  placeholder="예: 강남구"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">가입 사유</label>
              <textarea
                name="reason"
                value={form.reason}
                onChange={handleChange}
                rows={3}
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all resize-none"
                placeholder="서비스를 알게 된 경로, 기대하는 활용 방안 등"
              />
            </div>
          </div>

          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold text-lg hover:from-blue-500 hover:to-purple-500 transition-all shadow-lg shadow-blue-600/25 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '신청 중...' : '가입 신청'}
          </button>

          <p className="text-center text-sm text-gray-500">
            이미 계정이 있으신가요?{' '}
            <Link href="/login" className="text-blue-400 hover:text-blue-300 transition-colors">
              로그인
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
