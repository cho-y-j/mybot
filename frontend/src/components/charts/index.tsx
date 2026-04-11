'use client';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts';

export const CANDIDATE_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899',
];

// ──── 커스텀 툴팁 (다크모드 대응) ────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="backdrop-blur-sm shadow-xl rounded-xl px-4 py-3 text-sm bg-[var(--card-bg)] border border-[var(--card-border)]">
      <p className="font-semibold text-[var(--foreground)] mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-[var(--muted)]">{p.name}:</span>
          <span className="font-bold text-[var(--foreground)]">{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</span>
        </div>
      ))}
    </div>
  );
};

const CustomLegend = ({ payload }: any) => (
  <div className="flex items-center justify-center gap-5 pt-3">
    {payload?.map((p: any, i: number) => (
      <div key={i} className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: p.color }} />
        <span className="text-xs text-[var(--muted)] font-medium">{p.value}</span>
      </div>
    ))}
  </div>
);

// ──── 후보별 뉴스 감성 Bar Chart ────
export function CandidateNewsBar({ data }: { data: { name: string; count: number; positive: number; negative: number; neutral?: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} barGap={2} barCategoryGap="25%">
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 13, fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={35} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc' }} />
        <Legend content={<CustomLegend />} />
        <Bar dataKey="positive" name="긍정" fill="#22c55e" radius={[6, 6, 0, 0]} maxBarSize={40} />
        <Bar dataKey="negative" name="부정" fill="#ef4444" radius={[6, 6, 0, 0]} maxBarSize={40} />
        <Bar dataKey="neutral" name="중립" fill="#cbd5e1" radius={[6, 6, 0, 0]} maxBarSize={40} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ──── 감성 트렌드 Area Chart ────
export function SentimentTrendChart({ data }: { data: { date: string; positive: number; negative: number; neutral?: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
        <defs>
          <linearGradient id="gradPos" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradNeg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={30} />
        <Tooltip content={<CustomTooltip />} />
        <Legend content={<CustomLegend />} />
        <Area type="monotone" dataKey="positive" name="긍정" stroke="#22c55e" strokeWidth={2.5} fill="url(#gradPos)" dot={false} activeDot={{ r: 5, strokeWidth: 2, fill: '#fff' }} />
        <Area type="monotone" dataKey="negative" name="부정" stroke="#ef4444" strokeWidth={2.5} fill="url(#gradNeg)" dot={false} activeDot={{ r: 5, strokeWidth: 2, fill: '#fff' }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ──── 검색 트렌드 Line Chart ────
export function SearchTrendLine({ data, keywords }: { data: any[]; keywords: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={35} />
        <Tooltip content={<CustomTooltip />} />
        <Legend content={<CustomLegend />} />
        {keywords.map((kw, i) => (
          <Line key={kw} type="monotone" dataKey={kw}
            stroke={CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]}
            strokeWidth={2.5} dot={false}
            activeDot={{ r: 6, strokeWidth: 2, fill: '#fff', stroke: CANDIDATE_COLORS[i % CANDIDATE_COLORS.length] }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ──── 후보 비교 레이더 Chart ────
export function CandidateRadar({ data, candidates }: { data: any[]; candidates: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={340}>
      <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
        <PolarGrid stroke="#e2e8f0" />
        <PolarAngleAxis dataKey="metric" tick={{ fontSize: 12, fill: '#475569', fontWeight: 500 }} />
        <PolarRadiusAxis tick={{ fontSize: 10, fill: '#94a3b8' }} domain={[0, 100]} />
        {candidates.map((c, i) => (
          <Radar key={c} name={c} dataKey={c}
            stroke={CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]}
            fill={CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]}
            fillOpacity={0.1} strokeWidth={2.5} />
        ))}
        <Legend content={<CustomLegend />} />
        <Tooltip content={<CustomTooltip />} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

// ──── 감성 비율 Donut Chart ────
export function SentimentPie({ positive, negative, neutral }: { positive: number; negative: number; neutral: number }) {
  const data = [
    { name: '긍정', value: positive, color: '#22c55e' },
    { name: '부정', value: negative, color: '#ef4444' },
    { name: '중립', value: neutral, color: '#cbd5e1' },
  ].filter(d => d.value > 0);

  const total = positive + negative + neutral;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={85}
          dataKey="value" paddingAngle={3} cornerRadius={4}
          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
          labelLine={{ stroke: '#94a3b8', strokeWidth: 1 }}>
          {data.map((entry, i) => <Cell key={i} fill={entry.color} stroke="none" />)}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <text x="50%" y="48%" textAnchor="middle" className="text-2xl font-bold fill-gray-800">{total}</text>
        <text x="50%" y="58%" textAnchor="middle" className="text-xs fill-gray-400">전체</text>
      </PieChart>
    </ResponsiveContainer>
  );
}

// ──── 지지율 추이 Chart ────
export function SurveyTrendChart({ data, candidates }: { data: any[]; candidates: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
        <defs>
          {candidates.map((c, i) => (
            <linearGradient key={c} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]} stopOpacity={0.15} />
              <stop offset="100%" stopColor={CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} unit="%" width={40} />
        <Tooltip content={<CustomTooltip />} />
        <Legend content={<CustomLegend />} />
        {candidates.map((c, i) => (
          <Area key={c} type="monotone" dataKey={c}
            stroke={CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]}
            strokeWidth={2.5}
            fill={`url(#grad-${i})`}
            dot={false}
            activeDot={{ r: 6, strokeWidth: 2, fill: '#fff', stroke: CANDIDATE_COLORS[i % CANDIDATE_COLORS.length] }} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
