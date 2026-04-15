"use client";

import { useState } from "react";
import type { SiteData } from "@/types/site";

interface Props {
  schedules: SiteData["schedules"];
  sectionTitle?: string;
  colors?: Record<string, string>;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const weekday = weekdays[d.getDay()];
  return `${month}월 ${day}일 (${weekday})`;
}

function isPast(dateStr: string): boolean {
  const d = new Date(dateStr);
  d.setHours(23, 59, 59, 999);
  return d < new Date();
}

/* ── Calendar View ── */
function CalendarView({
  schedules,
  colors,
}: {
  schedules: SiteData["schedules"];
  colors: Record<string, string>;
}) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-indexed

  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDay = new Date(viewYear, viewMonth + 1, 0);
  const startWeekday = firstDay.getDay(); // 0=Sun
  const daysInMonth = lastDay.getDate();

  // Build schedule map for this month: { day: ScheduleItem[] }
  const dayMap: Record<number, typeof schedules> = {};
  for (const item of schedules) {
    const d = new Date(item.date);
    if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
      const day = d.getDate();
      if (!dayMap[day]) dayMap[day] = [];
      dayMap[day].push(item);
    }
  }

  function prevMonth() {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }

  const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];

  // Build grid cells
  const cells: Array<{ day: number | null }> = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ day: null });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d });

  const today = new Date();
  const isToday = (day: number) =>
    today.getFullYear() === viewYear &&
    today.getMonth() === viewMonth &&
    today.getDate() === day;

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={prevMonth}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <svg className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h3 className="text-lg font-bold text-gray-900">
          {viewYear}년 {viewMonth + 1}월
        </h3>
        <button
          onClick={nextMonth}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <svg className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-px mb-1">
        {weekdayLabels.map((w, i) => (
          <div
            key={w}
            className={`text-center text-xs font-semibold py-2 ${
              i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-gray-500"
            }`}
          >
            {w}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-xl overflow-hidden">
        {cells.map((cell, idx) => {
          if (cell.day === null) {
            return <div key={`empty-${idx}`} className="bg-gray-50 min-h-[60px] sm:min-h-[80px]" />;
          }
          const daySchedules = dayMap[cell.day] || [];
          const weekdayIdx = (startWeekday + cell.day - 1) % 7;
          return (
            <div
              key={cell.day}
              className={`bg-white min-h-[60px] sm:min-h-[80px] p-1 ${
                isToday(cell.day) ? "ring-2 ring-inset ring-blue-500" : ""
              }`}
            >
              <span
                className={`text-xs font-medium block mb-0.5 ${
                  isToday(cell.day)
                    ? "text-white rounded-full w-5 h-5 flex items-center justify-center"
                    : weekdayIdx === 0
                    ? "text-red-500"
                    : weekdayIdx === 6
                    ? "text-blue-500"
                    : "text-gray-700"
                }`}
                style={isToday(cell.day) ? { backgroundColor: "var(--primary)" } : undefined}
              >
                {cell.day}
              </span>
              {daySchedules.map((s) => {
                const c = colors[String(s.id)] || undefined;
                return (
                  <div
                    key={s.id}
                    className="text-[10px] sm:text-xs leading-tight truncate rounded px-1 py-0.5 mb-0.5 text-white"
                    style={{ backgroundColor: c || "var(--primary)" }}
                    title={`${s.title}${s.time ? ` ${s.time}` : ""}${s.location ? ` @ ${s.location}` : ""}`}
                  >
                    {s.title}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── List View ── */
function ListView({
  schedules,
  colors,
}: {
  schedules: SiteData["schedules"];
  colors: Record<string, string>;
}) {
  const sorted = [...schedules].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  return (
    <div className="space-y-3">
      {sorted.map((item) => {
        const past = isPast(item.date);
        const d = new Date(item.date);
        const itemColor = colors[String(item.id)] || undefined;
        return (
          <div
            key={item.id}
            className={`flex items-start gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:shadow-md ${
              past ? "opacity-50" : ""
            }`}
          >
            {/* Date badge */}
            <div
              className="flex flex-shrink-0 flex-col items-center rounded-xl px-3 py-2 min-w-[52px] text-white"
              style={{
                backgroundColor: past
                  ? "#9ca3af"
                  : itemColor || "var(--primary)",
              }}
            >
              <span className="text-2xl font-bold leading-tight">
                {d.getDate()}
              </span>
              <span className="text-[10px] font-medium uppercase tracking-wider">
                {d.getMonth() + 1}월
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-gray-900">{item.title}</h3>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
                <span>{formatDate(item.date)}</span>
                {item.time && <span>{item.time}</span>}
                {item.location && (
                  <span className="flex items-center gap-1">
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                    {item.location}
                  </span>
                )}
              </div>
            </div>

            {past && (
              <span className="flex-shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
                종료
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ElectionSchedule({
  schedules,
  sectionTitle,
  colors = {},
}: Props) {
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");

  if (schedules.length === 0) return null;

  return (
    <section id="schedule" className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
      {/* Section heading */}
      <div className="mb-10 text-center">
        <h2 className="section-heading text-2xl font-bold sm:text-3xl text-gray-900">
          {sectionTitle || "일정"}
        </h2>
      </div>

      {/* View toggle */}
      <div className="flex justify-center gap-2 mb-6">
        <button
          onClick={() => setViewMode("list")}
          className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all ${
            viewMode === "list"
              ? "text-white shadow-md"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
          style={
            viewMode === "list" ? { backgroundColor: "var(--primary)" } : undefined
          }
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
          목록
        </button>
        <button
          onClick={() => setViewMode("calendar")}
          className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all ${
            viewMode === "calendar"
              ? "text-white shadow-md"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
          style={
            viewMode === "calendar"
              ? { backgroundColor: "var(--primary)" }
              : undefined
          }
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          달력
        </button>
      </div>

      {viewMode === "list" ? (
        <ListView schedules={schedules} colors={colors} />
      ) : (
        <CalendarView schedules={schedules} colors={colors} />
      )}
    </section>
  );
}
