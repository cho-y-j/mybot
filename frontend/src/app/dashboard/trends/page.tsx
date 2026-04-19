'use client';
import { useState, useEffect, useMemo } from 'react';
import { useElection, getCandidateColorMap } from '@/hooks/useElection';
import { api } from '@/services/api';
import { SearchTrendLine, CANDIDATE_COLORS } from '@/components/charts';
import IssuesTab from '@/components/trends/IssuesTab';
import TopicCard from '@/components/trends/TopicCard';
import RecommendedTopicsPanel from '@/components/trends/RecommendedTopicsPanel';

type TabType = 'recommended' | 'candidates' | 'realtime' | 'search';

export default function TrendsPage() {
  const { election, candidates, ourCandidate, loading: elLoading } = useElection();
  const colorMap = useMemo(() => getCandidateColorMap(candidates), [candidates]);
  const [trends, setTrends] = useState<any>(null);
  const [realtime, setRealtime] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [tab, setTab] = useState<TabType>('recommended');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResult, setSearchResult] = useState<any>(null);
  const [searching, setSearching] = useState(false);
  // 주제 카드 (실시간 급상승 + 키워드 조회 공용)
  const [topicCard, setTopicCard] = useState<any>(null);
  const [loadingTopicCard, setLoadingTopicCard] = useState(false);
  const [trendingTopics, setTrendingTopics] = useState<any>(null);
  const [loadingTrending, setLoadingTrending] = useState(false);

  useEffect(() => {
    if (election) {
      loadTrends();
      loadTrendingTopics();
    }
    loadRealtime();
  }, [election]);

  const loadTrendingTopics = async () => {
    if (!election) return;
    setLoadingTrending(true);
    try {
      const r = await api.getTrendingTopics(election.id);
      setTrendingTopics(r);
    } catch (e: any) {
      console.error('trending topics error:', e);
    } finally { setLoadingTrending(false); }
  };

  const openTopicCard = async (kw: string) => {
    if (!election) return;
    setTab('search');
    setSearchKeyword(kw);
    setLoadingTopicCard(true);
    setTopicCard(null);
    try {
      const r = await api.getTopicCard(election.id, kw);
      setTopicCard(r);
    } catch (e: any) {
      setTopicCard({ error: e?.message || '주제 카드 생성 실패' });
    } finally { setLoadingTopicCard(false); }
  };

  const loadTrends = async () => {
    if (!election) return;
    try {
      const data = await api.getKeywordTrends(election.id, 30);
      setTrends(data);
    } catch (e: any) {
      console.error('trends error:', e);
    } finally { setLoading(false); }
  };

  const loadRealtime = async () => {
    try {
      const data = await api.getRealtimeTrends();
      setRealtime(data);
    } catch {}
  };

  const handleCollect = async () => {
    if (!election) return;
    setCollecting(true);
    try {
      await api.collectTrendsNow(election.id);
      await loadTrends();
    } catch (e: any) {
      alert('트렌드 수집 실패: ' + (e?.message || ''));
    } finally { setCollecting(false); }
  };

  // 기존 단순 검색 → 주제 카드로 통합
  const handleSearch = async (keyword?: string) => {
    const kw = (keyword || searchKeyword).trim();
    if (!kw || !election) return;
    if (keyword) setSearchKeyword(kw);
    setSearching(true);
    setLoadingTopicCard(true);
    setTopicCard(null);
    setSearchResult(null);
    try {
      const data = await api.getTopicCard(election.id, kw);
      setTopicCard(data);
    } catch (e: any) {
      setTopicCard({ error: e?.message || '주제 카드 생성 실패' });
    } finally { setSearching(false); setLoadingTopicCard(false); }
  };

  if (elLoading || loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" /></div>;
  if (!election) return <div className="card text-center py-12 text-[var(--muted)]">선거를 먼저 설정해주세요.</div>;

  // 후보 이름 (우리 후보 우선)
  const defaultNames = ['김진균', '윤건영', '김성근', '신문규', '조동욱'];
  const orderedNames = ourCandidate
    ? [ourCandidate.name, ...candidates.filter(c => c.enabled && !c.is_our_candidate).map(c => c.name)]
    : defaultNames;
  const allNames = orderedNames.length > 0 ? orderedNames : defaultNames;

  // API 데이터 가공
  const candData = trends?.candidates || {};
  const issueData = trends?.issues || {};
  const trendAlerts = trends?.alerts || [];

  // 후보별 최신 검색량
  const candVolumes = allNames.map(name => {
    const d = candData[name] || {};
    return {
      name,
      volume: d.latest || 0,
      avg7d: d.avg_7d || 0,
      avg30d: d.avg_30d || 0,
      trend: d.trend || 'stable',
      isOurs: name === ourCandidate?.name,
    };
  }).sort((a, b) => b.volume - a.volume);

  // 후보별 차트 데이터
  const chartData: Record<string, any>[] = [];
  const firstCandData = candData[allNames[0]]?.data || [];
  firstCandData.forEach((point: any, i: number) => {
    const row: any = { date: point.date?.substring(5) || '' };
    allNames.forEach(name => {
      const d = candData[name]?.data?.[i];
      if (d) row[name] = d.ratio;
    });
    chartData.push(row);
  });

  // 이슈 데이터는 IssuesTab 컴포넌트에서 처리

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">검색 트렌드</h1>
          <p className="text-sm text-[var(--muted)]">네이버 DataLab + Google Trends</p>
        </div>
        <button onClick={handleCollect} disabled={collecting}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
          {collecting ? '수집중...' : '지금 업데이트'}
        </button>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 bg-[var(--muted-bg)] rounded-lg p-1">
        {([
          ['recommended', '🎯 이번 주 추천'],
          ['realtime', '실시간 급상승'],
          ['search', '키워드 조회'],
          ['candidates', '후보 검색량'],
        ] as [TabType, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 py-2 text-sm rounded-md transition ${tab === key ? 'bg-[var(--card-bg)] shadow font-semibold' : 'text-[var(--muted)]'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ═══ 🎯 이번 주 추천 주제 (기본 탭, 푸시 모델) ═══ */}
      {tab === 'recommended' && (
        <RecommendedTopicsPanel
          electionId={election.id}
          onPickTopic={(kw) => openTopicCard(kw)}
        />
      )}

      {/* ═══ 실시간 급상승 (AI 관련도 기반 주제 선정) ═══ */}
      {tab === 'realtime' && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold">실시간 급상승 + 우리 선거 관련도</h3>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Google 실시간 급상승 키워드를 AI가 <b>{election.election_type === 'superintendent' ? '교육감' : election.election_type === 'mayor' ? '시장' : '선거'}</b> 관점에서 관련도를 평가합니다. 관련도 높은 것부터 상단.
              </p>
            </div>
            <button onClick={loadTrendingTopics} disabled={loadingTrending}
              className="text-xs px-3 py-1.5 bg-blue-500/10 text-blue-500 rounded-lg hover:bg-blue-500/20 disabled:opacity-50">
              {loadingTrending ? '분석중... (약 20초)' : '다시 분석'}
            </button>
          </div>
          {loadingTrending && !trendingTopics && (
            <div className="card text-center py-12 text-[var(--muted)]">
              <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
              AI가 급상승 키워드를 분석하고 있습니다...
            </div>
          )}
          {trendingTopics?.error && (
            <div className="card bg-red-500/10 border-red-500/30 text-red-500 text-sm">
              {trendingTopics.error}
            </div>
          )}
          {trendingTopics?.trends && trendingTopics.trends.length > 0 && (() => {
            const items = trendingTopics.trends;
            const high = items.filter((t: any) => t.relevance_score >= 70);
            const mid = items.filter((t: any) => t.relevance_score >= 40 && t.relevance_score < 70);
            const low = items.filter((t: any) => t.relevance_score < 40);
            const renderItem = (t: any, i: number) => (
              <button
                key={`${t.keyword}-${i}`}
                onClick={() => openTopicCard(t.keyword)}
                className={`w-full text-left p-3 rounded-xl border transition hover:border-blue-500/40 hover:bg-blue-500/5 ${
                  t.relevance_score >= 85 ? 'bg-green-500/5 border-green-500/30' :
                  t.relevance_score >= 70 ? 'bg-blue-500/5 border-blue-500/30' :
                  t.relevance_score >= 40 ? 'bg-amber-500/5 border-amber-500/30' :
                  'bg-[var(--card-bg)] border-[var(--card-border)]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-sm font-black w-8 text-[var(--muted)] mt-0.5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="font-semibold">{t.keyword}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                        t.relevance_score >= 85 ? 'bg-green-500/20 text-green-600' :
                        t.relevance_score >= 70 ? 'bg-blue-500/20 text-blue-600' :
                        t.relevance_score >= 40 ? 'bg-amber-500/20 text-amber-600' :
                        'bg-gray-500/20 text-gray-500'
                      }`}>
                        관련도 {t.relevance_score}
                      </span>
                      {t.traffic && <span className="text-[10px] text-[var(--muted)]">{t.traffic}</span>}
                    </div>
                    {t.relevance_reason && <p className="text-[11px] text-[var(--muted)] line-clamp-1">{t.relevance_reason}</p>}
                    {t.news?.[0] && <p className="text-[10px] text-[var(--muted)] mt-0.5 line-clamp-1 italic">📰 {t.news[0].title}</p>}
                  </div>
                  <span className="text-xs text-blue-500 flex-shrink-0">주제 분석 →</span>
                </div>
              </button>
            );
            return (
              <div className="space-y-4">
                {high.length > 0 && (
                  <section>
                    <h4 className="text-sm font-bold text-green-600 mb-2">🎯 지금 바로 활용 가능 (관련도 70+)</h4>
                    <div className="space-y-2">{high.map(renderItem)}</div>
                  </section>
                )}
                {mid.length > 0 && (
                  <section>
                    <h4 className="text-sm font-semibold text-amber-600 mb-2">💡 연관해서 활용 가능 (관련도 40~69)</h4>
                    <div className="space-y-2">{mid.map((t: any, i: number) => renderItem(t, high.length + i))}</div>
                  </section>
                )}
                {low.length > 0 && (
                  <details>
                    <summary className="text-xs text-[var(--muted)] cursor-pointer hover:text-[var(--foreground)]">
                      🔻 선거와 무관한 급상승 ({low.length}개) 펼쳐보기
                    </summary>
                    <div className="space-y-2 mt-2">{low.map((t: any, i: number) => renderItem(t, high.length + mid.length + i))}</div>
                  </details>
                )}
              </div>
            );
          })()}
          <div className="text-[10px] text-[var(--muted)] text-center">
            💡 키워드 클릭 → '키워드 조회' 탭에서 상세 주제 카드 (해시태그·블로그 제목·롱테일) 자동 생성
          </div>
        </>
      )}

      {/* ═══ 후보 검색량 ═══ */}
      {tab === 'candidates' && (
        <>
          {/* 알림 */}
          {trendAlerts.length > 0 && (
            <div className="space-y-2">
              {trendAlerts.map((a: any, i: number) => (
                <div key={i} className={`p-3 rounded-xl text-sm ${
                  a.level === 'critical' ? 'bg-red-500/10 border border-red-500/30 text-red-400' :
                  a.level === 'opportunity' ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400' :
                  'bg-blue-500/10 border border-blue-500/30 text-blue-400'
                }`}>
                  {a.level === 'critical' ? '' : ''} {a.message}
                </div>
              ))}
            </div>
          )}

          {/* 후보별 검색량 카드 */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {candVolumes.map((c, i) => (
              <div key={c.name} className={`card text-center ${c.isOurs ? 'ring-1 ring-blue-500/30 bg-blue-500/5' : ''}`}>
                <div className={`text-2xl font-black ${c.isOurs ? 'text-blue-500' : i === 0 ? 'text-amber-500' : ''}`}>{c.volume.toFixed(1)}</div>
                <div className="font-semibold text-sm mt-1">{c.name} {c.isOurs && ''}</div>
                <div className="text-[10px] text-[var(--muted)]">7일 {c.avg7d.toFixed(1)} | 30일 {c.avg30d.toFixed(1)}</div>
                <div className={`text-[10px] mt-0.5 ${c.trend === 'rising' ? 'text-green-500' : c.trend === 'falling' ? 'text-red-500' : 'text-[var(--muted)]'}`}>
                  {c.trend === 'rising' ? '↑ 상승' : c.trend === 'falling' ? '↓ 하락' : '→ 유지'}
                </div>
              </div>
            ))}
          </div>

          {/* 추이 차트 */}
          {chartData.length > 0 && (
            <div className="card">
              <h3 className="font-bold mb-4">후보별 검색량 추이 (30일)</h3>
              <SearchTrendLine data={chartData} keywords={allNames} />
              <p className="text-xs text-[var(--muted)] mt-2">* 이름 검색량 기준 — 동명이인(야구선수 등) 검색량이 포함될 수 있습니다</p>
            </div>
          )}

          {chartData.length === 0 && (
            <div className="card text-center py-12 text-[var(--muted)]">
              후보 검색 트렌드 데이터가 없습니다. "지금 업데이트"를 눌러주세요.
            </div>
          )}
        </>
      )}

      {/* ═══ 교육 이슈 ═══ */}
      {tab === 'issues' && (
        <IssuesTab
          election={election}
          issueData={issueData}
          onNavigateToSearch={(kw) => {
            setTab('search');
            handleSearch(kw);
          }}
        />
      )}

      {/* ═══ 키워드 조회 (주제 카드) ═══ */}
      {tab === 'search' && (
        <>
          <div className="card">
            <h3 className="font-bold mb-2">📝 주제 카드 생성</h3>
            <p className="text-xs text-[var(--muted)] mb-3">
              키워드 입력 → AI가 <b>검색량 + 관련도 + 후보 결합 해시태그 + 롱테일 + 블로그 제목 + SNS 캡션</b>을 한 번에 생성
            </p>
            <div className="flex gap-2">
              <input
                className="input-field flex-1"
                value={searchKeyword}
                onChange={e => setSearchKeyword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="예: AI교육, 사교육비, 늘봄학교, 학교급식..."
              />
              <button onClick={() => handleSearch()} disabled={searching}
                className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap">
                {searching ? 'AI 분석중...' : '주제 카드 생성'}
              </button>
            </div>
          </div>

          {/* 주제 카드 */}
          {loadingTopicCard && (
            <div className="card text-center py-12">
              <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
              <p className="text-[var(--muted)] text-sm">AI가 주제 카드를 생성하고 있습니다... (약 15초)</p>
            </div>
          )}
          {topicCard?.error && !loadingTopicCard && (
            <div className="card bg-red-500/10 border-red-500/30 text-red-500 text-sm">{topicCard.error}</div>
          )}
          {topicCard && !topicCard.error && !loadingTopicCard && (
            <TopicCard data={topicCard} />
          )}

          {false && searchResult && !searchResult.error && (() => {
            const r = searchResult.result || {};
            const related = searchResult.related_keywords || [];
            const pcRatio = r.total ? Math.round((r.pc / r.total) * 100) : 0;
            const mobileRatio = r.total ? 100 - pcRatio : 0;
            return (
            <div className="card">
              <h3 className="font-bold mb-3">"{searchResult.keyword}" 검색 결과</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="p-3 rounded-xl bg-blue-500/10 text-center">
                  <div className="text-2xl font-black text-blue-500">{r.total?.toLocaleString() || '-'}</div>
                  <div className="text-xs text-[var(--muted)]">월간 총 검색량</div>
                </div>
                <div className="p-3 rounded-xl bg-[var(--muted-bg)] text-center">
                  <div className="text-2xl font-black">{r.pc?.toLocaleString() || '-'}</div>
                  <div className="text-xs text-[var(--muted)]">PC ({pcRatio}%)</div>
                </div>
                <div className="p-3 rounded-xl bg-[var(--muted-bg)] text-center">
                  <div className="text-2xl font-black">{r.mobile?.toLocaleString() || '-'}</div>
                  <div className="text-xs text-[var(--muted)]">모바일 ({mobileRatio}%)</div>
                </div>
                <div className="p-3 rounded-xl bg-[var(--muted-bg)] text-center">
                  <div className="text-2xl font-black">{r.competition || '-'}</div>
                  <div className="text-xs text-[var(--muted)]">경쟁도</div>
                </div>
              </div>

              {/* PC/모바일 CTR */}
              {(r.avg_pc_ctr > 0 || r.avg_mobile_ctr > 0) && (
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="p-3 rounded-xl bg-[var(--muted-bg)] text-center">
                    <div className="text-lg font-bold">{r.avg_pc_ctr ? `${(r.avg_pc_ctr * 100).toFixed(1)}%` : '-'}</div>
                    <div className="text-xs text-[var(--muted)]">PC 평균 클릭률</div>
                  </div>
                  <div className="p-3 rounded-xl bg-[var(--muted-bg)] text-center">
                    <div className="text-lg font-bold">{r.avg_mobile_ctr ? `${(r.avg_mobile_ctr * 100).toFixed(1)}%` : '-'}</div>
                    <div className="text-xs text-[var(--muted)]">모바일 평균 클릭률</div>
                  </div>
                </div>
              )}

              {/* 관련 키워드 */}
              {related.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-2">관련 키워드</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-[var(--muted)] border-b border-[var(--card-border)]">
                          <th className="text-left py-2 font-medium">키워드</th>
                          <th className="text-right py-2 font-medium">월간 총합</th>
                          <th className="text-right py-2 font-medium">PC</th>
                          <th className="text-right py-2 font-medium">모바일</th>
                          <th className="text-right py-2 font-medium">경쟁도</th>
                        </tr>
                      </thead>
                      <tbody>
                        {related.map((kw: any, i: number) => (
                          <tr key={i} className="border-b border-[var(--card-border)]/50 hover:bg-[var(--muted-bg)]/50 cursor-pointer"
                              onClick={() => { setSearchKeyword(kw.keyword); }}>
                            <td className="py-2 text-blue-500 hover:underline">{kw.keyword}</td>
                            <td className="py-2 text-right font-semibold">{kw.total?.toLocaleString()}</td>
                            <td className="py-2 text-right text-[var(--muted)]">{kw.pc?.toLocaleString()}</td>
                            <td className="py-2 text-right text-[var(--muted)]">{kw.mobile?.toLocaleString()}</td>
                            <td className="py-2 text-right">{kw.competition || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 해시태그 추천 */}
              <div className="mt-4">
                <h4 className="font-semibold text-sm mb-2">추천 해시태그</h4>
                <div className="flex gap-2 flex-wrap">
                  {[`#${searchResult.keyword}`, `#충북교육`, `#교육감선거`, `#${searchResult.keyword.replace(/\s/g, '')}`, `#충북${searchResult.keyword}`].map((tag, i) => (
                    <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-500 cursor-pointer hover:bg-blue-500/20"
                      onClick={() => navigator.clipboard.writeText(tag)}>
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-[var(--muted)] mt-1">클릭하면 복사됩니다</p>
              </div>
            </div>
            );
          })()}

          {searchResult?.error && (
            <div className="card text-center py-8 text-red-500">{searchResult.error}</div>
          )}

          {!searchResult && (
            <div className="card">
              <h3 className="font-bold mb-3">추천 키워드</h3>
              <div className="flex gap-2 flex-wrap">
                {['AI교육', '사교육비', '학교급식', '고교학점제', '늘봄학교', '돌봄', '수능', '학교폭력',
                  '교권', '유아교육', '방과후학교', '디지털교육', '무상급식', '충북교육감'].map(kw => (
                  <button key={kw} onClick={() => { setSearchKeyword(kw); }}
                    className="text-sm px-3 py-1.5 rounded-full bg-[var(--muted-bg)] hover:bg-blue-500/10 transition">
                    {kw}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
