'use client';
import { useState, useEffect } from 'react';

export default function SystemPage() {
  const [health, setHealth] = useState<any>(null);

  const headers = (): Record<string, string> => ({
    Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    'Content-Type': 'application/json',
  });

  useEffect(() => { load(); }, []);
  const load = () => {
    fetch('/api/admin/system/health', { headers: headers() }).then(r => r.json()).then(setHealth).catch(() => {});
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">시스템 상태</h1>
        <button onClick={load} className="text-xs text-gray-400 hover:text-white px-3 py-1 bg-gray-700 rounded">새로고침</button>
      </div>
      {health ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <h3 className="text-white font-semibold text-sm mb-3">서비스 상태</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">전체</span>
                <span className={health.status === 'healthy' ? 'text-green-400' : 'text-red-400'}>{health.status?.toUpperCase()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">DB</span>
                <span className={health.db === 'connected' ? 'text-green-400' : 'text-red-400'}>{health.db}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Redis</span>
                <span className={health.redis === 'connected' ? 'text-green-400' : 'text-red-400'}>{health.redis}</span>
              </div>
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <h3 className="text-white font-semibold text-sm mb-3">데이터 요약</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">캠프</span>
                <span className="text-white">{health.tenants?.total || 0} (활성 {health.tenants?.active || 0})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">회원</span>
                <span className="text-white">{health.users || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">선거</span>
                <span className="text-white">{health.elections || 0}</span>
              </div>
              {health.data && Object.entries(health.data).map(([k, v]: [string, any]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-gray-400">{k}</span>
                  <span className="text-white">{(v || 0).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
          <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
        </div>
      )}
    </div>
  );
}
