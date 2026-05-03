'use client';
import { useState, useEffect } from 'react';

export default function TenantsPage() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [filterPlan, setFilterPlan] = useState('');
  const [filterActive, setFilterActive] = useState('');

  // 모달 상태
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPlan, setNewPlan] = useState('basic');
  const [creating, setCreating] = useState(false);
  const [showAddUser, setShowAddUser] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({ email: '', password: '', passwordConfirm: '', name: '', phone: '' });
  const [addingUser, setAddingUser] = useState(false);
  const [showChangePw, setShowChangePw] = useState<{ id: string; email: string } | null>(null);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [changingPw, setChangingPw] = useState(false);
  // 선거명/후보 수정
  const [editElection, setEditElection] = useState<{ id: string; name: string } | null>(null);

  const headers = (): Record<string, string> => ({
    Authorization: `Bearer ${(sessionStorage.getItem('access_token') || localStorage.getItem('access_token'))}`,
    'Content-Type': 'application/json',
  });

  useEffect(() => { loadTenants(); }, []);

  const loadTenants = async () => {
    try {
      const t = await fetch('/api/admin/tenants', { headers: headers() }).then(r => r.json());
      setTenants(Array.isArray(t) ? t : []);
    } catch {}
  };

  const loadDetail = async (id: string) => {
    try {
      const d = await fetch(`/api/admin/tenants/${id}`, { headers: headers() }).then(r => r.json());
      setSelected(d);
    } catch {}
  };

  const handleCreate = async () => {
    if (!newName.trim()) return alert('캠프 이름 필수');
    setCreating(true);
    try {
      const res = await fetch('/api/admin/tenants', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ name: newName.trim(), plan: newPlan, max_elections: 3, max_members: 10, max_candidates: 10, max_keywords: 50 }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || '실패');
      alert('캠프 생성 완료');
      setShowCreate(false);
      setNewName('');
      loadTenants();
    } catch (e: any) { alert(e?.message || '실패'); }
    finally { setCreating(false); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`"${name}" 삭제?`)) return;
    try {
      await fetch(`/api/admin/tenants/${id}`, { method: 'DELETE', headers: headers() });
      alert('삭제 완료');
      setSelected(null);
      loadTenants();
    } catch { alert('실패'); }
  };

  const handleUpdateTenant = async (id: string, data: any) => {
    try {
      await fetch(`/api/admin/tenants/${id}`, { method: 'PUT', headers: headers(), body: JSON.stringify(data) });
      loadDetail(id);
      loadTenants();
    } catch {}
  };

  const handleAddUser = async () => {
    if (!showAddUser || !newUser.email || !newUser.password || !newUser.name) return alert('이메일, 비밀번호, 이름 필수');
    if (newUser.password !== newUser.passwordConfirm) return alert('비밀번호 불일치');
    if (newUser.password.length < 8) return alert('비밀번호 최소 8자');
    setAddingUser(true);
    try {
      const res = await fetch(`/api/admin/tenants/${showAddUser}/users`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ email: newUser.email.trim(), password: newUser.password, name: newUser.name.trim(), phone: newUser.phone || null, role: 'admin' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || '실패');
      alert('사용자 추가 완료');
      setShowAddUser(null);
      setNewUser({ email: '', password: '', passwordConfirm: '', name: '', phone: '' });
      if (selected) loadDetail(selected.tenant.id);
      loadTenants();
    } catch (e: any) { alert(e?.message || '실패'); }
    finally { setAddingUser(false); }
  };

  const handleChangePw = async () => {
    if (!showChangePw || pw1 !== pw2 || pw1.length < 8) return alert('비밀번호 확인');
    setChangingPw(true);
    try {
      await fetch(`/api/admin/users/${showChangePw.id}/password`, {
        method: 'PUT', headers: headers(), body: JSON.stringify({ new_password: pw1 }),
      });
      alert('변경 완료');
      setShowChangePw(null);
      setPw1(''); setPw2('');
    } catch { alert('실패'); }
    finally { setChangingPw(false); }
  };

  const handleDeleteUser = async (uid: string, email: string) => {
    if (!confirm(`"${email}" 삭제?`)) return;
    try {
      await fetch(`/api/admin/users/${uid}`, { method: 'DELETE', headers: headers() });
      alert('삭제 완료');
      if (selected) loadDetail(selected.tenant.id);
      loadTenants();
    } catch { alert('실패'); }
  };

  const handleUpdateElectionName = async () => {
    if (!editElection) return;
    try {
      await fetch(`/api/admin/elections/${editElection.id}`, {
        method: 'PUT', headers: headers(), body: JSON.stringify({ name: editElection.name }),
      });
      alert('선거명 수정 완료');
      setEditElection(null);
      if (selected) loadDetail(selected.tenant.id);
    } catch { alert('실패 (API 미구현일 수 있음)'); }
  };

  // 필터링
  const filtered = tenants.filter(t => {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterPlan && t.plan !== filterPlan) return false;
    if (filterActive === 'active' && !t.is_active) return false;
    if (filterActive === 'inactive' && t.is_active) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">캠프 관리</h1>
        <button onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-bold">+ 새 캠프</button>
      </div>

      {/* 검색/필터 */}
      <div className="flex gap-3 items-center">
        <input className="px-3 py-1.5 bg-gray-800 text-white border border-gray-600 rounded text-sm w-48"
          placeholder="캠프 검색..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="px-2 py-1.5 bg-gray-800 text-gray-300 border border-gray-600 rounded text-sm"
          value={filterPlan} onChange={e => setFilterPlan(e.target.value)}>
          <option value="">전체 요금제</option>
          <option value="basic">Basic</option>
          <option value="pro">Pro</option>
          <option value="premium">Premium</option>
          <option value="enterprise">Enterprise</option>
        </select>
        <select className="px-2 py-1.5 bg-gray-800 text-gray-300 border border-gray-600 rounded text-sm"
          value={filterActive} onChange={e => setFilterActive(e.target.value)}>
          <option value="">전체 상태</option>
          <option value="active">활성</option>
          <option value="inactive">비활성</option>
        </select>
        <span className="text-xs text-gray-500">{filtered.length}개</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 캠프 목록 */}
        <div className="bg-gray-800 rounded-lg border border-gray-700">
          <div className="divide-y divide-gray-700/50 max-h-[700px] overflow-y-auto">
            {filtered.map(t => (
              <div key={t.id} className={`p-3 hover:bg-gray-700/30 cursor-pointer ${selected?.tenant?.id === t.id ? 'bg-gray-700/50' : ''}`}
                onClick={() => loadDetail(t.id)}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-white font-medium">{t.name}</span>
                    <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                      t.plan === 'enterprise' || t.plan === 'premium' ? 'bg-purple-500/20 text-purple-300' :
                      t.plan === 'pro' ? 'bg-blue-500/20 text-blue-300' :
                      'bg-gray-600/30 text-gray-300'
                    }`}>{t.plan?.toUpperCase()}</span>
                  </div>
                  <span className={`w-2 h-2 rounded-full ${t.is_active ? 'bg-green-400' : 'bg-red-400'}`} />
                </div>
                <div className="flex gap-4 mt-1 text-xs text-gray-400">
                  <span>멤버 {t.members || 0}</span>
                  <span>선거 {t.elections || 0}</span>
                  <span>뉴스 {t.news_collected || 0}</span>
                  <span>스케줄 {t.schedules_active || 0}</span>
                </div>
              </div>
            ))}
            {filtered.length === 0 && <p className="p-8 text-center text-gray-500 text-sm">캠프 없음</p>}
          </div>
        </div>

        {/* 캠프 상세 */}
        {selected ? (
          <div className="bg-gray-800 rounded-lg border border-gray-700">
            <div className="p-4 border-b border-gray-700 flex justify-between items-center">
              <h3 className="text-white font-semibold">{selected.tenant?.name}</h3>
              <div className="flex gap-2">
                <a href={`/dashboard?tenant_id=${selected.tenant?.id}`} target="_blank"
                  className="text-xs px-2 py-1 bg-green-600/20 text-green-400 rounded hover:bg-green-600/40">
                  대시보드 보기
                </a>
                <button onClick={() => setSelected(null)} className="text-xs text-gray-400 hover:text-white">닫기</button>
              </div>
            </div>
            <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
              {/* 기본 정보 */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="text-gray-400">요금제:
                  <select className="ml-2 bg-gray-700 text-white rounded px-2 py-0.5 text-xs"
                    value={selected.tenant?.plan || 'basic'}
                    onChange={e => handleUpdateTenant(selected.tenant.id, { plan: e.target.value })}>
                    <option value="basic">Basic</option>
                    <option value="pro">Pro</option>
                    <option value="premium">Premium</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <div className="text-gray-400">상태:
                  <button onClick={async () => {
                    const willStop = selected.tenant.is_active;
                    if (willStop && !confirm(`"${selected.tenant.name}" 캠프를 정지하시겠습니까?\n→ 모든 자동 수집 스케줄도 함께 정지됩니다.`)) return;
                    const res = await fetch(`/api/admin/tenants/${selected.tenant.id}/toggle-active`, { method: 'POST', headers: headers() });
                    if (!res.ok) { alert('실패'); return; }
                    loadDetail(selected.tenant.id);
                    loadTenants();
                  }}
                    className={`ml-2 px-2 py-0.5 rounded text-xs font-bold ${selected.tenant?.is_active ? 'bg-green-600/30 text-green-400' : 'bg-red-600/30 text-red-400'}`}>
                    {selected.tenant?.is_active ? '활성' : '정지'}
                  </button>
                </div>
              </div>

              {/* 멤버 */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <h4 className="text-gray-300 text-sm font-medium">멤버 ({selected.members?.length || 0})</h4>
                  <button onClick={() => setShowAddUser(selected.tenant.id)}
                    className="text-xs px-2 py-1 bg-blue-600/20 text-blue-400 rounded hover:bg-blue-600/40">+ 추가</button>
                </div>
                {(selected.members || []).map((m: any) => (
                  <div key={m.id} className="flex items-center justify-between py-2 text-sm border-b border-gray-700/30">
                    <div>
                      <span className="text-white">{m.name}</span>
                      <span className="text-gray-500 text-xs ml-1">({m.email})</span>
                      <select className="ml-2 bg-gray-700 text-gray-300 rounded px-1 py-0.5 text-[10px]"
                        value={m.role} onChange={async e => {
                          await fetch(`/api/admin/users/${m.id}/role`, { method: 'PUT', headers: headers(), body: JSON.stringify({ role: e.target.value }) });
                          loadDetail(selected.tenant.id);
                        }}>
                        <option value="admin">admin</option>
                        <option value="analyst">analyst</option>
                        <option value="viewer">viewer</option>
                      </select>
                      {m.password_plain && <span className="text-amber-400 text-[10px] ml-1">PW: {m.password_plain}</span>}
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setShowChangePw({ id: m.id, email: m.email })}
                        className="text-[10px] px-2 py-1 bg-amber-600/20 text-amber-400 rounded">비번</button>
                      <button onClick={() => handleDeleteUser(m.id, m.email)}
                        className="text-[10px] px-2 py-1 bg-red-600/20 text-red-400 rounded">삭제</button>
                    </div>
                  </div>
                ))}
              </div>

              {/* 선거 */}
              <div>
                <h4 className="text-gray-300 text-sm font-medium mb-2">선거 ({selected.elections?.length || 0})</h4>
                {(selected.elections || []).map((e: any) => (
                  <div key={e.id} className="flex justify-between items-center py-1.5 text-sm border-b border-gray-700/30">
                    {editElection?.id === e.id ? (
                      <div className="flex gap-2 flex-1">
                        <input className="flex-1 px-2 py-0.5 bg-gray-700 text-white rounded text-xs border border-gray-600"
                          value={editElection?.name || ''} onChange={ev => editElection && setEditElection({ ...editElection, name: ev.target.value })} />
                        <button onClick={handleUpdateElectionName} className="text-xs text-green-400">저장</button>
                        <button onClick={() => setEditElection(null)} className="text-xs text-gray-400">취소</button>
                      </div>
                    ) : (
                      <>
                        <span className="text-white">{e.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 text-xs">{e.date}</span>
                          <button onClick={() => setEditElection({ id: e.id, name: e.name })}
                            className="text-[10px] text-gray-400 hover:text-white">수정</button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* 삭제 버튼 */}
              <button onClick={() => handleDelete(selected.tenant.id, selected.tenant.name)}
                className="w-full py-2 bg-red-600/20 text-red-400 rounded text-sm hover:bg-red-600/40 mt-4">캠프 삭제</button>
            </div>
          </div>
        ) : (
          <div className="bg-gray-800 rounded-lg border border-gray-700 flex items-center justify-center h-64">
            <p className="text-gray-500 text-sm">캠프를 선택하세요</p>
          </div>
        )}
      </div>

      {/* 캠프 생성 모달 */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 w-96">
            <h3 className="text-white font-bold text-lg mb-4">새 캠프 생성</h3>
            <div className="space-y-3">
              <input className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600"
                placeholder="캠프 이름" value={newName} onChange={e => setNewName(e.target.value)} />
              <select className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600"
                value={newPlan} onChange={e => setNewPlan(e.target.value)}>
                <option value="basic">Basic</option><option value="pro">Pro</option>
                <option value="premium">Premium</option><option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleCreate} disabled={creating}
                className="flex-1 py-2 bg-blue-600 text-white rounded disabled:opacity-50">{creating ? '...' : '생성'}</button>
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-gray-700 text-gray-300 rounded">취소</button>
            </div>
          </div>
        </div>
      )}

      {/* 사용자 추가 모달 */}
      {showAddUser && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 w-96">
            <h3 className="text-white font-bold text-lg mb-4">사용자 추가</h3>
            <div className="space-y-3">
              <input className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600"
                placeholder="이메일" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} />
              <input className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600"
                placeholder="비밀번호 (8자 이상)" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} />
              <input className={`w-full px-3 py-2 bg-gray-700 text-white rounded border ${newUser.passwordConfirm && newUser.password !== newUser.passwordConfirm ? 'border-red-500' : 'border-gray-600'}`}
                placeholder="비밀번호 확인" value={newUser.passwordConfirm} onChange={e => setNewUser({ ...newUser, passwordConfirm: e.target.value })} />
              <input className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600"
                placeholder="이름" value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} />
              <input className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600"
                placeholder="전화번호 (선택)" value={newUser.phone} onChange={e => setNewUser({ ...newUser, phone: e.target.value })} />
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleAddUser} disabled={addingUser}
                className="flex-1 py-2 bg-blue-600 text-white rounded disabled:opacity-50">{addingUser ? '...' : '추가'}</button>
              <button onClick={() => setShowAddUser(null)} className="px-4 py-2 bg-gray-700 text-gray-300 rounded">취소</button>
            </div>
          </div>
        </div>
      )}

      {/* 비밀번호 변경 모달 */}
      {showChangePw && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 w-96">
            <h3 className="text-white font-bold mb-1">비밀번호 변경</h3>
            <p className="text-xs text-gray-400 mb-4">{showChangePw.email}</p>
            <div className="space-y-3">
              <input type="text" className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600"
                placeholder="새 비밀번호" value={pw1} onChange={e => setPw1(e.target.value)} />
              <input type="text" className={`w-full px-3 py-2 bg-gray-700 text-white rounded border ${pw2 && pw1 !== pw2 ? 'border-red-500' : 'border-gray-600'}`}
                placeholder="비밀번호 확인" value={pw2} onChange={e => setPw2(e.target.value)} />
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleChangePw} disabled={changingPw || !pw1 || pw1 !== pw2}
                className="flex-1 py-2 bg-amber-600 text-white rounded disabled:opacity-50">{changingPw ? '...' : '변경'}</button>
              <button onClick={() => { setShowChangePw(null); setPw1(''); setPw2(''); }}
                className="px-4 py-2 bg-gray-700 text-gray-300 rounded">취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
