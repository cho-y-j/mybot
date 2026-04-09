'use client';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  AreaChart, Area,
} from 'recharts';

interface TotalTrend {
  year: number;
  total_rate: number;
  early_rate: number;
}

interface AgeSeriesEntry {
  age: string;
  [year: string]: string | number;
}

const AGE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

export default function AgeTurnoutChart({
  totalTrend,
  ageSeries,
  insight,
}: {
  totalTrend: TotalTrend[];
  ageSeries: AgeSeriesEntry[];
  insight?: string;
}) {
  // ageSeries: [{age:"18-29",2014:42.1,2018:48.3,2022:51.2}, ...]
  // → 차트를 위해 transpose: [{year:2014,"18-29":42.1,"30-39":...}, ...]
  const years = new Set<string>();
  (ageSeries || []).forEach((row) => {
    Object.keys(row).forEach((k) => { if (k !== 'age') years.add(k); });
  });
  const yearList = Array.from(years).sort();
  const ageChartData = yearList.map((y) => {
    const e: any = { year: y };
    (ageSeries || []).forEach((row) => {
      e[row.age] = row[y];
    });
    return e;
  });
  const ageKeys = (ageSeries || []).map((r) => r.age);

  return (
    <div className="space-y-6">
      <div className="card">
        <h3 className="text-base font-bold mb-1">총 투표율 vs 사전투표율</h3>
        {insight && <p className="text-xs text-gray-500 mb-4">{insight}</p>}
        {totalTrend?.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={totalTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="year" />
              <YAxis unit="%" />
              <Tooltip formatter={(v: any) => `${v}%`} />
              <Legend />
              <Area type="monotone" dataKey="total_rate" name="총 투표율" stroke="#10b981" fill="#10b98133" strokeWidth={3} />
              <Area type="monotone" dataKey="early_rate" name="사전투표율" stroke="#3b82f6" fill="#3b82f633" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-center text-gray-500 py-8 text-sm">투표율 데이터가 아직 없습니다.</div>
        )}
      </div>

      <div className="card">
        <h3 className="text-base font-bold mb-4">연령대별 투표율 추이</h3>
        {ageChartData.length && ageKeys.length ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={ageChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="year" />
              <YAxis unit="%" />
              <Tooltip formatter={(v: any) => v != null ? `${v}%` : '—'} />
              <Legend />
              {ageKeys.map((age, i) => (
                <Line
                  key={age}
                  type="monotone"
                  dataKey={age}
                  stroke={AGE_COLORS[i % AGE_COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-center text-gray-500 py-8 text-sm">연령대별 투표율 데이터가 아직 없습니다.</div>
        )}
      </div>
    </div>
  );
}
