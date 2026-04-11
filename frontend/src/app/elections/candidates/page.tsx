'use client';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/services/api';

export default function CandidatesPage() {
  const searchParams = useSearchParams();
  const urlElectionId = searchParams?.get('id') || '';
  const [electionId, setElectionId] = useState(urlElectionId);

  const [candidates, setCandidates] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', party: '', party_alignment: '', role: '',
    is_our_candidate: false, career_summary: '',
    search_keywords: '', homonym_filters: '',
  });
  const [error, setError] = useState('');

  // URL에 election_id 없으면 첫 번째 선거 자동 선택
  useEffect(() => {
    if (!electionId) {
      api.getElections().then((els: any[]) => {
        if (els.length > 0) setElectionId(els[0].id);
      }).catch(() => {});
    }
  }, []);

  useEffect(() => { if (electionId) loadCandidates(); }, [electionId]);

  const loadCandidates = async () => {
    try { setCandidates(await api.getCandidates(electionId)); } catch {}
  };

  const resetForm = () => {
    setForm({ name: '', party: '', party_alignment: '', role: '', is_our_candidate: false, career_summary: '', search_keywords: '', homonym_filters: '' });
    setEditId(null);
    setShowForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const data = {
      ...form,
      search_keywords: form.search_keywords.split(',').map(s => s.trim()).filter(Boolean),
      homonym_filters: form.homonym_filters.split(',').map(s => s.trim()).filter(Boolean),
    };

    try {
      if (editId) {
        await api.updateCandidate(electionId, editId, data);
      } else {
        await api.addCandidate(electionId, data);
      }
      resetForm();
      loadCandidates();
    } catch (err: any) { setError(err.message); }
  };

  const startEdit = (c: any) => {
    setForm({
      name: c.name, party: c.party || '', party_alignment: c.party_alignment || '',
      role: c.role || '', is_our_candidate: c.is_our_candidate,
      career_summary: c.career_summary || '',
      search_keywords: (c.search_keywords || []).join(', '),
      homonym_filters: (c.homonym_filters || []).join(', '),
    });
    setEditId(c.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    try {
      await api.deleteCandidate(electionId, id);
      loadCandidates();
    } catch {}
  };

  const alignments: Record<string, string> = {
    conservative: '보수', progressive: '진보', centrist: '중도', independent: '무소속',
  };

  if (!electionId) {
    return <div className="card text-center py-12 text-gray-500">선거를 먼저 선택해주세요.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">후보자 관리</h1>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary">
          + 후보자 추가
        </button>
      </div>

      {showForm && (
        <div className="card">
          <h3 className="font-semibold mb-4">{editId ? '후보자 수정' : '새 후보자 추가'}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">이름 *</label>
              <input className="input-field" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">정당</label>
              <input className="input-field" value={form.party}
                onChange={(e) => setForm({ ...form, party: e.target.value })}
                placeholder="예: 국민의힘" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">정치 성향</label>
              <select className="input-field" value={form.party_alignment}
                onChange={(e) => setForm({ ...form, party_alignment: e.target.value })}>
                <option value="">선택</option>
                {Object.entries(alignments).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">직책/직함</label>
              <input className="input-field" value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                placeholder="예: 전 교육부 차관" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                검색 키워드 (콤마 구분)
              </label>
              <input className="input-field" value={form.search_keywords}
                onChange={(e) => setForm({ ...form, search_keywords: e.target.value })}
                placeholder="김진균, 김진균 교육감, 김진균 충북" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                동명이인 필터 (콤마 구분)
              </label>
              <input className="input-field" value={form.homonym_filters}
                onChange={(e) => setForm({ ...form, homonym_filters: e.target.value })}
                placeholder="야구감독, 배우" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">경력 요약</label>
              <textarea className="input-field" rows={2} value={form.career_summary}
                onChange={(e) => setForm({ ...form, career_summary: e.target.value })} />
            </div>
            <div className="md:col-span-2 flex items-center gap-2">
              <input type="checkbox" id="our" checked={form.is_our_candidate}
                onChange={(e) => setForm({ ...form, is_our_candidate: e.target.checked })} />
              <label htmlFor="our" className="text-sm font-medium">우리 후보로 지정</label>
            </div>

            {error && <div className="md:col-span-2 bg-danger-50 text-danger-600 text-sm p-3 rounded-lg">{error}</div>}

            <div className="md:col-span-2 flex gap-2">
              <button type="submit" className="btn-primary">{editId ? '수정' : '추가'}</button>
              <button type="button" onClick={resetForm} className="btn-secondary">취소</button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {candidates.map((c) => (
          <div key={c.id} className={`card flex items-center justify-between ${c.is_our_candidate ? 'ring-2 ring-primary-500' : ''}`}>
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center font-bold text-gray-600">
                {c.name[0]}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{c.name}</span>
                  {c.is_our_candidate && <span className="badge-positive">우리 후보</span>}
                  {c.party && <span className="text-sm text-gray-500">{c.party}</span>}
                  {c.party_alignment && (
                    <span className="text-xs text-gray-400">({alignments[c.party_alignment]})</span>
                  )}
                </div>
                <p className="text-sm text-gray-500">
                  키워드: {(c.search_keywords || []).join(', ')}
                  {c.homonym_filters?.length > 0 && (
                    <span className="ml-2 text-orange-500">필터: {c.homonym_filters.join(', ')}</span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => startEdit(c)} className="btn-secondary text-sm">수정</button>
              {!c.is_our_candidate && (
                <button onClick={() => handleDelete(c.id)} className="text-sm text-gray-400 hover:text-red-500 px-3 py-1">삭제</button>
              )}
            </div>
          </div>
        ))}

        {candidates.length === 0 && (
          <div className="card text-center py-8 text-gray-500">
            등록된 후보자가 없습니다. "후보자 추가" 버튼으로 경쟁 후보를 추가하세요.
          </div>
        )}
      </div>
    </div>
  );
}
