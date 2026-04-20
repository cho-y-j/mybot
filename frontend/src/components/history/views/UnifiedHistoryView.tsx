'use client';
import { useState, useMemo } from 'react';
import HistorySummaryCards from '@/components/history/HistorySummaryCards';
import RawPartyTrendChart from '@/components/history/RawPartyTrendChart';
import UnifiedHeatmap, { ViewMode } from '@/components/history/UnifiedHeatmap';
import DistrictDrilldownPanel from '@/components/history/DistrictDrilldownPanel';
import DongDrilldown from '@/components/history/DongDrilldown';
import CandidateStrongholds from '@/components/history/CandidateStrongholds';
import SigunguTurnoutChart from '@/components/history/SigunguTurnoutChart';
import AgeTurnoutChart from '@/components/history/AgeTurnoutChart';
import StructuredAIStrategy from '@/components/history/StructuredAIStrategy';
import YearSelector from '@/components/history/YearSelector';
import { partyToCamp, campTierOf, partyColor } from '@/components/history/utils';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

type Tab = 'party' | 'strength' | 'drilldown' | 'dong' | 'candidates' | 'turnout' | 'ai';

interface Props {
  data: any;
  electionId: string;
  onRefresh: () => void;
}

/**
 * 범용 과거 선거 뷰.
 * - 모든 선거 유형(mayor/governor/superintendent/gu_head/gun_head/council/congressional) 지원
 * - 전역 년도 셀렉터 + 전역 정당/진영 토글 → 모든 하위 탭(강세/드릴다운/동)에 자동 연동
 * - 청주·수원·성남·창원 등 복합 시·구 자동 그룹핑 (utils.ts)
 */
