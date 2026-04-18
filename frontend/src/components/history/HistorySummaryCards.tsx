'use client';

interface Summary {
  elections_count: number;
  dominant_party: string;
  dominant_pct: number;
  avg_margin: number;
  swing_count: number;
  total_districts: number;
  latest_turnout: number | null;
  top_action: string | null;
  alternation_rate: number;
}

export default function HistorySummaryCards({ summary }: { summary: Summary }) {
  if (!summary) return null;

  const isNonPartisan = !summary.dominant_party || summary.dominant_party === '기타';
  const partyColor = summary.dominant_party === '진보'
    ? 'text-blue-600 dark:text-blue-400'
    : summary.dominant_party === '보수'
    ? 'text-red-600 dark:text-red-400'
    : 'text-gray-600 dark:text-gray-400';

  const cards = [
    {
      label: '분석 선거',
      value: `${summary.elections_count}회`,
      sub: `교대율 ${summary.alternation_rate}%`,
      tone: 'text-gray-900 dark:text-gray-100',
    },
    {
      label: isNonPartisan ? '선거 유형' : '우세 정당',
      value: isNonPartisan ? '무정당' : summary.dominant_party,
      sub: isNonPartisan ? '교육감 등 정당 무관' : (summary.dominant_pct === 100 ? '전 지역 석권' : `${summary.dominant_pct}% 지역 승리`),
      tone: partyColor,
    },
    {
      label: '평균 격차',
      value: `${summary.avg_margin}%p`,
      sub: summary.avg_margin >= 10 ? '안정 구도' : '경합 가능',
      tone: 'text-violet-600 dark:text-violet-400',
    },
    {
      label: '스윙 시군',
      value: `${summary.swing_count} / ${summary.total_districts}`,
      sub: summary.swing_count > 0 ? '집중 대응 대상' : '안정',
      tone: 'text-orange-600 dark:text-orange-400',
    },
    {
      label: '최근 투표율',
      value: summary.latest_turnout ? `${summary.latest_turnout.toFixed(1)}%` : '—',
      sub: '직전 선거',
      tone: 'text-emerald-600 dark:text-emerald-400',
    },
    {
      label: 'AI 핵심 액션',
      value: summary.top_action ? '' : '미생성',
      sub: summary.top_action || 'AI 전략 탭에서 생성',
      tone: 'text-indigo-600 dark:text-indigo-400',
      wide: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((c, i) => (
        <div
          key={i}
          className={`rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 ${c.wide ? 'col-span-2 lg:col-span-1' : ''}`}
        >
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{c.label}</div>
          <div className={`text-2xl font-black ${c.tone} truncate`}>{c.value}</div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
