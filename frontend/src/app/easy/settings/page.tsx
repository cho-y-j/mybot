'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useElection } from '@/hooks/useElection';
import { api } from '@/services/api';

const TABS = [
  { id: 'election', label: '선거 관리' },
  { id: 'candidates', label: '후보자 관리' },
  { id: 'schedules', label: '수집 스케줄' },
  { id: 'account', label: '계정 · 알림' },
] as const;

type TabId = typeof TABS[number]['id'];

// ─── 선거 관리 탭 ───────────────────────────────────────────

function ElectionTab() {
  const [elections, setElections] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', election_type: 'superintendent', election_date: '', region_sido: '', region_sigungu: '' });
  const [error, setError] = useState('');

  useEffect(() => { loadElections(); }, []);
  const loadElections = async () => { try { setElections(await api.getElections()); } catch {} };

  const types: Record<string, string> = {
    presidential: '대통령', congressional: '국회의원', governor: '시도지사',
    mayor: '시장/군수/구청장', superintendent: '교육감', council: '지방의원', other: '기타',
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--muted)]">등록된 선거를 관리합니다.</p>
        <button onClick={() => setShowForm(!showForm)} className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500">
          + 새 선거
        </button>
      </div>

      {showForm && (
        <div className="p-4 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] space-y-3">
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1">선거 이름</label>
              <input className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })} placeholder="2026 충북 교육감 선거" required />
            </div>
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1">선거 유형</label>
              <select className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={form.election_type}
                onChange={e => setForm({ ...form, election_type: e.target.value })}>
                {Object.entries(types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1">선거일</label>
              <input type="date" className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={form.election_date}
                onChange={e => setForm({ ...form, election_date: e.target.value })} required />
            </div>
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1">시/도</label>
              <input className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={form.region_sido}
                onChange={e => setForm({ ...form, region_sido: e.target.value })} placeholder="충청북도" />
            </div>
            {error && <div className="sm:col-span-2 text-sm text-red-400 bg-red-500/10 p-2 rounded-lg">{error}</div>}
            <div className="sm:col-span-2 flex gap-2">
              <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500">생성</button>
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-[var(--muted)] hover:text-white">취소</button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-2">
        {elections.map(el => (
          <div key={el.id} className="p-4 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] flex items-center justify-between">
            <div>
              <div className="font-semibold">{el.name}</div>
              <div className="text-xs text-[var(--muted)] mt-1">
                {types[el.election_type]} · {el.region_sido || '전국'} · {el.election_date} · 후보 {el.candidates_count}명
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-lg font-bold ${el.d_day <= 30 ? 'text-red-400' : 'text-blue-400'}`}>D-{el.d_day}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${el.is_active ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>
                {el.is_active ? '활성' : '종료'}
              </span>
            </div>
          </div>
        ))}
        {elections.length === 0 && !showForm && (
          <div className="text-center py-12 text-[var(--muted)] text-sm">등록된 선거가 없습니다.</div>
        )}
      </div>
    </div>
  );
}

// ─── 후보자 관리 탭 ──────────────────────────────────────────

function CandidatesTab() {
  const { election } = useElection();
  const [candidates, setCandidates] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', party: '', party_alignment: '', role: '', is_our_candidate: false, career_summary: '', search_keywords: '', homonym_filters: '' });
  const [error, setError] = useState('');

  const electionId = election?.id;
  useEffect(() => { if (electionId) load(); }, [electionId]);

  const load = async () => { try { setCandidates(await api.getCandidates(electionId!)); } catch {} };

  const alignments: Record<string, string> = { conservative: '보수', progressive: '진보', centrist: '중도', independent: '무소속' };

  const resetForm = () => { setForm({ name: '', party: '', party_alignment: '', role: '', is_our_candidate: false, career_summary: '', search_keywords: '', homonym_filters: '' }); setEditId(null); setShowForm(false); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const data = { ...form, search_keywords: form.search_keywords.split(',').map(s => s.trim()).filter(Boolean), homonym_filters: form.homonym_filters.split(',').map(s => s.trim()).filter(Boolean) };
    try {
      if (editId) await api.updateCandidate(electionId!, editId, data);
      else await api.addCandidate(electionId!, data);
      resetForm(); load();
    } catch (err: any) { setError(err.message); }
  };

  const startEdit = (c: any) => {
    setForm({ name: c.name, party: c.party || '', party_alignment: c.party_alignment || '', role: c.role || '', is_our_candidate: c.is_our_candidate, career_summary: c.career_summary || '', search_keywords: (c.search_keywords || []).join(', '), homonym_filters: (c.homonym_filters || []).join(', ') });
    setEditId(c.id); setShowForm(true);
  };

  const handleDelete = async (id: string) => { if (!confirm('정말 삭제하시겠습니까?')) return; try { await api.deleteCandidate(electionId!, id); load(); } catch {} };

  if (!election) return <div className="text-center py-12 text-[var(--muted)] text-sm">선거를 먼저 등록해주세요.</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--muted)]">{election.name} — 후보자를 추가·수정합니다.</p>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500">+ 후보자 추가</button>
      </div>

      {showForm && (
        <div className="p-4 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)]">
          <h3 className="font-semibold text-sm mb-3">{editId ? '후보자 수정' : '새 후보자 추가'}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1">이름 *</label>
              <input className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1">정당</label>
              <input className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={form.party} onChange={e => setForm({ ...form, party: e.target.value })} placeholder="국민의힘" />
            </div>
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1">정치 성향</label>
              <select className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={form.party_alignment} onChange={e => setForm({ ...form, party_alignment: e.target.value })}>
                <option value="">선택</option>
                {Object.entries(alignments).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1">직책/직함</label>
              <input className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} placeholder="전 교육부 차관" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-[var(--muted)] mb-1">검색 키워드 (콤마 구분)</label>
              <input className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={form.search_keywords} onChange={e => setForm({ ...form, search_keywords: e.target.value })} placeholder="김진균, 김진균 교육감" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-[var(--muted)] mb-1">동명이인 필터 (콤마 구분)</label>
              <input className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={form.homonym_filters} onChange={e => setForm({ ...form, homonym_filters: e.target.value })} placeholder="야구감독, 배우" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-[var(--muted)] mb-1">경력 요약</label>
              <textarea className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" rows={2} value={form.career_summary} onChange={e => setForm({ ...form, career_summary: e.target.value })} />
            </div>
            <div className="sm:col-span-2 flex items-center gap-2">
              <input type="checkbox" id="our-cand" checked={form.is_our_candidate} onChange={e => setForm({ ...form, is_our_candidate: e.target.checked })} className="rounded" />
              <label htmlFor="our-cand" className="text-sm">우리 후보로 지정</label>
            </div>
            {error && <div className="sm:col-span-2 text-sm text-red-400 bg-red-500/10 p-2 rounded-lg">{error}</div>}
            <div className="sm:col-span-2 flex gap-2">
              <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500">{editId ? '수정' : '추가'}</button>
              <button type="button" onClick={resetForm} className="px-4 py-2 text-sm text-[var(--muted)] hover:text-white">취소</button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-2">
        {candidates.map(c => (
          <div key={c.id} className={`p-4 rounded-xl border bg-[var(--card-bg)] flex items-center justify-between ${c.is_our_candidate ? 'border-blue-500/50' : 'border-[var(--card-border)]'}`}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-blue-500/20 flex items-center justify-center font-bold text-sm text-blue-400">
                {c.name[0]}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{c.name}</span>
                  {c.is_our_candidate && <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded-full">우리 후보</span>}
                  {c.party && <span className="text-xs text-[var(--muted)]">{c.party}</span>}
                </div>
                <div className="text-[11px] text-[var(--muted)] mt-0.5">
                  {(c.search_keywords || []).join(', ')}
                  {c.homonym_filters?.length > 0 && <span className="ml-2 text-orange-400">필터: {c.homonym_filters.join(', ')}</span>}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => startEdit(c)} className="text-xs text-blue-400 hover:text-blue-300">수정</button>
              {!c.is_our_candidate && <button onClick={() => handleDelete(c.id)} className="text-xs text-[var(--muted)] hover:text-red-400">삭제</button>}
            </div>
          </div>
        ))}
        {candidates.length === 0 && <div className="text-center py-12 text-[var(--muted)] text-sm">등록된 후보자가 없습니다.</div>}
      </div>
    </div>
  );
}

// ─── 스케줄 탭 ──────────────────────────────────────────────

const STYPE_LABELS: Record<string, string> = { news: '뉴스', community: '커뮤니티', youtube: '유튜브', trends: '트렌드', briefing: '브리핑', alert: '알림', full_with_briefing: '전체+브리핑', full_collection: '전체수집' };

function SchedulesTab() {
  const { election } = useElection();
  const [schedules, setSchedules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', schedule_type: 'full_with_briefing', fixed_times: '', enabled: true });
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [editForm, setEditForm] = useState({ name: '', fixed_times: '', schedule_type: 'news' });

  useEffect(() => { if (election) loadSchedules(); }, [election]);

  const loadSchedules = async () => {
    if (!election) return;
    try { setSchedules(await api.getSchedules(election.id)); } catch {} finally { setLoading(false); }
  };

  const handleCreateDefaults = async () => {
    if (!election) return;
    setCreating(true);
    try { const r = await api.createDefaultSchedules(election.id); setMessage(r.message); loadSchedules(); } catch (e: any) { setMessage('실패: ' + (e?.message || '')); } finally { setCreating(false); }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    if (!election) return;
    try { await api.updateSchedule(election.id, id, { enabled: !enabled }); loadSchedules(); } catch {}
  };

  const handleEdit = (s: any) => { setEditing(s); setEditForm({ name: s.name || '', fixed_times: (s.fixed_times || []).join(', '), schedule_type: s.schedule_type || 'news' }); };

  const handleSaveEdit = async () => {
    if (!election || !editing) return;
    try { await api.updateSchedule(election.id, editing.id, { name: editForm.name, fixed_times: editForm.fixed_times.split(',').map((t: string) => t.trim()).filter(Boolean), schedule_type: editForm.schedule_type }); setEditing(null); loadSchedules(); } catch (e: any) { alert('수정 실패: ' + (e?.message || '')); }
  };

  const handleDelete = async (id: string) => {
    if (!election || !confirm('삭제하시겠습니까?')) return;
    try { await api.deleteSchedule(election.id, id); loadSchedules(); } catch {}
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!election) return;
    try { await api.createSchedule(election.id, { ...form, fixed_times: form.fixed_times.split(',').map((t: string) => t.trim()).filter(Boolean) }); setShowAdd(false); setForm({ name: '', schedule_type: 'full_with_briefing', fixed_times: '', enabled: true }); loadSchedules(); } catch (e: any) { alert('추가 실패: ' + (e?.message || '')); }
  };

  if (!election) return <div className="text-center py-12 text-[var(--muted)] text-sm">선거를 먼저 등록해주세요.</div>;
  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full" /></div>;

  const sorted = [...schedules].sort((a, b) => (a.fixed_times?.[0] || '99:99').localeCompare(b.fixed_times?.[0] || '99:99'));
  const activeCount = schedules.filter(s => s.enabled).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--muted)]">활성 {activeCount}개 · 운영 09:00~20:00</p>
        <div className="flex gap-2">
          <button onClick={() => setShowAdd(true)} className="text-sm px-3 py-1.5 border border-[var(--card-border)] rounded-lg hover:bg-white/5">+ 추가</button>
          {schedules.length === 0 && <button onClick={handleCreateDefaults} disabled={creating} className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500">{creating ? '생성 중...' : '기본 스케줄 자동 생성'}</button>}
        </div>
      </div>

      {message && <div className="text-sm text-green-400 bg-green-500/10 p-2 rounded-lg">{message}</div>}

      {showAdd && (
        <div className="p-4 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)]">
          <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1">이름</label>
              <input className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="오전 수집" required />
            </div>
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1">유형</label>
              <select className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={form.schedule_type} onChange={e => setForm({ ...form, schedule_type: e.target.value })}>
                <option value="full_with_briefing">전체 수집 + 브리핑</option>
                <option value="full_collection">전체 수집만</option>
                <option value="news">뉴스</option><option value="community">커뮤니티</option>
                <option value="youtube">유튜브</option><option value="trends">트렌드</option>
                <option value="briefing">브리핑</option><option value="alert">알림</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-[var(--muted)] mb-1">실행 시간 (HH:MM, 콤마 구분)</label>
              <input className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm font-mono" value={form.fixed_times} onChange={e => setForm({ ...form, fixed_times: e.target.value })} placeholder="07:00, 13:00, 18:00" required />
            </div>
            <div className="sm:col-span-2 flex gap-2">
              <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500">추가</button>
              <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-[var(--muted)] hover:text-white">취소</button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-2">
        {sorted.map(s => (
          <div key={s.id} className={`p-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] flex items-center justify-between ${!s.enabled ? 'opacity-40' : ''}`}>
            <div className="flex items-center gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{s.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--muted-bg)] text-[var(--muted)]">{STYPE_LABELS[s.schedule_type] || s.schedule_type}</span>
                </div>
                <div className="flex items-center gap-1 mt-1">
                  {(s.fixed_times || []).map((t: string, i: number) => <span key={i} className="text-[11px] font-mono bg-white/5 px-1.5 py-0.5 rounded">{t}</span>)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => handleToggle(s.id, s.enabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${s.enabled ? 'bg-green-500' : 'bg-gray-600'}`}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${s.enabled ? 'left-[20px]' : 'left-0.5'}`} />
              </button>
              <button onClick={() => handleEdit(s)} className="text-xs text-blue-400 hover:text-blue-300">편집</button>
              <button onClick={() => handleDelete(s.id)} className="text-xs text-[var(--muted)] hover:text-red-400">삭제</button>
            </div>
          </div>
        ))}
        {schedules.length === 0 && <div className="text-center py-12 text-[var(--muted)] text-sm">스케줄이 없습니다. "기본 스케줄 자동 생성"을 눌러주세요.</div>}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="w-full max-w-sm mx-4 p-5 rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)]">
            <h3 className="font-bold mb-4">스케줄 편집</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[var(--muted)] mb-1">이름</label>
                <input className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-[var(--muted)] mb-1">유형</label>
                <select className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={editForm.schedule_type} onChange={e => setEditForm({ ...editForm, schedule_type: e.target.value })}>
                  <option value="full_with_briefing">전체 수집 + 브리핑</option>
                  <option value="full_collection">전체 수집만</option>
                  <option value="news">뉴스</option><option value="community">커뮤니티</option>
                  <option value="youtube">유튜브</option><option value="trends">트렌드</option>
                  <option value="briefing">브리핑</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--muted)] mb-1">실행 시간 (HH:MM, 콤마 구분)</label>
                <input className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm font-mono" value={editForm.fixed_times} onChange={e => setEditForm({ ...editForm, fixed_times: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleSaveEdit} className="flex-1 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500">저장</button>
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-[var(--muted)] hover:text-white">취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 계정·알림 탭 ───────────────────────────────────────────

function AccountTab() {
  const [tenant, setTenant] = useState<any>(null);
  const [tgData, setTgData] = useState<any>(null);
  const [botForm, setBotForm] = useState({ bot_token: '' });
  const [recipientForm, setRecipientForm] = useState({ chat_id: '', name: '', chat_type: 'private' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showTgGuide, setShowTgGuide] = useState(false);
  const [showBotEdit, setShowBotEdit] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwChanging, setPwChanging] = useState(false);

  useEffect(() => { loadAll(); }, []);

  const getToken = () => sessionStorage.getItem('access_token') || localStorage.getItem('access_token');

  const loadAll = async () => {
    try { setTenant(await api.getMyTenant()); } catch {}
    try {
      const r = await fetch('/api/telegram/recipients', { headers: { Authorization: `Bearer ${getToken()}` } });
      if (r.ok) setTgData(await r.json());
    } catch {}
  };

  const handleChangePassword = async () => {
    setMessage(''); setError('');
    if (!pwCurrent || !pwNew) { setError('현재 비밀번호와 새 비밀번호를 입력하세요'); return; }
    if (pwNew !== pwConfirm) { setError('비밀번호가 일치하지 않습니다'); return; }
    if (pwNew.length < 8) { setError('최소 8자 이상'); return; }
    setPwChanging(true);
    try { await api.changePassword(pwCurrent, pwNew); setMessage('비밀번호가 변경되었습니다'); setPwCurrent(''); setPwNew(''); setPwConfirm(''); } catch (e: any) { setError(e.message || '변경 실패'); } finally { setPwChanging(false); }
  };

  const handleConnectBot = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    try {
      const r = await fetch('/api/telegram/connect-bot', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify(botForm) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail);
      setMessage(`봇 연결 성공: @${data.bot_username}`); setBotForm({ bot_token: '' }); setShowBotEdit(false); loadAll();
    } catch (err: any) { setError(err.message); }
  };

  const handleAddRecipient = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    try {
      const r = await fetch('/api/telegram/recipients', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify(recipientForm) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail);
      setMessage(data.message); setRecipientForm({ chat_id: '', name: '', chat_type: 'private' }); loadAll();
    } catch (err: any) { setError(err.message); }
  };

  const handleDeleteRecipient = async (id: string) => {
    if (!confirm('수신자를 삭제하시겠습니까?')) return;
    try { await fetch(`/api/telegram/recipients/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` } }); loadAll(); } catch {}
  };

  const handleToggleRecipient = async (id: string, field: string, val: boolean) => {
    try { await fetch(`/api/telegram/recipients/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify({ [field]: !val }) }); loadAll(); } catch {}
  };

  return (
    <div className="space-y-5">
      {message && <div className="text-sm text-green-400 bg-green-500/10 p-2 rounded-lg">{message}</div>}
      {error && <div className="text-sm text-red-400 bg-red-500/10 p-2 rounded-lg">{error}</div>}

      {/* 비밀번호 */}
      <div className="p-4 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)]">
        <h3 className="font-semibold text-sm mb-3">비밀번호 변경</h3>
        <div className="space-y-2 max-w-sm">
          <input type="password" className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" placeholder="현재 비밀번호" value={pwCurrent} onChange={e => setPwCurrent(e.target.value)} />
          <input type="password" className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" placeholder="새 비밀번호 (8자 이상)" value={pwNew} onChange={e => setPwNew(e.target.value)} />
          <input type="password" className={`w-full px-3 py-2 rounded-lg bg-white/5 border text-sm ${pwConfirm && pwNew !== pwConfirm ? 'border-red-500' : 'border-white/10'}`} placeholder="새 비밀번호 확인" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} />
          <button onClick={handleChangePassword} disabled={pwChanging || !pwCurrent || !pwNew || pwNew !== pwConfirm}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 disabled:opacity-40">
            {pwChanging ? '변경 중...' : '비밀번호 변경'}
          </button>
        </div>
      </div>

      {/* 조직 정보 */}
      {tenant && (
        <div className="p-4 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)]">
          <h3 className="font-semibold text-sm mb-3">조직 정보</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-[var(--muted)]">조직명:</span> {tenant.name}</div>
            <div><span className="text-[var(--muted)]">요금제:</span> <span className="uppercase font-medium">{tenant.plan}</span></div>
            <div><span className="text-[var(--muted)]">최대 후보:</span> {tenant.max_candidates}명</div>
            <div><span className="text-[var(--muted)]">최대 키워드:</span> {tenant.max_keywords}개</div>
          </div>
        </div>
      )}

      {/* 텔레그램 */}
      <div className="p-4 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">텔레그램 알림</h3>
          <button onClick={() => setShowTgGuide(!showTgGuide)} className="text-[11px] text-blue-400 hover:underline">{showTgGuide ? '안내 닫기' : '설정 방법'}</button>
        </div>

        {showTgGuide && (
          <div className="mb-3 p-3 bg-blue-500/10 rounded-lg text-xs space-y-2 border border-blue-500/20">
            <p className="font-semibold text-blue-400">텔레그램 알림 설정 안내</p>
            <p>1. 텔레그램에서 <strong>@BotFather</strong> 검색 → /newbot → 봇 이름/사용자명 입력 → 토큰 발급</p>
            <p>2. 만든 봇에게 /start → 브라우저에서 https://api.telegram.org/bot토큰/getUpdates → chat id 확인</p>
            <p className="text-green-400">기본 봇이 있으면 Chat ID만 입력하면 됩니다.</p>
          </div>
        )}

        {tgData?.bot_connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-2 bg-green-500/10 rounded-lg">
              <span className="w-2.5 h-2.5 bg-green-500 rounded-full" />
              <span className="text-sm text-green-400 font-medium">@{tgData.bot_username} 연결됨</span>
              <button onClick={() => setShowBotEdit(!showBotEdit)} className="ml-auto text-[11px] text-[var(--muted)] hover:text-blue-400">토큰 변경</button>
            </div>
            {showBotEdit && (
              <form onSubmit={handleConnectBot} className="flex gap-2">
                <input className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={botForm.bot_token} onChange={e => setBotForm({ bot_token: e.target.value })} placeholder="새 Bot Token" required />
                <button type="submit" className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg">변경</button>
              </form>
            )}
          </div>
        ) : (
          <form onSubmit={handleConnectBot} className="space-y-2">
            <input className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={botForm.bot_token} onChange={e => setBotForm({ bot_token: e.target.value })} placeholder="1234567890:ABCDefGHI..." required />
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500">봇 연결</button>
          </form>
        )}
      </div>

      {/* 수신자 */}
      {tgData?.bot_connected && (
        <div className="p-4 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">수신자 관리</h3>
            <button onClick={async () => { try { const r = await api.testTelegram(); setMessage(r.message); } catch (e: any) { setError(e.message); } }}
              className="text-[11px] px-2 py-1 border border-[var(--card-border)] rounded hover:bg-white/5">테스트 발송</button>
          </div>

          {tgData.recipients?.length > 0 ? (
            <div className="space-y-2 mb-4">
              {tgData.recipients.map((r: any) => (
                <div key={r.id} className={`flex items-center justify-between p-3 rounded-lg border border-[var(--card-border)] ${!r.is_active ? 'opacity-40' : ''}`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{r.chat_type === 'group' ? '그룹' : '개인'}</span>
                      <span className="text-sm font-medium">{r.name}</span>
                      <span className="text-[10px] text-[var(--muted)]">ID: {r.chat_id}</span>
                    </div>
                    <div className="flex gap-1.5 mt-1.5">
                      {[['receive_news', r.receive_news, '뉴스', 'blue'], ['receive_briefing', r.receive_briefing, '브리핑', 'green'], ['receive_alert', r.receive_alert, '알림', 'red']].map(([field, val, label, color]) => (
                        <button key={field as string} onClick={() => handleToggleRecipient(r.id, field as string, val as boolean)}
                          className={`text-[10px] px-1.5 py-0.5 rounded-full ${val ? `bg-${color}-500/20 text-${color}-400` : 'bg-white/5 text-[var(--muted)]'}`}>
                          {label as string}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleToggleRecipient(r.id, 'is_active', r.is_active)}
                      className={`relative w-9 h-5 rounded-full transition-colors ${r.is_active ? 'bg-green-500' : 'bg-gray-600'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${r.is_active ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                    <button onClick={() => handleDeleteRecipient(r.id)} className="text-[11px] text-[var(--muted)] hover:text-red-400">삭제</button>
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="text-center py-6 text-[var(--muted)] text-sm mb-4">아직 수신자가 없습니다.</div>}

          <form onSubmit={handleAddRecipient} className="border-t border-[var(--card-border)] pt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={recipientForm.name} onChange={e => setRecipientForm({ ...recipientForm, name: e.target.value })} placeholder="이름 (예: 전략팀)" required />
              <input className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={recipientForm.chat_id} onChange={e => setRecipientForm({ ...recipientForm, chat_id: e.target.value })} placeholder="Chat ID" required />
            </div>
            <div className="flex gap-2">
              <select className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={recipientForm.chat_type} onChange={e => setRecipientForm({ ...recipientForm, chat_type: e.target.value })}>
                <option value="private">개인</option><option value="group">그룹</option>
              </select>
              <button type="submit" className="flex-1 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500">수신자 추가</button>
            </div>
          </form>
        </div>
      )}

      {/* 브리핑 발송 */}
      {tgData?.bot_connected && tgData.recipients?.length > 0 && (
        <div className="p-4 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)]">
          <h3 className="font-semibold text-sm mb-3">수동 브리핑 발송</h3>
          <div className="flex gap-2">
            {[['morning', '오전 브리핑'], ['afternoon', '오후 브리핑'], ['daily', '일일 보고서']].map(([type, label]) => (
              <button key={type} onClick={async () => { try { const r = await api.sendBriefing(type); setMessage(r.message); } catch (e: any) { setError(e.message); } }}
                className="px-3 py-2 text-sm border border-[var(--card-border)] rounded-lg hover:bg-white/5">{label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 메인 페이지 ────────────────────────────────────────────

function SettingsContent() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams?.get('tab') as TabId) || 'election';
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">설정</h1>

      {/* 탭 바 */}
      <div className="flex gap-1 p-1 bg-white/5 rounded-xl overflow-x-auto">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex-1 min-w-0 px-3 py-2 text-sm rounded-lg transition whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-[var(--foreground)] text-[var(--background)] font-semibold'
                : 'text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-white/5'
            }`}>
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      <div>
        {activeTab === 'election' && <ElectionTab />}
        {activeTab === 'candidates' && <CandidatesTab />}
        {activeTab === 'schedules' && <SchedulesTab />}
        {activeTab === 'account' && <AccountTab />}
      </div>
    </div>
  );
}

export default function EasySettingsPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full" /></div>}>
      <SettingsContent />
    </Suspense>
  );
}
