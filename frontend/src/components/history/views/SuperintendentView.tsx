'use client';
import { useState, useMemo } from 'react';
import HistorySummaryCards from '@/components/history/HistorySummaryCards';
import CampHeatmap from '@/components/history/CampHeatmap';
import DistrictDrilldownPanel from '@/components/history/DistrictDrilldownPanel';
import DongDrilldown from '@/components/history/DongDrilldown';
import CandidateStrongholds from '@/components/history/CandidateStrongholds';
import SigunguTurnoutChart from '@/components/history/SigunguTurnoutChart';
import StructuredAIStrategy from '@/components/history/StructuredAIStrategy';
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

  // 후보별 진영 매핑 lookup (camp_grid의 latest_winner_camp + drilldown 정보)
  const campMap = useMemo(() => {
    const m: Record<string, string> = {};
    (sec.camp_grid?.cells || []).forEach((c: any) => {
      if (c.latest_winner && c.latest_winner_camp) m[c.latest_winner] = c.latest_winner_camp;
    });
    return m;
  }, [sec.camp_grid]);

  function handleSelectDistrict(d: string) {
    setSelectedDistrict(d);
    setTab('dong');  // 시군 카드 클릭 → 동 단위 탭으로
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

      <div>
        {tab === 'camp' && (
          <div className="space-y-4">
            <CampHeatmap data={sec.camp_grid} onSelectDistrict={handleSelectDistrict} />
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
            drilldown={sec.district_drilldown || {}}
            cells={sec.strength_grid?.cells || []}
            selectedDistrict={selectedDistrict}
            onSelect={setSelectedDistrict}
          />
        )}
        {tab === 'dong' && <DongDrilldown electionId={electionId} initialSigungu={selectedDistrict} />}
        {tab === 'turnout' && <SigunguTurnoutChart rows={sec.sigungu_turnout || []} />}
        {tab === 'ai' && <StructuredAIStrategy electionId={electionId} initial={sec.ai_strategy || { text: '', structured: null, ai_generated: false }} onRefresh={onRefresh} />}
      </div>
    </div>
  );
}
