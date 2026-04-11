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
  const [mediaData, setMediaData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (election) loadData();
  }, [election]);

  const loadData = async () => {
    if (!election) return;
    setLoading(true);
    try {
      const [gp, sv, md] = await Promise.all([
        api.getCompetitorGaps(election.id).catch(() => null),
        api.getSurveys(election.id).catch(() => ({ surveys: [] })),
        api.getMediaOverview(election.id).catch(() => null),
      ]);
      setGaps(gp);
      setSurveys(sv.surveys || []);
      setMediaData(md);
    } catch (e: any) {
      console.error('candidates load error:', e);
    } finally { setLoading(false); }
  };

  const handleRefreshAnalysis = async () => {
    if (!election) return;
    setAnalyzing(true);
    try {
      const gp = await api.getCompetitorGaps(election.id, 7, true);
      setGaps(gp);
    } catch (e: any) {
      console.error('refresh error:', e);
    } finally { setAnalyzing(false); }
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

  // Survey trend — 중첩 구조도 풀어서 후보별 지지율 추출
  const parseResults = (r: any): Record<string, number> => {
    if (!r) return {};
    let data = r;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return {}; } }

    const flat: Record<string, number> = {};
    for (const [key, val] of Object.entries(data)) {
      if (typeof val === 'number') {
        flat[key] = val;
      } else if (typeof val === 'object' && val !== null) {
        // 중첩 구조: {"교육감지지도": {"김진균": 8.1, ...}} → 풀기
        for (const [k2, v2] of Object.entries(val as any)) {
          if (typeof v2 === 'number' && orderedNames.some(n => k2.includes(n) || n.includes(k2))) {
            flat[k2] = v2 as number;
          }
        }
      }
    }
    return flat;
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

  // Latest survey results — 후보 이름이 있는 가장 최신 여론조사 찾기
  let latestSurvey: Record<string, number> = {};
  for (const s of surveys) {
    const parsed = parseResults(s.results);
    if (orderedNames.some(n => parsed[n] > 0)) {
      latestSurvey = parsed;
      break;
    }
  }

  // Gap analysis items
  const gapItems = gaps?.gaps || [];
  const strengthItems = gaps?.strengths || [];
  const parityItems = gaps?.parity || [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">후보 비교 분석</h1>

      {/* AI Gap Summary */}
      {gaps?.ai_summary && (
        <div className="bg-gradient-to-r from-purple-500/5 to-pink-500/5 rounded-xl border border-purple-500/20 p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-lg">AI</span>
              <h3 className="font-bold">AI 경쟁 분석</h3>
              <span className="text-xs bg-purple-500/10 text-purple-500 px-2 py-0.5 rounded-full">{gaps.analysis_period}</span>
              {gaps.cached && (
                <span className="text-[10px] text-[var(--muted)]">캐시 ({gaps.cached_at?.substring(5, 16)})</span>
              )}
            </div>
            <button onClick={handleRefreshAnalysis} disabled={analyzing}
              className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs hover:bg-purple-700 disabled:opacity-50">
              {analyzing ? 'AI 분석 중...' : 'AI 재분석'}
            </button>
          </div>
          <p className="text-sm leading-relaxed">{gaps.ai_summary}</p>
        </div>
      )}
      {!gaps?.ai_summary && (
        <div className="card text-center py-6">
          <button onClick={handleRefreshAnalysis} disabled={analyzing}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 disabled:opacity-50">
            {analyzing ? 'AI 분석 중...' : 'AI 경쟁 분석 실행'}
          </button>
          <p className="text-xs text-[var(--muted)] mt-2">경쟁자 대비 갭 분석 + AI 요약을 생성합니다</p>
        </div>
      )}

      {/* Candidate Profile Cards */}
      <div className={`grid grid-cols-1 ${orderedCands.length === 1 ? 'md:grid-cols-1' : orderedCands.length === 2 ? 'md:grid-cols-2' : orderedCands.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-4'} gap-4`}>
        {orderedCands.map((c) => {
          const data = newsByCand.find((d: any) => d.name === c.name);
          const total = data ? data.positive + data.negative + data.neutral : 0;
          const effective = (data?.positive || 0) + (data?.negative || 0);
          const posRate = effective > 0 ? Math.round((data?.positive || 0) / effective * 100) : 0;
          const qualityLow = (data?.analysis_quality === 'low');
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
                  <p className="text-xs text-gray-500">긍정률 {effective > 0 ? `(${effective}건)` : ''}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-red-600">{data?.negative || 0}</p>
                  <p className="text-xs text-gray-500">부정 뉴스</p>
                </div>
              {qualityLow && (
                <div className="col-span-2 bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-700 text-center">
                  분석 품질 낮음 — 중립 {data?.neutral_rate}% (재분석 필요)
                </div>
              )}
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
                      {g.recommendation && <p className="text-red-500 text-xs mt-1">{g.recommendation}</p>}
                      {g.quality_warning && <p className="text-amber-600 text-[10px] mt-1">* 분석 품질 낮음 — 재분석 후 재확인 필요</p>}
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
                      {s.quality_warning && <p className="text-amber-600 text-[10px] mt-1">* 분석 품질 낮음 — 재분석 후 재확인 필요</p>}
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
              {/* Positive rate (neutral 제외 유효 감성 기준) */}
              <tr className="border-b border-gray-100 hover:bg-gray-50">
                <td className="p-3 font-medium">긍정률</td>
                {orderedCands.map(c => {
                  const d = newsByCand.find((n: any) => n.name === c.name);
                  const eff = d ? (d.positive || 0) + (d.negative || 0) : 0;
                  const rate = eff > 0 ? Math.round(d.positive / eff * 100) : 0;
                  return <td key={c.id} className="text-center p-3 font-bold text-green-600">
                    {rate}%
                    {d?.analysis_quality === 'low' && <span className="block text-[10px] text-amber-500 font-normal">분석 품질 낮음</span>}
                  </td>;
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
              {/* YouTube views */}
              <tr className="border-b border-[var(--card-border)]/50 hover:bg-[var(--muted-bg)]/30">
                <td className="p-3 font-medium">유튜브 조회수</td>
                {orderedCands.map(c => {
                  const md = (mediaData?.candidates || []).find((m: any) => m.name === c.name);
                  return <td key={c.id} className="text-center p-3 font-bold">{md?.youtube?.views ? md.youtube.views.toLocaleString() : '-'}</td>;
                })}
              </tr>
              {/* YouTube engagement */}
              <tr className="border-b border-[var(--card-border)]/50 hover:bg-[var(--muted-bg)]/30">
                <td className="p-3 font-medium">유튜브 참여율</td>
                {orderedCands.map(c => {
                  const md = (mediaData?.candidates || []).find((m: any) => m.name === c.name);
                  const yt = md?.youtube || {};
                  const engRate = yt.views > 0 ? ((yt.likes + yt.comments) / yt.views * 100).toFixed(2) : null;
                  return <td key={c.id} className="text-center p-3 font-bold">{engRate ? `${engRate}%` : '-'}</td>;
                })}
              </tr>
              {/* Community */}
              <tr className="border-b border-[var(--card-border)]/50 hover:bg-[var(--muted-bg)]/30">
                <td className="p-3 font-medium">커뮤니티 언급</td>
                {orderedCands.map(c => {
                  const md = (mediaData?.candidates || []).find((m: any) => m.name === c.name);
                  return <td key={c.id} className="text-center p-3 font-bold">{md?.community?.count || 0}</td>;
                })}
              </tr>
              {/* Reach score */}
              <tr className="border-b border-[var(--card-border)]/50 hover:bg-[var(--muted-bg)]/30">
                <td className="p-3 font-medium">도달 점수</td>
                {orderedCands.map(c => {
                  const md = (mediaData?.candidates || []).find((m: any) => m.name === c.name);
                  return <td key={c.id} className="text-center p-3 font-black text-blue-500">{md?.reach_score ? md.reach_score.toLocaleString() : '-'}</td>;
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
