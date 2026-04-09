'use client';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

interface RawPartyTrend {
  by_year: Array<Record<string, any>>;
  parties: string[];
  colors: Record<string, string>;
}

export default function RawPartyTrendChart({ data }: { data: RawPartyTrend }) {
  if (!data || !data.by_year?.length) {
    return <div className="card text-center text-gray-500 py-12">정당 추이 데이터가 없습니다.</div>;
  }

  const lineKeys = [...data.parties, '기타'];

  return (
    <div className="card">
      <h3 className="text-base font-bold mb-1">정당별 평균 득표율 추이</h3>
      <p className="text-xs text-gray-500 mb-4">Top {data.parties.length} 정당 + 기타 (실제 정당명)</p>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data.by_year}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="year" />
          <YAxis unit="%" />
          <Tooltip formatter={(v: any) => v != null ? `${v}%` : '—'} />
          <Legend />
          {lineKeys.map((p) => (
            <Line
              key={p}
              type="monotone"
              dataKey={p}
              stroke={data.colors[p] || '#9ca3af'}
              strokeWidth={2.5}
              dot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
