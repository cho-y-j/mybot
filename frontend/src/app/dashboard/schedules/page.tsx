'use client';
import { useState, useEffect } from 'react';
import { useElection } from '@/hooks/useElection';
import { api } from '@/services/api';

const TYPE_ICONS: Record<string, string> = {
  news: '📰', community: '💬', youtube: '▶️', trends: '📈', briefing: '📋', alert: '🚨',
};

const TYPE_COLORS: Record<string, string> = {
  news: 'bg-blue-100 text-blue-700',
  community: 'bg-purple-100 text-purple-700',
  youtube: 'bg-red-100 text-red-700',
  trends: 'bg-amber-100 text-amber-700',
  briefing: 'bg-green-100 text-green-700',
  alert: 'bg-orange-100 text-orange-700',
};

export default function SchedulesPage() {
  const { election, loading: elLoading } = useElection();
  const [schedules, setSchedules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', schedule_type: 'news', fixed_times: '', enabled: true });
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (election) loadSchedules();
  }, [election]);

  const loadSchedules = async () => {
    if (!election) return;
    try {
      const data = await api.getSchedules(election.id);
      setSchedules(data);
    } catch {} finally { setLoading(false); }
  };

  const handleCreateDefaults = async () => {
    if (!election) return;
    setCreating(true);
    try {
      const result = await api.createDefaultSchedules(election.id);
      setMessage(result.message);
      loadSchedules();
    } catch (e: any) {
      setMessage(e.message);
    } finally { setCreating(false); }
  };

  const handleToggle = async (scheduleId: string, currentEnabled: boolean) => {
    if (!election) return;
    try {
      await api.updateSchedule(election.id, scheduleId, { enabled: String(!currentEnabled) });
      loadSchedules();
    } catch {}
  };

  const handleDelete = async (scheduleId: string) => {
    if (!election || !confirm('이 스케줄을 삭제하시겠습니까?')) return;
    try {
      await api.deleteSchedule(election.id, scheduleId);
      loadSchedules();
    } catch {}
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!election) return;
    try {
      await api.createSchedule(election.id, {
        ...form,
        fixed_times: form.fixed_times.split(',').map(t => t.trim()).filter(Boolean),
      });
      setShowAdd(false);
      setForm({ name: '', schedule_type: 'news', fixed_times: '', enabled: true });
      loadSchedules();
    } catch {}
  };

  if (elLoading || loading) {
    return <div className="flex items-center justify-center h-64">
      <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" />
    </div>;
  }

  if (!election) {
    return <div className="card text-center py-12 text-gray-500">선거를 먼저 설정해주세요.</div>;
  }

  // 스케줄을 시간순으로 정렬
  const sorted = [...schedules].sort((a, b) => {
    const timeA = a.fixed_times?.[0] || '99:99';
    const timeB = b.fixed_times?.[0] || '99:99';
    return timeA.localeCompare(timeB);
  });

  // 시간대별 그룹핑
  const activeCount = schedules.filter(s => s.enabled).length;
  const totalRuns = schedules.reduce((sum, s) => sum + (s.enabled ? (s.fixed_times?.length || 0) : 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">수집 스케줄</h1>
          <p className="text-gray-500 mt-1">
            활성 {activeCount}개 | 일 {totalRuns}회 실행 | 운영시간 09:00~20:00
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowAdd(true)} className="btn-secondary text-sm">+ 스케줄 추가</button>
          {schedules.length === 0 && (
            <button onClick={handleCreateDefaults} disabled={creating} className="btn-primary text-sm">
              {creating ? '생성 중...' : '기본 스케줄 자동 생성'}
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className="bg-green-50 text-green-700 p-3 rounded-lg text-sm">{message}</div>
      )}

      {/* 타임라인 뷰 */}
      {schedules.length > 0 ? (
        <div className="card">
          <h3 className="font-semibold mb-4">일일 스케줄 타임라인</h3>
          {/* 시간 바 */}
          <div className="relative">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-2 px-1">
              {['09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'].map(h => (
                <span key={h}>{h}:00</span>
              ))}
            </div>
            <div className="h-12 bg-gray-100 rounded-lg relative overflow-hidden">
              {sorted.filter(s => s.enabled).flatMap(s =>
                (s.fixed_times || []).map((time: string, i: number) => {
                  const [h, m] = time.split(':').map(Number);
                  const pct = ((h - 9) * 60 + m) / (11 * 60) * 100;
                  if (pct < 0 || pct > 100) return null;
                  return (
                    <div key={`${s.id}-${i}`}
                      className="absolute top-1 bottom-1 w-1.5 rounded-full"
                      style={{ left: `${pct}%`, backgroundColor: TYPE_COLORS[s.schedule_type]?.includes('blue') ? '#3b82f6' : TYPE_COLORS[s.schedule_type]?.includes('red') ? '#ef4444' : TYPE_COLORS[s.schedule_type]?.includes('amber') ? '#f59e0b' : TYPE_COLORS[s.schedule_type]?.includes('green') ? '#22c55e' : TYPE_COLORS[s.schedule_type]?.includes('purple') ? '#8b5cf6' : '#666' }}
                      title={`${time} ${s.name}`}
                    />
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="card text-center py-12">
          <p className="text-gray-500 mb-4">아직 설정된 스케줄이 없습니다.</p>
          <p className="text-sm text-gray-400 mb-6">
            "기본 스케줄 자동 생성" 버튼을 클릭하면 요금제에 맞는 스케줄이 자동으로 만들어집니다.
          </p>
          <button onClick={handleCreateDefaults} disabled={creating} className="btn-primary">
            {creating ? '생성 중...' : '기본 스케줄 자동 생성'}
          </button>
        </div>
      )}

      {/* 스케줄 목록 */}
      <div className="space-y-2">
        {sorted.map(s => (
          <div key={s.id} className={`card p-4 flex items-center justify-between ${!s.enabled ? 'opacity-50' : ''}`}>
            <div className="flex items-center gap-4">
              <span className="text-xl">{TYPE_ICONS[s.schedule_type] || '📌'}</span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_COLORS[s.schedule_type] || 'bg-gray-100 text-gray-600'}`}>
                    {s.type_label}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
                  <span>실행 시간:</span>
                  {(s.fixed_times || []).map((t: string, i: number) => (
                    <span key={i} className="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono">{t}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* 토글 스위치 */}
              <button onClick={() => handleToggle(s.id, s.enabled)}
                className={`relative w-11 h-6 rounded-full transition-colors ${s.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${s.enabled ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
              <button onClick={() => handleDelete(s.id)} className="text-xs text-gray-400 hover:text-red-500">삭제</button>
            </div>
          </div>
        ))}
      </div>

      {/* 스케줄 추가 폼 */}
      {showAdd && (
        <div className="card">
          <h3 className="font-semibold mb-4">새 스케줄 추가</h3>
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">이름</label>
              <input className="input-field" value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="예: 오전 뉴스 수집" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">유형</label>
              <select className="input-field" value={form.schedule_type}
                onChange={e => setForm({ ...form, schedule_type: e.target.value })}>
                <option value="news">뉴스 수집</option>
                <option value="community">커뮤니티/블로그</option>
                <option value="youtube">유튜브</option>
                <option value="trends">검색 트렌드</option>
                <option value="briefing">브리핑/보고서</option>
                <option value="alert">위기 감지</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                실행 시간 (콤마 구분, HH:MM 형식)
              </label>
              <input className="input-field" value={form.fixed_times}
                onChange={e => setForm({ ...form, fixed_times: e.target.value })}
                placeholder="09:00, 14:00, 18:00" required />
            </div>
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" className="btn-primary">추가</button>
              <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary">취소</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
