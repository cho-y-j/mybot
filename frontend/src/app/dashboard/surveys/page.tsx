'use client';
import { useState, useEffect, useMemo } from 'react';
import { useElection } from '@/hooks/useElection';
import { api } from '@/services/api';
import { CANDIDATE_COLORS } from '@/components/charts';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
} from 'recharts';

type TabType = 'overview' | 'crosstab' | 'trend' | 'add';

export default function SurveysPage() {
  const { election, candidates, ourCandidate, loading: elLoading } = useElection();
  const [surveys, setSurveys] = useState<any[]>([]);
  const [deepData, setDeepData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [tab, setTab] = useState<TabType>('overview');
  const [expandedAI, setExpandedAI] = useState(false);
  const [selectedSurveyId, setSelectedSurveyId] = useState<string | null>(null);
  const [selectedCrosstabs, setSelectedCrosstabs] = useState<any>(null);
  const [loadingCrosstab, setLoadingCrosstab] = useState(false);

  // 후보 이름 (우리 후보 우선)
  const candNames = useMemo(() => {
    const enabled = candidates.filter(c => c.enabled).map(c => c.name);
    if (!ourCandidate) return enabled;
    return [ourCandidate.name, ...enabled.filter(n => n !== ourCandidate.name)];
  }, [candidates, ourCandidate]);

  // 교육감 후보 매칭 키 (candNames가 빈 경우에도 작동하도록 기본 후보명 포함)
  const defaultNames = ['윤건영', '김진균', '김성근', '신문규', '조동욱'];
  const allNames = candNames.length > 0 ? candNames : defaultNames;
  const matchKeys = useMemo(() => new Set([...allNames, '모름', '없음', '모름/무응답', '기타', '기타 인물']), [allNames]);
  const isMatch = (k: string) => matchKeys.has(k) || allNames.some(cn => k.includes(cn) || cn.includes(k));

  useEffect(() => {
    if (election) { loadSurveys(); }
  }, [election?.id]);

  const loadSurveys = async () => {
    if (!election) return;
    try {
      const d = await api.getSurveys(election.id);
      setSurveys(d.surveys || []);
    } catch (e: any) {
      console.error('survey load error:', e);
    } finally { setLoading(false); }
  };

  const loadDeepAnalysis = async () => {
    if (!election) return;
    setAnalyzing(true);
    try { setDeepData(await api.getSurveyDeepAnalysis(election.id)); }
    catch {} finally { setAnalyzing(false); }
  };

  const loadCrosstab = async (surveyId: string) => {
    if (!election) return;
    setLoadingCrosstab(true);
    setSelectedSurveyId(surveyId);
    try {
      const d = await api.getSurveyCrosstabs(election.id, surveyId);
      setSelectedCrosstabs(d);
    } catch (e: any) {
      console.error('crosstab load error:', e);
      setSelectedCrosstabs(null);
    } finally { setLoadingCrosstab(false); }
  };

  if (elLoading || loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" /></div>;
  if (!election) return <div className="card text-center py-12 text-gray-500">선거를 먼저 설정해주세요.</div>;

  // ── 교육감 후보 데이터만 추출 ──
  const parseResults = (r: any): Record<string, number> => {
    if (!r) return {};
    if (typeof r === 'string') { try { r = JSON.parse(r); } catch { return {}; } }
    const flat: Record<string, number> = {};
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === 'number' && isMatch(k)) flat[k] = v;
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        for (const [sk, sv] of Object.entries(v as Record<string, any>)) {
          if (typeof sv === 'number' && isMatch(sk)) flat[sk] = sv;
        }
      }
    }
    return flat;
  };

  // 본인 선거 vs 참고 (다른 선거 유형) 분리
  // 백엔드에서 is_own_election 플래그 제공
  const ownSurveys = surveys.filter(s => s.is_own_election !== false && (() => {
    const r = parseResults(s.results); return Object.keys(r).length > 0;
  })());
  const referenceSurveys = surveys.filter(s => s.is_own_election === false);
  const eduSurveys = ownSurveys;  // 기존 변수 호환

  // ── 추이 차트 데이터 ──
  const trendData = [...eduSurveys].reverse().map(s => {
    const r = parseResults(s.results);
    const row: any = { date: s.date?.substring(2, 7)?.replace('-', '/') || '', org: s.org };
    allNames.forEach(n => { if (r[n] !== undefined) row[n] = r[n]; });
    // 부동층
    const undecided = (r['모름'] || 0) + (r['없음'] || 0) + (r['모름/무응답'] || 0);
    if (undecided > 0) row['부동층'] = undecided;
    return row;
  });

  // 최신 여론조사
  const latest = eduSurveys[0];
  const latestR = latest ? parseResults(latest.results) : {};

  // 교차분석
  const sections = deepData?.sections || {};
  const crosstab = sections.crosstab || {};
  const sw = sections.strength_weakness || {};
  const aiStrategy = sections.ai_strategy || {};

  // 후보별 색상
  const candColorMap: Record<string, string> = {};
  allNames.forEach((n, i) => { candColorMap[n] = CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]; });

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">여론조사 심층 분석</h1>
          <p className="text-sm text-[var(--muted)]">
            본인 선거 {ownSurveys.length}건
            {referenceSurveys.length > 0 && ` · 같은 지역 참고 ${referenceSurveys.length}건`}
            {' '}| 최신: {latest?.date || '-'}
          </p>
        </div>
        <button onClick={loadDeepAnalysis} disabled={analyzing}
          className="px-3 py-1.5 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-700 disabled:opacity-50">
          {analyzing ? '분석 중...' : 'AI 분석'}
        </button>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 bg-[var(--muted-bg)] rounded-lg p-1">
        {([
          ['overview', '지지율 현황'],
          ['trend', '추이 분석'],
          ['crosstab', '교차 분석'],
          ['add', '등록'],
        ] as [TabType, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 py-2 text-sm rounded-md transition ${tab === key ? 'bg-[var(--card-bg)] shadow font-semibold' : 'text-[var(--muted)]'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ═══ TAB: 지지율 현황 ═══ */}
      {tab === 'overview' && (
        <>
          {/* 최신 지지율 */}
          {latest && (
            <div className="card">
              <h3 className="font-bold mb-1">현재 지지율 ({latest.date})</h3>
              <p className="text-xs text-[var(--muted)] mb-4">{latest.org} | n={latest.sample_size || '?'} | ±{latest.margin_of_error || '?'}%p</p>
              <div className="space-y-3">
                {allNames.map((name, i) => {
                  const val = latestR[name] || 0;
                  const isOurs = name === ourCandidate?.name;
                  const maxVal = Math.max(...allNames.map(n => latestR[n] || 0));
                  return (
                    <div key={name} className={`p-3 rounded-xl ${isOurs ? 'bg-blue-500/10 ring-1 ring-blue-500/30' : 'bg-[var(--muted-bg)]'}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className={`font-semibold ${isOurs ? 'text-blue-500' : ''}`}>{name} {isOurs && '★'}</span>
                        <span className={`text-2xl font-black ${val === maxVal && val > 0 ? 'text-amber-500' : isOurs ? 'text-blue-500' : 'text-[var(--foreground)]'}`}>{val}%</span>
                      </div>
                      <div className="h-3 bg-[var(--card-border)] rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${val / 50 * 100}%`, backgroundColor: candColorMap[name] }} />
                      </div>
                    </div>
                  );
                })}
                {/* 부동층 */}
                {(latestR['모름'] || latestR['없음'] || latestR['모름/무응답']) && (
                  <div className="p-3 rounded-xl bg-amber-500/5">
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--muted)]">부동층 (모름+없음)</span>
                      <span className="text-xl font-bold text-amber-600">
                        {((latestR['모름'] || 0) + (latestR['없음'] || 0) + (latestR['모름/무응답'] || 0)).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* AI 분석 */}
          {aiStrategy?.text && (
            <div className="card bg-gradient-to-br from-blue-500/5 to-violet-500/5 border-blue-500/20">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold">AI 전략 분석 <span className="text-xs font-normal text-[var(--muted)]">{ourCandidate?.name} 관점</span></h3>
                <button onClick={() => setExpandedAI(!expandedAI)} className="text-xs text-blue-500">{expandedAI ? '접기' : '전체'}</button>
              </div>
              <div className={`text-sm leading-relaxed whitespace-pre-line ${!expandedAI ? 'max-h-40 overflow-hidden' : ''}`}>{aiStrategy.text}</div>
              {!expandedAI && aiStrategy.text.length > 300 && <div className="bg-gradient-to-t from-[var(--card-bg)] to-transparent h-8 -mt-8 relative" />}
            </div>
          )}

          {/* 강약 세그먼트 */}
          {((sw.strengths || []).length > 0 || (sw.weaknesses || []).length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="card">
                <h3 className="font-bold text-green-600 mb-3">강점 세그먼트 ({ourCandidate?.name} 우위)</h3>
                {(sw.strengths || []).length > 0 ? (sw.strengths || []).map((s: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-2 mb-1 rounded-lg bg-green-500/5 text-sm">
                    <span><span className="text-xs text-[var(--muted)]">[{s.dimension}]</span> {s.segment}</span>
                    <span className="font-bold text-green-600">+{s.gap}%p</span>
                  </div>
                )) : <p className="text-sm text-[var(--muted)]">우위 세그먼트 없음</p>}
              </div>
              <div className="card">
                <h3 className="font-bold text-red-600 mb-3">약점 세그먼트 ({ourCandidate?.name} 열세)</h3>
                {(sw.weaknesses || []).slice(0, 8).map((s: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-2 mb-1 rounded-lg bg-red-500/5 text-sm">
                    <span><span className="text-xs text-[var(--muted)]">[{s.dimension}]</span> {s.segment}</span>
                    <span className="font-bold text-red-600">{s.gap}%p</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 여론조사 목록 */}
          <div className="card">
            <h3 className="font-bold mb-3">역대 여론조사 ({eduSurveys.length}건)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--card-border)]">
                    <th className="text-left p-2 text-[var(--muted)]">날짜</th>
                    <th className="text-left p-2 text-[var(--muted)]">조사기관</th>
                    {allNames.map(n => (
                      <th key={n} className={`text-right p-2 ${n === ourCandidate?.name ? 'text-blue-500 font-bold' : 'text-[var(--muted)]'}`}>{n}</th>
                    ))}
                    <th className="text-right p-2 text-[var(--muted)]">부동층</th>
                  </tr>
                </thead>
                <tbody>
                  {eduSurveys.map((s, i) => {
                    const r = parseResults(s.results);
                    const undec = (r['모름'] || 0) + (r['없음'] || 0) + (r['모름/무응답'] || 0);
                    const maxVal = Math.max(...allNames.map(n => r[n] || 0));
                    return (
                      <tr key={i} className="border-b border-[var(--card-border)] hover:bg-[var(--muted-bg)]">
                        <td className="p-2 font-medium">{s.date}</td>
                        <td className="p-2 text-[var(--muted)] text-xs">{s.org}</td>
                        {allNames.map(n => {
                          const v = r[n];
                          const isMax = v === maxVal && v > 0;
                          return (
                            <td key={n} className={`p-2 text-right font-mono ${isMax ? 'font-bold text-amber-500' : n === ourCandidate?.name ? 'text-blue-500' : ''}`}>
                              {v !== undefined ? `${v}%` : '-'}
                            </td>
                          );
                        })}
                        <td className="p-2 text-right text-amber-600">{undec > 0 ? `${undec.toFixed(1)}%` : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 같은 지역 참고 여론조사 (도지사/교육감/시장 등 다른 선거 유형) */}
          {referenceSurveys.length > 0 && (
            <div className="card">
              <h3 className="font-bold mb-1">📊 같은 지역 참고 여론조사 ({referenceSurveys.length}건)</h3>
              <p className="text-xs text-[var(--muted)] mb-4">
                다른 선거 유형이지만 같은 지역의 정치 지형 파악용 — 도지사·교육감 결과는 시장 선거 분위기와 강한 상관관계
              </p>
              <div className="space-y-2">
                {referenceSurveys.map((s: any) => {
                  const r = parseResults(s.results);
                  const top = Object.entries(r)
                    .filter(([k]) => !['모름', '없음', '모름/무응답'].includes(k))
                    .sort(([, a], [, b]) => (b as number) - (a as number))
                    .slice(0, 3);
                  const typeLabel: Record<string, string> = {
                    governor: '도지사', mayor: '시장', superintendent: '교육감',
                    metro_council: '시·도의원', basic_council: '구·시·군의원', congressional: '국회의원',
                  };
                  return (
                    <div key={s.id} className="rounded-lg border border-[var(--card-border)] p-3 hover:bg-[var(--muted-bg)] transition">
                      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500 text-white font-bold">
                            {typeLabel[s.election_type] || s.election_type}
                          </span>
                          <span className="font-semibold text-sm">{s.org}</span>
                          <span className="text-xs text-[var(--muted)]">{s.date}</span>
                        </div>
                        <span className="text-xs text-[var(--muted)]">n={s.sample_size || '?'} · ±{s.margin_of_error || '?'}%p</span>
                      </div>
                      {top.length > 0 && (
                        <div className="flex gap-3 flex-wrap">
                          {top.map(([name, val], i) => (
                            <span key={i} className="text-sm">
                              <span className={i === 0 ? 'font-bold text-amber-500' : 'text-[var(--muted)]'}>{name}</span>
                              <span className={`ml-1 font-bold ${i === 0 ? 'text-amber-500' : ''}`}>{val as number}%</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 본인 선거 데이터 없을 때 안내 */}
          {ownSurveys.length === 0 && referenceSurveys.length > 0 && (
            <div className="card bg-amber-500/10 border-amber-500/30 text-sm text-amber-700 dark:text-amber-300">
              ⚠️ 본인 선거 유형의 여론조사가 아직 없습니다. 위 참고 자료(같은 지역 다른 선거)로 정치 지형을 파악하거나, "등록" 탭에서 직접 등록할 수 있습니다.
            </div>
          )}
        </>
      )}

      {/* ═══ TAB: 추이 분석 ═══ */}
      {tab === 'trend' && (
        <>
          {/* 지지율 추이 라인차트 */}
          <div className="card">
            <h3 className="font-bold mb-4">후보별 지지율 추이</h3>
            {trendData.length >= 2 ? (
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={trendData} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} unit="%" domain={[0, 40]} />
                  <Tooltip contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 12 }} />
                  <Legend />
                  {allNames.map((name, i) => (
                    <Line key={name} type="monotone" dataKey={name}
                      stroke={CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]}
                      strokeWidth={name === ourCandidate?.name ? 3 : 2}
                      dot={{ r: name === ourCandidate?.name ? 5 : 3, fill: CANDIDATE_COLORS[i % CANDIDATE_COLORS.length] }}
                      activeDot={{ r: 7 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="text-[var(--muted)] text-center py-8">2건 이상 여론조사가 필요합니다</p>}
          </div>

          {/* 부동층 추이 */}
          <div className="card">
            <h3 className="font-bold mb-4">부동층(모름+없음) 추이</h3>
            {trendData.filter(d => d['부동층']).length >= 2 ? (
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={trendData.filter(d => d['부동층'])} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                  <defs>
                    <linearGradient id="undecidedGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} unit="%" domain={[0, 70]} />
                  <Tooltip contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 12 }} />
                  <Area type="monotone" dataKey="부동층" stroke="#f59e0b" fill="url(#undecidedGrad)" strokeWidth={2.5} dot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <p className="text-[var(--muted)] text-center py-8">부동층 데이터가 부족합니다</p>}
          </div>

          {/* 추이 상세 테이블 */}
          <div className="card">
            <h3 className="font-bold mb-3">조사별 상세</h3>
            <div className="space-y-2">
              {eduSurveys.map((s, i) => {
                const r = parseResults(s.results);
                return (
                  <div key={i} className="p-3 rounded-lg bg-[var(--muted-bg)]">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium">{s.date}</span>
                      <span className="text-xs text-[var(--muted)]">{s.org} | n={s.sample_size} | ±{s.margin_of_error}%p</span>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {allNames.map(n => r[n] !== undefined && (
                        <span key={n} className={`text-xs px-2 py-1 rounded-full ${n === ourCandidate?.name ? 'bg-blue-500/20 text-blue-500 font-bold' : 'bg-[var(--card-border)]'}`}>
                          {n} {r[n]}%
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ═══ TAB: 교차 분석 ═══ */}
      {tab === 'crosstab' && (
        <>
          {/* 여론조사 선택 */}
          <div className="card">
            <h3 className="font-bold mb-3">여론조사 선택</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {eduSurveys.map((s) => (
                <button key={s.id} onClick={() => loadCrosstab(s.id)}
                  className={`text-left p-3 rounded-xl border transition ${selectedSurveyId === s.id ? 'border-blue-500 bg-blue-500/10' : 'border-[var(--card-border)] hover:bg-[var(--muted-bg)]'}`}>
                  <div className="font-semibold text-sm">{s.date}</div>
                  <div className="text-xs text-[var(--muted)]">{s.org}</div>
                  <div className="text-xs text-[var(--muted)]">n={s.sample_size} | ±{s.margin_of_error}%p</div>
                </button>
              ))}
            </div>
          </div>

          {/* 로딩 */}
          {loadingCrosstab && <div className="text-center py-8"><div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" /></div>}

          {/* 선택 안 했을 때 */}
          {!selectedSurveyId && !loadingCrosstab && (
            <div className="card text-center py-12 text-[var(--muted)]">위에서 여론조사를 선택하면 교차분석이 표시됩니다.</div>
          )}

          {/* 교차분석 없음 */}
          {selectedSurveyId && selectedCrosstabs && !selectedCrosstabs.has_crosstabs && !loadingCrosstab && (
            <div className="card text-center py-12 text-[var(--muted)]">이 여론조사에는 교차분석 데이터가 없습니다.</div>
          )}

          {/* 교차분석 테이블 */}
          {selectedCrosstabs?.has_crosstabs && !loadingCrosstab && (
            <>
              <div className="text-sm text-[var(--muted)] mb-2">
                {selectedCrosstabs.survey?.org} ({selectedCrosstabs.survey?.date}) 교차분석
              </div>
              {Object.entries(selectedCrosstabs.crosstabs || {}).map(([dim, segments]: [string, any]) => {
                const hasCandidate = (segments as any[]).some((seg: any) =>
                  allNames.some(cn => seg.candidates?.[cn] !== undefined)
                );
                if (!hasCandidate) return null;

                return (
                  <div key={dim} className="card">
                    <h3 className="font-bold mb-3">{dim}별 지지율</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[var(--card-border)]">
                            <th className="text-left p-2 text-[var(--muted)]">{dim}</th>
                            {allNames.map(n => (
                              <th key={n} className={`text-right p-2 ${n === ourCandidate?.name ? 'text-blue-500' : 'text-[var(--muted)]'}`}>{n}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(segments as any[]).map((seg: any, i: number) => {
                            const vals = allNames.map(n => seg.candidates?.[n] || 0);
                            const maxVal = Math.max(...vals);
                            return (
                              <tr key={i} className="border-b border-[var(--card-border)] hover:bg-[var(--muted-bg)]">
                                <td className="p-2 font-medium">{seg.segment}</td>
                                {allNames.map((n) => {
                                  const v = seg.candidates?.[n];
                                  const isMax = v === maxVal && v > 0;
                                  return (
                                    <td key={n} className={`p-2 text-right font-mono ${isMax ? 'font-bold bg-amber-500/10' : n === ourCandidate?.name ? 'text-blue-500' : ''}`}>
                                      {v !== undefined ? `${v}%` : '-'}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      {/* ═══ TAB: 등록 ═══ */}
      {tab === 'add' && (
        <div className="card">
          <p className="text-[var(--muted)] text-center py-8">
            여론조사 등록은 관리자 페이지에서 진행합니다.<br />
            <a href="/admin" className="text-blue-500 underline">관리자 페이지로 이동</a>
          </p>
        </div>
      )}
    </div>
  );
}