export default function UnifiedHistoryView({ data, electionId, onRefresh }: Props) {
  const sec = data.sections || {};
  const summary = data.summary;
  const drilldown = sec.district_drilldown || {};
  const campTrend = sec.camp_trend?.by_year || [];
  const unmapped: string[] = sec.unmapped_candidates || [];
  const region = data.region || '';
  const layout = data.layout || 'mayor';

  // 모든 선거 유형 기본 '진영(보수/진보)' 모드 — 보편적 색 표현 통일
  const [mode, setMode] = useState<ViewMode>('camp');
  const [tab, setTab] = useState<Tab>('strength');
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);

  // 년도 목록 추출
  const yearOptions = useMemo(() => {
    const ys = new Set<number>();
    Object.values(drilldown).forEach((timeline: any) => {
      (timeline || []).forEach((y: any) => ys.add(y.year));
    });
    return Array.from(ys).sort((a, b) => b - a);
  }, [drilldown]);

  // 교육감 기본 누적, 나머지는 단일 회차
  const [aggregate, setAggregate] = useState(layout === 'superintendent');
  const [year, setYear] = useState<number | null>(yearOptions[0] ?? null);

  // ─── 후보-진영 매핑 (camp_grid에서) ───
  const campMap = useMemo(() => {
    const m: Record<string, string> = {};
    (sec.camp_grid?.cells || []).forEach((c: any) => {
      if (c.latest_winner && c.latest_winner_camp) m[c.latest_winner] = c.latest_winner_camp;
    });
    return m;
  }, [sec.camp_grid]);

  // ─── 정당 모드: 단일 회차용 grid 재계산 ───
  const partyGridByYear = useMemo(() => {
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

  // ─── 진영 모드 grid ─── */
  // 역대 누적: 백엔드 sec.camp_grid 그대로 사용 (candidate_alignments + camp_overrides 적용된 정확한 진영 매핑).
  //   프론트 재계산 시 교육감 무소속 후보의 party_camp 가 비어있어 0/0이 나오던 치명 버그 방지.
  // 단일 회차: drilldown을 재집계하되, camp_grid에서 후보→진영 매핑을 가져와 fallback.
  const campGridByYear = useMemo(() => {
    if (aggregate) return sec.camp_grid;

    // 후보명 → 진영 매핑 (백엔드 camp_grid의 latest_winner 기반으로 추출)
    const candToCamp = new Map<string, string>();
    (sec.camp_grid?.cells || []).forEach((cg: any) => {
      if (cg.latest_winner && cg.latest_winner_camp) {
        candToCamp.set(cg.latest_winner, cg.latest_winner_camp);
      }
    });

    const cells: any[] = [];
    const legendCounts: Record<string, number> = {
      진보강세: 0, 진보우세: 0, 경합: 0, 보수우세: 0, 보수강세: 0,
    };
    Object.entries(drilldown).forEach(([sgg, timeline]: any) => {
      const entry = (timeline || []).find((t: any) => t.year === year);
      if (!entry || !entry.top3?.length) return;

      let progSum = 0, consSum = 0;
      entry.top3.forEach((c: any) => {
        // 정당 → 진영 매핑 우선, 안되면 후보명으로 백엔드 매핑 fallback (교육감 무소속 대응)
        const camp = c.party_camp || partyToCamp(c.party) || candToCamp.get(c.name) || '';
        if (camp === '진보') progSum += c.vote_rate || 0;
        else if (camp === '보수') consSum += c.vote_rate || 0;
      });
      const gap = Math.abs(progSum - consSum);
      const dominant = progSum >= consSum ? '진보' : '보수';
      const tier = campTierOf(progSum, consSum);
      legendCounts[tier] = (legendCounts[tier] || 0) + 1;

      const latestWinner = entry.top3[0];
      cells.push({
        district: sgg,
        tier,
        dominant,
        progressive_rate: Math.round(progSum * 10) / 10,
        conservative_rate: Math.round(consSum * 10) / 10,
        gap: Math.round(gap * 10) / 10,
        latest_winner: latestWinner?.name || '',
        latest_winner_camp: latestWinner
          ? (partyToCamp(latestWinner.party) || candToCamp.get(latestWinner.name) || '')
          : '',
        latest_year: year || 0,
      });
    });
    return { cells, legend_counts: legendCounts };
  }, [aggregate, year, drilldown, sec.camp_grid]);

  // 카드 클릭 → 드릴다운 탭
  function handleSelectDistrict(d: string) {
    setSelectedDistrict(d);
    setTab('drilldown');
  }

  const periodLabel = aggregate
    ? `역대 ${yearOptions.length}회 누적`
    : year ? `${year}년 단일 회차` : '';

  const TABS: { key: Tab; label: string }[] = [
    { key: 'strength', label: '시·군·구 강세' },
    { key: 'drilldown', label: '시·군·구 드릴다운' },
    { key: 'dong', label: '읍·면·동' },
    ...(layout === 'superintendent'
      ? [{ key: 'candidates' as Tab, label: '역대 후보' }]
      : [{ key: 'party' as Tab, label: '정당 추이' }]),
    { key: 'turnout', label: '투표율' },
    { key: 'ai', label: 'AI 전략' },
  ];

  return (
    <div className="space-y-5">
      {summary && <HistorySummaryCards summary={summary} />}

      {unmapped.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
          진영(진보/보수)이 미매핑된 후보 {unmapped.length}명: <strong>{unmapped.join(', ')}</strong>
          <div className="mt-1 opacity-90">슈퍼관리자가 매핑하면 분석 정확도 향상.</div>
        </div>
      )}

      {/* ─── 상단: 전역 보기 모드 토글 (정당/진영) ─── */}
      <div className="card bg-blue-500/5 border-blue-500/20">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs">
            <div className="font-bold">보기 모드</div>
            <div className="text-[var(--muted)] mt-0.5">
              {mode === 'party'
                ? '실제 정당 색상 기준 (교육감 등 무소속은 "기타"로 표시)'
                : '진보(민주 계열) / 보수(국민의힘 계열) 5단계 색상'}
            </div>
          </div>
          <div className="flex items-center gap-1 bg-[var(--muted-bg)] rounded-lg p-1">
            {([['party', '정당별'], ['camp', '진영별 (진보/보수)']] as [ViewMode, string][]).map(([v, l]) => (
              <button
                key={v}
                onClick={() => setMode(v)}
                className={`px-3 py-1.5 text-xs rounded-md font-semibold transition ${
                  mode === v ? 'bg-[var(--card-bg)] shadow' : 'text-[var(--muted)]'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ─── 탭 ─── */}
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

      {/* ─── 전역 년도 셀렉터 (strength/drilldown/dong 탭에서만) ─── */}
      {(tab === 'strength' || tab === 'drilldown' || tab === 'dong') && yearOptions.length > 0 && (
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
        {/* ─── 시·군·구 강세 ─── */}
        {tab === 'strength' && (
          <div className="space-y-4">
            <UnifiedHeatmap
              mode={mode}
              sido={region}
              partyData={partyGridByYear}
              campData={campGridByYear}
              onSelectDistrict={handleSelectDistrict}
              periodLabel={periodLabel}
            />
            {/* 진영 추이 차트 (교육감/진영모드에서만) */}
            {mode === 'camp' && campTrend.length > 0 && (
              <div className="card">
                <h3 className="text-base font-bold mb-1">진영별 평균 득표율 추이</h3>
                <p className="text-xs text-[var(--muted)] mb-4">{sec.camp_trend?.summary}</p>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={campTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
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

        {/* ─── 시·군·구 드릴다운 (year 반영) ─── */}
        {/* strength_grid는 progressive/conservative_rate가 0이라 쓸모없음 → campGridByYear 사용 */}
        {tab === 'drilldown' && (
          <DistrictDrilldownPanel
            drilldown={drilldown}
            cells={(campGridByYear?.cells || []).map((c: any) => ({
              district: c.district,
              margin: c.gap || 0,
              dominant: c.dominant,
              progressive_rate: c.progressive_rate,
              conservative_rate: c.conservative_rate,
              strength: c.tier,
            }))}
            selectedDistrict={selectedDistrict}
            onSelect={setSelectedDistrict}
            sido={region}
            yearFilter={aggregate ? null : year}
          />
        )}

        {/* ─── 읍·면·동 (진영 모드 전달 + year) ─── */}
        {tab === 'dong' && (
          <DongDrilldown
            electionId={electionId}
            year={year}
            initialSigungu={selectedDistrict}
            viewMode={mode}
          />
        )}

        {/* ─── 역대 후보 (교육감) ─── */}
        {tab === 'candidates' && (
          <CandidateStrongholds candidates={sec.candidate_strongholds?.candidates || []} campMap={campMap} />
        )}

        {/* ─── 정당 추이 ─── */}
        {tab === 'party' && <RawPartyTrendChart data={sec.raw_party_trend} />}

        {/* ─── 투표율 ─── */}
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

        {/* ─── AI 전략 ─── */}
        {tab === 'ai' && (
          <StructuredAIStrategy
            electionId={electionId}
            initial={sec.ai_strategy || { text: '', structured: null, ai_generated: false }}
            onRefresh={onRefresh}
          />
        )}
      </div>
    </div>
  );
}
