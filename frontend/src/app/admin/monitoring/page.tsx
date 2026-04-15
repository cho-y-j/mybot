'use client';
import { useState, useEffect } from 'react';

export default function MonitoringPage() {
  const [accessStats, setAccessStats] = useState<any>(null);
  const [aiUsage, setAiUsage] = useState<any>(null);
  const [errorLogs, setErrorLogs] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  const headers = (): Record<string, string> => ({
    Authorization: `Bearer ${(sessionStorage.getItem('access_token') || localStorage.getItem('access_token'))}`,
    'Content-Type': 'application/json',
  });

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    const [access, ai, errors, audit] = await Promise.all([
      fetch('/api/admin/access-stats', { headers: headers() }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/admin/ai-usage', { headers: headers() }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/admin/error-logs', { headers: headers() }).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch('/api/admin/audit-logs?limit=30', { headers: headers() }).then(r => r.ok ? r.json() : []).catch(() => []),
    ]);
    setAccessStats(access);
    setAiUsage(ai);
    setErrorLogs(Array.isArray(errors) ? errors : []);
    setAuditLogs(Array.isArray(audit) ? audit : []);
  };

  const maxLogins = accessStats?.daily ? Math.max(...accessStats.daily.map((d: any) => d.logins), 1) : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">모니터링</h1>
        <button onClick={loadAll} className="text-xs text-gray-400 hover:text-white px-3 py-1 bg-gray-700 rounded">새로고침</button>
      </div>

      {/* 접속 현황 차트 */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h3 className="text-white font-semibold text-sm mb-4">일별 접속 현황 (14일)</h3>
        {accessStats?.daily ? (
          <div className="flex items-end gap-1 h-32">
            {accessStats.daily.map((d: any, i: number) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] text-gray-400">{d.logins}</span>
                <div className="w-full bg-blue-500/70 rounded-t transition-all"
                  style={{ height: `${(d.logins / maxLogins) * 100}%`, minHeight: d.logins > 0 ? '4px' : '0' }} />
                <span className="text-[9px] text-gray-500 rotate-[-45deg] origin-center whitespace-nowrap">
                  {d.date?.slice(5)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm text-center py-8">데이터 로딩 중...</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* AI/스케줄 사용량 */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <h3 className="text-white font-semibold text-sm mb-3">스케줄 실행 현황 (7일)</h3>
          {aiUsage ? (
            <>
              <div className="mb-3 text-sm text-gray-400">
                총 실행: <span className="text-white font-bold">{aiUsage.total_runs_7d || 0}회</span>
              </div>
              <div className="space-y-2">
                {(aiUsage.by_tenant || []).map((t: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-gray-300">{t.tenant_name}</span>
                    <div className="flex gap-3">
                      <span className="text-green-400">{t.success}성공</span>
                      {t.failed > 0 && <span className="text-red-400">{t.failed}실패</span>}
                      <span className="text-gray-400">{t.runs}회</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-gray-500 text-sm text-center py-4">로딩 중...</p>
          )}
        </div>

        {/* 에러 로그 */}
        <div className="bg-gray-800 rounded-lg border border-gray-700">
          <div className="p-4 border-b border-gray-700">
            <h3 className="text-white font-semibold text-sm">
              최근 에러 {errorLogs.length > 0 && <span className="text-red-400 ml-1">({errorLogs.length})</span>}
            </h3>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {errorLogs.length === 0 ? (
              <p className="p-4 text-gray-500 text-sm text-center">에러 없음</p>
            ) : errorLogs.map((e: any, i: number) => (
              <div key={i} className="px-4 py-2.5 border-b border-gray-700/30 text-xs">
                <div className="flex justify-between">
                  <span className="text-red-400 font-medium">{e.task_type || e.action}</span>
                  <span className="text-gray-500">{e.created_at ? new Date(e.created_at).toLocaleString('ko', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                </div>
                <div className="text-gray-400 mt-0.5">{e.tenant_name}</div>
                {e.error && <div className="text-gray-500 mt-0.5 truncate">{e.error}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 전체 활동 로그 */}
      <div className="bg-gray-800 rounded-lg border border-gray-700">
        <div className="p-4 border-b border-gray-700">
          <h3 className="text-white font-semibold text-sm">전체 활동 로그 (최근 30건)</h3>
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-700/50 sticky top-0">
              <tr className="text-gray-400">
                <th className="text-left px-3 py-2">시각</th>
                <th className="text-left px-3 py-2">액션</th>
                <th className="text-left px-3 py-2">사용자</th>
                <th className="text-left px-3 py-2">IP</th>
                <th className="text-left px-3 py-2">상세</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/30">
              {auditLogs.map((log: any, i: number) => (
                <tr key={i} className="hover:bg-gray-700/20">
                  <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">
                    {log.created_at ? new Date(log.created_at).toLocaleString('ko', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={`font-medium ${
                      log.action === 'login' ? 'text-green-400' :
                      log.action?.startsWith('admin_') ? 'text-yellow-400' :
                      log.action?.startsWith('delete') ? 'text-red-400' :
                      'text-gray-300'
                    }`}>{log.action}</span>
                  </td>
                  <td className="px-3 py-1.5 text-gray-300">{log.user_email || '-'}</td>
                  <td className="px-3 py-1.5 text-gray-500">{log.ip_address || '-'}</td>
                  <td className="px-3 py-1.5 text-gray-500 max-w-[200px] truncate">
                    {log.details ? (typeof log.details === 'string' ? log.details : JSON.stringify(log.details).slice(0, 60)) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
