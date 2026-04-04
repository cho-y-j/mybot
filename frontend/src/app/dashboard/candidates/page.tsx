'use client';
import { useState, useEffect, useMemo } from 'react';
import { useElection, getCandidateColorMap } from '@/hooks/useElection';
import { api } from '@/services/api';
import { CandidateNewsBar, SurveyTrendChart } from '@/components/charts';

export default function CandidateComparisonPage() {
  const { election, candidates, candidateNames, ourCandidate, overview, loading: elLoading } = useElection();
  const colorMap = useMemo(() => getCandidateColorMap(candidates), [candidates]);
  const [gaps, setGaps] = useState<any>(null);
  const [surveys, setSurveys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (election) loadData();
  }, [election]);

  const loadData = async () => {
    if (!election) return;
    setLoading(true);
    try {
      const [gp, sv] = await Promise.all([
        api.getCompetitorGaps(election.id).catch(() => null),
        api.getSurveys(election.id).catch(() => ({ surveys: [] })),
      ]);
      setGaps(gp);
      setSurveys(sv.surveys || []);
    } catch {} finally { setLoading(false); }
  };

  if (elLoading || loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" /></div>;
  if (!election) return <div className="card text-center py-12 text-gray-500">선거를 먼저 설정해주세요.</div>;

  const newsByCand = overview?.news_by_candidate || [];
  // Our candidate first
  const orderedCands = candidates.filter(c => c.enabled).sort((a, b) => {
    if (a.is_our_candidate) return -1;
    if (b.is_our_candidate) return 1;
    return 0;
  });
  const orderedNames = orderedCands.map(c => c.name);

  // Survey trend
  const parseResults = (r: any): Record<string, number> => {
    if (!r) return {};
    if (typeof r === 'string') { try { return JSON.parse(r); } catch { return {}; } }
    return r;
  };

  const trendData = surveys.filter(s => {
    const r = parseResults(s.results);
    return r && Object.keys(r).length > 0;
  }).reverse().map(s => {
    const r = parseResults(s.results);
    const row: any = { date: s.date?.substring(5) || '' };
    orderedNames.forEach(n => { row[n] = r[n] || 0; });
    return row;
  });

  // Latest survey results
  const latestSurvey = surveys.length > 0 ? parseResults(surveys[0].results) : {};

  // Gap analysis items
  const gapItems = gaps?.gaps || [];
  const strengthItems = gaps?.strengths || [];
  const parityItems = gaps?.parity || [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">후보 비교 분석</h1>

      {/* AI Gap Summary */}
      {gaps?.ai_summary && (
        <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl border border-purple-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">AI</span>
            <h3 className="font-bold text-purple-900">AI 경쟁 분석</h3>
            <span className="text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full">{gaps.analysis_period}</span>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">{gaps.ai_summary}</p>
        </div>
      )}

      {/* Candidate Profile Cards */}
      <div className={`grid grid-cols-1 md:grid-cols-${Math.min(orderedCands.length, 4)} gap-4`}>
        {orderedCands.map((c) => {
          const data = newsByCand.find((d: any) => d.name === c.name);
          const total = data ? data.positive + data.negative + data.neutral : 0;
          const posRate = total ? Math.round((data?.positive || 0) / total * 100) : 0;
          const surveyVal = latestSurvey[c.name] || 0;

          return (
            <div key={c.id} className={`card ${c.is_our_candidate ? 'ring-2 ring-blue-400 bg-blue-50/30' : ''}`}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-md"
                  style={{ backgroundColor: colorMap[c.name] }}>
                  {c.name[0]}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-lg">{c.name}</h3>
                    {c.is_our_candidate && <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">우리 후보</span>}
                  </div>
                  <p className="text-sm text-gray-500">{c.party || '무소속'} {c.party_alignment ? `(${c.party_alignment === 'conservative' ? '보수' : c.party_alignment === 'progressive' ? '진보' : '중도'})` : ''}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold" style={{ color: colorMap[c.name] }}>{surveyVal ? `${surveyVal}%` : '-'}</p>
                  <p className="text-xs text-gray-500">최근 지지율</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-gray-700">{data?.count || 0}</p>
                  <p className="text-xs text-gray-500">뉴스 건수</p>
                </div>
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{posRate}%</p>
                  <p className="text-xs text-gray-500">긍정률</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-red-600">{data?.negative || 0}</p>
                  <p className="text-xs text-gray-500">부정 뉴스</p>
                </div>
              </div>

              {/* Sentiment bar */}
              <div className="mt-4">
                <div className="h-2 rounded-full overflow-hidden flex bg-gray-100">
                  {total > 0 && <>
                    <div className="bg-green-500 h-full" style={{ width: `${(data?.positive || 0) / total * 100}%` }} />
                    <div className="bg-red-500 h-full" style={{ width: `${(data?.negative || 0) / total * 100}%` }} />
                    <div className="bg-gray-400 h-full" style={{ width: `${(data?.neutral || 0) / total * 100}%` }} />
                  </>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* News Sentiment Comparison */}
      {newsByCand.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-4">뉴스 감성 비교</h3>
          <CandidateNewsBar data={[...newsByCand].sort((a: any, b: any) => {
            if (a.is_ours) return -1;
            if (b.is_ours) return 1;
            return b.count - a.count;
          })} />
        </div>
      )}

      {/* Gap Analysis Table */}
      {gaps && (gapItems.length > 0 || strengthItems.length > 0 || parityItems.length > 0) && (
        <div className="card">
          <h3 className="font-semibold mb-4">경쟁자 대비 갭 분석</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {gapItems.length > 0 && (
              <div>
                <p className="text-xs font-bold text-red-600 mb-2 uppercase">부족 영역</p>
                <div className="space-y-2">
                  {gapItems.map((g: any, i: number) => (
                    <div key={i} className="bg-red-50 rounded-lg p-3 text-sm">
                      <p className="font-medium text-red-800">{g.area}</p>
                      {g.detail && <p className="text-red-600 text-xs mt-1">{g.detail}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {strengthItems.length > 0 && (
              <div>
                <p className="text-xs font-bold text-green-600 mb-2 uppercase">우위 영역</p>
                <div className="space-y-2">
                  {strengthItems.map((s: any, i: number) => (
                    <div key={i} className="bg-green-50 rounded-lg p-3 text-sm">
                      <p className="font-medium text-green-800">{s.area}</p>
                      {s.detail && <p className="text-green-600 text-xs mt-1">{s.detail}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {parityItems.length > 0 && (
              <div>
                <p className="text-xs font-bold text-gray-600 mb-2 uppercase">비슷한 영역</p>
                <div className="space-y-2">
                  {parityItems.map((p: any, i: number) => (
                    <div key={i} className="bg-gray-50 rounded-lg p-3 text-sm">
                      <p className="font-medium text-gray-800">{p.area}</p>
                      {p.detail && <p className="text-gray-500 text-xs mt-1">{p.detail}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Survey Trend */}
      {trendData.length >= 2 && (
        <div className="card">
          <h3 className="font-semibold mb-4">여론조사 지지율 추이</h3>
          <SurveyTrendChart data={trendData} candidates={orderedNames} />
        </div>
      )}

      {/* Detailed Comparison Table */}
      {newsByCand.length > 0 && (
        <div className="card overflow-x-auto">
          <h3 className="font-semibold mb-4">지표별 상세 비교</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left p-3 text-gray-500 font-medium">지표</th>
                {orderedCands.map(c => (
                  <th key={c.id} className="text-center p-3 font-semibold" style={{ color: colorMap[c.name] }}>
                    {c.name} {c.is_our_candidate && '(*)'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* News count */}
              <tr className="border-b border-gray-100 hover:bg-gray-50">
                <td className="p-3 font-medium">뉴스 건수</td>
                {orderedCands.map(c => {
                  const d = newsByCand.find((n: any) => n.name === c.name);
                  return <td key={c.id} className="text-center p-3 font-bold">{d?.count || 0}</td>;
                })}
              </tr>
              {/* Positive rate */}
              <tr className="border-b border-gray-100 hover:bg-gray-50">
                <td className="p-3 font-medium">긍정률</td>
                {orderedCands.map(c => {
                  const d = newsByCand.find((n: any) => n.name === c.name);
                  const total = d ? d.positive + d.negative + d.neutral : 0;
                  const rate = total ? Math.round(d.positive / total * 100) : 0;
                  return <td key={c.id} className="text-center p-3 font-bold text-green-600">{rate}%</td>;
                })}
              </tr>
              {/* Negative count */}
              <tr className="border-b border-gray-100 hover:bg-gray-50">
                <td className="p-3 font-medium">부정 뉴스</td>
                {orderedCands.map(c => {
                  const d = newsByCand.find((n: any) => n.name === c.name);
                  return <td key={c.id} className="text-center p-3 font-bold text-red-600">{d?.negative || 0}</td>;
                })}
              </tr>
              {/* Latest survey */}
              <tr className="border-b border-gray-100 hover:bg-gray-50">
                <td className="p-3 font-medium">최근 지지율</td>
                {orderedCands.map(c => {
                  const val = latestSurvey[c.name];
                  return <td key={c.id} className="text-center p-3 font-bold">{val ? `${val}%` : '-'}</td>;
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
