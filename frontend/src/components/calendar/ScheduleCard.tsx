'use client';
/**
 * 일정 카드 — 목록 및 결과 미입력 상태 표시
 */
import {
  CATEGORY_LABELS, CATEGORY_COLORS, ScheduleCategory,
  formatTimeRange, dDayLabel, MOOD_LABELS,
} from '@/lib/schedules';

export default function ScheduleCard({
  schedule,
  size = 'md',
  onClick,
}: {
  schedule: any;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
}) {
  const needsResult =
    schedule.status === 'done' && !schedule.result_mood && !schedule.result_summary;
  const isPast = new Date(schedule.ends_at).getTime() < Date.now();
  const isCanceled = schedule.status === 'canceled';

  const sizeCls =
    size === 'lg' ? 'p-4 text-base'
    : size === 'sm' ? 'p-2 text-xs'
    : 'p-3 text-sm';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left flex items-stretch gap-3 rounded-lg border transition
        ${sizeCls}
        ${isCanceled
          ? 'border-[var(--card-border)] bg-[var(--muted-bg)] opacity-50'
          : needsResult
            ? 'border-rose-500/40 bg-rose-500/5 hover:border-rose-500'
            : 'border-[var(--card-border)] bg-[var(--card-bg)] hover:border-blue-300'}`}
    >
      {/* 카테고리 색상 바 */}
      <div className={`w-1 rounded shrink-0 ${CATEGORY_COLORS[schedule.category as ScheduleCategory] || 'bg-gray-400'}`} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-semibold truncate ${isCanceled ? 'line-through' : ''}`}>
            {schedule.title}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded bg-[var(--muted-bg)] ${size === 'lg' ? 'text-xs' : ''}`}>
            {CATEGORY_LABELS[schedule.category as ScheduleCategory] || '기타'}
          </span>
          {schedule.visibility === 'public' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500">공개</span>
          )}
          {schedule.recurrence_rule && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500">반복</span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[var(--muted)] mt-1">
          <span>{formatTimeRange(schedule.starts_at, schedule.ends_at, schedule.all_day)}</span>
          {schedule.location && (
            <>
              <span>·</span>
              <span className="truncate max-w-[40%]">{schedule.location}</span>
            </>
          )}
          {schedule.admin_dong && !isPast && (
            <span className="text-[10px] text-emerald-500">· {schedule.admin_dong}</span>
          )}
        </div>

        {schedule.result_mood && (
          <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
            결과: {MOOD_LABELS[schedule.result_mood as keyof typeof MOOD_LABELS]}
            {schedule.result_summary ? ` — ${schedule.result_summary}` : ''}
          </div>
        )}

        {needsResult && (
          <div className="mt-2 text-xs text-rose-500 font-semibold">
            결과 입력 필요 · 탭하여 기록
          </div>
        )}
      </div>

      <div className="text-right text-[var(--muted)] shrink-0 ml-2">
        {!isPast && !isCanceled && (
          <div className={`${size === 'lg' ? 'text-sm font-semibold' : 'text-xs'}`}>
            {dDayLabel(schedule.starts_at)}
          </div>
        )}
      </div>
    </button>
  );
}
