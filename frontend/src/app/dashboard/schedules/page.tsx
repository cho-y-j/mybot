'use client';
import { useState, useEffect } from 'react';
import { useElection } from '@/hooks/useElection';
import { api } from '@/services/api';

const TYPE_ICONS: Record<string, string> = {
  news: '', community: '', youtube: '▶', trends: '', briefing: '', alert: '',
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
  // 편집 모달
  const [editing, setEditing] = useState<any>(null);
  const [editForm, setEditForm] = useState({ name: '', fixed_times: '', schedule_type: 'news' });
  // 즉시 수집 상태 (쿨다운 방지)
  const [collecting, setCollecting] = useState(false);
  const [lastCollectAt, setLastCollectAt] = useState<number>(0);
  const [collectMsg, setCollectMsg] = useState('');

  // 최근 1시간 내 수집했는지 (쿨다운)
  const cooldownMinutes = 60;
  const cooldownRemainSec = lastCollectAt
    ? Math.max(0, cooldownMinutes * 60 - Math.floor((Date.now() - lastCollectAt) / 1000))
    : 0;
  const inCooldown = cooldownRemainSec > 0;

  // 페이지 로드시 localStorage에서 마지막 수집 시각 복원 (캠프별)
  useEffect(() => {
    if (!election) return;
    const key = `last_collect_${election.id}`;
    const raw = localStorage.getItem(key);
    if (raw) setLastCollectAt(parseInt(raw, 10) || 0);
  }, [election?.id]);

  // 수동 수집 실행 (확인 다이얼로그 + 쿨다운)
  async function handleManualCollect() {
    if (!election) return;
    if (inCooldown) {
      const mins = Math.ceil(cooldownRemainSec / 60);
      alert(`최근 ${cooldownMinutes - mins}분 전에 수집했습니다. ${mins}분 후 다시 시도 가능합니다.\n\n(API 쿼터 보호를 위한 쿨다운)`);
      return;
    }
    const ok = confirm(
      '즉시 수집을 실행합니다.\n\n' +
      '• 뉴스 + 커뮤니티 + 유튜브 + 트렌드 전체\n' +
      '• 약 1~3분 소요\n' +
      '• YouTube API 쿼터를 소모합니다\n' +
      '• 자동 스케줄(07/13/17시)과 별도\n\n' +
      '계속하시겠습니까?'
    );
    if (!ok) return;
    setCollecting(true);
    setCollectMsg('수집 요청 전송...');
    try {
      await api.collectNow(election.id, 'all');
      const now = Date.now();
      setLastCollectAt(now);
      localStorage.setItem(`last_collect_${election.id}`, String(now));
      setCollectMsg('백그라운드 수집 중... 1~3분 후 각 페이지에서 확인 가능.');
      setTimeout(() => setCollectMsg(''), 10000);
    } catch (e: any) {
      setCollectMsg('수집 실패: ' + (e?.message || ''));
      setTimeout(() => setCollectMsg(''), 5000);
    } finally { setCollecting(false); }
  }

  useEffect(() => {
    if (election) loadSchedules();
  }, [election]);

  const loadSchedules = async () => {
    if (!election) return;
    try {
      const data = await api.getSchedules(election.id);
      setSchedules(data);
    } catch (e: any) {
      console.error('schedules load error:', e);
    } finally { setLoading(false); }
  };

  const handleCreateDefaults = async () => {
    if (!election) return;
    setCreating(true);
    try {
      const result = await api.createDefaultSchedules(election.id);
      setMessage(result.message);
      loadSchedules();
    } catch (e: any) {
      setMessage('기본 스케줄 생성 실패: ' + (e?.message || ''));
    } finally { setCreating(false); }
  };

  const handleToggle = async (scheduleId: string, currentEnabled: boolean) => {
    if (!election) return;
    try {
      await api.updateSchedule(election.id, scheduleId, { enabled: !currentEnabled });
      loadSchedules();
    } catch (e: any) {
      alert('변경 실패: ' + (e?.message || ''));
    }
  };

  const handleEdit = (s: any) => {
    setEditing(s);
    setEditForm({
      name: s.name || '',
      fixed_times: (s.fixed_times || []).join(', '),
      schedule_type: s.schedule_type || 'news',
    });
  };

  const handleSaveEdit = async () => {
    if (!election || !editing) return;
    try {
      await api.updateSchedule(election.id, editing.id, {
        name: editForm.name,
        fixed_times: editForm.fixed_times.split(',').map(t => t.trim()).filter(Boolean),
        schedule_type: editForm.schedule_type,
      });
      setEditing(null);
      loadSchedules();
    } catch (e: any) {
      alert('수정 실패: ' + (e?.message || ''));
    }
  };

  const handleDelete = async (scheduleId: string) => {
    if (!election || !confirm('이 스케줄을 삭제하시겠습니까?')) return;
    try {
      await api.deleteSchedule(election.id, scheduleId);
      loadSchedules();
    } catch (e: any) {
      alert('삭제 실패: ' + (e?.message || ''));
    }
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
    } catch (e: any) {
      alert('스케줄 추가 실패: ' + (e?.message || ''));
    }
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">수집 스케줄</h1>
          <p className="text-[var(--muted)] mt-1 text-sm">
            활성 {activeCount}개 | 일 {totalRuns}회 자동 실행 | 운영시간 09:00~20:00
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* 즉시 수집 — 확인 다이얼로그 + 1시간 쿨다운 (API 쿼터 보호) */}
          <button
            onClick={handleManualCollect}
            disabled={collecting || inCooldown}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title={inCooldown ? `쿨다운 ${Math.ceil(cooldownRemainSec/60)}분 남음` : '뉴스+커뮤니티+유튜브+트렌드 즉시 수집'}
          >
            {collecting ? '수집중...' : inCooldown ? `쿨다운 ${Math.ceil(cooldownRemainSec/60)}분` : '지금 수집'}
          </button>
          <button onClick={() => setShowAdd(true)} className="btn-secondary text-sm">+ 스케줄 추가</button>
          {schedules.length === 0 && (
            <button onClick={handleCreateDefaults} disabled={creating} className="btn-primary text-sm">
              {creating ? '생성 중...' : '기본 스케줄 자동 생성'}
            </button>
          )}
        </div>
      </div>
      {collectMsg && (
        <div className={`text-xs p-2 rounded ${collectMsg.includes('실패') ? 'bg-red-500/10 text-red-500' : 'bg-blue-500/10 text-blue-500'}`}>
          {collecting && <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-2 align-middle" />}
          {collectMsg}
        </div>
      )}

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
              <span className="text-xl">{TYPE_ICONS[s.schedule_type] || ''}</span>
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
              <button onClick={() => handleEdit(s)} className="text-xs text-blue-500 hover:text-blue-700">편집</button>
              <button onClick={() => handleDelete(s.id)} className="text-xs text-gray-400 hover:text-red-500">삭제</button>
            </div>
          </div>
        ))}
      </div>

      {/* 편집 모달 */}
      {editing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="card w-96">
            <h3 className="font-bold text-lg mb-4">스케줄 편집</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">이름</label>
                <input className="input-field w-full" value={editForm.name}
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">유형</label>
                <select className="input-field w-full" value={editForm.schedule_type}
                  onChange={e => setEditForm({ ...editForm, schedule_type: e.target.value })}>
                  <option value="full_with_briefing">전체 수집 + 브리핑 (추천)</option>
                  <option value="full_collection">전체 수집만</option>
                  <option value="news">뉴스만</option>
                  <option value="community">커뮤니티만</option>
                  <option value="youtube">유튜브만</option>
                  <option value="trends">검색 트렌드만</option>
                  <option value="briefing">브리핑만</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">실행 시간 (HH:MM, 콤마 구분)</label>
                <input className="input-field w-full font-mono" value={editForm.fixed_times}
                  onChange={e => setEditForm({ ...editForm, fixed_times: e.target.value })}
                  placeholder="07:00, 13:00, 18:00" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleSaveEdit} className="flex-1 btn-primary">저장</button>
              <button onClick={() => setEditing(null)} className="btn-secondary">취소</button>
            </div>
          </div>
        </div>
      )}

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
                <option value="full_with_briefing">전체 수집 + 브리핑 (추천)</option>
                <option value="full_collection">전체 수집만</option>
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
