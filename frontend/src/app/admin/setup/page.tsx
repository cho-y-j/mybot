'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function AdminSetupPage() {
  const searchParams = useSearchParams();
  const tenantId = searchParams.get('tenant') || '';

  const [form, setForm] = useState({
    election_name: '',
    election_type: 'superintendent',
    election_date: '',
    region_sido: '',
    region_sigungu: '',
    our_candidate_name: '',
    our_candidate_party: '',
    setup_notes: '',
  });
  const [competitors, setCompetitors] = useState<Array<{ name: string; party: string; alignment: string }>>([]);
  const [keywords, setKeywords] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const addCompetitor = () => {
    setCompetitors([...competitors, { name: '', party: '', alignment: '' }]);
  };

  const updateCompetitor = (i: number, field: string, value: string) => {
    const updated = [...competitors];
    (updated[i] as any)[field] = value;
    setCompetitors(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    const body = {
      ...form,
      competitors,
      monitoring_keywords: keywords.split(',').map(s => s.trim()).filter(Boolean),
    };

    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/setup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('access_token')}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail);
      }

      const data = await res.json();
      setMessage(`셋팅 완료! 선거: ${data.election_id}, 후보: ${data.candidates}명, 키워드: ${data.keywords}개, 스케줄: ${data.schedules}개`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">고객 초기 셋팅</h1>
      {!tenantId && (
        <div className="bg-yellow-500/20 text-yellow-300 p-3 rounded-lg text-sm">
          고객 목록에서 "셋팅 필요"를 클릭하여 테넌트 ID를 전달해주세요.
        </div>
      )}

      {message && <div className="bg-green-500/20 text-green-300 p-3 rounded-lg text-sm">{message}</div>}
      {error && <div className="bg-red-500/20 text-red-300 p-3 rounded-lg text-sm">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 선거 정보 */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-5 space-y-4">
          <h3 className="text-white font-semibold">선거 정보</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">선거 이름</label>
              <input className="input-field bg-gray-700 text-white border-gray-600" value={form.election_name}
                onChange={(e) => setForm({ ...form, election_name: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">선거 유형</label>
              <select className="input-field bg-gray-700 text-white border-gray-600" value={form.election_type}
                onChange={(e) => setForm({ ...form, election_type: e.target.value })}>
                <option value="presidential">대통령</option>
                <option value="congressional">국회의원</option>
                <option value="governor">시도지사</option>
                <option value="mayor">시장/군수/구청장</option>
                <option value="superintendent">교육감</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">선거일</label>
              <input type="date" className="input-field bg-gray-700 text-white border-gray-600"
                value={form.election_date}
                onChange={(e) => setForm({ ...form, election_date: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">시/도</label>
              <input className="input-field bg-gray-700 text-white border-gray-600" value={form.region_sido}
                onChange={(e) => setForm({ ...form, region_sido: e.target.value })} />
            </div>
          </div>
        </div>

        {/* 우리 후보 */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-5 space-y-4">
          <h3 className="text-white font-semibold">우리 후보</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">이름</label>
              <input className="input-field bg-gray-700 text-white border-gray-600"
                value={form.our_candidate_name}
                onChange={(e) => setForm({ ...form, our_candidate_name: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">정당</label>
              <input className="input-field bg-gray-700 text-white border-gray-600"
                value={form.our_candidate_party}
                onChange={(e) => setForm({ ...form, our_candidate_party: e.target.value })} />
            </div>
          </div>
        </div>

        {/* 경쟁 후보 */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-semibold">경쟁 후보</h3>
            <button type="button" onClick={addCompetitor}
              className="text-sm text-primary-400 hover:text-primary-300">+ 추가</button>
          </div>
          {competitors.map((c, i) => (
            <div key={i} className="grid grid-cols-3 gap-3">
              <input className="input-field bg-gray-700 text-white border-gray-600" placeholder="이름"
                value={c.name} onChange={(e) => updateCompetitor(i, 'name', e.target.value)} />
              <input className="input-field bg-gray-700 text-white border-gray-600" placeholder="정당"
                value={c.party} onChange={(e) => updateCompetitor(i, 'party', e.target.value)} />
              <select className="input-field bg-gray-700 text-white border-gray-600"
                value={c.alignment} onChange={(e) => updateCompetitor(i, 'alignment', e.target.value)}>
                <option value="">성향</option>
                <option value="conservative">보수</option>
                <option value="progressive">진보</option>
                <option value="centrist">중도</option>
              </select>
            </div>
          ))}
        </div>

        {/* 키워드 */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-5 space-y-4">
          <h3 className="text-white font-semibold">모니터링 키워드 (콤마 구분)</h3>
          <textarea className="input-field bg-gray-700 text-white border-gray-600" rows={3}
            value={keywords} onChange={(e) => setKeywords(e.target.value)}
            placeholder="교육감 선거, 학교 급식, 돌봄 교실, 학부모 의견" />
        </div>

        {/* 메모 */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-5 space-y-4">
          <h3 className="text-white font-semibold">관리자 메모</h3>
          <textarea className="input-field bg-gray-700 text-white border-gray-600" rows={2}
            value={form.setup_notes} onChange={(e) => setForm({ ...form, setup_notes: e.target.value })}
            placeholder="고객 요구사항, 특이사항 등" />
        </div>

        <button type="submit" className="btn-primary w-full py-3 text-lg" disabled={!tenantId}>
          초기 셋팅 완료
        </button>
      </form>
    </div>
  );
}
