'use client';
import { useState, useEffect, useMemo } from 'react';
import { useElection, getCandidateColorMap } from '@/hooks/useElection';
import { api } from '@/services/api';
import { SearchTrendLine, CANDIDATE_COLORS } from '@/components/charts';
import AlertCard from '@/components/cards/AlertCard';

export default function TrendsPage() {
  const { election, candidates, candidateNames, ourCandidate, loading: elLoading } = useElection();
  const colorMap = useMemo(() => getCandidateColorMap(candidates), [candidates]);
  const [trends, setTrends] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);

  useEffect(() => {
    if (election) loadTrends();
  }, [election]);

  const loadTrends = async () => {
    if (!election) return;
    setLoading(true);
    try {
      const data = await api.getKeywordTrends(election.id, 30);
      setTrends(data);
    } catch {} finally { setLoading(false); }
  };

  const handleCollect = async () => {
    if (!election) return;
    setCollecting(true);
    try {
      await api.collectTrendsNow(election.id);
      await loadTrends();
    } catch {} finally { setCollecting(false); }
  };

  if (elLoading || loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" /></div>;
  if (!election) return <div className="card text-center py-12 text-gray-500">선거를 먼저 설정해주세요.</div>;

  const candTrends = trends?.candidates || {};
  const issueTrends = trends?.issues || {};
  const alerts = (trends?.alerts || []).map((a: any) => ({ ...a, title: a.level === 'critical' ? '검색량 위기' : a.level === 'opportunity' ? '이슈 선점 기회' : '주의', time: '실시간' }));

  // 후보별 차트 데이터
  const candChartData: any[] = [];
  const allDates = new Set<string>();
  Object.values(candTrends).forEach((t: any) => t.data?.forEach((d: any) => allDates.add(d.date)));
  Array.from(allDates).sort().forEach(date => {
    const row: any = { date: date.substring(5) }; // MM-DD
    Object.entries(candTrends).forEach(([name, t]: [string, any]) => {
      const point = t.data?.find((d: any) => d.date === date);
      row[name] = point?.ratio || 0;
    });
    candChartData.push(row);
  });

  // 이슈 차트 데이터
  const issueChartData: any[] = [];
  const issueDates = new Set<string>();
  Object.values(issueTrends).forEach((t: any) => t.data?.forEach((d: any) => issueDates.add(d.date)));
  Array.from(issueDates).sort().forEach(date => {
    const row: any = { date: date.substring(5) };
    Object.entries(issueTrends).forEach(([name, t]: [string, any]) => {
      const point = t.data?.find((d: any) => d.date === date);
      row[name] = point?.ratio || 0;
    });
    issueChartData.push(row);
  });

  // 최고 검색량 후보
  const maxCand = Object.entries(candTrends).sort((a: any, b: any) => b[1].latest - a[1].latest)[0];
  const ourData = ourCandidate ? candTrends[ourCandidate.name] : null;
  const maxRatio = maxCand ? (maxCand[1] as any).latest : 0;

  const trendLabels: Record<string, string> = { rising: '📈 상승', falling: '📉 하락', stable: '➡️ 유지', insufficient: '⏳ 데이터 부족', new: '🆕 신규' };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">실시간 검색 트렌드</h1>
          <p className="text-gray-500 mt-1">네이버 DataLab 기반 | {trends?.period || '최근 30일'}</p>
        </div>
        <button onClick={handleCollect} disabled={collecting} className="btn-primary text-sm">
          {collecting ? '수집 중...' : '🔄 지금 업데이트'}
        </button>
      </div>

      {/* AI 분석 */}
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-200 p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">🤖</span>
          <h3 className="font-bold text-amber-900">AI 검색 트렌드 분석</h3>
          <span className="text-xs bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full">실시간 데이터</span>
        </div>
        <p className="text-sm text-gray-700 leading-relaxed">
          {ourCandidate && ourData ? (
            <>
              <strong>{ourCandidate.name}</strong> 후보의 검색량({ourData.latest.toFixed(1)})은
              최고치({maxCand?.[0]} {maxRatio.toFixed(1)}) 대비 <strong>{maxRatio > 0 ? Math.round(ourData.latest / maxRatio * 100) : 0}%</strong> 수준입니다.
              {ourData.latest / maxRatio < 0.3 ? ' 유권자 인지도 제고를 위한 적극적 미디어 노출이 시급합니다.' :
               ourData.latest / maxRatio < 0.6 ? ' 검색량 강화가 필요합니다.' : ' 양호한 수준입니다.'}
              {' '}추세: {trendLabels[ourData.trend] || ourData.trend}
            </>
          ) : '후보별 검색 트렌드를 분석합니다.'}
        </p>
      </div>

      {/* 알림 */}
      <AlertCard alerts={alerts} />

      {/* 후보별 검색량 카드 */}
      <div className={`grid grid-cols-1 md:grid-cols-${Math.min(Object.keys(candTrends).length, 4)} gap-4`}>
        {Object.entries(candTrends).sort((a: any, b: any) => b[1].latest - a[1].latest).map(([name, data]: [string, any]) => {
          const cand = candidates.find(c => c.name === name);
          const pctOfMax = maxRatio > 0 ? Math.round(data.latest / maxRatio * 100) : 0;
          return (
            <div key={name} className={`card ${cand?.is_our_candidate ? 'ring-2 ring-blue-400' : ''}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colorMap[name] }} />
                  <span className="font-semibold">{name}</span>
                  {cand?.is_our_candidate && <span className="text-xs text-blue-500">(우리)</span>}
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100">{trendLabels[data.trend]}</span>
              </div>
              <p className="text-3xl font-bold" style={{ color: colorMap[name] }}>{data.latest.toFixed(1)}</p>
              <p className="text-xs text-gray-400 mt-1">7일 평균: {data.avg_7d.toFixed(1)} | 30일: {data.avg_30d.toFixed(1)}</p>
              <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${pctOfMax}%`, backgroundColor: colorMap[name] }} />
              </div>
              <p className="text-xs text-gray-400 mt-1 text-right">최고 대비 {pctOfMax}%</p>
            </div>
          );
        })}
      </div>

      {/* 후보별 검색량 추이 차트 */}
      {candChartData.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-4">후보별 검색량 추이 (30일)</h3>
          <SearchTrendLine data={candChartData} keywords={Object.keys(candTrends)} />
        </div>
      )}

      {/* 이슈 키워드 */}
      {Object.keys(issueTrends).length > 0 && (
        <>
          <div className="card">
            <h3 className="font-semibold mb-4">이슈 키워드 검색 트렌드</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              {Object.entries(issueTrends).sort((a: any, b: any) => b[1].latest - a[1].latest).map(([issue, data]: [string, any], i) => (
                <div key={issue} className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-gray-800">{data.latest.toFixed(1)}</p>
                  <p className="text-sm font-medium text-gray-600">{issue}</p>
                  <p className="text-xs text-gray-400">{trendLabels[data.trend]}</p>
                </div>
              ))}
            </div>
            {issueChartData.length > 0 && (
              <SearchTrendLine data={issueChartData} keywords={Object.keys(issueTrends)} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
