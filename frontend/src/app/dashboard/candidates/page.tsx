'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useElection, getCandidateColorMap } from '@/hooks/useElection';
import { api } from '@/services/api';
import { CandidateNewsBar, SurveyTrendChart } from '@/components/charts';
import ComparisonViz, { CandStats } from '@/components/candidates/ComparisonViz';

export default function CandidateComparisonPage() {
  const router = useRouter();
  const { election, candidates, candidateNames, ourCandidate, loading: elLoading } = useElection();
  const colorMap = useMemo(() => getCandidateColorMap(candidates), [candidates]);
  const [gaps, setGaps] = useState<any>(null);
  const [surveys, setSurveys] = useState<any[]>([]);
  const [mediaData, setMediaData] = useState<any>(null);
  const [overview, setOverview] = useState<any>(null);  // period 반영을 위해 직접 관리
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [expandedAI, setExpandedAI] = useState(false);
  // 기간 토글 — 1(일간) / 7(주간) / 30(월간)
  const [period, setPeriod] = useState<1 | 7 | 30>(7);

  useEffect(() => {
    if (election) loadData();
  }, [election?.id, period]);

  const loadData = async () => {
    if (!election) return;
    setLoading(true);
    try {
      const [gp, sv, md, ov] = await Promise.all([
        api.getCompetitorGaps(election.id, period).catch(() => null),
        api.getSurveys(election.id).catch(() => ({ surveys: [] })),
        api.getMediaOverview(election.id, period).catch(() => null),
        api.getAnalysisOverview(election.id, period).catch(() => null),
      ]);
      setGaps(gp);
      setSurveys(sv.surveys || []);
      setMediaData(md);
      setOverview(ov);
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
  if (!election) return <div className="card text-center py-12 text-[var(--muted)]">선거를 먼저 설정해주세요.</div>;

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
    orderedNames.forEach(n => {
      const v = r[n];
      row[n] = (typeof v === 'number' && v > 0) ? v : null;
    });
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

  // Gap analysis items — area 기준 dedup (같은 area가 여러 경쟁자에 대해 반복되는 중복 제거)
  const dedupByArea = (items: any[]): any[] => {
    const map = new Map<string, any>();
    items.forEach(it => {
      const key = it.area || '';
      if (!map.has(key)) {
        map.set(key, { ...it, details: [it.detail].filter(Boolean), recommendations: [it.recommendation].filter(Boolean) });
      } else {
        const existing = map.get(key);
        if (it.detail && !existing.details.includes(it.detail)) existing.details.push(it.detail);
        if (it.recommendation && !existing.recommendations.includes(it.recommendation)) existing.recommendations.push(it.recommendation);
      }
    });
    return Array.from(map.values());
  };

  const gapItems = dedupByArea(gaps?.gaps || []);
  const strengthItems = dedupByArea(gaps?.strengths || []);
  const parityItems = dedupByArea(gaps?.parity || []);

  const periodLabel = period === 1 ? '최근 1일' : period === 7 ? '최근 7일' : '최근 30일';

  return (
    <div className="space-y-5">
      {/* 헤더 + 기간 토글 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">후보 비교 분석</h1>
          <p className="text-sm text-[var(--muted)]">{periodLabel} 기준 지표 비교</p>
        </div>
        <div className="flex items-center gap-1 bg-[var(--muted-bg)] rounded-lg p-1">
          {([[1, '일간'], [7, '주간'], [30, '월간']] as [1|7|30, string][]).map(([v, label]) => (
            <button key={v} onClick={() => setPeriod(v)}
              className={`px-3 py-1.5 rounded-md text-xs transition font-medium ${period === v ? 'bg-[var(--card-bg)] shadow text-[var(--foreground)]' : 'text-[var(--muted)]'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* AI 요약 — 압축 (2~3줄) + 전체 보기 토글 */}
      {gaps?.ai_summary && (
        <div className="card bg-blue-500/5 border-blue-500/20">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm">AI 경쟁 분석</h3>
              <span className="text-[10px] bg-blue-500/10 text-blue-500 px-2 py-0.5 rounded-full">{gaps.analysis_period}</span>
              {gaps.cached && (
                <span className="text-[10px] text-[var(--muted)]">캐시</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setExpandedAI(!expandedAI)} className="text-xs text-blue-500 hover:underline">
                {expandedAI ? '접기' : '전체 보기'}
              </button>
              <button onClick={handleRefreshAnalysis} disabled={analyzing}
                className="px-2.5 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50">
                {analyzing ? '분석 중...' : '재분석'}
              </button>
            </div>
          </div>
          <p className={`text-sm leading-relaxed whitespace-pre-line ${!expandedAI ? 'line-clamp-2' : ''}`}>
            {gaps.ai_summary}
          </p>
        </div>
      )}
      {!gaps?.ai_summary && (
        <div className="card text-center py-5">
          <button onClick={handleRefreshAnalysis} disabled={analyzing}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
            {analyzing ? 'AI 분석 중...' : 'AI 경쟁 분석 실행'}
          </button>
          <p className="text-xs text-[var(--muted)] mt-2">경쟁자 대비 갭 분석 + AI 요약 생성</p>
        </div>
      )}

      {/* ═══ 5층 시각화 (메인): 점수 + 레이더 + 갭바 + 히트맵 + AI 약점 ═══ */}
      {(() => {
        if (newsByCand.length === 0 && !mediaData) return null;
        const vizStats: CandStats[] = orderedCands.map(c => {
          const d = newsByCand.find((n: any) => n.name === c.name);
          const md = (mediaData?.candidates || []).find((m: any) => m.name === c.name);
          const eff = d ? (d.positive || 0) + (d.negative || 0) : 0;
          const yt = md?.youtube || {};
          return {
            id: c.id,
            name: c.name,
            is_our_candidate: !!c.is_our_candidate,
            color: colorMap[c.name] || '#64748b',
            newsCount: d?.count || 0,
            posRate: eff > 0 ? Math.round((d?.positive || 0) / eff * 100) : 0,
            negCount: d?.negative || 0,
            surveyVal: latestSurvey[c.name] || 0,
            ytViews: yt.views || 0,
            ytEngRate: yt.views > 0 ? ((yt.likes + yt.comments) / yt.views * 100) : 0,
            cmCount: md?.community?.count || 0,
            reachScore: md?.reach_score || 0,
          };
        });
        return (
          <ComparisonViz
            stats={vizStats}
            periodLabel={periodLabel}
            onNavigate={(route) => router.push(route)}
          />
        );
      })()}

      {/* ═══ 상세 숫자 테이블 (접기 기본, 검증용) ═══ */}
      {newsByCand.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer font-semibold text-sm flex items-center gap-2 hover:text-blue-500">
            상세 숫자 테이블 · 숫자 확인용
            <span className="text-xs text-[var(--muted)] font-normal">(펼쳐보기)</span>
          </summary>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b border-[var(--card-border)]">
                  <th className="text-left p-2.5 text-[var(--muted)] font-medium w-24">지표</th>
                  {orderedCands.map(c => (
                    <th key={c.id} className={`text-center p-2.5 font-bold ${c.is_our_candidate ? 'bg-blue-500/5' : ''}`} style={{ color: colorMap[c.name] }}>
                      {c.name}
                      {c.is_our_candidate && <span className="block text-[9px] font-normal text-blue-500">우리</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[var(--card-border)]/50">
                  <td className="p-2.5 text-[var(--muted)]">뉴스 건수</td>
                  {orderedCands.map(c => {
                    const d = newsByCand.find((n: any) => n.name === c.name);
                    return <td key={c.id} className="text-center p-2.5">{d?.count || 0}</td>;
                  })}
                </tr>
                <tr className="border-b border-[var(--card-border)]/50">
                  <td className="p-2.5 text-[var(--muted)]">긍정률</td>
                  {orderedCands.map(c => {
                    const d = newsByCand.find((n: any) => n.name === c.name);
                    const eff = d ? (d.positive || 0) + (d.negative || 0) : 0;
                    const r = eff > 0 ? Math.round((d?.positive || 0) / eff * 100) : 0;
                    return <td key={c.id} className="text-center p-2.5">{eff > 0 ? `${r}%` : '-'}</td>;
                  })}
                </tr>
                <tr className="border-b border-[var(--card-border)]/50">
                  <td className="p-2.5 text-[var(--muted)]">부정 뉴스</td>
                  {orderedCands.map(c => {
                    const d = newsByCand.find((n: any) => n.name === c.name);
                    return <td key={c.id} className="text-center p-2.5">{d?.negative || 0}</td>;
                  })}
                </tr>
                <tr className="border-b border-[var(--card-border)]/50">
                  <td className="p-2.5 text-[var(--muted)]">최근 지지율 <span className="text-[9px]">(최신 1건)</span></td>
                  {orderedCands.map(c => {
                    const v = latestSurvey[c.name];
                    return <td key={c.id} className="text-center p-2.5">{v ? `${v}%` : '-'}</td>;
                  })}
                </tr>
                <tr className="border-b border-[var(--card-border)]/50">
                  <td className="p-2.5 text-[var(--muted)]">유튜브 조회</td>
                  {orderedCands.map(c => {
                    const md = (mediaData?.candidates || []).find((m: any) => m.name === c.name);
                    return <td key={c.id} className="text-center p-2.5">{md?.youtube?.views ? md.youtube.views.toLocaleString() : '-'}</td>;
                  })}
                </tr>
                <tr className="border-b border-[var(--card-border)]/50">
                  <td className="p-2.5 text-[var(--muted)]">유튜브 참여율</td>
                  {orderedCands.map(c => {
                    const md = (mediaData?.candidates || []).find((m: any) => m.name === c.name);
                    const yt = md?.youtube || {};
                    const e = yt.views > 0 ? ((yt.likes + yt.comments) / yt.views * 100).toFixed(2) : null;
                    return <td key={c.id} className="text-center p-2.5">{e ? `${e}%` : '-'}</td>;
                  })}
                </tr>
                <tr className="border-b border-[var(--card-border)]/50">
                  <td className="p-2.5 text-[var(--muted)]">커뮤니티 언급</td>
                  {orderedCands.map(c => {
                    const md = (mediaData?.candidates || []).find((m: any) => m.name === c.name);
                    return <td key={c.id} className="text-center p-2.5">{md?.community?.count || 0}</td>;
                  })}
                </tr>
                <tr>
                  <td className="p-2.5 text-[var(--muted)] font-semibold">도달 점수</td>
                  {orderedCands.map(c => {
                    const md = (mediaData?.candidates || []).find((m: any) => m.name === c.name);
                    return <td key={c.id} className="text-center p-2.5 font-bold text-blue-500">{md?.reach_score ? md.reach_score.toLocaleString() : '-'}</td>;
                  })}
                </tr>
              </tbody>
            </table>
            <p className="text-[10px] text-[var(--muted)] mt-2">
              * 뉴스/유튜브/커뮤니티는 {periodLabel}. 여론조사는 최신 1건 기준(기간 무관).
            </p>
          </div>
        </details>
      )}

      {/* Candidate Profile Cards — 간소화 (이름/소속/최근 지지율만) */}
      <div className={`grid grid-cols-1 ${orderedCands.length <= 2 ? 'md:grid-cols-2' : orderedCands.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-4 xl:grid-cols-5'} gap-3`}>
        {orderedCands.map((c) => {
          const surveyVal = latestSurvey[c.name] || 0;
          return (
            <div key={c.id} className={`card ${c.is_our_candidate ? 'ring-1 ring-blue-500/30 bg-blue-500/5' : ''}`}>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-md flex-shrink-0"
                  style={{ backgroundColor: colorMap[c.name] }}>
                  {c.name[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h3 className="font-bold truncate">{c.name}</h3>
                    {c.is_our_candidate && <span className="text-[10px] bg-blue-500/10 text-blue-500 px-1.5 py-0.5 rounded-full font-semibold">우리</span>}
                  </div>
                  <p className="text-[11px] text-[var(--muted)] truncate">
                    {c.party || '무소속'} {c.party_alignment ? `(${c.party_alignment === 'conservative' ? '보수' : c.party_alignment === 'progressive' ? '진보' : '중도'})` : ''}
                  </p>
                  {surveyVal > 0 && (
                    <p className="text-xs font-bold mt-0.5" style={{ color: colorMap[c.name] }}>
                      지지율 {surveyVal}%
                    </p>
                  )}
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
                <p className="text-xs font-bold text-red-600 mb-2 uppercase tracking-wider">부족 영역</p>
                <div className="space-y-2">
                  {gapItems.map((g: any, i: number) => (
                    <div key={i} className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 text-sm">
                      <p className="font-semibold text-red-600">{g.area}</p>
                      {(g.details || []).map((d: string, j: number) => (
                        <p key={j} className="text-[var(--muted)] text-xs mt-1">• {d}</p>
                      ))}
                      {(g.recommendations || []).map((r: string, j: number) => (
                        <p key={j} className="text-red-500 text-xs mt-1">→ {r}</p>
                      ))}
                      {g.quality_warning && <p className="text-amber-500 text-[10px] mt-1">* 분석 품질 낮음</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {strengthItems.length > 0 && (
              <div>
                <p className="text-xs font-bold text-green-600 mb-2 uppercase tracking-wider">우위 영역</p>
                <div className="space-y-2">
                  {strengthItems.map((s: any, i: number) => (
                    <div key={i} className="bg-green-500/5 border border-green-500/20 rounded-lg p-3 text-sm">
                      <p className="font-semibold text-green-600">{s.area}</p>
                      {(s.details || []).map((d: string, j: number) => (
                        <p key={j} className="text-[var(--muted)] text-xs mt-1">• {d}</p>
                      ))}
                      {s.quality_warning && <p className="text-amber-500 text-[10px] mt-1">* 분석 품질 낮음</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {parityItems.length > 0 && (
              <div>
                <p className="text-xs font-bold text-[var(--muted)] mb-2 uppercase tracking-wider">비슷한 영역</p>
                <div className="space-y-2">
                  {parityItems.map((p: any, i: number) => (
                    <div key={i} className="bg-[var(--muted-bg)] rounded-lg p-3 text-sm">
                      <p className="font-semibold">{p.area}</p>
                      {(p.details || []).map((d: string, j: number) => (
                        <p key={j} className="text-[var(--muted)] text-xs mt-1">• {d}</p>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Survey Trend */}
      <div className="card">
        <h3 className="font-semibold mb-4">여론조사 지지율 추이</h3>
        {trendData.length >= 2 ? (
          <SurveyTrendChart data={trendData} candidates={orderedNames} />
        ) : trendData.length === 1 ? (
          <div className="text-center py-8 text-sm text-[var(--muted)]">
            <p>여론조사 1건만 수집됨 — 추이 그래프는 **2건 이상** 필요합니다.</p>
            <p className="text-xs mt-2">여론조사 메뉴에서 추가 입력 가능.</p>
          </div>
        ) : (
          <div className="text-center py-8 text-sm text-[var(--muted)]">
            <p>아직 여론조사 자료가 없습니다.</p>
            <p className="text-xs mt-2"> 여론조사 메뉴에서 공표된 결과를 입력하면 자동으로 추이 그래프가 표시됩니다.</p>
          </div>
        )}
      </div>

    </div>
  );
}
