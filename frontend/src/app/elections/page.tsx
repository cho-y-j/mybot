'use client';
import { useState, useEffect } from 'react';
import { api } from '@/services/api';

export default function ElectionsPage() {
  const [elections, setElections] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '', election_type: 'superintendent', election_date: '',
    region_sido: '', region_sigungu: '',
  });
  const [error, setError] = useState('');

  useEffect(() => { loadElections(); }, []);

  const loadElections = async () => {
    try { setElections(await api.getElections()); } catch {}
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.createElection(form);
      setShowForm(false);
      setForm({ name: '', election_type: 'superintendent', election_date: '', region_sido: '', region_sigungu: '' });
      loadElections();
    } catch (err: any) { setError(err.message); }
  };

  const types: Record<string, string> = {
    presidential: '대통령', congressional: '국회의원', governor: '시도지사',
    mayor: '시장/군수/구청장', superintendent: '교육감', council: '지방의원', other: '기타',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">선거 관리</h1>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          + 새 선거 추가
        </button>
      </div>

      {showForm && (
        <div className="card">
          <h3 className="font-semibold mb-4">새 선거 생성</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">선거 이름</label>
              <input className="input-field" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="예: 2026 충북 교육감 선거" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">선거 유형</label>
              <select className="input-field" value={form.election_type}
                onChange={(e) => setForm({ ...form, election_type: e.target.value })}>
                {Object.entries(types).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">선거일</label>
              <input type="date" className="input-field" value={form.election_date}
                onChange={(e) => setForm({ ...form, election_date: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">시/도</label>
              <input className="input-field" value={form.region_sido}
                onChange={(e) => setForm({ ...form, region_sido: e.target.value })}
                placeholder="예: 충청북도" />
            </div>
            {error && <div className="col-span-2 bg-danger-50 text-danger-600 text-sm p-3 rounded-lg">{error}</div>}
            <div className="col-span-2 flex gap-2">
              <button type="submit" className="btn-primary">생성</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">취소</button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {elections.map((el) => (
          <div key={el.id} className="card hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-lg">{el.name}</h3>
                <p className="text-sm text-gray-500 mt-1">
                  {types[el.election_type]} | {el.region_sido || '전국'} | {el.election_date}
                </p>
              </div>
              <span className={`text-2xl font-bold ${el.d_day <= 30 ? 'text-danger-500' : 'text-primary-600'}`}>
                D-{el.d_day}
              </span>
            </div>
            <div className="mt-4 flex gap-4 text-sm text-gray-500">
              <span>후보 {el.candidates_count}명</span>
              <span>키워드 {el.keywords_count}개</span>
              <span className={el.is_active ? 'text-green-600' : 'text-gray-400'}>
                {el.is_active ? '활성' : '비활성'}
              </span>
            </div>
            <div className="mt-4 flex gap-2">
              <a href={`/elections/candidates?id=${el.id}`} className="btn-secondary text-sm">후보자 관리</a>
              <a href={`/elections/keywords?id=${el.id}`} className="btn-secondary text-sm">키워드 관리</a>
            </div>
          </div>
        ))}

        {elections.length === 0 && !showForm && (
          <div className="col-span-2 card text-center py-12 text-gray-500">
            아직 등록된 선거가 없습니다. 위의 "새 선거 추가" 버튼을 눌러주세요.
          </div>
        )}
      </div>
    </div>
  );
}
