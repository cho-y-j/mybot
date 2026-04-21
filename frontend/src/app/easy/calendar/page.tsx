'use client';
/**
 * /easy/calendar — dashboard 페이지 재사용 + sticky 헤더로 "오늘 N개 · 다음 D-X"
 */
import { useEffect, useState } from 'react';
import { api } from '@/services/api';
import { useElection } from '@/hooks/useElection';
import { dDayLabel } from '@/lib/schedules';
import CalendarPage from '@/app/dashboard/calendar/page';

export default function EasyCalendarPage() {
  const { election } = useElection();
  const [todayCount, setTodayCount] = useState<number | null>(null);
  const [nextAt, setNextAt] = useState<string | null>(null);

  useEffect(() => {
    if (!election?.id) return;
    (async () => {
      try {
        const now = new Date();
        const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
        const in14 = new Date(now); in14.setDate(in14.getDate() + 14);
        const items = await api.listCandidateSchedules(election.id, {
          from: todayStart.toISOString(),
          to: in14.toISOString(),
        });
        const today = items.filter((s) => {
          const st = new Date(s.starts_at);
          return st.toDateString() === now.toDateString() && s.status !== 'canceled';
        });
        setTodayCount(today.length);

        const upcoming = items
          .filter((s) => new Date(s.starts_at) > now && s.status !== 'canceled')
          .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
        setNextAt(upcoming[0]?.starts_at || null);
      } catch {}
    })();
  }, [election?.id]);

  return (
    <div>
      {/* Sticky 요약 헤더 — easy 모드 큰 폰트 */}
      {(todayCount !== null || nextAt) && (
        <div className="sticky top-0 z-10 -mx-4 px-4 py-3 mb-4 bg-[var(--background)] border-b border-[var(--card-border)]">
          <div className="flex items-center gap-4 flex-wrap text-base">
            <div>
              <span className="text-[var(--muted)]">오늘</span>{' '}
              <span className="font-bold text-xl text-blue-500">{todayCount ?? 0}</span>
              <span className="text-[var(--muted)]">건</span>
            </div>
            {nextAt && (
              <div>
                <span className="text-[var(--muted)]">다음 일정</span>{' '}
                <span className="font-bold text-xl text-emerald-500">{dDayLabel(nextAt)}</span>
              </div>
            )}
          </div>
        </div>
      )}
      <CalendarPage />
    </div>
  );
}
