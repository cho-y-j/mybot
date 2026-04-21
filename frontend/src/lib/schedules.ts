/**
 * schedules_v2 — 공용 상수·유틸
 */

export type ScheduleCategory =
  | 'rally' | 'street' | 'debate' | 'broadcast' | 'interview'
  | 'meeting' | 'supporter' | 'voting' | 'internal' | 'other';

export type ScheduleStatus = 'planned' | 'in_progress' | 'done' | 'canceled';
export type ScheduleVisibility = 'public' | 'internal';
export type ResultMood = 'good' | 'normal' | 'bad';

export const CATEGORY_LABELS: Record<ScheduleCategory, string> = {
  rally: '유세',
  street: '거리인사',
  debate: '토론·간담',
  broadcast: '방송출연',
  interview: '인터뷰',
  meeting: '회의',
  supporter: '지지자모임',
  voting: '투표일정',
  internal: '내부일정',
  other: '기타',
};

// 단색 사이드 바 색상 (CLAUDE.md 이모지 금지 · 색상으로 표현)
export const CATEGORY_COLORS: Record<ScheduleCategory, string> = {
  rally: 'bg-rose-500',
  street: 'bg-amber-500',
  debate: 'bg-indigo-500',
  broadcast: 'bg-cyan-500',
  interview: 'bg-teal-500',
  meeting: 'bg-slate-500',
  supporter: 'bg-emerald-500',
  voting: 'bg-violet-500',
  internal: 'bg-zinc-500',
  other: 'bg-gray-400',
};

export const STATUS_LABELS: Record<ScheduleStatus, string> = {
  planned: '예정',
  in_progress: '진행중',
  done: '완료',
  canceled: '취소',
};

export const MOOD_LABELS: Record<ResultMood, string> = {
  good: '좋음',
  normal: '보통',
  bad: '별로',
};

export const MOOD_COLORS: Record<ResultMood, string> = {
  good: 'bg-emerald-500 text-white',
  normal: 'bg-amber-500 text-white',
  bad: 'bg-rose-500 text-white',
};

export function formatTimeRange(starts_at: string, ends_at: string, all_day?: boolean): string {
  if (all_day) return '종일';
  const s = new Date(starts_at);
  const e = new Date(ends_at);
  const hm = (d: Date) => d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${hm(s)} ~ ${hm(e)}`;
}

export function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '내일';
  if (diff === -1) return '어제';
  if (diff === 2) return '모레';
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getMonth() + 1}/${d.getDate()} (${WD[d.getDay()]})`;
}

export function dDayLabel(starts_at: string): string {
  const s = new Date(starts_at);
  const now = new Date();
  const ms = s.getTime() - now.getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 0) return '지남';
  if (minutes < 60) return `${minutes}분 후`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 후`;
  const days = Math.round(hours / 24);
  return `D-${days}`;
}

export function groupByDate<T extends { starts_at: string }>(items: T[]): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const it of items) {
    const key = new Date(it.starts_at).toISOString().slice(0, 10);
    (groups[key] ||= []).push(it);
  }
  return groups;
}
