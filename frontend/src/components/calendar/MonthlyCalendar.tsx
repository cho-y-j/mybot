'use client';
/**
 * 월간 달력 — FullCalendar daygrid
 *
 * 제약 (사용자 피드백 "익숙한 달력이 편하다"):
 *   - 월간 뷰만 (주/일/리스트 플러그인 미설치)
 *   - 드래그/리사이즈 비활성 (editable=false) — 실수 방지
 *   - 이벤트 클릭 → BottomSheet 상세
 *   - 날짜 셀 클릭 → 아래 패널에 해당 날짜 일정 리스트 (과거·미래 자유 탐색)
 */
import { useMemo, useState, useCallback } from 'react';
import FullCalendarRaw from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import koLocale from '@fullcalendar/core/locales/ko';

// FullCalendar v6 types not perfectly compatible with strict React 18 types — cast as component
const FullCalendar = FullCalendarRaw as unknown as React.ComponentType<any>;

import { CATEGORY_COLORS, ScheduleCategory, CATEGORY_LABELS, formatTimeRange, formatDateLabel } from '@/lib/schedules';
import ScheduleCard from '@/components/calendar/ScheduleCard';

// tailwind bg-{color} → 실제 hex (FullCalendar는 class가 아니라 color string을 이벤트별로 받음)
const COLOR_HEX: Record<ScheduleCategory, string> = {
  rally: '#f43f5e',       // rose-500
  street: '#f59e0b',      // amber-500
  debate: '#6366f1',      // indigo-500
  broadcast: '#06b6d4',   // cyan-500
  interview: '#14b8a6',   // teal-500
  meeting: '#64748b',     // slate-500
  supporter: '#10b981',   // emerald-500
  voting: '#8b5cf6',      // violet-500
  internal: '#71717a',    // zinc-500
  other: '#9ca3af',       // gray-400
};

interface Props {
  schedules: any[];
  onLoadRange: (fromIso: string, toIso: string) => Promise<any[]>;
  onSelect: (schedule: any) => void;
  onAddForDate?: (dateIso: string) => void;
}

