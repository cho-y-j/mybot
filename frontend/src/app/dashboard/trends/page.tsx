'use client';
import { useState, useEffect, useMemo } from 'react';
import { useElection, getCandidateColorMap } from '@/hooks/useElection';
import { api } from '@/services/api';
import { SearchTrendLine, CANDIDATE_COLORS } from '@/components/charts';
import IssuesTab from '@/components/trends/IssuesTab';

type TabType = 'candidates' | 'realtime' | 'issues' | 'search';

export default function TrendsPage() {
  const { election, candidates, ourCandidate, loading: elLoading } = useElection();
  const colorMap = useMemo(() => getCandidateColorMap(candidates), [candidates]);
  const [trends, setTrends] = useState<any>(null);
  const [realtime, setRealtime] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [tab, setTab] = useState<TabType>('candidates');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResult, setSearchResult] = useState<any>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (election) loadTrends();
    loadRealtime();
  }, [election]);

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

  const handleSearch = async (keyword?: string) => {
    const kw = (keyword || searchKeyword).trim();
    if (!kw || !election) return;
    if (keyword) setSearchKeyword(kw);
    setSearching(true);
    try {
      const data = await api.searchKeyword(election.id, kw);
      setSearchResult(data);
    } catch (e: any) {
      setSearchResult({ error: e?.message || '검색 실패' });
    } finally { setSearching(false); }
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
          ['candidates', '후보 검색량'],
          ['realtime', '실시간 급상승'],
          ['issues', election.election_type === 'superintendent' ? '교육 이슈' :
                     election.election_type === 'mayor' ? '시정 이슈' :
                     election.election_type === 'governor' ? '도정 이슈' :
                     election.election_type === 'congressional' ? '정책 이슈' :
                     election.election_type === 'council' ? '지역 이슈' : '관련 이슈'],
          ['search', '키워드 조회'],
        ] as [TabType, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 py-2 text-sm rounded-md transition ${tab === key ? 'bg-[var(--card-bg)] shadow font-semibold' : 'text-[var(--muted)]'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ═══ 실시간 급상승 ═══ */}
      {tab === 'realtime' && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="font-bold">실시간 급상승 검색어</h3>
            <button onClick={loadRealtime} className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]">새로고침</button>
          </div>
          {(() => {
            const items = realtime?.trends || [];
            const half = Math.ceil(items.length / 2);
            const left = items.slice(0, half);
            const right = items.slice(half);
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  {left.map((t: any, i: number) => (
                    <div key={i} className={`p-3 rounded-xl border transition ${
                      t.is_education_related ? 'bg-amber-500/10 border-amber-500/30' : 'bg-[var(--card-bg)] border-[var(--card-border)]'
                    }`}>
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-black text-[var(--muted)] w-8">{i + 1}</span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{t.keyword}</span>
                            {t.is_education_related && <span className="text-[10px] bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded font-bold">교육</span>}
                          </div>
                          {t.news?.[0] && <p className="text-xs text-[var(--muted)] mt-0.5 line-clamp-1">{t.news[0].title}</p>}
                        </div>
                        <span className="text-xs text-[var(--muted)]">{t.traffic}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  {right.map((t: any, i: number) => (
                    <div key={i} className={`p-3 rounded-xl border transition ${
                      t.is_education_related ? 'bg-amber-500/10 border-amber-500/30' : 'bg-[var(--card-bg)] border-[var(--card-border)]'
                    }`}>
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-black text-[var(--muted)] w-8">{half + i + 1}</span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{t.keyword}</span>
                            {t.is_education_related && <span className="text-[10px] bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded font-bold">교육</span>}
                          </div>
                          {t.news?.[0] && <p className="text-xs text-[var(--muted)] mt-0.5 line-clamp-1">{t.news[0].title}</p>}
                        </div>
                        <span className="text-xs text-[var(--muted)]">{t.traffic}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          {(realtime?.trends || []).length === 0 && (
            <div className="card text-center py-12 text-[var(--muted)]">실시간 데이터를 불러올 수 없습니다.</div>
          )}
          <div className="text-xs text-[var(--muted)] text-center">교육/선거 관련 키워드는 노란색으로 하이라이트 | 출처: Google Trends</div>
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

      {/* ═══ 키워드 조회 ═══ */}
      {tab === 'search' && (
        <>
          <div className="card">
            <h3 className="font-bold mb-3">키워드 검색량 조회</h3>
            <p className="text-xs text-[var(--muted)] mb-3">공약, 교육 이슈 등 키워드를 입력하면 검색량과 추천 해시태그를 확인할 수 있습니다.</p>
            <div className="flex gap-2">
              <input
                className="input-field flex-1"
                value={searchKeyword}
                onChange={e => setSearchKeyword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="예: AI교육, 사교육비, 학교급식, 고교학점제..."
              />
              <button onClick={() => handleSearch()} disabled={searching}
                className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm hover:bg-blue-700 disabled:opacity-50">
                {searching ? '조회중...' : '검색'}
              </button>
            </div>
          </div>

          {searchResult && !searchResult.error && (() => {
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
