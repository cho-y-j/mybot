'use client';
import { useState, useEffect, useMemo } from 'react';
import { api } from '@/services/api';
import { getCandidateColorMap, useElection } from '@/hooks/useElection';
import StrategicQuadrant from '@/components/StrategicQuadrant';
import {
  CandidateRadar, CANDIDATE_COLORS,
} from '@/components/charts';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, Cell,
} from 'recharts';

export default function DashboardPage() {
  const { election, candidates, candidateNames, ourCandidate, loading: elLoading } = useElection();
  const colorMap = useMemo(() => getCandidateColorMap(candidates), [candidates]);
  const [data, setData] = useState<any>(null);
  const [collecting, setCollecting] = useState(false);
  const [refreshingBrief, setRefreshingBrief] = useState(false);

  const handleRefreshBriefing = async () => {
    if (!election) return;
    setRefreshingBrief(true);
    try {
      await api.refreshBriefing(election.id);
      await loadData();
    } catch {} finally { setRefreshingBrief(false); }
  };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { if (election) loadData(); }, [election]);

  const loadData = async () => {
    if (!election) return;
    setLoading(true); setError('');
    try {
      const ov = await api.getAnalysisOverview(election.id, 30);
      setData(ov);
    } catch (e: any) {
      setError(e?.message || '데이터를 불러올 수 없습니다.');
    } finally { setLoading(false); }
  };

  const [collectMsg, setCollectMsg] = useState('');

  const handleCollect = async () => {
    if (!election) return;
    setCollecting(true);
    setCollectMsg('수집 요청 전송...');
    try {
      await api.collectNow(election.id, 'all');
      setCollectMsg('백그라운드 수집 중... (1~2분 소요)');
      // 30초 후 자동 새로고침
      setTimeout(async () => {
        await loadData();
        setCollectMsg('수집 완료! 데이터가 업데이트되었습니다.');
        setTimeout(() => setCollectMsg(''), 3000);
        setCollecting(false);
      }, 30000);
      // 60초 후 한 번 더
      setTimeout(async () => {
        await loadData();
      }, 60000);
    } catch (e: any) {
      setError('수집 실패: ' + (e?.message || ''));
      setCollectMsg('');
      setCollecting(false);
    }
  };

  if (elLoading || loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" />
    </div>
  );

  if (!election) return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center">
      <h2 className="text-xl font-bold mb-2">선거를 설정해주세요</h2>
      <a href="/onboarding" className="btn-primary">시작하기</a>
    </div>
  );

  if (error) return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">대시보드</h1>
      <div className="card text-center py-12">
        <p className="text-red-500 mb-3">{error}</p>
        <button onClick={loadData} className="btn-primary text-sm">다시 시도</button>
      </div>
    </div>
  );

  if (!data) return null;

  const kpi = data.kpi || {};
  const scoreBoard = data.score_board || [];
  const radarData = data.radar_data || [];
  const sentiment7d = data.sentiment_7d || [];
  const negNews = data.negative_news || [];
  const surveys = data.surveys || [];
  const alerts = data.alerts || [];
  const brief = data.ai_briefing || {};
  const oursName = data.our_candidate || '';

  // 우리 후보 순위 색상
  const rankColor = (rank: number) => rank === 1 ? 'text-blue-600' : rank === 2 ? 'text-gray-600' : 'text-red-600';

  // 레이더 차트 데이터 변환
  const radarChartData = ['뉴스 노출', '긍정 감성', '커뮤니티', '유튜브', '종합'].map(metric => {
    const row: any = { metric };
    radarData.forEach((c: any) => { row[c.name] = c[metric] || 0; });
    return row;
  });

  // 여론조사 최신 1건
  // 여론조사: 중첩 구조 펼치기 (교육감지지도 등에서 후보 지지율 추출)
  const latestSurvey = surveys[0];
  const rawResults = latestSurvey?.results || {};
  const flatSurvey: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawResults)) {
    if (typeof v === 'number') {
      flatSurvey[k] = v;
    } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      for (const [sk, sv] of Object.entries(v as Record<string, any>)) {
        if (typeof sv === 'number') flatSurvey[sk] = sv;
      }
    }
  }
  // 후보 이름과 매칭되는 것만 (또는 모름/없음 포함)
  const candSet = new Set([...candidateNames, '모름', '없음', '모름/무응답']);
  const surveyFiltered = Object.entries(flatSurvey).filter(([k]) => candSet.has(k) || candidateNames.some(cn => k.includes(cn)));
  const surveyBarData = surveyFiltered
    .sort((a: any, b: any) => {
      if (a[0] === oursName) return -1;
      if (b[0] === oursName) return 1;
      return b[1] - a[1];
    })
    .map(([name, value]) => ({
      name: name.length > 4 ? name.substring(0, 4) + '..' : name,
      fullName: name,
      value,
      fill: name === oursName ? '#3b82f6' : name === '모름' || name === '없음' ? '#cbd5e1' : '#94a3b8',
    }));

  // 감성 추이 후보 목록
  const sentCandNames = candidates.filter(c => c.enabled).map(c => c.name);
  const orderedSentNames = ourCandidate
    ? [ourCandidate.name, ...sentCandNames.filter(n => n !== ourCandidate.name)]
    : sentCandNames;

  return (
    <div className="space-y-5">
      {/* ── 헤더 ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{data.election?.name}</h1>
          <p className="text-gray-500 mt-0.5 text-sm">
            {data.election?.date} | 후보 {data.election?.candidates_count}명 | 뉴스 {kpi.total_news}건 | 여론조사 {kpi.survey_count || 0}건
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${kpi.d_day > 30 ? 'text-blue-600' : kpi.d_day > 7 ? 'text-amber-600' : 'text-red-600'}`}>
            {kpi.d_day > 0 ? `D-${kpi.d_day}` : kpi.d_day === 0 ? 'D-Day' : `D+${Math.abs(kpi.d_day)}`}
          </span>
          <button onClick={handleCollect} disabled={collecting}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
            {collecting ? '수집중...' : '지금 수집'}
          </button>
          {collectMsg && (
            <span className={`text-xs ${collectMsg.includes('완료') ? 'text-green-500' : 'text-amber-500'}`}>
              {collecting && <span className="inline-block w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mr-1" />}
              {collectMsg}
            </span>
          )}
        </div>
      </div>

      {/* ── [전략 4사분면] AI 분류 — 액션 가능 콘텐츠 ── */}
      {election && <StrategicQuadrant electionId={election.id} />}

      {/* ── [1] 미디어 활동 현황 ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-lg">미디어 활동 현황</h3>
            <p className="text-xs text-[var(--muted)]">뉴스 · 감성 · 커뮤니티 · 유튜브 실측 데이터</p>
          </div>
          <a href="/dashboard/candidates" className="text-xs text-blue-500 hover:underline">상세 비교 →</a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--card-border)]">
                <th className="text-left py-2 px-2 font-medium text-[var(--muted)] text-xs">후보</th>
                <th className="text-center py-2 px-2 font-medium text-[var(--muted)] text-xs">뉴스</th>
                <th className="text-center py-2 px-2 font-medium text-[var(--muted)] text-xs">긍정률</th>
                <th className="text-center py-2 px-2 font-medium text-[var(--muted)] text-xs">부정</th>
                <th className="text-center py-2 px-2 font-medium text-[var(--muted)] text-xs">커뮤니티</th>
                <th className="text-center py-2 px-2 font-medium text-[var(--muted)] text-xs">유튜브</th>
              </tr>
            </thead>
            <tbody>
              {scoreBoard.map((s: any, i: number) => {
                const newsMax = Math.max(...scoreBoard.map((x: any) => x.news || 0), 1);
                const isTop = (field: string) => s[field] === Math.max(...scoreBoard.map((x: any) => x[field] || 0));
                return (
                  <tr key={s.name} className={`border-b border-[var(--card-border)]/50 ${s.is_ours ? 'bg-blue-500/5' : ''}`}>
                    <td className="py-3 px-2">
                      <a href="/dashboard/candidates" className="flex items-center gap-2 hover:text-blue-500 transition">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold ${i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-gray-400' : 'bg-gray-300'}`}>
                          {i + 1}
                        </span>
                        <span className={`font-bold ${s.is_ours ? 'text-blue-500' : ''}`}>
                          {s.name} {s.is_ours && ''}
                        </span>
                        <span className="text-[10px] text-[var(--muted)]">{s.party || ''}</span>
                      </a>
                    </td>
                    <td className={`py-3 px-2 text-center font-bold ${isTop('news') ? 'text-blue-500' : ''}`}>{s.news}</td>
                    <td className={`py-3 px-2 text-center font-bold ${s.sentiment_rate >= 50 ? 'text-green-500' : s.sentiment_rate < 30 ? 'text-red-500' : ''}`}>{s.sentiment_rate}%</td>
                    <td className="py-3 px-2 text-center">
                      {s.negative_count != null && s.negative_count > 0
                        ? <span className="text-red-500 font-bold">{s.negative_count}</span>
                        : <span className="text-[var(--muted)]">0</span>
                      }
                    </td>
                    <td className={`py-3 px-2 text-center font-bold ${isTop('community') ? 'text-blue-500' : ''}`}>{s.community}</td>
                    <td className={`py-3 px-2 text-center font-bold ${isTop('youtube_views') ? 'text-blue-500' : ''}`}>{(s.youtube_views || 0).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {scoreBoard.length > 0 && (() => {
          const ours = scoreBoard.find((s: any) => s.is_ours);
          if (!ours) return null;
          const warnings = [];
          const topNews = Math.max(...scoreBoard.map((x: any) => x.news || 0));
          const topComm = Math.max(...scoreBoard.map((x: any) => x.community || 0));
          const topYt = Math.max(...scoreBoard.map((x: any) => x.youtube_views || 0));
          if (ours.news < topNews * 0.5) warnings.push('뉴스 노출 부족');
          if (ours.sentiment_rate < 30) warnings.push('부정 여론 주의');
          if (ours.community < topComm * 0.5) warnings.push('커뮤니티 활동 부족');
          if (ours.youtube_views < topYt * 0.3) warnings.push('유튜브 노출 부족');
          if (warnings.length === 0) return null;
          return (
            <div className="mt-3 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <span className="text-xs text-amber-500 font-bold">부족한 점: </span>
              <span className="text-xs text-amber-400">{warnings.join(' · ')}</span>
            </div>
          );
        })()}
      </div>

      {/* ── [2] AI 브리핑 + [3] 레이더 차트 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* AI 오늘의 브리핑 */}
        <div className="card bg-gradient-to-br from-blue-500/5 to-indigo-500/5 border-blue-500/20">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg font-bold">AI</span>
            <h3 className="font-bold">오늘의 브리핑</h3>
            {brief.ai_generated && <span className="text-[9px] bg-purple-500/10 text-purple-500 px-1.5 py-0.5 rounded">Claude 분석</span>}
            {brief.ai_generated === false && <span className="text-[9px] bg-[var(--muted-bg)] text-[var(--muted)] px-1.5 py-0.5 rounded">자동 분석</span>}
            {brief.cached && <span className="text-[9px] text-[var(--muted)]">캐시</span>}
            <button onClick={handleRefreshBriefing} disabled={refreshingBrief}
              className="text-[9px] px-2 py-0.5 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 ml-auto">
              {refreshingBrief ? 'AI 분석중...' : 'AI 재분석'}
            </button>
            <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${brief.rank === 1 ? 'bg-blue-100 text-blue-700' : brief.rank === 2 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
              {brief.rank_total > 0 ? `${brief.rank}위 / ${brief.rank_total}명` : '-'}
            </span>
          </div>

          {(brief.crises || []).length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-bold text-red-600 mb-1">위기</p>
              {brief.crises.map((c: string, i: number) => (
                <p key={i} className="text-sm text-red-800 flex items-start gap-1.5">
                  <span className="text-red-500 mt-0.5">!</span> {c}
                </p>
              ))}
            </div>
          )}

          {(brief.opportunities || []).length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-bold text-green-600 mb-1">기회</p>
              {brief.opportunities.map((o: string, i: number) => (
                <p key={i} className="text-sm text-green-800 flex items-start gap-1.5">
                  <span className="text-green-500 mt-0.5">+</span> {o}
                </p>
              ))}
            </div>
          )}

          <div>
            <p className="text-xs font-bold text-blue-600 mb-1">오늘 할 일</p>
            {(brief.todos || []).map((t: string, i: number) => (
              <p key={i} className="text-sm text-gray-700 flex items-start gap-1.5">
                <span className="text-blue-500 font-bold mt-0.5">{i + 1}.</span> {t}
              </p>
            ))}
          </div>
        </div>

        {/* 후보별 활동 비교 레이더 */}
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold">후보별 활동 비교</h3>
            <a href="/dashboard/candidates" className="text-xs text-blue-600 hover:underline">상세 →</a>
          </div>
          {radarChartData.length > 0 && candidates.length > 0 ? (
            <CandidateRadar data={radarChartData} candidates={orderedSentNames} />
          ) : (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">데이터 수집 후 표시됩니다</div>
          )}
        </div>
      </div>

      {/* ── [4] 감성 트렌드 + [5] 여론조사 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 7일 감성 추이 */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold">7일 감성 추이 (긍정률 %)</h3>
            <a href="/dashboard/news" className="text-xs text-blue-600 hover:underline">뉴스 분석 →</a>
          </div>
          {sentiment7d.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={sentiment7d}>
                <defs>
                  {orderedSentNames.map((name, i) => (
                    <linearGradient key={name} id={`grad_${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                <Tooltip formatter={(val: number) => `${val}%`} />
                <Legend />
                {orderedSentNames.map((name, i) => (
                  <Area key={name} type="monotone" dataKey={name}
                    stroke={CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]}
                    fill={`url(#grad_${i})`} strokeWidth={name === oursName ? 2.5 : 1.5} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">뉴스 수집 후 표시됩니다</div>
          )}
        </div>

        {/* 여론조사 최신 */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold">최근 여론조사</h3>
            <a href="/dashboard/surveys" className="text-xs text-blue-600 hover:underline">상세 분석 →</a>
          </div>
          {latestSurvey ? (
            <>
              <p className="text-xs text-gray-500 mb-3">{latestSurvey.org} | {latestSurvey.date} | n={latestSurvey.sample_size || '?'}</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={surveyBarData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} unit="%" domain={[0, 60]} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={50} />
                  <Tooltip formatter={(val: number, name: string, props: any) => [`${val}%`, props.payload.fullName]} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {surveyBarData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </>
          ) : (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
              등록된 여론조사가 없습니다
              <a href="/dashboard/surveys" className="ml-2 text-blue-500 underline">등록하기</a>
            </div>
          )}
        </div>
      </div>

      {/* ── [6] 부정 뉴스 알림 (있을 때만) ── */}
      {negNews.length > 0 && (
        <div className="card border-red-500/20 bg-red-500/5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-red-400">부정 뉴스 알림 — 대응 필요</h3>
            <a href="/dashboard/news" className="text-xs text-red-400 hover:underline">전체 뉴스 →</a>
          </div>
          <div className="space-y-2">
            {negNews.map((n: any, i: number) => (
              <a key={i} href={n.url || '#'} target="_blank" rel="noopener noreferrer"
                className="block p-3 bg-red-500/10 rounded-lg border border-red-500/20 hover:bg-red-500/15 transition">
                <div className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full mt-2 flex-shrink-0" />
                  <div>
                    <div className="flex items-center gap-2 text-xs mb-0.5">
                      <span className="font-bold text-red-400">{n.candidate}</span>
                      <span className="text-[var(--muted)]">{n.date}</span>
                    </div>
                    <p className="text-sm font-medium text-[var(--foreground)]">{n.title}</p>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
