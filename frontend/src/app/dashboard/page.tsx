'use client';
import { useState, useEffect, useMemo } from 'react';
import { api } from '@/services/api';
import { getCandidateColorMap, useElection } from '@/hooks/useElection';
import StatCard from '@/components/cards/StatCard';
import AlertCard from '@/components/cards/AlertCard';
import {
  CandidateNewsBar, SentimentPie, SurveyTrendChart,
} from '@/components/charts';

export default function DashboardPage() {
  const { election, candidates, candidateNames, ourCandidate, loading: elLoading } = useElection();
  const colorMap = useMemo(() => getCandidateColorMap(candidates), [candidates]);
  const [data, setData] = useState<any>(null);
  const [gaps, setGaps] = useState<any>(null);
  const [tgStatus, setTgStatus] = useState<any>(null);
  const [collecting, setCollecting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (election) loadData(); }, [election]);

  const loadData = async () => {
    if (!election) return;
    setLoading(true);
    try {
      const [ov, gp, tg] = await Promise.all([
        api.getAnalysisOverview(election.id, 30),
        api.getCompetitorGaps(election.id).catch(() => null),
        api.getTelegramStatus().catch(() => null),
      ]);
      setData(ov);
      setGaps(gp);
      setTgStatus(tg);
    } catch {} finally { setLoading(false); }
  };

  const handleCollect = async () => {
    if (!election) return;
    setCollecting(true);
    try { await api.collectNow(election.id, 'news'); await loadData(); } catch {} finally { setCollecting(false); }
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

  if (!data) return null;

  const kpi = data.kpi || {};
  const newsByCand = data.news_by_candidate || [];
  const recentNews = data.recent_news || [];
  const surveys = data.surveys || [];
  const alerts = (data.alerts || []).map((a: any) => ({ ...a, time: '실시간' }));
  const oursName = data.our_candidate || '';
  const oursData = newsByCand.find((n: any) => n.is_ours);

  // Sort newsByCand: our candidate first
  const sortedNewsByCand = [...newsByCand].sort((a: any, b: any) => {
    if (a.is_ours) return -1;
    if (b.is_ours) return 1;
    return b.count - a.count;
  });

  // Survey trend data
  const surveyTrend = surveys.filter((s: any) => s.results && Object.keys(s.results).length > 0)
    .reverse()
    .map((s: any) => {
      const row: any = { date: s.date?.substring(5) || '' };
      // Our candidate first in data keys
      const ourName = ourCandidate?.name;
      if (ourName && s.results[ourName] !== undefined) row[ourName] = s.results[ourName];
      candidateNames.forEach(n => {
        if (n !== ourName) row[n] = s.results[n] || 0;
      });
      return row;
    });

  // Ordered candidate names: our candidate first
  const orderedCandNames = ourCandidate
    ? [ourCandidate.name, ...candidateNames.filter(n => n !== ourCandidate.name)]
    : candidateNames;

  // AI insight generation from real data
  const generateInsight = () => {
    if (!oursData) return null;
    const totalAll = newsByCand.reduce((s: number, n: any) => s + n.count, 0);
    const maxCand = [...newsByCand].sort((a: any, b: any) => b.count - a.count)[0];
    const ourTotal = oursData.count || 0;
    const ourPosRate = kpi.our_pos_rate || 0;
    const parts: string[] = [];

    if (maxCand && maxCand.name !== oursName && maxCand.count > ourTotal) {
      parts.push(
        `${maxCand.name} 후보가 뉴스 ${maxCand.count}건으로 노출 1위. ` +
        `${oursName} 후보는 ${ourTotal}건(${maxCand.count > 0 ? Math.round(ourTotal / maxCand.count * 100) : 0}% 수준).`
      );
    } else if (maxCand && maxCand.name === oursName) {
      parts.push(`${oursName} 후보가 뉴스 ${ourTotal}건으로 노출 1위.`);
    }

    parts.push(`긍정률 ${ourPosRate}%${ourPosRate < 40 ? ' (위험 수준 - 대응 필요)' : ourPosRate < 60 ? ' (보통)' : ' (양호)'}.`);

    if (oursData.negative > 0) {
      parts.push(`부정 뉴스 ${oursData.negative}건 감지 - 모니터링 필요.`);
    }

    return parts.join(' ');
  };

  // Competitor gap items
  const gapItems = gaps?.gaps || [];
  const strengthItems = gaps?.strengths || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{data.election?.name}</h1>
          <p className="text-gray-500 mt-1">선거일 {data.election?.date} | 후보 {data.election?.candidates_count}명</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">데이터 <strong>{kpi.total_news}건</strong></span>
          <button onClick={handleCollect} disabled={collecting} className="btn-primary text-sm">
            {collecting ? '수집중...' : '지금 수집'}
          </button>
          {tgStatus?.connected && <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">TG 연결</span>}
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="D-Day" value={kpi.d_day > 0 ? `D-${kpi.d_day}` : kpi.d_day === 0 ? 'D-Day' : `D+${Math.abs(kpi.d_day)}`} sub={data.election?.date} color="blue" />
        <StatCard label="뉴스" value={kpi.total_news} sub="수집 건수" color="purple" />
        <StatCard label="긍정률" value={`${kpi.our_pos_rate}%`} sub={oursName} color="green" />
        <StatCard label="부정 경보" value={kpi.negative_alerts} sub="감지됨" color="red" />
        <StatCard label="여론조사" value={kpi.survey_count} sub="등록됨" color="amber" />
      </div>

      {/* AI Insight Card */}
      {oursData && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">AI</span>
            <h3 className="font-bold text-blue-900">AI 현황 분석</h3>
            <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">실시간 데이터 기반</span>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">{generateInsight()}</p>
        </div>
      )}

      {/* Alerts */}
      {alerts.length > 0 && <AlertCard alerts={alerts} />}

      {/* Competitor Gap Checklist */}
      {gaps && (gapItems.length > 0 || strengthItems.length > 0) && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">경쟁자 대비 갭 분석</h3>
            <span className="text-xs text-gray-400">{gaps.analysis_period}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Gaps (areas where we lag) */}
            {gapItems.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-red-600 mb-2">부족한 영역</p>
                <div className="space-y-2">
                  {gapItems.slice(0, 5).map((g: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-red-400 mt-0.5 flex-shrink-0">-</span>
                      <div>
                        <span className="font-medium">{g.area}</span>
                        {g.detail && <span className="text-gray-500"> - {g.detail}</span>}
                        {g.our_value !== undefined && g.comp_value !== undefined && (
                          <span className="text-xs text-gray-400 ml-1">
                            ({oursName}: {g.our_value}{g.unit || ''} vs {g.comp_name}: {g.comp_value}{g.unit || ''})
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Strengths */}
            {strengthItems.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-600 mb-2">우위 영역</p>
                <div className="space-y-2">
                  {strengthItems.slice(0, 5).map((s: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-green-400 mt-0.5 flex-shrink-0">+</span>
                      <div>
                        <span className="font-medium">{s.area}</span>
                        {s.detail && <span className="text-gray-500"> - {s.detail}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {gaps.ai_summary && (
            <p className="text-xs text-gray-500 mt-3 pt-3 border-t border-gray-100">{gaps.ai_summary}</p>
          )}
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card lg:col-span-2">
          <h3 className="font-semibold mb-4">후보별 뉴스 감성</h3>
          <CandidateNewsBar data={sortedNewsByCand} />
        </div>
        {oursData && (
          <div className="card">
            <h3 className="font-semibold mb-2">{oursName} 감성</h3>
            <SentimentPie positive={oursData.positive} negative={oursData.negative} neutral={oursData.neutral} />
            <div className="grid grid-cols-3 gap-2 text-center text-sm mt-2">
              <div><span className="font-bold text-green-600">{oursData.positive}</span><br/><span className="text-xs">긍정</span></div>
              <div><span className="font-bold text-red-600">{oursData.negative}</span><br/><span className="text-xs">부정</span></div>
              <div><span className="font-bold text-gray-500">{oursData.neutral}</span><br/><span className="text-xs">중립</span></div>
            </div>
          </div>
        )}
      </div>

      {/* Survey Trend */}
      {surveyTrend.length >= 2 && (
        <div className="card">
          <div className="flex justify-between mb-4">
            <h3 className="font-semibold">여론조사 추이</h3>
            <a href="/dashboard/surveys" className="text-xs text-primary-600">상세 &rarr;</a>
          </div>
          <SurveyTrendChart data={surveyTrend} candidates={orderedCandNames} />
        </div>
      )}

      {/* Recent News */}
      <div className="card">
        <div className="flex justify-between mb-4">
          <h3 className="font-semibold">최근 뉴스 <span className="text-xs text-green-600 ml-1">실시간 {recentNews.length}건</span></h3>
          <a href="/dashboard/news" className="text-xs text-primary-600">전체 &rarr;</a>
        </div>
        <div className="space-y-2">
          {recentNews.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">수집된 뉴스가 없습니다. &quot;지금 수집&quot; 버튼을 눌러주세요.</p>
          )}
          {recentNews.map((news: any, i: number) => (
            <a key={i} href={news.url || '#'} target="_blank" rel="noopener noreferrer"
              className={`block p-3 rounded-lg border transition-all hover:shadow-md ${
                news.sentiment === 'negative' ? 'bg-red-50/50 border-red-200' :
                news.sentiment === 'positive' ? 'bg-green-50/30 border-green-100' : 'bg-white border-gray-100'
              }`}>
              <div className="flex items-start gap-2">
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  news.sentiment === 'negative' ? 'bg-red-500' : news.sentiment === 'positive' ? 'bg-green-500' : 'bg-gray-300'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`text-[10px] px-1 py-0.5 rounded font-bold ${
                      news.sentiment === 'negative' ? 'bg-red-100 text-red-700' :
                      news.sentiment === 'positive' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>{news.sentiment === 'negative' ? '부정' : news.sentiment === 'positive' ? '긍정' : '중립'}</span>
                    <span className="text-xs font-semibold" style={{ color: colorMap[news.candidate] || '#666' }}>{news.candidate}</span>
                    <span className="text-[10px] text-gray-400">{news.source}</span>
                    <span className="text-[10px] text-gray-300 ml-auto">{news.date || ''}</span>
                  </div>
                  <p className={`text-sm font-medium ${news.sentiment === 'negative' ? 'text-red-900' : 'text-gray-900'}`}>{news.title}</p>
                  {news.summary && <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{news.summary}</p>}
                  {news.url && <span className="text-[10px] text-primary-500">기사 원문 &rarr;</span>}
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* Candidate Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {sortedNewsByCand.map((c: any) => {
          const total = c.positive + c.negative + c.neutral;
          const posRate = total ? Math.round(c.positive / total * 100) : 0;
          return (
            <div key={c.name} className={`card ${c.is_ours ? 'ring-2 ring-blue-400' : ''}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                  style={{ backgroundColor: colorMap[c.name] || '#666' }}>{c.name[0]}</div>
                <div>
                  <h4 className="font-bold">{c.name} {c.is_ours && <span className="text-xs text-blue-500">(우리)</span>}</h4>
                  <p className="text-xs text-gray-500">{c.party || ''} | {total}건 | 긍정률 {posRate}%</p>
                </div>
              </div>
              <div className="h-2.5 rounded-full overflow-hidden flex bg-gray-100">
                {total > 0 && <>
                  <div className="bg-green-500 h-full" style={{ width: `${c.positive / total * 100}%` }} />
                  <div className="bg-red-500 h-full" style={{ width: `${c.negative / total * 100}%` }} />
                  <div className="bg-gray-300 h-full" style={{ width: `${c.neutral / total * 100}%` }} />
                </>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
