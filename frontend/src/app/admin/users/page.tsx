'use client';
import { useState, useEffect } from 'react';

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterTenant, setFilterTenant] = useState('');
  const [filterActive, setFilterActive] = useState('');
  const [showChangePw, setShowChangePw] = useState<{ id: string; email: string } | null>(null);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');

  const headers = (): Record<string, string> => ({
    Authorization: `Bearer ${(sessionStorage.getItem('access_token') || localStorage.getItem('access_token'))}`,
    'Content-Type': 'application/json',
  });

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    const [u, t] = await Promise.all([
      fetch('/api/admin/users', { headers: headers() }).then(r => r.json()),
      fetch('/api/admin/tenants', { headers: headers() }).then(r => r.json()),
    ]);
    setUsers(Array.isArray(u) ? u : []);
    setTenants(Array.isArray(t) ? t : []);
  };

  const handleToggle = async (uid: string, email: string, active: boolean) => {
    if (!confirm(`"${email}" ${active ? '정지' : '활성화'}?`)) return;
    await fetch(`/api/admin/users/${uid}/toggle-active`, { method: 'POST', headers: headers() });
    loadAll();
  };

  const handleDelete = async (uid: string, email: string) => {
    if (!confirm(`"${email}" 삭제?`)) return;
    await fetch(`/api/admin/users/${uid}`, { method: 'DELETE', headers: headers() });
    loadAll();
  };

  const handleChangePw = async () => {
    if (!showChangePw || pw1 !== pw2 || pw1.length < 8) return alert('비밀번호 확인');
    await fetch(`/api/admin/users/${showChangePw.id}/password`, {
      method: 'PUT', headers: headers(), body: JSON.stringify({ new_password: pw1 }),
    });
    alert('변경 완료');
    setShowChangePw(null); setPw1(''); setPw2('');
  };

  const filtered = users.filter(u => {
    if (search && !u.name?.toLowerCase().includes(search.toLowerCase()) && !u.email?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterRole && u.role !== filterRole) return false;
    if (filterTenant && u.tenant_id !== filterTenant) return false;
    if (filterActive === 'active' && !u.is_active) return false;
    if (filterActive === 'inactive' && u.is_active) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">회원 관리 ({users.length}명)</h1>
        <button onClick={loadAll} className="text-xs text-gray-400 hover:text-white px-3 py-1 bg-gray-700 rounded">새로고침</button>
      </div>

      {/* 필터 */}
      <div className="flex gap-3 items-center flex-wrap">
        <input className="px-3 py-1.5 bg-gray-800 text-white border border-gray-600 rounded text-sm w-48"
          placeholder="이름/이메일 검색..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="px-2 py-1.5 bg-gray-800 text-gray-300 border border-gray-600 rounded text-sm"
          value={filterRole} onChange={e => setFilterRole(e.target.value)}>
          <option value="">전체 역할</option>
          <option value="admin">Admin</option>
          <option value="analyst">Analyst</option>
          <option value="viewer">Viewer</option>
        </select>
        <select className="px-2 py-1.5 bg-gray-800 text-gray-300 border border-gray-600 rounded text-sm"
          value={filterTenant} onChange={e => setFilterTenant(e.target.value)}>
          <option value="">전체 캠프</option>
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className="px-2 py-1.5 bg-gray-800 text-gray-300 border border-gray-600 rounded text-sm"
          value={filterActive} onChange={e => setFilterActive(e.target.value)}>
          <option value="">전체 상태</option>
          <option value="active">활성</option>
          <option value="inactive">비활성</option>
        </select>
        <span className="text-xs text-gray-500">{filtered.length}명</span>
      </div>

      {/* 회원 테이블 */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-700/50">
            <tr className="text-gray-400 text-xs">
              <th className="text-left px-4 py-2">이름/이메일</th>
              <th className="text-left px-4 py-2">캠프</th>
              <th className="text-center px-4 py-2">역할</th>
              <th className="text-center px-4 py-2">상태</th>
              <th className="text-center px-4 py-2">가입일</th>
              <th className="text-center px-4 py-2">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {filtered.map(u => (
              <tr key={u.id} className="hover:bg-gray-700/30">
                <td className="px-4 py-2.5">
                  <div className="text-white font-medium">{u.name} {u.is_superadmin && <span className="text-red-400 text-[10px]">SUPER</span>}</div>
                  <div className="text-gray-400 text-xs">{u.email}</div>
                  {u.password_plain && <div className="text-amber-400 text-[10px]">PW: {u.password_plain}</div>}
                </td>
                <td className="px-4 py-2.5">
                  {u.is_superadmin ? <span className="text-gray-500 text-xs">-</span> : (
                    <select className="bg-gray-700 text-gray-300 rounded px-1 py-0.5 text-xs"
                      value={u.tenant_id || ''} onChange={async e => {
                        await fetch(`/api/admin/users/${u.id}/tenant`, {
                          method: 'PUT', headers: headers(), body: JSON.stringify({ tenant_id: e.target.value || null }),
                        });
                        loadAll();
                      }}>
                      <option value="">없음</option>
                      {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  )}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {u.is_superadmin ? <span className="text-red-400 text-xs">SUPER</span> : (
                    <select className="bg-gray-700 text-gray-300 rounded px-1 py-0.5 text-xs"
                      value={u.role} onChange={async e => {
                        await fetch(`/api/admin/users/${u.id}/role`, {
                          method: 'PUT', headers: headers(), body: JSON.stringify({ role: e.target.value }),
                        });
                        loadAll();
                      }}>
                      <option value="admin">admin</option>
                      <option value="analyst">analyst</option>
                      <option value="viewer">viewer</option>
                    </select>
                  )}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`w-2 h-2 rounded-full inline-block ${u.is_active ? 'bg-green-400' : 'bg-red-400'}`} />
                  {u.approval_status === 'pending' && <span className="text-yellow-400 text-[10px] ml-1">대기</span>}
                </td>
                <td className="px-4 py-2.5 text-center text-xs text-gray-400">
                  {new Date(u.created_at).toLocaleDateString('ko')}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {!u.is_superadmin && (
                    <div className="flex gap-1 justify-center">
                      <button onClick={() => handleToggle(u.id, u.email, u.is_active)}
                        className={`px-2 py-0.5 rounded text-[10px] ${u.is_active ? 'bg-orange-600/30 text-orange-400' : 'bg-green-600/30 text-green-400'}`}>
                        {u.is_active ? '정지' : '활성'}
                      </button>
                      <button onClick={() => setShowChangePw({ id: u.id, email: u.email })}
                        className="px-2 py-0.5 rounded text-[10px] bg-blue-600/30 text-blue-400">비번</button>
                      <button onClick={() => handleDelete(u.id, u.email)}
                        className="px-2 py-0.5 rounded text-[10px] bg-red-600/30 text-red-400">삭제</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 비번 변경 모달 */}
      {showChangePw && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 w-96">
            <h3 className="text-white font-bold mb-1">비밀번호 변경</h3>
            <p className="text-xs text-gray-400 mb-4">{showChangePw.email}</p>
            <div className="space-y-3">
              <input type="text" className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600"
                placeholder="새 비밀번호 (8자 이상)" value={pw1} onChange={e => setPw1(e.target.value)} />
              <input type="text" className={`w-full px-3 py-2 bg-gray-700 text-white rounded border ${pw2 && pw1 !== pw2 ? 'border-red-500' : 'border-gray-600'}`}
                placeholder="확인" value={pw2} onChange={e => setPw2(e.target.value)} />
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleChangePw} disabled={!pw1 || pw1 !== pw2}
                className="flex-1 py-2 bg-amber-600 text-white rounded disabled:opacity-50">변경</button>
              <button onClick={() => { setShowChangePw(null); setPw1(''); setPw2(''); }}
                className="px-4 py-2 bg-gray-700 text-gray-300 rounded">취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
