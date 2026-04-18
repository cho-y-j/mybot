'use client';
import clsx from 'clsx';

interface Alert {
  level: 'critical' | 'warning' | 'info' | 'opportunity';
  title: string;
  message: string;
  time?: string;
}

const styles: Record<Alert['level'], { bg: string; badge: string }> = {
  critical: { bg: 'bg-red-50 border-red-300', badge: 'bg-red-100 text-red-700' },
  warning: { bg: 'bg-amber-50 border-amber-300', badge: 'bg-amber-100 text-amber-700' },
  info: { bg: 'bg-blue-50 border-blue-300', badge: 'bg-blue-100 text-blue-700' },
  opportunity: { bg: 'bg-green-50 border-green-300', badge: 'bg-green-100 text-green-700' },
};

export default function AlertCard({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return null;

  return (
    <div className="space-y-2">
      {alerts.map((a, i) => {
        const s = styles[a.level];
        return (
          <div key={i} className={clsx('rounded-lg border p-4 flex items-start gap-3', s.bg)}>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', s.badge)}>
                  {a.level.toUpperCase()}
                </span>
                <span className="font-semibold text-sm">{a.title}</span>
                {a.time && <span className="text-xs text-gray-400 ml-auto">{a.time}</span>}
              </div>
              <p className="text-sm text-gray-600 mt-1">{a.message}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
