'use client';
import { useState, useMemo } from 'react';
import HistorySummaryCards from '@/components/history/HistorySummaryCards';
import RawPartyTrendChart from '@/components/history/RawPartyTrendChart';
import RawPartyHeatmap from '@/components/history/RawPartyHeatmap';
import CampHeatmap from '@/components/history/CampHeatmap';
import DistrictDrilldownPanel from '@/components/history/DistrictDrilldownPanel';
import DongDrilldown from '@/components/history/DongDrilldown';
import SigunguTurnoutChart from '@/components/history/SigunguTurnoutChart';
import AgeTurnoutChart from '@/components/history/AgeTurnoutChart';
import StructuredAIStrategy from '@/components/history/StructuredAIStrategy';
import YearSelector from '@/components/history/YearSelector';
import { partyToCamp, campTierOf } from '@/components/history/utils';

type Tab = 'party' | 'strength' | 'drilldown' | 'dong' | 'turnout' | 'ai';
type ViewMode = 'party' | 'camp';

const TABS: { key: Tab; label: string }[] = [
  { key: 'party', label: '정당 추이' },
  { key: 'strength', label: '시·군·구 강세' },
  { key: 'drilldown', label: '시·군·구 드릴다운' },
  { key: 'dong', label: '읍·면·동 단위' },
  { key: 'turnout', label: '투표율' },
  { key: 'ai', label: 'AI 전략' },
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
  const [mode, setMode] = useState<ViewMode>('party');   // 정당별 / 진영별 토글
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);

  const sec = data.sections || {};
  const summary = data.summary;
  const drilldown = sec.district_drilldown || {};

  const yearOptions = useMemo(() => {
    const ys = new Set<number>();
    Object.values(drilldown).forEach((timeline: any) => {
      (timeline || []).forEach((y: any) => ys.add(y.year));
    });
    return Array.from(ys).sort((a, b) => b - a);
  }, [drilldown]);

  const [aggregate, setAggregate] = useState(false);
  const [year, setYear] = useState<number | null>(yearOptions[0] ?? null);

  // 단일 회차 정당 모드 heatmap
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
    return { cells, party_counts: partyCounts };
  }, [aggregate, year, sec.raw_party_grid, drilldown]);

  // 진영 모드 heatmap — drilldown을 진보/보수로 재집계 (aggregate / year 모두 지원)
  const campHeatmap = useMemo(() => {
    if (mode !== 'camp') return null;
    const cells: any[] = [];
    const legendCounts: Record<string, number> = {
      '진보강세': 0, '진보우세': 0, '경합': 0, '보수우세': 0, '보수강세': 0,
    };
    Object.entries(drilldown).forEach(([sgg, timeline]: any) => {
      const entries = aggregate
        ? (timeline || [])
        : (timeline || []).filter((t: any) => t.year === year);
      if (!entries.length) return;

      let progSum = 0, consSum = 0, cnt = 0;
      entries.forEach((entry: any) => {
        (entry.top3 || []).forEach((c: any) => {
          const camp = c.party_camp || partyToCamp(c.party);
          if (camp === '진보') progSum += c.vote_rate || 0;
          else if (camp === '보수') consSum += c.vote_rate || 0;
        });
        cnt++;
      });
      const progRate = cnt > 0 ? progSum / cnt : 0;
      const consRate = cnt > 0 ? consSum / cnt : 0;
      const gap = Math.abs(progRate - consRate);
      const dominant = progRate >= consRate ? '진보' : '보수';
      const tier = campTierOf(progRate, consRate);
      legendCounts[tier] = (legendCounts[tier] || 0) + 1;

      const latest = entries[0];
      const latestWinner = latest?.top3?.[0];
      cells.push({
        district: sgg,
        tier,
        dominant,
        progressive_rate: Math.round(progRate * 10) / 10,
        conservative_rate: Math.round(consRate * 10) / 10,
        gap: Math.round(gap * 10) / 10,
        latest_winner: latestWinner?.name || '',
        latest_winner_camp: (latestWinner ? partyToCamp(latestWinner.party) : '') as string,
        latest_year: latest?.year || 0,
      });
    });
    return { cells, legend_counts: legendCounts };
  }, [mode, aggregate, year, drilldown]);

  function handleSelectDistrict(d: string) {
    setSelectedDistrict(d);
    setTab('drilldown');
  }

  return (
    <div className="space-y-5">
      {summary && <HistorySummaryCards summary={summary} />}

      <div className="border-b border-[var(--card-border)]">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-500 text-blue-500'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
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
            {/* 보는 방식 토글 — 정당별 vs 진영별 */}
            <div className="card bg-blue-500/5 border-blue-500/20">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="text-xs text-[var(--muted)]">
                  {aggregate
                    ? `역대 ${yearOptions.length}회 누적 (${yearOptions[yearOptions.length - 1]}~${yearOptions[0]}년)`
                    : `${year}년 단일 회차`}
                  <span className="ml-2 text-blue-500">— 카드 클릭 시 시·군·구 드릴다운</span>
                </div>
                <div className="flex items-center gap-1 bg-[var(--muted-bg)] rounded-lg p-1">
                  {([['party', '정당별'], ['camp', '진영별 (진보/보수)']] as [ViewMode, string][]).map(([v, l]) => (
                    <button
                      key={v}
                      onClick={() => setMode(v)}
                      className={`px-3 py-1 text-xs rounded-md font-semibold transition ${
                        mode === v ? 'bg-[var(--card-bg)] shadow text-[var(--foreground)]' : 'text-[var(--muted)]'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[10px] text-[var(--muted)] mt-2">
                {mode === 'party'
                  ? '실제 정당 기준 · 각 정당 고유 색상 + 격차 클수록 진하게'
                  : '진보(민주계열) / 보수(국힘계열)로 분류 · 강세·우세·경합 5단계 색상'}
              </p>
            </div>

            {mode === 'party'
              ? <RawPartyHeatmap data={yearHeatmap} onSelectDistrict={handleSelectDistrict} />
              : <CampHeatmap data={campHeatmap as any} onSelectDistrict={handleSelectDistrict} />
            }
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
