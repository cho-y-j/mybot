'use client';
import { useState, useMemo } from 'react';
import HistorySummaryCards from '@/components/history/HistorySummaryCards';
import CampHeatmap from '@/components/history/CampHeatmap';
import DistrictDrilldownPanel from '@/components/history/DistrictDrilldownPanel';
import DongDrilldown from '@/components/history/DongDrilldown';
import CandidateStrongholds from '@/components/history/CandidateStrongholds';
import SigunguTurnoutChart from '@/components/history/SigunguTurnoutChart';
import AgeTurnoutChart from '@/components/history/AgeTurnoutChart';
import StructuredAIStrategy from '@/components/history/StructuredAIStrategy';
import YearSelector from '@/components/history/YearSelector';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

type Tab = 'camp' | 'candidates' | 'drilldown' | 'dong' | 'turnout' | 'ai';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'camp', label: '진영 강세', icon: '🏛️' },
  { key: 'candidates', label: '역대 후보', icon: '👤' },
  { key: 'drilldown', label: '시·군·구 드릴다운', icon: '🔍' },
  { key: 'dong', label: '읍·면·동 단위', icon: '📍' },
  { key: 'turnout', label: '투표율', icon: '🗳️' },
  { key: 'ai', label: 'AI 전략', icon: '🤖' },
];

export default function SuperintendentView({ data, electionId, onRefresh }: { data: any; electionId: string; onRefresh: () => void }) {
  const [tab, setTab] = useState<Tab>('camp');
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);

  const sec = data.sections || {};
  const summary = data.summary;
  const campTrend = sec.camp_trend?.by_year || [];
  const unmapped: string[] = sec.unmapped_candidates || [];
  const drilldown = sec.district_drilldown || {};

  // 사용 가능한 회차 추출
  const yearOptions = useMemo(() => {
    const ys = new Set<number>();
    Object.values(drilldown).forEach((timeline: any) => {
      (timeline || []).forEach((y: any) => ys.add(y.year));
    });
    return Array.from(ys).sort((a, b) => b - a);
  }, [drilldown]);

  const [aggregate, setAggregate] = useState(true);  // 교육감은 기본 누적
  const [year, setYear] = useState<number | null>(yearOptions[0] ?? null);

  // 후보별 진영 매핑 lookup
  const campMap = useMemo(() => {
    const m: Record<string, string> = {};
    (sec.camp_grid?.cells || []).forEach((c: any) => {
      if (c.latest_winner && c.latest_winner_camp) m[c.latest_winner] = c.latest_winner_camp;
    });
    return m;
  }, [sec.camp_grid]);

  // 단일 회차 모드: drilldown에서 해당 년도 데이터로 camp_grid 재구성
  const yearCampGrid = useMemo(() => {
    if (aggregate || !year) return sec.camp_grid;
    const cells: any[] = [];
    const legendCounts: Record<string, number> = { '진보강세': 0, '진보우세': 0, '경합': 0, '보수우세': 0, '보수강세': 0 };
    Object.entries(drilldown).forEach(([sgg, timeline]: any) => {
      const entry = (timeline || []).find((t: any) => t.year === year);
      if (!entry || !entry.top3?.length) return;
      // top3에서 진보/보수 비율 계산
      let progRate = 0, consRate = 0;
      (entry.top3 || []).forEach((c: any) => {
        const camp = campMap[c.name] || c.camp || '';
        if (camp === '진보') progRate += (c.vote_rate || 0);
        else if (camp === '보수') consRate += (c.vote_rate || 0);
      });
      const gap = Math.abs(progRate - consRate);
      const dominant = progRate >= consRate ? '진보' : '보수';
      let tier: string;
      if (gap >= 20) tier = dominant === '진보' ? '진보강세' : '보수강세';
      else if (gap >= 5) tier = dominant === '진보' ? '진보우세' : '보수우세';
      else tier = '경합';
      legendCounts[tier] = (legendCounts[tier] || 0) + 1;
      cells.push({
        district: sgg,
        tier,
        dominant,
        progressive_rate: Math.round(progRate * 10) / 10,
        conservative_rate: Math.round(consRate * 10) / 10,
        gap: Math.round(gap * 10) / 10,
        latest_winner: entry.top3[0]?.name || '',
        latest_winner_camp: campMap[entry.top3[0]?.name] || '',
        latest_year: year,
      });
    });
    return { cells, legend_counts: legendCounts };
  }, [aggregate, year, sec.camp_grid, drilldown, campMap]);

  function handleSelectDistrict(d: string) {
    setSelectedDistrict(d);
    setTab('dong');
  }

  return (
    <div className="space-y-5">
      {summary && <HistorySummaryCards summary={summary} />}

      {unmapped.length > 0 && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 text-xs text-amber-800 dark:text-amber-200">
          ⚠️ 진영(진보/보수)이 미매핑된 역대 후보 {unmapped.length}명: <strong>{unmapped.join(', ')}</strong>
          <div className="mt-1 opacity-90">슈퍼관리자가 매핑하면 시·군·구 강세 분석이 더 정확해집니다.</div>
        </div>
      )}

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

      {/* 회차 선택자 — camp/드릴다운/동 탭에서 노출 */}
      {(tab === 'camp' || tab === 'drilldown' || tab === 'dong') && yearOptions.length > 0 && (
        <YearSelector
          years={yearOptions}
          value={year}
          onChange={setYear}
          showAggregateOption={tab === 'camp'}
          aggregateValue={aggregate}
          onAggregateChange={setAggregate}
        />
      )}

      <div>
        {tab === 'camp' && (
          <div className="space-y-4">
            <div className="card bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800 text-xs text-violet-800 dark:text-violet-200">
              {aggregate
                ? `📊 역대 ${yearOptions.length}회 누적 진영 강세 (${yearOptions[yearOptions.length - 1]}~${yearOptions[0]}년)`
                : `🗳️ ${year}년 단일 회차 진영 분석`}
              <span className="ml-2 text-violet-600">— 카드 클릭 시 읍면동 드릴다운</span>
            </div>
            <CampHeatmap data={yearCampGrid} onSelectDistrict={handleSelectDistrict} />
            {campTrend.length > 0 && (
              <div className="card">
                <h3 className="text-base font-bold mb-1">진영별 평균 득표율 추이</h3>
                <p className="text-xs text-gray-500 mb-4">{sec.camp_trend?.summary}</p>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={campTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="year" />
                    <YAxis unit="%" />
                    <Tooltip formatter={(v: any) => `${v}%`} />
                    <Legend />
                    <Line type="monotone" dataKey="progressive" name="진보" stroke="#2563eb" strokeWidth={3} dot={{ r: 5 }} />
                    <Line type="monotone" dataKey="conservative" name="보수" stroke="#dc2626" strokeWidth={3} dot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}
        {tab === 'candidates' && (
          <CandidateStrongholds candidates={sec.candidate_strongholds?.candidates || []} campMap={campMap} />
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