export default function MonthlyCalendar({ schedules, onLoadRange, onSelect, onAddForDate }: Props) {
  const [selectedDate, setSelectedDate] = useState<string | null>(
    // 기본값: 오늘 (YYYY-MM-DD 로컬)
    () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
  );

  // FullCalendar events 형식 변환
  const events = useMemo(() => {
    return schedules
      .filter((s) => s.status !== 'canceled')
      .map((s) => ({
        id: s.id,
        title: s.title,
        start: s.starts_at,
        end: s.ends_at,
        allDay: s.all_day,
        color: COLOR_HEX[s.category as ScheduleCategory] || '#9ca3af',
        borderColor: COLOR_HEX[s.category as ScheduleCategory] || '#9ca3af',
        extendedProps: { raw: s },
      }));
  }, [schedules]);

  // 선택된 날짜의 일정
  const itemsForSelectedDate = useMemo(() => {
    if (!selectedDate) return [];
    return schedules
      .filter((s) => {
        const d = new Date(s.starts_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return key === selectedDate && s.status !== 'canceled';
      })
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  }, [selectedDate, schedules]);

  // 월 이동 시 해당 월 데이터 lazy-load (현재는 부모가 넓게 로드하므로 noop 여지)
  const handleDatesSet = useCallback(async (arg: { startStr: string; endStr: string }) => {
    try { await onLoadRange(arg.startStr, arg.endStr); } catch {}
  }, [onLoadRange]);

  const handleEventClick = (info: any) => {
    const raw = info.event.extendedProps.raw;
    if (raw) onSelect(raw);
  };

  const handleDateClick = (info: any) => {
    setSelectedDate(info.dateStr);
  };

  return (
    <div className="space-y-4 calendar-root">
      {/* CSS 커스텀 — 다크모드 + CLAUDE.md 테마 일관성 */}
      <style jsx global>{`
        .calendar-root .fc {
          --fc-border-color: var(--card-border);
          --fc-today-bg-color: rgba(59, 130, 246, 0.08);
          --fc-neutral-bg-color: var(--muted-bg);
          --fc-page-bg-color: var(--background);
          font-family: inherit;
        }
        .calendar-root .fc-theme-standard th,
        .calendar-root .fc-theme-standard td {
          border-color: var(--card-border);
        }
        .calendar-root .fc .fc-col-header-cell-cushion,
        .calendar-root .fc .fc-daygrid-day-number {
          color: var(--foreground);
          text-decoration: none;
          font-size: 0.8rem;
          padding: 4px 6px;
        }
        .calendar-root .fc .fc-daygrid-day.fc-day-today {
          background: var(--fc-today-bg-color);
        }
        .calendar-root .fc .fc-button {
          background: var(--card-bg);
          color: var(--foreground);
          border: 1px solid var(--card-border);
          text-transform: none;
          padding: 4px 10px;
          font-size: 0.8rem;
        }
        .calendar-root .fc .fc-button:hover {
          background: var(--muted-bg);
        }
        .calendar-root .fc .fc-button-primary:not(:disabled).fc-button-active,
        .calendar-root .fc .fc-button-primary:not(:disabled):active {
          background: rgb(59, 130, 246);
          color: white;
          border-color: rgb(59, 130, 246);
        }
        .calendar-root .fc .fc-toolbar-title {
          font-size: 1.1rem;
          font-weight: 600;
        }
        .calendar-root .fc .fc-event {
          border-radius: 3px;
          padding: 1px 4px;
          font-size: 0.72rem;
          cursor: pointer;
          border-width: 0 0 0 3px;
        }
        .calendar-root .fc .fc-daygrid-day-frame {
          min-height: 80px;
        }
        .calendar-root .fc-day-sun .fc-daygrid-day-number { color: #ef4444; }
        .calendar-root .fc-day-sat .fc-daygrid-day-number { color: #3b82f6; }

        /* 사용자가 선택한 날짜 하이라이트 */
        .calendar-root .fc .fc-day-selected-by-user {
          background: rgba(59, 130, 246, 0.15) !important;
        }
      `}</style>

      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        locale={koLocale}
        height="auto"
        events={events}
        editable={false}
        selectable={false}
        eventClick={handleEventClick}
        dateClick={handleDateClick}
        datesSet={handleDatesSet}
        dayCellClassNames={(arg: { date: Date }) => {
          const key = `${arg.date.getFullYear()}-${String(arg.date.getMonth() + 1).padStart(2, '0')}-${String(arg.date.getDate()).padStart(2, '0')}`;
          return key === selectedDate ? ['fc-day-selected-by-user'] : [];
        }}
        dayMaxEventRows={3}
        moreLinkText={(n: number) => `+${n}건`}
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: '',
        }}
        buttonText={{ today: '오늘' }}
      />

      {/* 선택된 날짜 일정 리스트 */}
      <div className="border border-[var(--card-border)] rounded-xl bg-[var(--card-bg)] p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <p className="text-sm font-semibold">
              {selectedDate ? formatDateLabel(`${selectedDate}T00:00:00+09:00`) : '날짜 선택'}
              <span className="text-xs text-[var(--muted)] ml-2">
                {selectedDate && `${selectedDate}`}
              </span>
            </p>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {itemsForSelectedDate.length > 0
                ? `${itemsForSelectedDate.length}건 — 클릭하여 상세·수정·회고`
                : '일정이 없습니다'}
            </p>
          </div>
          {onAddForDate && selectedDate && (
            <button
              onClick={() => onAddForDate(selectedDate)}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700"
            >
              + 이 날짜에 추가
            </button>
          )}
        </div>

        {itemsForSelectedDate.length === 0 ? (
          <div className="text-center py-8 text-sm text-[var(--muted)]">
            달력에서 다른 날짜를 클릭해 해당 날짜 일정을 확인하세요.
          </div>
        ) : (
          <div className="space-y-2">
            {itemsForSelectedDate.map((s) => (
              <ScheduleCard key={s.id} schedule={s} onClick={() => onSelect(s)} />
            ))}
          </div>
        )}
      </div>

      {/* 카테고리 범례 */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-[var(--muted)]">
        {(Object.keys(CATEGORY_LABELS) as ScheduleCategory[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ background: COLOR_HEX[k] }}
            />
            {CATEGORY_LABELS[k]}
          </span>
        ))}
      </div>
    </div>
  );
}
