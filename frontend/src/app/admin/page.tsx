'use client';
import { useState, useEffect } from 'react';

export default function AdminDashboard() {
  const [health, setHealth] = useState<any>(null);
  const [tenants, setTenants] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [dataStats, setDataStats] = useState<any>(null);
  const [selectedTenant, setSelectedTenant] = useState<any>(null);

  const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('access_token')}` });

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [h, t, u, d] = await Promise.all([
        fetch('/api/admin/system/health', { headers: headers() }).then(r => r.json()),
        fetch('/api/admin/tenants', { headers: headers() }).then(r => r.json()),
        fetch('/api/admin/users', { headers: headers() }).then(r => r.json()),
        fetch('/api/admin/data-stats', { headers: headers() }).then(r => r.json()),
      ]);
      setHealth(h);
      setTenants(t);
      setUsers(u);
      setDataStats(d);
    } catch {}
  };

  const loadTenantDetail = async (id: string) => {
    try {
      const d = await fetch(`/api/admin/tenants/${id}`, { headers: headers() }).then(r => r.json());
      setSelectedTenant(d);
    } catch {}
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">관리자 대시보드</h1>

      {/* 시스템 현황 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: '시스템', value: health?.status === 'healthy' ? 'HEALTHY' : '?', color: 'text-green-400' },
          { label: '고객', value: health?.tenants?.total || 0, color: 'text-white' },
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
                <p className="text-lg font-bold text-white">{cnt.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400">{name}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 고객 목록 */}
        <div className="bg-gray-800 rounded-xl border border-gray-700">
          <div className="p-4 border-b border-gray-700">
            <h3 className="text-white font-semibold">고객 ({tenants.length})</h3>
          </div>
          <div className="divide-y divide-gray-700/50">
            {tenants.map(t => (
              <div key={t.id} className="p-3 hover:bg-gray-700/30 cursor-pointer" onClick={() => loadTenantDetail(t.id)}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-white font-medium">{t.name}</span>
                    <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                      t.plan === 'enterprise' ? 'bg-purple-500/20 text-purple-300' :
                      t.plan === 'pro' ? 'bg-blue-500/20 text-blue-300' :
                      'bg-gray-600/30 text-gray-300'
                    }`}>{t.plan.toUpperCase()}</span>
                  </div>
                  <span className={`w-2 h-2 rounded-full ${t.is_active ? 'bg-green-400' : 'bg-red-400'}`} />
                </div>
                <div className="flex gap-4 mt-1 text-xs text-gray-400">
                  <span>멤버 {t.members}</span>
                  <span>선거 {t.elections}</span>
                  <span>뉴스 {t.news_collected}</span>
                  <span>스케줄 {t.schedules_active}</span>
                </div>
              </div>
            ))}
            {tenants.length === 0 && (
              <div className="p-8 text-center text-gray-500 text-sm">등록된 고객 없음</div>
            )}
          </div>
        </div>

        {/* 고객 상세 / 회원 목록 */}
        {selectedTenant ? (
          <div className="bg-gray-800 rounded-xl border border-gray-700">
            <div className="p-4 border-b border-gray-700 flex justify-between items-center">
              <h3 className="text-white font-semibold">{selectedTenant.tenant.name} 상세</h3>
              <button onClick={() => setSelectedTenant(null)} className="text-xs text-gray-400">닫기</button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="text-gray-400">요금제: <span className="text-white font-medium">{selectedTenant.tenant.plan}</span></div>
                <div className="text-gray-400">셋팅: <span className={selectedTenant.tenant.setup_completed ? 'text-green-400' : 'text-yellow-400'}>{selectedTenant.tenant.setup_completed ? '완료' : '필요'}</span></div>
                <div className="text-gray-400">최대 후보: <span className="text-white">{selectedTenant.tenant.max_candidates}명</span></div>
                <div className="text-gray-400">뉴스: <span className="text-white">{selectedTenant.data_stats.news}건</span></div>
              </div>

              <div>
                <h4 className="text-gray-300 text-sm font-medium mb-2">멤버</h4>
                {selectedTenant.members.map((m: any) => (
                  <div key={m.id} className="flex justify-between py-1 text-sm">
                    <span className="text-white">{m.name} ({m.email})</span>
                    <span className="text-gray-400">{m.role}</span>
                  </div>
                ))}
              </div>

              <div>
                <h4 className="text-gray-300 text-sm font-medium mb-2">선거</h4>
                {selectedTenant.elections.map((e: any) => (
                  <div key={e.id} className="flex justify-between py-1 text-sm">
                    <span className="text-white">{e.name}</span>
                    <span className="text-gray-400">{e.date}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-gray-800 rounded-xl border border-gray-700">
            <div className="p-4 border-b border-gray-700">
              <h3 className="text-white font-semibold">전체 회원 ({users.length})</h3>
            </div>
            <div className="divide-y divide-gray-700/50">
              {users.map(u => (
                <div key={u.id} className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-white font-medium">{u.name}</span>
                      <span className="text-gray-400 text-xs ml-2">{u.email}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${u.is_superadmin ? 'text-red-400' : 'text-gray-400'}`}>
                        {u.is_superadmin ? 'SUPER' : u.role}
                      </span>
                      <span className={`w-2 h-2 rounded-full ${u.is_active ? 'bg-green-400' : 'bg-gray-500'}`} />
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {u.tenant_name || '소속 없음'} | 가입: {new Date(u.created_at).toLocaleDateString('ko')}
                    {u.last_login && ` | 최근: ${new Date(u.last_login).toLocaleDateString('ko')}`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
