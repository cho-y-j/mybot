'use client';
import { useState, useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

interface TurnoutRow {
  year: number;
  election_number: number;
  district: string;
  total_rate: number;
  early_rate: number;
  election_day_rate: number;
  eligible: number;
}

export default function SigunguTurnoutChart({ rows }: { rows: TurnoutRow[] }) {
  const years = useMemo(() => {
    const ys = Array.from(new Set(rows.map((r) => r.year))).sort((a, b) => b - a);
    return ys;
  }, [rows]);
  const [year, setYear] = useState<number | null>(years[0] ?? null);

  if (!rows?.length) {
    return <div className="card text-center text-gray-500 py-12">투표율 데이터가 없습니다.</div>;
  }

  const filtered = rows.filter((r) => r.year === year);

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-base font-bold">시·군·구별 투표율 (사전 vs 본투표)</h3>
          <div className="flex gap-1">
            {years.map((y) => (
              <button
                key={y}
                onClick={() => setYear(y)}
                className={`px-3 py-1 text-xs rounded ${
                  year === y
                    ? 'bg-violet-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={Math.max(280, filtered.length * 24)}>
          <BarChart data={filtered} layout="vertical" margin={{ left: 50 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis type="number" unit="%" />
            <YAxis type="category" dataKey="district" width={100} />
            <Tooltip formatter={(v: any) => `${v}%`} />
            <Legend />
            <Bar dataKey="early_rate" name="사전·거소" stackId="a" fill="#3b82f6" />
            <Bar dataKey="election_day_rate" name="선거일" stackId="a" fill="#10b981" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
