'use client';
import { useState, useEffect } from 'react';

export default function AdminDashboard() {
  const [health, setHealth] = useState<any>(null);
  const [dataStats, setDataStats] = useState<any>(null);
  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [scheduleStatus, setScheduleStatus] = useState<any>(null);
  const [pendingUsers, setPendingUsers] = useState<any[]>([]);

  const headers = (): Record<string, string> => ({
    Authorization: `Bearer ${(sessionStorage.getItem('access_token') || localStorage.getItem('access_token'))}`,
    'Content-Type': 'application/json',
  });

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [h, d, logs, sched, p] = await Promise.all([
        fetch('/api/admin/system/health', { headers: headers() }).then(r => r.json()),
        fetch('/api/admin/data-stats', { headers: headers() }).then(r => r.json()),
        fetch('/api/admin/audit-logs?limit=15', { headers: headers() }).then(r => r.ok ? r.json() : []),
        fetch('/api/admin/schedule-status', { headers: headers() }).then(r => r.ok ? r.json() : null),
        fetch('/api/admin/pending-users', { headers: headers() }).then(r => r.ok ? r.json() : []),
      ]);
      setHealth(h);
      setDataStats(d);
      setRecentLogs(Array.isArray(logs) ? logs : []);
      setScheduleStatus(sched);
      setPendingUsers(Array.isArray(p) ? p : []);
    } catch (e) {
      console.error('dashboard load error:', e);
    }
  };

  const handleApprove = async (uid: string, email: string) => {
    if (!confirm(`"${email}" 승인?`)) return;
    try {
      await fetch(`/api/admin/approve-user/${uid}`, { method: 'POST', headers: headers() });
      alert(`"${email}" 승인 완료`);
      loadAll();
    } catch { alert('실패'); }
  };

  const handleReject = async (uid: string, email: string) => {
    const reason = prompt(`"${email}" 거부 사유:`);
    if (reason === null) return;
    try {
      await fetch(`/api/admin/reject-user/${uid}`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ note: reason || '심사 미통과' }),
      });
      alert(`"${email}" 거부`);
      loadAll();
    } catch { alert('실패'); }
  };

  const todayLogins = recentLogs.filter(l => l.action === 'login').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">관리자 대시보드</h1>
        <button onClick={loadAll} className="text-xs text-gray-400 hover:text-white px-3 py-1 bg-gray-700 rounded">새로고침</button>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          { label: '시스템', value: health?.status === 'healthy' ? 'OK' : '!', color: health?.status === 'healthy' ? 'text-green-400' : 'text-red-400' },
          { label: '활성 캠프', value: health?.tenants?.active || 0, color: 'text-white' },
          { label: '전체 회원', value: health?.users || 0, color: 'text-white' },
          { label: '오늘 접속', value: todayLogins, color: 'text-blue-400' },
          { label: '승인 대기', value: pendingUsers.length, color: pendingUsers.length > 0 ? 'text-yellow-400' : 'text-gray-500' },
          { label: '선거', value: health?.elections || 0, color: 'text-purple-400' },
        ].map((s, i) => (
          <div key={i} className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <p className="text-gray-400 text-xs">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* 데이터 현황 */}
      {dataStats && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <h3 className="text-white font-semibold text-sm mb-3">데이터 현황 (총 {dataStats.total?.toLocaleString()}건)</h3>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {Object.entries(dataStats.tables || {}).map(([name, cnt]: [string, any]) => (
              <div key={name} className="text-center">
                <p className="text-lg font-bold text-white">{(cnt || 0).toLocaleString()}</p>
                <p className="text-[10px] text-gray-400">{name}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 가입 승인 대기 */}
        <div className="bg-gray-800 rounded-lg border border-gray-700">
          <div className="p-4 border-b border-gray-700">
            <h3 className="text-white font-semibold text-sm">
              가입 승인 대기 {pendingUsers.length > 0 && <span className="text-yellow-400 ml-1">({pendingUsers.length})</span>}
            </h3>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {pendingUsers.length === 0 ? (
              <p className="p-4 text-gray-500 text-sm text-center">대기 중인 가입이 없습니다</p>
            ) : pendingUsers.map((u: any) => (
              <div key={u.id} className="p-3 border-b border-gray-700/50">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-white text-sm font-medium">{u.name}</span>
                    <span className="text-gray-400 text-xs ml-2">{u.email}</span>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {u.candidate_name_applied && <span className="text-blue-400">{u.candidate_name_applied}</span>}
                      {' '}{u.election_type_applied} | {u.region_applied}
                    </div>
                    {u.organization && <div className="text-[10px] text-gray-500">소속: {u.organization} | 직책: {u.position_in_camp}</div>}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => handleApprove(u.id, u.email)}
                      className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-500">승인</button>
                    <button onClick={() => handleReject(u.id, u.email)}
                      className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-500">거부</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 최근 접속 로그 */}
        <div className="bg-gray-800 rounded-lg border border-gray-700">
          <div className="p-4 border-b border-gray-700">
            <h3 className="text-white font-semibold text-sm">최근 활동</h3>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {recentLogs.length === 0 ? (
              <p className="p-4 text-gray-500 text-sm text-center">로그 없음</p>
            ) : recentLogs.map((log: any, i: number) => (
              <div key={i} className="px-3 py-2 border-b border-gray-700/30 text-xs">
                <div className="flex justify-between">
                  <div>
                    <span className={`font-medium ${
                      log.action === 'login' ? 'text-green-400' :
                      log.action?.startsWith('admin_') ? 'text-yellow-400' :
                      log.action?.startsWith('delete') ? 'text-red-400' :
                      'text-gray-300'
                    }`}>{log.action}</span>
                    {log.user_email && <span className="text-gray-400 ml-2">{log.user_email}</span>}
                  </div>
                  <span className="text-gray-500">{log.created_at ? new Date(log.created_at).toLocaleString('ko', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                </div>
                {log.details && <p className="text-gray-500 mt-0.5 truncate">{typeof log.details === 'string' ? log.details : JSON.stringify(log.details).slice(0, 80)}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 스케줄 현황 */}
      {scheduleStatus && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <h3 className="text-white font-semibold text-sm mb-3">스케줄 현황</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="text-gray-400">활성 스케줄: <span className="text-white font-bold">{scheduleStatus.active_schedules || 0}</span></div>
            <div className="text-gray-400">오늘 실행: <span className="text-white font-bold">{scheduleStatus.today_runs || 0}</span></div>
            <div className="text-gray-400">성공: <span className="text-green-400 font-bold">{scheduleStatus.today_success || 0}</span></div>
            <div className="text-gray-400">실패: <span className={`font-bold ${(scheduleStatus.today_failed || 0) > 0 ? 'text-red-400' : 'text-gray-500'}`}>{scheduleStatus.today_failed || 0}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
