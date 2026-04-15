'use client';
import { useState, useEffect } from 'react';

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<any>(null);
  const [tenants, setTenants] = useState<any[]>([]);
  const [triggering, setTriggering] = useState<string | null>(null);

  const headers = (): Record<string, string> => ({
    Authorization: `Bearer ${(sessionStorage.getItem('access_token') || localStorage.getItem('access_token'))}`,
    'Content-Type': 'application/json',
  });

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    const [sched, t] = await Promise.all([
      fetch('/api/admin/schedule-status', { headers: headers() }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/admin/tenants', { headers: headers() }).then(r => r.ok ? r.json() : []).catch(() => []),
    ]);
    setSchedules(sched);
    setTenants(Array.isArray(t) ? t : []);
  };

  const handleTrigger = async (tenantId: string, tenantName: string) => {
    if (!confirm(`"${tenantName}" 즉시 수집+분석을 실행합니다. 계속?`)) return;
    setTriggering(tenantId);
    try {
      const res = await fetch(`/api/admin/trigger-collection/${tenantId}`, { method: 'POST', headers: headers() });
      const data = await res.json();
      if (res.ok) {
        alert(`수집 시작됨 (task_id: ${data.task_id || 'queued'})`);
      } else {
        alert(`실패: ${data.detail || '알 수 없는 오류'}`);
      }
    } catch { alert('요청 실패'); }
    finally { setTriggering(null); }
  };

  const handleControlAll = async (action: string) => {
    if (!confirm(`전체 스케줄을 ${action === 'pause' ? '정지' : '재개'}합니다. 계속?`)) return;
    await fetch(`/api/admin/schedule-control-all?action=${action}`, { method: 'POST', headers: headers() });
    alert(`전체 스케줄 ${action === 'pause' ? '정지' : '재개'} 완료`);
    loadAll();
  };

  const handleControl = async (tenantId: string, tenantName: string, action: string) => {
    if (!confirm(`"${tenantName}" 스케줄을 ${action === 'pause' ? '정지' : '재개'}?`)) return;
    await fetch(`/api/admin/schedule-control/${tenantId}?action=${action}`, { method: 'POST', headers: headers() });
    loadAll();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">스케줄 관리</h1>
        <div className="flex gap-2">
          <button onClick={() => handleControlAll('resume')} className="text-xs px-3 py-1.5 bg-green-600/20 text-green-400 rounded hover:bg-green-600/40">전체 재개</button>
          <button onClick={() => handleControlAll('pause')} className="text-xs px-3 py-1.5 bg-red-600/20 text-red-400 rounded hover:bg-red-600/40">전체 정지</button>
          <button onClick={loadAll} className="text-xs text-gray-400 hover:text-white px-3 py-1.5 bg-gray-700 rounded">새로고침</button>
        </div>
      </div>

      {/* 요약 */}
      {schedules && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: '활성 스케줄', value: schedules.active_schedules || 0 },
            { label: '오늘 실행', value: schedules.today_runs || 0 },
            { label: '성공', value: schedules.today_success || 0, color: 'text-green-400' },
            { label: '실패', value: schedules.today_failed || 0, color: (schedules.today_failed || 0) > 0 ? 'text-red-400' : 'text-gray-400' },
          ].map((s, i) => (
            <div key={i} className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <p className="text-gray-400 text-xs">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.color || 'text-white'}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* 캠프별 수동 실행 */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h3 className="text-white font-semibold text-sm mb-3">수동 수집 트리거</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {tenants.filter(t => t.is_active).map(t => (
            <button key={t.id}
              onClick={() => handleTrigger(t.id, t.name)}
              disabled={triggering === t.id}
              className="px-3 py-2 bg-gray-700 text-white rounded text-sm hover:bg-blue-600/30 disabled:opacity-50 text-left">
              {triggering === t.id ? '실행 중...' : `▶ ${t.name}`}
            </button>
          ))}
        </div>
      </div>

      {/* 스케줄 목록 */}
      {schedules?.schedules && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-700/50">
              <tr className="text-gray-400 text-xs">
                <th className="text-left px-4 py-2">캠프</th>
                <th className="text-left px-4 py-2">유형</th>
                <th className="text-center px-4 py-2">시간</th>
                <th className="text-center px-4 py-2">상태</th>
                <th className="text-center px-4 py-2">마지막 실행</th>
                <th className="text-center px-4 py-2">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {(schedules.schedules || []).map((s: any, i: number) => (
                <tr key={i} className="hover:bg-gray-700/30">
                  <td className="px-4 py-2 text-white">{s.tenant_name || '-'}</td>
                  <td className="px-4 py-2 text-gray-300 text-xs">{s.name || s.schedule_type}</td>
                  <td className="px-4 py-2 text-center text-gray-300 text-xs">{
                    Array.isArray(s.fixed_times) ? s.fixed_times.join(', ') : (s.fixed_times || '-')
                  }</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`text-xs ${s.enabled ? 'text-green-400' : 'text-red-400'}`}>
                      {s.enabled ? '활성' : '정지'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-center text-xs text-gray-400">
                    {s.last_run ? new Date(s.last_run).toLocaleString('ko', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {s.tenant_id && (
                      <button onClick={() => handleControl(s.tenant_id, s.tenant_name || '', s.enabled ? 'pause' : 'resume')}
                        className={`text-[10px] px-2 py-0.5 rounded ${s.enabled ? 'bg-orange-600/20 text-orange-400' : 'bg-green-600/20 text-green-400'}`}>
                        {s.enabled ? '정지' : '재개'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
