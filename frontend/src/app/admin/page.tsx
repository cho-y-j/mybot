'use client';
import { useState, useEffect } from 'react';

export default function AdminDashboard() {
  const [health, setHealth] = useState<any>(null);
  const [tenants, setTenants] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [dataStats, setDataStats] = useState<any>(null);
  const [selectedTenant, setSelectedTenant] = useState<any>(null);

  // 새 캠프 생성 모달
  const [showCreateTenant, setShowCreateTenant] = useState(false);
  const [newTenantName, setNewTenantName] = useState('');
  const [newTenantPlan, setNewTenantPlan] = useState('basic');
  const [creating, setCreating] = useState(false);

  // 사용자 추가 모달
  const [showAddUser, setShowAddUser] = useState<string | null>(null); // tenant_id
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserPasswordConfirm, setNewUserPasswordConfirm] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('');
  const [addingUser, setAddingUser] = useState(false);

  // 비밀번호 변경 모달
  const [showChangePw, setShowChangePw] = useState<{ id: string; email: string } | null>(null);
  const [changePw1, setChangePw1] = useState('');
  const [changePw2, setChangePw2] = useState('');
  const [changingPw, setChangingPw] = useState(false);

  // 가입 승인
  const [pendingUsers, setPendingUsers] = useState<any[]>([]);

  const headers = (): Record<string, string> => ({
    Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    'Content-Type': 'application/json',
  });

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [h, t, u, d, p] = await Promise.all([
        fetch('/api/admin/system/health', { headers: headers() }).then(r => r.json()),
        fetch('/api/admin/tenants', { headers: headers() }).then(r => r.json()),
        fetch('/api/admin/users', { headers: headers() }).then(r => r.json()),
        fetch('/api/admin/data-stats', { headers: headers() }).then(r => r.json()),
        fetch('/api/admin/pending-users', { headers: headers() }).then(r => r.ok ? r.json() : []),
      ]);
      setHealth(h);
      setTenants(t);
      setUsers(u);
      setDataStats(d);
      setPendingUsers(p);
    } catch (e) {
      console.error('admin load error:', e);
    }
  };

  const loadTenantDetail = async (id: string) => {
    try {
      const d = await fetch(`/api/admin/tenants/${id}`, { headers: headers() }).then(r => r.json());
      setSelectedTenant(d);
    } catch {}
  };

  const handleCreateTenant = async () => {
    if (!newTenantName.trim()) return alert('캠프 이름을 입력하세요');
    setCreating(true);
    try {
      const res = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          name: newTenantName.trim(),
          plan: newTenantPlan,
          max_elections: 3,
          max_members: 10,
          max_candidates: 10,
          max_keywords: 50,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || '생성 실패');
      }
      const tenant = await res.json();
      alert(`"${tenant.name}" 캠프 생성 완료`);
      setShowCreateTenant(false);
      setNewTenantName('');
      await loadAll();
    } catch (e: any) {
      alert('실패: ' + (e?.message || ''));
    } finally { setCreating(false); }
  };

  const handleDeleteTenant = async (tid: string, name: string) => {
    if (!confirm(`"${name}" 캠프를 삭제합니다.\n사용자들의 캠프 매핑이 해제됩니다. 계속하시겠습니까?`)) return;
    try {
      const res = await fetch(`/api/admin/tenants/${tid}`, { method: 'DELETE', headers: headers() });
      if (!res.ok && res.status !== 204) throw new Error('삭제 실패');
      alert(`"${name}" 삭제 완료`);
      setSelectedTenant(null);
      await loadAll();
    } catch (e: any) {
      alert('실패: ' + (e?.message || ''));
    }
  };

  const handleAddUser = async () => {
    if (!showAddUser || !newUserEmail.trim() || !newUserPassword.trim() || !newUserName.trim()) {
      return alert('이메일, 비밀번호, 이름 필수');
    }
    if (newUserPassword !== newUserPasswordConfirm) {
      return alert('비밀번호가 일치하지 않습니다');
    }
    if (newUserPassword.length < 8) {
      return alert('비밀번호는 최소 8자 이상이어야 합니다');
    }
    setAddingUser(true);
    try {
      const res = await fetch(`/api/admin/tenants/${showAddUser}/users`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          email: newUserEmail.trim(),
          password: newUserPassword,
          name: newUserName.trim(),
          phone: newUserPhone.trim() || null,
          role: 'admin',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || '추가 실패');
      }
      const user = await res.json();
      alert(`사용자 "${user.name}" 추가 완료\n로그인: ${user.email}`);
      setShowAddUser(null);
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserPasswordConfirm('');
      setNewUserName('');
      setNewUserPhone('');
      await loadAll();
      if (selectedTenant) loadTenantDetail(selectedTenant.tenant.id);
    } catch (e: any) {
      alert('실패: ' + (e?.message || ''));
    } finally { setAddingUser(false); }
  };

  const handleChangePassword = async () => {
    if (!showChangePw) return;
    if (changePw1 !== changePw2) return alert('비밀번호가 일치하지 않습니다');
    if (changePw1.length < 8) return alert('비밀번호는 최소 8자 이상이어야 합니다');
    setChangingPw(true);
    try {
      const res = await fetch(`/api/admin/users/${showChangePw.id}/password`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ new_password: changePw1 }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || '변경 실패');
      }
      alert(`${showChangePw.email} 비밀번호 변경 완료`);
      setShowChangePw(null);
      setChangePw1('');
      setChangePw2('');
    } catch (e: any) {
      alert('실패: ' + (e?.message || ''));
    } finally { setChangingPw(false); }
  };

  const handleApproveUser = async (uid: string, email: string) => {
    if (!confirm(`"${email}" 가입을 승인합니다. 계속하시겠습니까?`)) return;
    try {
      const res = await fetch(`/api/admin/approve-user/${uid}`, { method: 'POST', headers: headers() });
      if (!res.ok) throw new Error('승인 실패');
      alert(`"${email}" 승인 완료`);
      await loadAll();
    } catch (e: any) { alert('실패: ' + (e?.message || '')); }
  };

  const handleRejectUser = async (uid: string, email: string) => {
    const reason = prompt(`"${email}" 가입을 거부합니다. 사유를 입력하세요:`);
    if (reason === null) return;
    try {
      const res = await fetch(`/api/admin/reject-user/${uid}`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ note: reason || '심사 미통과' }),
      });
      if (!res.ok) throw new Error('거부 실패');
      alert(`"${email}" 거부 완료`);
      await loadAll();
    } catch (e: any) { alert('실패: ' + (e?.message || '')); }
  };

  const handleToggleActive = async (uid: string, email: string, currentActive: boolean) => {
    const action = currentActive ? '정지' : '활성화';
    if (!confirm(`"${email}" 계정을 ${action}합니다. 계속하시겠습니까?`)) return;
    try {
      const res = await fetch(`/api/admin/users/${uid}/toggle-active`, { method: 'POST', headers: headers() });
      if (!res.ok) throw new Error(`${action} 실패`);
      alert(`"${email}" ${action} 완료`);
      await loadAll();
    } catch (e: any) { alert('실패: ' + (e?.message || '')); }
  };

  const handleDeleteUser = async (uid: string, email: string) => {
    if (!confirm(`사용자 "${email}"를 삭제합니다. 계속하시겠습니까?`)) return;
    try {
      const res = await fetch(`/api/admin/users/${uid}`, { method: 'DELETE', headers: headers() });
      if (!res.ok && res.status !== 204) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || '삭제 실패');
      }
      alert(`"${email}" 삭제 완료`);
      await loadAll();
      if (selectedTenant) loadTenantDetail(selectedTenant.tenant.id);
    } catch (e: any) {
      alert('실패: ' + (e?.message || ''));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">관리자 대시보드</h1>
        <button onClick={() => setShowCreateTenant(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-bold">
          + 새 캠프 생성
        </button>
      </div>

      {/* 시스템 현황 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: '시스템', value: health?.status === 'healthy' ? 'HEALTHY' : '?', color: 'text-green-400' },
          { label: '캠프', value: health?.tenants?.total || 0, color: 'text-white' },
          { label: '회원', value: health?.users || 0, color: 'text-white' },
          { label: '선거', value: health?.elections || 0, color: 'text-blue-400' },
          { label: '뉴스', value: health?.data?.news || 0, color: 'text-purple-400' },
        ].map((s, i) => (
          <div key={i} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <p className="text-gray-400 text-xs">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* 데이터 현황 */}
      {dataStats && (
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
          <h3 className="text-white font-semibold mb-3">데이터 현황 (총 {dataStats.total?.toLocaleString()}건)</h3>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
            {Object.entries(dataStats.tables || {}).map(([name, cnt]: [string, any]) => (
              <div key={name} className="text-center">
                <p className="text-lg font-bold text-white">{(cnt || 0).toLocaleString()}</p>
                <p className="text-[10px] text-gray-400">{name}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 가입 승인 대기 */}
      {pendingUsers.length > 0 && (
        <div className="bg-yellow-900/30 rounded-xl border border-yellow-700/50">
          <div className="p-4 border-b border-yellow-700/50 flex items-center justify-between">
            <h3 className="text-yellow-400 font-semibold">가입 승인 대기 ({pendingUsers.length}건)</h3>
          </div>
          <div className="divide-y divide-yellow-700/30">
            {pendingUsers.map((u: any) => (
              <div key={u.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-semibold">{u.name}</span>
                      <span className="text-xs text-gray-400">{u.email}</span>
                      <span className="text-xs text-yellow-500">{u.phone}</span>
                    </div>
                    <div className="mt-1 text-sm text-gray-300">
                      <span className="text-blue-400">{u.candidate_name_applied}</span>
                      {' '}{u.election_type_applied} | {u.region_applied}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      소속: {u.organization} | 직책: {u.position_in_camp}
                    </div>
                    {u.apply_reason && (
                      <div className="mt-1 text-xs text-gray-500">사유: {u.apply_reason}</div>
                    )}
                    <div className="text-xs text-gray-600 mt-1">
                      신청: {u.applied_at ? new Date(u.applied_at).toLocaleString('ko') : '-'}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => handleApproveUser(u.id, u.email)}
                      className="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-bold hover:bg-green-500">
                      승인
                    </button>
                    <button onClick={() => handleRejectUser(u.id, u.email)}
                      className="px-3 py-1.5 bg-red-600 text-white rounded text-xs font-bold hover:bg-red-500">
                      거부
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 캠프 목록 */}
        <div className="bg-gray-800 rounded-xl border border-gray-700">
          <div className="p-4 border-b border-gray-700">
            <h3 className="text-white font-semibold">캠프 ({tenants.length})</h3>
          </div>
          <div className="divide-y divide-gray-700/50 max-h-[600px] overflow-y-auto">
            {tenants.map(t => (
              <div key={t.id} className="p-3 hover:bg-gray-700/30">
                <div className="flex items-center justify-between cursor-pointer" onClick={() => loadTenantDetail(t.id)}>
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
                <div className="flex gap-2 mt-2">
                  <button onClick={() => setShowAddUser(t.id)}
                    className="text-xs px-2 py-1 bg-blue-600/20 text-blue-400 rounded hover:bg-blue-600/40">
                    + 사용자 추가
                  </button>
                  <button onClick={() => handleDeleteTenant(t.id, t.name)}
                    className="text-xs px-2 py-1 bg-red-600/20 text-red-400 rounded hover:bg-red-600/40">
                    삭제
                  </button>
                </div>
              </div>
            ))}
            {tenants.length === 0 && (
              <div className="p-8 text-center text-gray-500 text-sm">등록된 캠프 없음</div>
            )}
          </div>
        </div>

        {/* 캠프 상세 / 회원 목록 */}
        {selectedTenant ? (
          <div className="bg-gray-800 rounded-xl border border-gray-700">
            <div className="p-4 border-b border-gray-700 flex justify-between items-center">
              <h3 className="text-white font-semibold">{selectedTenant.tenant?.name} 상세</h3>
              <button onClick={() => setSelectedTenant(null)} className="text-xs text-gray-400 hover:text-white">닫기</button>
            </div>
            <div className="p-4 space-y-4 max-h-[550px] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="text-gray-400">요금제: <span className="text-white font-medium">{selectedTenant.tenant?.plan}</span></div>
                <div className="text-gray-400">상태: <span className={selectedTenant.tenant?.is_active ? 'text-green-400' : 'text-red-400'}>{selectedTenant.tenant?.is_active ? '활성' : '비활성'}</span></div>
                <div className="text-gray-400">최대 후보: <span className="text-white">{selectedTenant.tenant?.max_candidates}명</span></div>
                <div className="text-gray-400">최대 멤버: <span className="text-white">{selectedTenant.tenant?.max_members}명</span></div>
              </div>

              <div>
                <h4 className="text-gray-300 text-sm font-medium mb-2">멤버 ({selectedTenant.members?.length || 0})</h4>
                {(selectedTenant.members || []).map((m: any) => (
                  <div key={m.id} className="flex items-center justify-between py-2 text-sm border-b border-gray-700/30">
                    <div>
                      <div className="text-white font-medium">{m.name} <span className="text-gray-500 text-xs">({m.email})</span></div>
                      <div className="text-[10px] text-gray-500">{m.role}{m.last_login ? ` · 최근로그인 ${new Date(m.last_login).toLocaleDateString('ko')}` : ''}</div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setShowChangePw({ id: m.id, email: m.email })}
                        className="text-[10px] px-2 py-1 bg-amber-600/20 text-amber-400 rounded hover:bg-amber-600/40">
                        비밀번호 변경
                      </button>
                      <button onClick={() => handleDeleteUser(m.id, m.email)}
                        className="text-[10px] px-2 py-1 bg-red-600/20 text-red-400 rounded hover:bg-red-600/40">
                        삭제
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <h4 className="text-gray-300 text-sm font-medium mb-2">선거 ({selectedTenant.elections?.length || 0})</h4>
                {(selectedTenant.elections || []).map((e: any) => (
                  <div key={e.id} className="flex justify-between py-1 text-sm">
                    <span className="text-white">{e.name}</span>
                    <span className="text-gray-400">{e.date}</span>
                  </div>
                ))}
                {(!selectedTenant.elections || selectedTenant.elections.length === 0) && (
                  <p className="text-xs text-gray-500">선거 없음</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-gray-800 rounded-xl border border-gray-700">
            <div className="p-4 border-b border-gray-700">
              <h3 className="text-white font-semibold">전체 회원 ({users.length})</h3>
            </div>
            <div className="divide-y divide-gray-700/50 max-h-[600px] overflow-y-auto">
              {users.map(u => (
                <div key={u.id} className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-white font-medium">{u.name}</span>
                      <span className="text-gray-400 text-xs ml-2">{u.email}</span>
                      {u.approval_status === 'pending' && <span className="text-xs text-yellow-500 ml-2">대기</span>}
                      {u.approval_status === 'rejected' && <span className="text-xs text-red-500 ml-2">거부됨</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${u.is_superadmin ? 'text-red-400' : 'text-gray-400'}`}>
                        {u.is_superadmin ? 'SUPER' : u.role}
                      </span>
                      <span className={`w-2 h-2 rounded-full ${u.is_active ? 'bg-green-400' : 'bg-gray-500'}`} title={u.is_active ? '활성' : '비활성'} />
                      {!u.is_superadmin && (
                        <div className="flex gap-1">
                          <button onClick={() => handleToggleActive(u.id, u.email, u.is_active)}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${u.is_active ? 'bg-orange-600/30 text-orange-400 hover:bg-orange-600/50' : 'bg-green-600/30 text-green-400 hover:bg-green-600/50'}`}>
                            {u.is_active ? '정지' : '활성화'}
                          </button>
                          <button onClick={() => setShowChangePw({ id: u.id, email: u.email })}
                            className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-600/30 text-blue-400 hover:bg-blue-600/50">
                            비번
                          </button>
                          <button onClick={() => handleDeleteUser(u.id, u.email)}
                            className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-600/30 text-red-400 hover:bg-red-600/50">
                            삭제
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {u.tenant_name || '캠프 없음'} | 가입: {new Date(u.created_at).toLocaleDateString('ko')}
                    {u.candidate_name_applied && <> | 후보: {u.candidate_name_applied}</>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 새 캠프 생성 모달 */}
      {showCreateTenant && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 w-96">
            <h3 className="text-white font-bold text-lg mb-4">새 캠프 생성</h3>
            <div className="space-y-3">
              <div>
                <label className="text-gray-400 text-xs block mb-1">캠프 이름</label>
                <input className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 outline-none"
                  value={newTenantName} onChange={e => setNewTenantName(e.target.value)}
                  placeholder="예: 청주시장 캠프" />
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">요금제</label>
                <select className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600"
                  value={newTenantPlan} onChange={e => setNewTenantPlan(e.target.value)}>
                  <option value="basic">Basic</option>
                  <option value="pro">Pro</option>
                  <option value="premium">Premium</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleCreateTenant} disabled={creating}
                className="flex-1 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                {creating ? '생성 중...' : '생성'}
              </button>
              <button onClick={() => { setShowCreateTenant(false); setNewTenantName(''); }}
                className="px-4 py-2 bg-gray-700 text-gray-300 rounded hover:bg-gray-600">
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 비밀번호 변경 모달 */}
      {showChangePw && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 w-96">
            <h3 className="text-white font-bold text-lg mb-1">비밀번호 변경</h3>
            <p className="text-xs text-gray-400 mb-4">{showChangePw.email}</p>
            <div className="space-y-3">
              <div>
                <label className="text-gray-400 text-xs block mb-1">새 비밀번호 (최소 8자)</label>
                <input type="text" className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600"
                  value={changePw1} onChange={e => setChangePw1(e.target.value)} autoFocus />
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">비밀번호 확인</label>
                <input type="text" className={`w-full px-3 py-2 bg-gray-700 text-white rounded border ${
                  changePw2 && changePw1 !== changePw2 ? 'border-red-500' : 'border-gray-600'
                }`}
                  value={changePw2} onChange={e => setChangePw2(e.target.value)} />
                {changePw2 && changePw1 !== changePw2 && (
                  <p className="text-[10px] text-red-400 mt-1">비밀번호가 일치하지 않습니다</p>
                )}
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleChangePassword} disabled={changingPw || !changePw1 || changePw1 !== changePw2}
                className="flex-1 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50">
                {changingPw ? '변경 중...' : '변경'}
              </button>
              <button onClick={() => { setShowChangePw(null); setChangePw1(''); setChangePw2(''); }}
                className="px-4 py-2 bg-gray-700 text-gray-300 rounded hover:bg-gray-600">
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 사용자 추가 모달 */}
      {showAddUser && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 w-96">
            <h3 className="text-white font-bold text-lg mb-4">캠프에 사용자 추가</h3>
            <div className="space-y-3">
              <div>
                <label className="text-gray-400 text-xs block mb-1">이메일</label>
                <input type="email" className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600"
                  value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)}
                  placeholder="user@example.com" />
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">비밀번호 (최소 8자)</label>
                <input type="text" className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600"
                  value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)}
                  placeholder="최소 8자" />
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">비밀번호 확인</label>
                <input type="text" className={`w-full px-3 py-2 bg-gray-700 text-white rounded border ${
                  newUserPasswordConfirm && newUserPassword !== newUserPasswordConfirm ? 'border-red-500' : 'border-gray-600'
                }`}
                  value={newUserPasswordConfirm} onChange={e => setNewUserPasswordConfirm(e.target.value)}
                  placeholder="다시 한 번 입력" />
                {newUserPasswordConfirm && newUserPassword !== newUserPasswordConfirm && (
                  <p className="text-[10px] text-red-400 mt-1">비밀번호가 일치하지 않습니다</p>
                )}
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">이름</label>
                <input className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600"
                  value={newUserName} onChange={e => setNewUserName(e.target.value)} />
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">전화번호 (선택)</label>
                <input className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600"
                  value={newUserPhone} onChange={e => setNewUserPhone(e.target.value)}
                  placeholder="010-0000-0000" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleAddUser} disabled={addingUser}
                className="flex-1 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                {addingUser ? '추가 중...' : '사용자 추가'}
              </button>
              <button onClick={() => setShowAddUser(null)}
                className="px-4 py-2 bg-gray-700 text-gray-300 rounded hover:bg-gray-600">
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
