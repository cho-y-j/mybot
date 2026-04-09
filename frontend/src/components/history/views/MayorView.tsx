'use client';
import { useState, useMemo } from 'react';
import HistorySummaryCards from '@/components/history/HistorySummaryCards';
import RawPartyTrendChart from '@/components/history/RawPartyTrendChart';
import RawPartyHeatmap from '@/components/history/RawPartyHeatmap';
import DistrictDrilldownPanel from '@/components/history/DistrictDrilldownPanel';
import DongDrilldown from '@/components/history/DongDrilldown';
import SigunguTurnoutChart from '@/components/history/SigunguTurnoutChart';
import AgeTurnoutChart from '@/components/history/AgeTurnoutChart';
import StructuredAIStrategy from '@/components/history/StructuredAIStrategy';
import YearSelector from '@/components/history/YearSelector';

type Tab = 'party' | 'strength' | 'drilldown' | 'dong' | 'turnout' | 'ai';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'party', label: '정당 추이', icon: '📈' },
  { key: 'strength', label: '시·군·구 정당 강세', icon: '🗺️' },
  { key: 'drilldown', label: '시·군·구 드릴다운', icon: '🔍' },
  { key: 'dong', label: '읍·면·동 단위', icon: '📍' },
  { key: 'turnout', label: '투표율', icon: '🗳️' },
  { key: 'ai', label: 'AI 전략', icon: '🤖' },
];

const PARTY_COLOR: Record<string, string> = {
  '더불어민주당': '#1e40af',
  '민주당': '#1e40af',
  '새정치민주연합': '#2563eb',
  '열린우리당': '#3b82f6',
  '국민의힘': '#dc2626',
  '자유한국당': '#dc2626',
  '새누리당': '#ef4444',
  '한나라당': '#f87171',
  '미래통합당': '#dc2626',
  '정의당': '#fbbf24',
  '진보당': '#fbbf24',
  '국민의당': '#7c3aed',
  '바른미래당': '#7c3aed',
  '자유선진당': '#0ea5e9',
  '국민중심당': '#0ea5e9',
  '민주평화당': '#10b981',
  '무소속': '#6b7280',
};
const partyColor = (p: string) => PARTY_COLOR[p?.trim() || ''] || '#9ca3af';

export default function MayorView({ data, electionId, onRefresh }: { data: any; electionId: string; onRefresh: () => void }) {
  const [tab, setTab] = useState<Tab>('strength');
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);

  const sec = data.sections || {};
  const summary = data.summary;
  const drilldown = sec.district_drilldown || {};

  // 사용 가능한 회차 추출 (drilldown 데이터에서)
  const yearOptions = useMemo(() => {
    const ys = new Set<number>();
    Object.values(drilldown).forEach((timeline: any) => {
      (timeline || []).forEach((y: any) => ys.add(y.year));
    });
    return Array.from(ys).sort((a, b) => b - a);
  }, [drilldown]);

  const [aggregate, setAggregate] = useState(false);
  const [year, setYear] = useState<number | null>(yearOptions[0] ?? null);

  // 단일 회차 모드: drilldown에서 그 해 1위만 추출하여 heatmap 재구성
  const yearHeatmap = useMemo(() => {
    if (aggregate || !year) return sec.raw_party_grid;
    const cells: any[] = [];
    const partyCounts: Record<string, number> = {};
    Object.entries(drilldown).forEach(([sgg, timeline]: any) => {
      const entry = (timeline || []).find((t: any) => t.year === year);
      if (!entry || !entry.top3?.length) return;
      const winner = entry.top3[0];
      const party = winner.party || '무소속';
      partyCounts[party] = (partyCounts[party] || 0) + 1;
      cells.push({
        district: sgg,
        latest_party: party,
        latest_rate: winner.vote_rate || 0,
        latest_year: year,
        dominant_party: party,
        dominant_pct: 100,
        margin: entry.margin || 0,
        color: partyColor(party),
      });
    });
    // 청주시 4구를 묶기 위해 parent city로 1차 정렬
    const parentCity = (d: string) => {
      const m = d.match(/^(.+?시)/);
      return m ? m[1] : d;
    };
    cells.sort((a, b) => {
      const pa = parentCity(a.district), pb = parentCity(b.district);
      if (pa !== pb) return pa.localeCompare(pb, 'ko');
      return a.district.localeCompare(b.district, 'ko');
    });
    return { cells, party_counts: partyCounts };
  }, [aggregate, year, sec.raw_party_grid, drilldown]);

  function handleSelectDistrict(d: string) {
    setSelectedDistrict(d);
    setTab('dong');  // 시군 카드 클릭 → 바로 동 단위 탭으로
  }

  return (
    <div className="space-y-5">
      {summary && <HistorySummaryCards summary={summary} />}

      <div className="border-b border-gray-200 dark:border-gray-700">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-violet-600 text-violet-600 dark:text-violet-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <span className="mr-1">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 회차 선택자 — '강세'/드릴다운/동 탭에서만 노출 */}
      {(tab === 'strength' || tab === 'drilldown' || tab === 'dong') && (
        <YearSelector
          years={yearOptions}
          value={year}
          onChange={setYear}
          showAggregateOption={tab === 'strength'}
          aggregateValue={aggregate}
          onAggregateChange={setAggregate}
        />
      )}

      <div>
        {tab === 'party' && <RawPartyTrendChart data={sec.raw_party_trend} />}
        {tab === 'strength' && (
          <div className="space-y-3">
            <div className="card bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800 text-xs text-violet-800 dark:text-violet-200">
              {aggregate
                ? `📊 역대 ${yearOptions.length}회 누적 우세 정당 (${yearOptions[yearOptions.length - 1]}~${yearOptions[0]}년)`
                : `🗳️ ${year}년 단일 회차 1위 정당`}
              <span className="ml-2 text-violet-600">— 카드 클릭 시 같은 회차 기준으로 드릴다운</span>
            </div>
            <RawPartyHeatmap data={yearHeatmap} onSelectDistrict={handleSelectDistrict} />
          </div>
        )}
        {tab === 'drilldown' && (
          <DistrictDrilldownPanel
            drilldown={drilldown}
            cells={sec.strength_grid?.cells || []}
            selectedDistrict={selectedDistrict}
            onSelect={setSelectedDistrict}
          />
        )}
        {tab === 'dong' && <DongDrilldown electionId={electionId} year={year} initialSigungu={selectedDistrict} />}
        {tab === 'turnout' && (
          <div className="space-y-4">
            <SigunguTurnoutChart rows={sec.sigungu_turnout || []} />
            <AgeTurnoutChart
              totalTrend={sec.turnout_analysis?.total_trend || []}
              ageSeries={sec.turnout_analysis?.age_series || []}
              insight={sec.turnout_analysis?.insight}
            />
          </div>
        )}
        {tab === 'ai' && <StructuredAIStrategy electionId={electionId} initial={sec.ai_strategy || { text: '', structured: null, ai_generated: false }} onRefresh={onRefresh} />}
      </div>
    </div>
  );
}
