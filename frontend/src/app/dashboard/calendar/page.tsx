'use client';
/**
 * /dashboard/calendar — 후보자 일정 관리 (3탭 구조)
 *   탭1: 오늘 — 다음 일정 3개 크게 + 어제 회고 + 하루 타임라인(접힘)
 *   탭2: 이번주 — 요일별 그룹 리스트
 *   탭3: 지도 — Phase 3 히트맵 (Phase 1 placeholder)
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/services/api';
import { useElection } from '@/hooks/useElection';
import {
  CATEGORY_COLORS, CATEGORY_LABELS, ScheduleCategory,
  formatTimeRange, formatDateLabel, dDayLabel, groupByDate,
} from '@/lib/schedules';
import ScheduleAddPanel from '@/components/calendar/ScheduleAddPanel';
import ScheduleCard from '@/components/calendar/ScheduleCard';
import ScheduleBottomSheet from '@/components/calendar/ScheduleBottomSheet';
import MonthlyCalendar from '@/components/calendar/MonthlyCalendar';
import ScheduleHeatmap from '@/components/calendar/ScheduleHeatmap';

type Tab = 'today' | 'week' | 'month' | 'map';

export default function CalendarPage() {
  const { election, candidates, loading: elLoading } = useElection();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>('today');
  const [schedules, setSchedules] = useState<any[]>([]);
  const [yesterdayList, setYesterdayList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [showYesterday, setShowYesterday] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);

  // 외부(예: history 지도)에서 ?dong=&sigungu=&from=history 받으면 일정 추가 패널 자동 열기
  const [prefilledLocation, setPrefilledLocation] = useState<string | null>(null);
  useEffect(() => {
    const from = searchParams.get('from');
    if (from !== 'history') return;
    const dong = searchParams.get('dong') || '';
    const sigungu = searchParams.get('sigungu') || '';
    const sido = searchParams.get('sido') || '';
    const loc = [sido, sigungu, dong].filter(Boolean).join(' ').trim();
    if (loc) {
      setPrefilledLocation(loc);
      setShowAdd(true);
    }
  }, [searchParams]);

  // 로드 범위: 달력 뷰의 월 이동 시 확장. 기본은 -30일 ~ +60일
  const [loadedRange, setLoadedRange] = useState<{ from: string; to: string } | null>(null);

  const load = useCallback(async (fromOverride?: string, toOverride?: string) => {
    if (!election?.id) return;
    setLoading(true);
    try {
      const now = new Date();
      const from = fromOverride ? new Date(fromOverride) : (() => {
        const d = new Date(now);
        d.setDate(d.getDate() - 30);
        d.setHours(0, 0, 0, 0);
        return d;
      })();
      const to = toOverride ? new Date(toOverride) : (() => {
        const d = new Date(now);
        d.setDate(d.getDate() + 60);
        d.setHours(23, 59, 59, 999);
        return d;
      })();

      const [items, yest] = await Promise.all([
        api.listCandidateSchedules(election.id, {
          from: from.toISOString(),
          to: to.toISOString(),
        }),
        api.listYesterdayCandidateSchedules(election.id),
      ]);
      setSchedules(items || []);
      setYesterdayList(yest || []);
      setLoadedRange({ from: from.toISOString(), to: to.toISOString() });
      // 어제 회고는 기본 접힘 — 상단 빨간 배너로 힌트, 사용자가 탭 시 펼침
    } catch (e) {
      console.error('load schedules', e);
    } finally {
      setLoading(false);
    }
  }, [election?.id]);

  /** 타임라인에서 빈 시간 슬롯 클릭 → 오늘 {hour}:00에 1시간짜리 일정 즉시 생성 */
  const handleQuickAdd = useCallback(async (hour: number, title: string) => {
    if (!election?.id) return;
    const candidateId = election.our_candidate_id || candidates[0]?.id;
    if (!candidateId) return;
    const now = new Date();
    const startsAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0);
    const endsAt = new Date(startsAt);
    endsAt.setHours(endsAt.getHours() + 1);
    await api.createCandidateSchedule(election.id, {
      candidate_id: candidateId,
      title,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      category: 'other',
    });
    await load();
  }, [election?.id, election?.our_candidate_id, candidates, load]);

  /** 달력 뷰에서 월 이동 시 호출 — 현재 로드 범위 밖이면 확장 로드 */
  const handleCalendarRange = useCallback(async (fromIso: string, toIso: string) => {
    if (!election?.id) return [];
    const needsReload =
      !loadedRange ||
      new Date(fromIso) < new Date(loadedRange.from) ||
      new Date(toIso) > new Date(loadedRange.to);
    if (needsReload) {
      // 새 월 범위 + 기존 범위 여유 포함
      const newFrom = new Date(fromIso);
      newFrom.setDate(newFrom.getDate() - 7);
      const newTo = new Date(toIso);
      newTo.setDate(newTo.getDate() + 7);
      await load(newFrom.toISOString(), newTo.toISOString());
    }
    return [];
  }, [election?.id, loadedRange, load]);

  useEffect(() => { load(); }, [load]);

  // 오늘 일정
  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }, []);
  const todayEnd = useMemo(() => {
    const d = new Date(); d.setHours(23, 59, 59, 999); return d;
  }, []);

  const todayItems = useMemo(() =>
    schedules.filter((s) => {
      const st = new Date(s.starts_at);
      return st >= todayStart && st <= todayEnd && s.status !== 'canceled';
    }).sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()),
    [schedules, todayStart, todayEnd],
  );

  // 다음 일정 3개 (현재 시각 이후)
  const nextUpcoming = useMemo(() => {
    const now = new Date();
    return schedules
      .filter((s) => new Date(s.starts_at) > now && s.status !== 'canceled')
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
      .slice(0, 3);
  }, [schedules]);

  // 이번주 (오늘~+7일)
  const weekItems = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setDate(end.getDate() + 7);
    return schedules
      .filter((s) => {
        const st = new Date(s.starts_at);
        return st >= now && st <= end && s.status !== 'canceled';
      })
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  }, [schedules]);

  const yesterdayNeedingResult = yesterdayList.filter(
    (s) => s.status === 'done' && !s.result_mood && !s.result_summary,
  );

  if (elLoading) return <div className="animate-pulse text-sm">로딩 중…</div>;
  if (!election) return <div className="text-sm text-[var(--muted)]">선거 정보 없음</div>;

  return (
    <div className="space-y-4">
      {/* 헤더 + 탭 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">일정</h1>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            한 줄 입력·카톡 복붙·음성 — 뭐든 AI가 알아서 정리
          </p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"
        >
          + 일정 추가
        </button>
      </div>

      {showAdd && (
        <ScheduleAddPanel
          electionId={election.id}
          candidates={candidates}
          defaultCandidateId={election.our_candidate_id || candidates[0]?.id}
          defaultMode={prefilledLocation ? 'manual' : undefined}
          defaultLocation={prefilledLocation || undefined}
          onSaved={() => { setShowAdd(false); setPrefilledLocation(null); load(); }}
          onClose={() => { setShowAdd(false); setPrefilledLocation(null); }}
        />
      )}

      {/* 탭 */}
      <div className="flex gap-1 border-b border-[var(--card-border)]">
        {([
          { v: 'today' as Tab, label: '오늘' },
          { v: 'week' as Tab, label: '이번주' },
          { v: 'month' as Tab, label: '달력' },
          { v: 'map' as Tab, label: '지도' },
        ]).map((t) => (
          <button
            key={t.v}
            onClick={() => setTab(t.v)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              tab === t.v
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── 오늘 탭 ─── */}
      {tab === 'today' && (
        <div className="space-y-4">
          {/* 어제 회고 미입력 힌트 배너 (상단, 얇게) */}
          {yesterdayNeedingResult.length > 0 && (
            <button
              onClick={() => {
                setShowYesterday(true);
                setTimeout(() => {
                  document.getElementById('yesterday-review')?.scrollIntoView({ behavior: 'smooth' });
                }, 50);
              }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-sm hover:bg-rose-500/15"
            >
              <span className="text-rose-600 dark:text-rose-400 font-medium">
                어제 결과 미입력 {yesterdayNeedingResult.length}건
              </span>
              <span className="text-xs text-rose-500">아래로 이동 →</span>
            </button>
          )}

          {/* 1. 다음 일정 3개 크게 (오늘 우선) */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-[var(--muted)]">다가오는 일정</p>
            {loading ? (
              <div className="h-20 bg-[var(--muted-bg)] rounded-xl animate-pulse" />
            ) : nextUpcoming.length === 0 ? (
              <div className="border border-dashed border-[var(--card-border)] rounded-xl p-6 text-center text-sm text-[var(--muted)]">
                다가오는 일정이 없습니다. "일정 추가" 버튼으로 첫 일정을 등록하세요.
              </div>
            ) : (
              nextUpcoming.map((s) => (
                <ScheduleCard key={s.id} schedule={s} size="lg" onClick={() => setSelected(s)} />
              ))
            )}
          </div>

          {/* 2. 오늘 하루 타임라인 (접힘 기본) */}
          {todayItems.length > 0 && (
            <div className="border border-[var(--card-border)] rounded-xl overflow-hidden">
              <button
                onClick={() => setShowTimeline(!showTimeline)}
                className="w-full flex items-center justify-between px-4 py-3 bg-[var(--muted-bg)] hover:bg-[var(--card-bg)] text-sm"
              >
                <span className="font-semibold">오늘 하루 타임라인 ({todayItems.length}건)</span>
                <span className="text-xs text-[var(--muted)]">{showTimeline ? '닫기' : '펼치기'}</span>
              </button>
              {showTimeline && (
                <DayTimeline items={todayItems} onPick={setSelected} onQuickAdd={handleQuickAdd} />
              )}
            </div>
          )}

          {/* 3. 어제 회고 (아래로 이동, 접힘 기본) */}
          {yesterdayList.length > 0 && (
            <div id="yesterday-review" className="border border-[var(--card-border)] rounded-xl overflow-hidden">
              <button
                onClick={() => setShowYesterday(!showYesterday)}
                className="w-full flex items-center justify-between px-4 py-3 bg-[var(--muted-bg)] hover:bg-[var(--card-bg)] text-sm"
              >
                <span className="font-semibold">
                  어제 회고 · 완료 {yesterdayList.filter((s) => s.status === 'done').length}건
                  {yesterdayNeedingResult.length > 0 && (
                    <span className="ml-2 text-rose-500">
                      (결과 미입력 {yesterdayNeedingResult.length}건)
                    </span>
                  )}
                </span>
                <span className="text-xs text-[var(--muted)]">{showYesterday ? '닫기' : '펼치기'}</span>
              </button>
              {showYesterday && (
                <div className="p-3 space-y-2">
                  {yesterdayList.map((s) => (
                    <ScheduleCard key={s.id} schedule={s} onClick={() => setSelected(s)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── 이번주 탭 ─── */}
      {tab === 'week' && (
        <div className="space-y-4">
          {loading ? (
            <div className="h-20 bg-[var(--muted-bg)] rounded-xl animate-pulse" />
          ) : weekItems.length === 0 ? (
            <div className="border border-dashed border-[var(--card-border)] rounded-xl p-6 text-center text-sm text-[var(--muted)]">
              이번주 일정이 없습니다.
            </div>
          ) : (
            Object.entries(groupByDate(weekItems)).map(([dateKey, items]) => (
              <div key={dateKey} className="space-y-2">
                <p className="text-sm font-semibold">
                  {formatDateLabel(items[0].starts_at)}
                  <span className="text-xs text-[var(--muted)] ml-2">
                    {items.length}건
                  </span>
                </p>
                {items.map((s: any) => (
                  <ScheduleCard key={s.id} schedule={s} onClick={() => setSelected(s)} />
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {/* ─── 달력 탭 (월간 뷰) ─── */}
      {tab === 'month' && (
        <MonthlyCalendar
          schedules={schedules}
          onLoadRange={handleCalendarRange}
          onSelect={setSelected}
          onAddForDate={(dateIso) => {
            setShowAdd(true);
            // 날짜 프리필은 ScheduleAddPanel 내부 수동 모드에서 자동 적용은 향후 개선
            // Phase 1에서는 달력에서 날짜 클릭 후 "이 날짜에 추가" → 추가 패널 스크롤로 이동
            setTimeout(() => {
              document.querySelector('.border-blue-500\\/30')?.scrollIntoView({ behavior: 'smooth' });
            }, 50);
          }}
        />
      )}

      {/* ─── 지도 탭 ─── */}
      {tab === 'map' && (
        <ScheduleHeatmap
          electionId={election.id}
          onSelectSchedule={setSelected}
          onAddForLocation={(loc) => {
            setShowAdd(true);
            setTimeout(() => {
              document.querySelector('.border-blue-500\\/30')?.scrollIntoView({ behavior: 'smooth' });
            }, 50);
          }}
        />
      )}

      {/* 상세 Bottom Sheet */}
      <ScheduleBottomSheet
        schedule={selected}
        onClose={() => setSelected(null)}
        onChanged={load}
      />
    </div>
  );
}


/** 오늘 하루 타임라인 — 06:00~22:00 세로 축 + 빈 슬롯 클릭 즉시 추가 */
function DayTimeline({
  items, onPick, onQuickAdd,
}: {
  items: any[];
  onPick: (s: any) => void;
  onQuickAdd: (hour: number, title: string) => Promise<void>;
}) {
  const HOURS = Array.from({ length: 17 }, (_, i) => 6 + i); // 06~22
  const [editingHour, setEditingHour] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const commit = async () => {
    const title = editText.trim();
    if (editingHour === null || !title || saving) return;
    setSaving(true);
    setErr(null);
    try {
      await onQuickAdd(editingHour, title);
      setEditingHour(null);
      setEditText('');
    } catch (e: any) {
      setErr(e?.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => { setEditingHour(null); setEditText(''); setErr(null); };

  return (
    <div className="p-3">
      <div className="relative">
        {HOURS.map((h) => {
          const hourItems = items.filter((s) => new Date(s.starts_at).getHours() === h);
          const hh = String(h).padStart(2, '0');
          return (
            <div key={h} className="flex items-start gap-3 py-2 border-t border-[var(--card-border)] first:border-t-0">
              <div className="w-10 text-xs text-[var(--muted)] shrink-0 pt-0.5">
                {hh}:00
              </div>
              <div className="flex-1 min-h-[40px] space-y-1">
                {hourItems.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onPick(s)}
                    className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 border border-[var(--card-border)] hover:border-blue-300 ${
                      s.status === 'canceled' ? 'opacity-50' : ''
                    }`}
                  >
                    <div className={`w-1 h-6 rounded ${CATEGORY_COLORS[s.category as ScheduleCategory]}`} />
                    <span className="font-medium truncate">{s.title}</span>
                    <span className="text-xs text-[var(--muted)] ml-auto">
                      {formatTimeRange(s.starts_at, s.ends_at)}
                    </span>
                  </button>
                ))}

                {editingHour === h ? (
                  <div className="space-y-1">
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); commit(); }
                          else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
                        }}
                        disabled={saving}
                        placeholder={`${hh}:00 일정 제목 (Enter 저장 · Esc 취소)`}
                        className="flex-1 px-3 py-2 rounded border border-blue-500 text-sm bg-[var(--card-bg)] focus:outline-none"
                      />
                      <button
                        onClick={commit}
                        disabled={!editText.trim() || saving}
                        className="px-3 py-2 bg-blue-600 text-white rounded text-sm font-medium disabled:opacity-50"
                      >
                        {saving ? '저장…' : '저장'}
                      </button>
                      <button
                        onClick={cancel}
                        disabled={saving}
                        className="px-2 py-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
                      >
                        취소
                      </button>
                    </div>
                    {err && <p className="text-xs text-rose-500">{err}</p>}
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditingHour(h); setEditText(''); setErr(null); }}
                    className="w-full text-left text-xs text-[var(--muted)]/60 hover:text-blue-500 hover:bg-blue-500/5 rounded px-3 py-1.5 border border-dashed border-transparent hover:border-blue-300 transition"
                  >
                    + {hh}:00에 일정 추가 (1시간 · 기타)
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-[var(--muted)] mt-3">
        빠른 추가는 1시간·카테고리 “기타”로 저장됩니다. 저장 후 카드를 눌러 상세 수정하세요.
      </p>
    </div>
  );
}
