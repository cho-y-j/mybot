'use client';
import clsx from 'clsx';

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  change?: number;
  color?: 'blue' | 'red' | 'green' | 'amber' | 'purple' | 'gray';
}

const styles = {
  blue: { bg: 'bg-gradient-to-br from-blue-50 to-blue-100/50', text: 'text-blue-700', border: 'border-blue-200/60' },
  red: { bg: 'bg-gradient-to-br from-red-50 to-red-100/50', text: 'text-red-700', border: 'border-red-200/60' },
  green: { bg: 'bg-gradient-to-br from-green-50 to-emerald-100/50', text: 'text-green-700', border: 'border-green-200/60' },
  amber: { bg: 'bg-gradient-to-br from-amber-50 to-yellow-100/50', text: 'text-amber-700', border: 'border-amber-200/60' },
  purple: { bg: 'bg-gradient-to-br from-purple-50 to-violet-100/50', text: 'text-purple-700', border: 'border-purple-200/60' },
  gray: { bg: 'bg-gradient-to-br from-gray-50 to-slate-100/50', text: 'text-gray-700', border: 'border-gray-200/60' },
};

export default function StatCard({ label, value, sub, change, color = 'blue' }: StatCardProps) {
  const s = styles[color];
  return (
    <div className={clsx('rounded-2xl border p-5 transition-all hover:shadow-md', s.bg, s.border)}>
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className={clsx('text-3xl font-extrabold mt-1 tracking-tight', s.text)}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      {change !== undefined && (
        <div className="mt-2 flex items-center gap-1">
          <span className={clsx('text-xs font-semibold', change >= 0 ? 'text-green-600' : 'text-red-600')}>
            {change >= 0 ? '▲' : '▼'} {Math.abs(change)}%
          </span>
          <span className="text-[10px] text-gray-400">전일 대비</span>
        </div>
      )}
    </div>
  );
}
