'use client';
import { useState, useEffect } from 'react';

export default function SystemPage() {
  const [health, setHealth] = useState<any>(null);
  const [dataStats, setDataStats] = useState<any>(null);

  const headers = (): Record<string, string> => ({
    Authorization: `Bearer ${(sessionStorage.getItem('access_token') || localStorage.getItem('access_token'))}`,
    'Content-Type': 'application/json',
  });

  useEffect(() => { load(); }, []);
  const load = async () => {
    const [h, d] = await Promise.all([
      fetch('/api/admin/system/health', { headers: headers() }).then(r => r.json()).catch(() => null),
      fetch('/api/admin/data-stats', { headers: headers() }).then(r => r.json()).catch(() => null),
    ]);
    setHealth(h);
    setDataStats(d);
  };

  const StatusBadge = ({ ok, label }: { ok: boolean; label: string }) => (
    <div className="flex items-center gap-2">
      <span className={`w-3 h-3 rounded-full ${ok ? 'bg-green-400' : 'bg-red-400'}`} />
      <span className={ok ? 'text-green-400' : 'text-red-400'}>{label}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">시스템 상태</h1>
        <button onClick={load} className="text-xs text-gray-400 hover:text-white px-3 py-1 bg-gray-700 rounded">새로고침</button>
      </div>

      {health ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 서비스 상태 */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <h3 className="text-white font-semibold text-sm mb-4">서비스 상태</h3>
            <div className="space-y-3">
              <StatusBadge ok={health.status === 'healthy'} label={`전체: ${health.status?.toUpperCase()}`} />
              <StatusBadge ok={health.db === 'connected'} label={`PostgreSQL: ${health.db}`} />
              <StatusBadge ok={health.redis === 'connected'} label={`Redis: ${health.redis}`} />
            </div>
          </div>

          {/* 리소스 요약 */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <h3 className="text-white font-semibold text-sm mb-4">리소스 요약</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-400">
                <span>캠프</span>
                <span className="text-white">{health.tenants?.total || 0} (활성 {health.tenants?.active || 0})</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>회원</span>
                <span className="text-white">{health.users || 0}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>선거</span>
                <span className="text-white">{health.elections || 0}</span>
              </div>
            </div>
          </div>

          {/* 인프라 설정 */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <h3 className="text-white font-semibold text-sm mb-4">인프라 설정</h3>
            <div className="space-y-2 text-sm text-gray-400">
              <div>DB: <span className="text-gray-300">ep_postgres:5432</span></div>
              <div>Redis: <span className="text-gray-300">ep_redis:6379</span></div>
              <div>CLI: <span className="text-gray-300">Claude Code 2.1.x</span></div>
              <div>Keep-alive: <span className="text-gray-300">4시간 주기</span></div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
          <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
        </div>
      )}

      {/* 데이터 통계 */}
      {dataStats && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <h3 className="text-white font-semibold text-sm mb-4">데이터 통계 (총 {dataStats.total?.toLocaleString()}건)</h3>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
            {Object.entries(dataStats.tables || {}).map(([name, cnt]: [string, any]) => (
              <div key={name} className="bg-gray-700/30 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-white">{(cnt || 0).toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 mt-1">{name}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
