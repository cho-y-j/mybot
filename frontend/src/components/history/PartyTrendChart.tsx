'use client';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar,
} from 'recharts';

interface PartyTrend {
  by_year: Array<{ year: number; progressive: number; conservative: number; other: number }>;
  districts_won_by_year: Array<{ year: number; progressive: number; conservative: number; other: number }>;
  trend_summary: string;
}

export default function PartyTrendChart({ data }: { data: PartyTrend }) {
  if (!data || !data.by_year?.length) {
    return <div className="card text-center text-gray-500 py-12">정당 추이 데이터가 없습니다.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <h3 className="text-base font-bold mb-1">정당별 평균 득표율 추이</h3>
        <p className="text-xs text-gray-500 mb-4">{data.trend_summary}</p>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data.by_year}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="year" />
            <YAxis unit="%" />
            <Tooltip formatter={(v: any) => `${v}%`} />
            <Legend />
            <Line type="monotone" dataKey="progressive" name="진보" stroke="#2563eb" strokeWidth={3} dot={{ r: 5 }} />
            <Line type="monotone" dataKey="conservative" name="보수" stroke="#dc2626" strokeWidth={3} dot={{ r: 5 }} />
            <Line type="monotone" dataKey="other" name="기타" stroke="#9ca3af" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h3 className="text-base font-bold mb-4">정당별 당선 시군 수 추이</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.districts_won_by_year}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="year" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="progressive" name="진보" fill="#2563eb" />
            <Bar dataKey="conservative" name="보수" fill="#dc2626" />
            <Bar dataKey="other" name="기타" fill="#9ca3af" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
