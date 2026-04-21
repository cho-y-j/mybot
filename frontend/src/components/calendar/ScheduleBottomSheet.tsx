'use client';
/**
 * 일정 상세·편집·결과 입력 Bottom Sheet
 */
import { useEffect, useState } from 'react';
import { api } from '@/services/api';
import {
  CATEGORY_LABELS, CATEGORY_COLORS, ScheduleCategory,
  MOOD_LABELS, MOOD_COLORS, ResultMood, STATUS_LABELS,
  formatTimeRange, formatDateLabel,
} from '@/lib/schedules';

export default function ScheduleBottomSheet({
  schedule, onClose, onChanged,
}: {
  schedule: any | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 결과 입력 전용 state
  const [mood, setMood] = useState<ResultMood | ''>('');
  const [summary, setSummary] = useState('');
  const [attended, setAttended] = useState('');

  // 수정 모드
  const [editing, setEditing] = useState(false);
  const [eTitle, setETitle] = useState('');
  const [eLocation, setELocation] = useState('');
  const [eDate, setEDate] = useState('');
  const [eStart, setEStart] = useState('');
  const [eEnd, setEEnd] = useState('');
  const [eCategory, setECategory] = useState<ScheduleCategory>('other');
  const [eVisibility, setEVisibility] = useState<'public' | 'internal'>('internal');

  useEffect(() => {
    if (!schedule) return;
    setMood((schedule.result_mood as ResultMood) || '');
    setSummary(schedule.result_summary || '');
    setAttended(schedule.attended_count ? String(schedule.attended_count) : '');
    setETitle(schedule.title);
    setELocation(schedule.location || '');
    const s = new Date(schedule.starts_at);
    const e = new Date(schedule.ends_at);
    const pad = (n: number) => String(n).padStart(2, '0');
    setEDate(`${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`);
    setEStart(`${pad(s.getHours())}:${pad(s.getMinutes())}`);
    setEEnd(`${pad(e.getHours())}:${pad(e.getMinutes())}`);
    setECategory(schedule.category);
    setEVisibility(schedule.visibility);
    setEditing(false);
    setError(null);
  }, [schedule?.id]);

  if (!schedule) return null;

  const isPast = new Date(schedule.ends_at).getTime() < Date.now();
  const isCanceled = schedule.status === 'canceled';

  const handleSaveResult = async () => {
    setSaving(true); setError(null);
    try {
      await api.updateCandidateScheduleResult(schedule.id, {
        result_mood: mood || undefined,
        result_summary: summary || undefined,
        attended_count: attended ? parseInt(attended, 10) : undefined,
      });
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e?.message || '저장 실패');
    } finally { setSaving(false); }
  };

  const handleSaveEdit = async () => {
    setSaving(true); setError(null);
    try {
      const startIso = new Date(`${eDate}T${eStart}:00+09:00`).toISOString();
      const endIso = new Date(`${eDate}T${eEnd}:00+09:00`).toISOString();
      await api.updateCandidateSchedule(schedule.id, {
        title: eTitle,
        location: eLocation || null,
        starts_at: startIso,
        ends_at: endIso,
        category: eCategory,
        visibility: eVisibility,
      });
      onChanged();
      setEditing(false);
    } catch (e: any) {
      setError(e?.message || '저장 실패');
    } finally { setSaving(false); }
  };

  const handleCancel = async () => {
    if (!confirm('이 일정을 취소하시겠습니까? (복구 불가)')) return;
    setSaving(true);
    try {
      await api.cancelCandidateSchedule(schedule.id);
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e?.message || '취소 실패');
    } finally { setSaving(false); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-[var(--background)] border border-[var(--card-border)] w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-start gap-3 mb-3">
          <div className={`w-1.5 h-12 rounded ${CATEGORY_COLORS[schedule.category as ScheduleCategory] || 'bg-gray-400'} shrink-0`} />
          <div className="flex-1 min-w-0">
            {editing ? (
              <input value={eTitle} onChange={(e) => setETitle(e.target.value)}
                className="w-full font-bold text-lg bg-transparent border-b border-[var(--card-border)] focus:outline-none" />
            ) : (
              <h3 className={`text-lg font-bold ${isCanceled ? 'line-through text-[var(--muted)]' : ''}`}>
                {schedule.title}
              </h3>
            )}
            <div className="text-xs text-[var(--muted)] mt-0.5">
              {formatDateLabel(schedule.starts_at)} · {formatTimeRange(schedule.starts_at, schedule.ends_at, schedule.all_day)}
              {' · '}
              {STATUS_LABELS[schedule.status as keyof typeof STATUS_LABELS]}
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--muted)] text-2xl leading-none shrink-0">×</button>
        </div>

        {/* 편집 or 상세 */}
        {!editing ? (
          <div className="space-y-3">
            {schedule.location && (
              <div className="text-sm">
                <span className="text-[var(--muted)]">장소 · </span>
                {schedule.location_url ? (
                  <a href={schedule.location_url} target="_blank" rel="noopener"
                    className="text-blue-500 underline">{schedule.location}</a>
                ) : schedule.location}
                {schedule.admin_dong && (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 ml-2">
                    ({schedule.admin_sigungu} {schedule.admin_dong})
                  </span>
                )}
              </div>
            )}
            {schedule.description && (
              <div className="text-sm whitespace-pre-wrap text-[var(--muted)]">{schedule.description}</div>
            )}

            {/* 결과 입력 섹션 (완료 일정 한정) */}
            {(isPast || schedule.status === 'done') && !isCanceled && (
              <div className="border-t border-[var(--card-border)] pt-3">
                <p className="text-sm font-semibold mb-2">결과 기록</p>
                <div className="flex gap-2 mb-2">
                  {(['good', 'normal', 'bad'] as ResultMood[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMood(m)}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm transition ${
                        mood === m ? MOOD_COLORS[m] : 'border border-[var(--card-border)] bg-[var(--card-bg)]'
                      }`}
                    >
                      {MOOD_LABELS[m]}
                    </button>
                  ))}
                </div>
                <textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="한 줄 회고 (예: 참석자 30명, 호응 좋았음)"
                  className="w-full px-3 py-2 border rounded bg-[var(--card-bg)] border-[var(--card-border)] text-sm"
                  rows={2}
                />
                <div className="flex items-center gap-2 mt-2">
                  <label className="text-xs text-[var(--muted)]">참석자 수</label>
                  <input type="number" min={0} value={attended} onChange={(e) => setAttended(e.target.value)}
                    className="w-20 px-2 py-1 border rounded bg-[var(--card-bg)] border-[var(--card-border)] text-sm" />
                </div>
                <button onClick={handleSaveResult} disabled={saving}
                  className="mt-2 w-full px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                  {saving ? '저장 중…' : '결과 저장'}
                </button>
              </div>
            )}

            {/* 액션 */}
            <div className="flex gap-2 pt-3 border-t border-[var(--card-border)]">
              {!isCanceled && (
                <button onClick={() => setEditing(true)}
                  className="flex-1 px-3 py-2 border border-[var(--card-border)] rounded-lg text-sm hover:bg-[var(--muted-bg)]">
                  수정
                </button>
              )}
              {!isCanceled && (
                <button onClick={handleCancel} disabled={saving}
                  className="flex-1 px-3 py-2 border border-rose-500/40 text-rose-500 rounded-lg text-sm hover:bg-rose-500/10">
                  일정 취소
                </button>
              )}
            </div>
          </div>
        ) : (
          // 편집 모드
          <div className="space-y-3">
            <div>
              <label className="text-xs text-[var(--muted)] mb-1 block">장소</label>
              <input value={eLocation} onChange={(e) => setELocation(e.target.value)}
                className="w-full px-3 py-2 border rounded bg-[var(--card-bg)] border-[var(--card-border)] text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-[var(--muted)] mb-1 block">날짜</label>
                <input type="date" value={eDate} onChange={(e) => setEDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded bg-[var(--card-bg)] border-[var(--card-border)] text-sm" />
              </div>
              <div>
                <label className="text-xs text-[var(--muted)] mb-1 block">카테고리</label>
                <select value={eCategory} onChange={(e) => setECategory(e.target.value as ScheduleCategory)}
                  className="w-full px-3 py-2 border rounded bg-[var(--card-bg)] border-[var(--card-border)] text-sm">
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--muted)] mb-1 block">시작 시간</label>
                <input type="time" value={eStart} onChange={(e) => setEStart(e.target.value)}
                  className="w-full px-3 py-2 border rounded bg-[var(--card-bg)] border-[var(--card-border)] text-sm" />
              </div>
              <div>
                <label className="text-xs text-[var(--muted)] mb-1 block">종료 시간</label>
                <input type="time" value={eEnd} onChange={(e) => setEEnd(e.target.value)}
                  className="w-full px-3 py-2 border rounded bg-[var(--card-bg)] border-[var(--card-border)] text-sm" />
              </div>
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={eVisibility === 'public'}
                  onChange={(e) => setEVisibility(e.target.checked ? 'public' : 'internal')} />
                홈페이지 공개
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSaveEdit} disabled={saving}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                {saving ? '저장 중…' : '저장'}
              </button>
              <button onClick={() => setEditing(false)}
                className="px-4 py-2 border border-[var(--card-border)] rounded-lg text-sm">
                취소
              </button>
            </div>
          </div>
        )}

        {error && <div className="mt-3 text-sm text-rose-500 bg-rose-500/10 px-3 py-2 rounded">{error}</div>}
      </div>
    </div>
  );
}
