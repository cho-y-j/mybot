'use client';
import { useState, useEffect } from 'react';

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<any>(null);

  const headers = (): Record<string, string> => ({
    Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    'Content-Type': 'application/json',
  });

  useEffect(() => {
    fetch('/api/admin/schedule-status', { headers: headers() })
      .then(r => r.json()).then(setSchedules).catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-white">스케줄 관리</h1>
      {schedules ? (
        <div className="space-y-4">
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
          {schedules.schedules && (
            <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-700/50">
                  <tr className="text-gray-400 text-xs">
                    <th className="text-left px-4 py-2">캠프</th>
                    <th className="text-left px-4 py-2">유형</th>
                    <th className="text-center px-4 py-2">시간</th>
                    <th className="text-center px-4 py-2">상태</th>
                    <th className="text-center px-4 py-2">마지막 실행</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {(schedules.schedules || []).map((s: any, i: number) => (
                    <tr key={i} className="hover:bg-gray-700/30">
                      <td className="px-4 py-2 text-white">{s.tenant_name || '-'}</td>
                      <td className="px-4 py-2 text-gray-300">{s.schedule_type || s.name}</td>
                      <td className="px-4 py-2 text-center text-gray-300">{s.fixed_times || '-'}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`text-xs ${s.enabled ? 'text-green-400' : 'text-red-400'}`}>{s.enabled ? '활성' : '비활성'}</span>
                      </td>
                      <td className="px-4 py-2 text-center text-xs text-gray-400">{s.last_run ? new Date(s.last_run).toLocaleString('ko') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
          <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
        </div>
      )}
    </div>
  );
}
