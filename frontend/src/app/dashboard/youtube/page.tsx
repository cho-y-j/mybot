'use client';
import { useState, useEffect, useMemo } from 'react';
import { useElection, getCandidateColorMap } from '@/hooks/useElection';
import { api } from '@/services/api';

type TabType = 'integrated' | 'ai_threats' | 'overview' | 'videos' | 'channels' | 'danger' | 'community';

export default function YouTubePage() {
  const { election, candidates, loading: elLoading } = useElection();
  const colorMap = useMemo(() => getCandidateColorMap(candidates), [candidates]);
  const [data, setData] = useState<any>(null);
  const [communityData, setCommunityData] = useState<any>(null);
  const [mediaData, setMediaData] = useState<any>(null);
  const [aiThreats, setAiThreats] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabType>('integrated');
  const [period, setPeriod] = useState<number>(30);
  // 커뮤니티 필터
  const [cmFilterCand, setCmFilterCand] = useState<string>('all');
  const [cmFilterSent, setCmFilterSent] = useState<string>('all');
  const [cmPosts, setCmPosts] = useState<any[]>([]);
  const [cmPage, setCmPage] = useState<number>(1);
  const CM_PAGE_SIZE = 30;

  const handleRunAIAnalysis = async () => {
    if (!election) return;
    if (!confirm('미분석 콘텐츠 5건씩 AI 분석을 실행합니다 (약 1분 소요).\n참고: 수집 시 자동 분석됩니다.')) return;
    setAnalyzing(true);
    try {
      const result = await api.analyzeMediaWithAI(election.id, 5);
      alert(`AI 분석 완료!\n\n뉴스: ${result.news.analyzed}건\n유튜브: ${result.youtube.analyzed}건\n커뮤니티: ${result.community.analyzed}건\n\n새로 식별된 위협: ${result.total_threats}건`);
      const threats = await api.getAIThreats(election.id);
      setAiThreats(threats);
      setTab('ai_threats');
    } catch (e: any) {
      alert('AI 분석 실패: ' + (e?.message || ''));
    } finally { setAnalyzing(false); }
  };

  useEffect(() => {
    if (election) loadData();
  }, [election?.id, period]);

  async function loadData() {
    if (!election) return;
    setLoading(true);
    try {
      const [d, cd, md, at, cp] = await Promise.all([
        api.getYouTubeData(election.id, period).catch(() => null),
        api.getCommunityData(election.id, period).catch(() => null),
        api.getMediaOverview(election.id, period).catch(() => null),
        api.getAIThreats(election.id).catch(() => null),
        api.getCommunityPosts(election.id, period).catch(() => []),
      ]);
      setData(d);
      setCommunityData(cd);
      setMediaData(md);
      setAiThreats(at);
      setCmPosts(cp || []);
    } catch {} finally { setLoading(false); }
  }

  if (elLoading || loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" /></div>;
  if (!election) return <div className="card text-center py-12 text-[var(--muted)]">선거를 먼저 설정해주세요.</div>;

  const ytCandidates = data?.candidates || [];
  const channelAnalysis = data?.channel_analysis || [];
  const dangerVideos = data?.danger_videos || [];
  const ourCrisisVideos = dangerVideos.filter((v: any) => v.is_ours === true);
  const rivalRiskVideos = dangerVideos.filter((v: any) => v.is_ours === false);
  const maxViews = Math.max(...ytCandidates.map((d: any) => d.total_views || 0), 1);
  const totalAll = ytCandidates.reduce((s: number, c: any) => s + (c.total_videos || 0), 0);

  if (totalAll === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">유튜브 분석</h1>
        <div className="card text-center py-16">
          <p className="text-[var(--muted)] mb-2">수집된 유튜브 데이터가 없습니다.</p>
          <p className="text-[var(--muted)] text-sm">대시보드에서 "지금 수집"을 눌러 유튜브 데이터를 수집하세요.</p>
          <button onClick={loadData} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm mt-4 hover:bg-blue-700">새로고침</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">미디어 분석</h1>
          <p className="text-sm text-[var(--muted)]">
            {data?.period || `최근 ${period}일`} | 유튜브 {totalAll}건 + 커뮤니티 {(communityData?.candidates || []).reduce((s: number, c: any) => s + (c.total_posts || 0), 0)}건
          </p>
          <p className="text-[10px] text-amber-500 mt-0.5">AI 자동수집 데이터입니다. 동명이인 등 오류 발견 시 삭제해주세요.</p>
        </div>
        <div className="flex items-center gap-2">
          {([
            { v: 7, l: '7일' },
            { v: 30, l: '30일' },
            { v: 90, l: '90일' },
          ]).map(p => (
            <button key={p.v} onClick={() => setPeriod(p.v)}
              className={`px-3 py-1.5 rounded-lg text-xs transition ${period === p.v ? 'bg-blue-500 text-white font-bold' : 'bg-[var(--muted-bg)] text-[var(--muted)]'}`}>
              {p.l}
            </button>
          ))}
          <button onClick={handleRunAIAnalysis} disabled={analyzing}
            className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs hover:bg-purple-700 disabled:opacity-50">
            {analyzing ? 'AI 분석중...' : 'AI 위협 분석 실행'}
          </button>
          <button onClick={loadData} className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">새로고침</button>
        </div>
      </div>

      {/* 위험 영상 알림 — 우리 위기 vs 경쟁자 리스크 분리 */}
      {(ourCrisisVideos.length > 0 || rivalRiskVideos.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* 우리 후보 위기 — 즉시 방어 */}
          {ourCrisisVideos.length > 0 && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-red-500 font-bold text-sm">🚨 우리 후보 위기 {ourCrisisVideos.length}건</span>
                <span className="text-xs text-[var(--muted)]">즉시 방어/해명 필요</span>
              </div>
              <div className="space-y-1">
                {ourCrisisVideos.slice(0, 3).map((v: any, i: number) => (
                  <a key={i} href={`https://www.youtube.com/watch?v=${v.video_id}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm hover:text-red-400 transition">
                    <span className="text-red-500 font-bold">{v.candidate}</span>
                    <span className="flex-1 line-clamp-1">{v.title}</span>
                    <span className="text-xs text-red-400">조회 {(v.views || 0).toLocaleString()}</span>
                    {v.id && <span role="button" style={{cursor:'pointer'}} onClick={async (e) => { e.preventDefault(); e.stopPropagation();
                      if (!confirm('삭제하시겠습니까?')) return;
                      try { await api.deleteYoutubeItem(v.id); loadData(); } catch {}
                    }} className="text-[9px] text-gray-400 hover:text-red-400">삭제</span>}
                  </a>
                ))}
              </div>
            </div>
          )}
          {/* 경쟁자 리스크 — 공격 기회 */}
          {rivalRiskVideos.length > 0 && (
            <div className="p-4 rounded-xl bg-orange-500/10 border border-orange-500/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-orange-500 font-bold text-sm">🔥 경쟁자 리스크 {rivalRiskVideos.length}건</span>
                <span className="text-xs text-[var(--muted)]">공격/대응 콘텐츠 기회</span>
              </div>
              <div className="space-y-1">
                {rivalRiskVideos.slice(0, 3).map((v: any, i: number) => (
                  <a key={i} href={`https://www.youtube.com/watch?v=${v.video_id}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm hover:text-orange-400 transition">
                    <span className="text-orange-500 font-bold">{v.candidate}</span>
                    <span className="flex-1 line-clamp-1">{v.title}</span>
                    <span className="text-xs text-orange-400">조회 {(v.views || 0).toLocaleString()}</span>
                    {v.id && <span role="button" style={{cursor:'pointer'}} onClick={async (e) => { e.preventDefault(); e.stopPropagation();
                      if (!confirm('삭제하시겠습니까?')) return;
                      try { await api.deleteYoutubeItem(v.id); loadData(); } catch {}
                    }} className="text-[9px] text-gray-400 hover:text-orange-400">삭제</span>}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 탭 */}
      <div className="flex gap-1 bg-[var(--muted-bg)] rounded-lg p-1">
        {([
          ['integrated', '통합 분석'],
          ['ai_threats', 'AI 위협 분석'],
          ['overview', '유튜브'],
          ['community', '커뮤니티'],
          ['videos', '영상 목록'],
          ['channels', '채널 분석'],
          ['danger', '위험 모니터링'],
        ] as [TabType, string][]).map(([key, label]) => {
          const totalThreats = (aiThreats?.total) || 0;
          return (
            <button key={key} onClick={() => setTab(key)}
              className={`flex-1 py-2 text-sm rounded-md transition ${tab === key ? 'bg-[var(--card-bg)] shadow font-semibold' : 'text-[var(--muted)]'}`}>
              {label}
              {key === 'danger' && dangerVideos.length > 0 && (
                <span className="ml-1 text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded-full">{dangerVideos.length}</span>
              )}
              {key === 'ai_threats' && totalThreats > 0 && (
                <span className="ml-1 text-[10px] bg-purple-500 text-white px-1.5 py-0.5 rounded-full">{totalThreats}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ═══ 종합 분석 ═══ */}
      {/* ═══ 통합 분석 ═══ */}
      {tab === 'integrated' && (() => {
        const mediaCands = mediaData?.candidates || [];
        const totals = mediaData?.channel_totals || {};
        const maxReach = Math.max(...mediaCands.map((c: any) => c.reach_score || 0), 1);

        return (
          <>
            {/* 채널별 총 수집 현황 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="card text-center">
                <div className="text-2xl font-black text-blue-500">{totals.news || 0}</div>
                <div className="text-xs text-[var(--muted)]">뉴스 기사</div>
              </div>
              <div className="card text-center">
                <div className="text-2xl font-black text-red-500">{totals.youtube || 0}</div>
                <div className="text-xs text-[var(--muted)]">유튜브 영상</div>
              </div>
              <div className="card text-center">
                <div className="text-2xl font-black text-amber-500">{(totals.youtube_views || 0).toLocaleString()}</div>
                <div className="text-xs text-[var(--muted)]">유튜브 조회수</div>
              </div>
              <div className="card text-center">
                <div className="text-2xl font-black text-green-500">{totals.community || 0}</div>
                <div className="text-xs text-[var(--muted)]">커뮤니티 게시글</div>
              </div>
            </div>

            {/* 후보별 멀티채널 종합 */}
            <div className="card">
              <h3 className="font-bold mb-4">후보별 멀티채널 도달률</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-[var(--muted)] border-b border-[var(--card-border)]">
                      <th className="text-left py-2 font-medium">후보</th>
                      <th className="text-center py-2 font-medium">뉴스</th>
                      <th className="text-center py-2 font-medium">유튜브</th>
                      <th className="text-center py-2 font-medium">조회수</th>
                      <th className="text-center py-2 font-medium">커뮤니티</th>
                      <th className="text-center py-2 font-medium">총 언급</th>
                      <th className="text-center py-2 font-medium">긍정률</th>
                      <th className="text-left py-2 font-medium">도달 점수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mediaCands.map((c: any) => (
                      <tr key={c.name} className={`border-b border-[var(--card-border)]/50 ${c.is_ours ? 'bg-blue-500/5' : ''}`}>
                        <td className="py-3 font-bold" style={{ color: colorMap[c.name] }}>
                          {c.name} {c.is_ours && '★'}
                        </td>
                        <td className="py-3 text-center">
                          <div className="font-bold">{c.news?.count || 0}</div>
                          <div className="text-[10px] text-[var(--muted)]">
                            {c.news?.positive > 0 && <span className="text-green-500">+{c.news.positive}</span>}
                            {c.news?.negative > 0 && <span className="text-red-500 ml-1">-{c.news.negative}</span>}
                          </div>
                        </td>
                        <td className="py-3 text-center font-bold">{c.youtube?.count || 0}</td>
                        <td className="py-3 text-center font-bold">{(c.youtube?.views || 0).toLocaleString()}</td>
                        <td className="py-3 text-center">
                          <div className="font-bold">{c.community?.count || 0}</div>
                          <div className="text-[10px] text-[var(--muted)]">
                            {c.community?.positive > 0 && <span className="text-green-500">+{c.community.positive}</span>}
                            {c.community?.negative > 0 && <span className="text-red-500 ml-1">-{c.community.negative}</span>}
                          </div>
                        </td>
                        <td className="py-3 text-center font-black text-lg">{c.total_mentions}</td>
                        <td className="py-3 text-center">
                          <span className={`font-bold ${c.positive_rate > 50 ? 'text-green-500' : c.positive_rate < 30 ? 'text-red-500' : ''}`}>
                            {c.positive_rate}%
                          </span>
                        </td>
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-4 bg-[var(--muted-bg)] rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{
                                width: `${(c.reach_score || 0) / maxReach * 100}%`,
                                backgroundColor: colorMap[c.name],
                              }} />
                            </div>
                            <span className="text-xs font-bold w-12 text-right">{(c.reach_score || 0).toLocaleString()}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-[var(--muted)] mt-2">도달 점수 = 뉴스×100 + 유튜브조회수 + 커뮤니티×50</p>
            </div>

            {/* 채널별 감성 비교 */}
            <div className="card">
              <h3 className="font-bold mb-4">후보별 채널 감성 히트맵</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {mediaCands.filter((c: any) => c.total_mentions > 0).map((c: any) => {
                  const newsTotal = (c.news?.positive || 0) + (c.news?.negative || 0);
                  const cmTotal = (c.community?.positive || 0) + (c.community?.negative || 0);
                  const newsPosRate = newsTotal ? Math.round((c.news?.positive || 0) / newsTotal * 100) : 0;
                  const cmPosRate = cmTotal ? Math.round((c.community?.positive || 0) / cmTotal * 100) : 0;

                  return (
                    <div key={c.name} className={`p-4 rounded-xl border border-[var(--card-border)] ${c.is_ours ? 'ring-1 ring-blue-500/30' : ''}`}>
                      <div className="font-bold mb-3" style={{ color: colorMap[c.name] }}>{c.name} {c.is_ours && '★'}</div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs w-16 text-[var(--muted)]">뉴스</span>
                          <div className="flex-1 h-3 bg-[var(--muted-bg)] rounded-full overflow-hidden flex">
                            {newsTotal > 0 && <>
                              <div className="bg-green-500 h-full" style={{ width: `${newsPosRate}%` }} />
                              <div className="bg-red-500 h-full" style={{ width: `${100 - newsPosRate}%` }} />
                            </>}
                          </div>
                          <span className="text-[10px] w-10 text-right">{newsTotal > 0 ? `${newsPosRate}%` : '-'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs w-16 text-[var(--muted)]">커뮤니티</span>
                          <div className="flex-1 h-3 bg-[var(--muted-bg)] rounded-full overflow-hidden flex">
                            {cmTotal > 0 && <>
                              <div className="bg-green-500 h-full" style={{ width: `${cmPosRate}%` }} />
                              <div className="bg-red-500 h-full" style={{ width: `${100 - cmPosRate}%` }} />
                            </>}
                          </div>
                          <span className="text-[10px] w-10 text-right">{cmTotal > 0 ? `${cmPosRate}%` : '-'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs w-16 text-[var(--muted)]">유튜브</span>
                          <div className="flex-1 h-3 bg-[var(--muted-bg)] rounded-full overflow-hidden">
                            <div className="bg-blue-500 h-full" style={{ width: `${Math.min((c.youtube?.views || 0) / Math.max(...mediaCands.map((x: any) => x.youtube?.views || 0), 1) * 100, 100)}%` }} />
                          </div>
                          <span className="text-[10px] w-10 text-right">{(c.youtube?.views || 0).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        );
      })()}

      {/* ═══ AI 위협 분석 ═══ */}
      {tab === 'ai_threats' && (() => {
        const newsT = aiThreats?.news_threats || [];
        const ytT = aiThreats?.youtube_threats || [];
        const cmT = aiThreats?.community_threats || [];
        const total = newsT.length + ytT.length + cmT.length;

        if (total === 0) {
          return (
            <div className="card text-center py-12">
              <p className="text-lg font-bold mb-2">AI 분석 데이터 없음</p>
              <p className="text-sm text-[var(--muted)] mb-4">"AI 위협 분석 실행" 버튼을 눌러 Claude AI로 미디어 콘텐츠를 분석하세요.</p>
              <p className="text-xs text-[var(--muted)]">각 콘텐츠가 후보에게 미치는 영향을 분석하여 위협 수준을 자동 평가합니다.</p>
            </div>
          );
        }

        const renderItem = (item: any, type: string) => (
          <div key={`${type}-${item.id}`} className={`p-3 rounded-xl border ${
            item.level === 'high' ? 'bg-red-500/10 border-red-500/30' : 'bg-amber-500/10 border-amber-500/20'
          }`}>
            <div className="flex items-start gap-2 mb-1">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                item.level === 'high' ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'
              }`}>{item.level === 'high' ? '심각' : '주의'}</span>
              <span className="text-[10px] text-[var(--muted)]">{type}</span>
              <span className="text-[10px] font-bold" style={{ color: colorMap[item.candidate] }}>{item.candidate}</span>
              {item.views && <span className="text-[10px] text-[var(--muted)] ml-auto">조회 {item.views.toLocaleString()}</span>}
            </div>
            <a href={item.url || (item.video_id ? `https://www.youtube.com/watch?v=${item.video_id}` : '#')}
              target="_blank" rel="noopener noreferrer"
              className="text-sm font-semibold hover:text-blue-500 line-clamp-1 block mb-1">
              {item.title}
            </a>
            {item.summary && <p className="text-xs text-[var(--muted)] mb-1">{item.summary}</p>}
            {item.reason && (
              <p className="text-xs text-amber-600 mt-1">
                <span className="font-bold">AI 분석:</span> {item.reason}
              </p>
            )}
          </div>
        );

        return (
          <>
            <div className="card">
              <h3 className="font-bold mb-2">AI가 식별한 위협 콘텐츠 {total}건</h3>
              <p className="text-xs text-[var(--muted)] mb-4">Claude AI가 각 콘텐츠를 분석하여 후보에게 미치는 위협 수준을 평가합니다 (medium/high만 표시)</p>

              {newsT.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-bold mb-2 text-red-500">위협 뉴스 {newsT.length}건</h4>
                  <div className="space-y-2">
                    {newsT.map((t: any) => renderItem(t, '뉴스'))}
                  </div>
                </div>
              )}

              {ytT.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-bold mb-2 text-red-500">위협 유튜브 영상 {ytT.length}건</h4>
                  <div className="space-y-2">
                    {ytT.map((t: any) => renderItem(t, '유튜브'))}
                  </div>
                </div>
              )}

              {cmT.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold mb-2 text-red-500">위협 커뮤니티 게시글 {cmT.length}건</h4>
                  <div className="space-y-2">
                    {cmT.map((t: any) => renderItem(t, '커뮤니티'))}
                  </div>
                </div>
              )}
            </div>
          </>
        );
      })()}

      {/* ═══ 유튜브 종합 ═══ */}
      {tab === 'overview' && (
        <>
          {/* 후보별 카드 */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {ytCandidates.map((d: any) => {
              const sentEffective = (d.sentiment?.positive || 0) + (d.sentiment?.negative || 0);
              const posRate = sentEffective > 0 ? Math.round((d.sentiment?.positive || 0) / sentEffective * 100) : 0;
              const negRate = sentEffective > 0 ? Math.round((d.sentiment?.negative || 0) / sentEffective * 100) : 0;
              const cmtTotal = (d.comment_sentiment?.positive || 0) + (d.comment_sentiment?.negative || 0) + (d.comment_sentiment?.neutral || 0);
              const cmtPosRate = cmtTotal ? Math.round((d.comment_sentiment?.positive || 0) / cmtTotal * 100) : 0;

              return (
                <div key={d.name} className={`card ${d.is_ours ? 'ring-1 ring-blue-500/30 bg-blue-500/5' : ''}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                      style={{ backgroundColor: colorMap[d.name] }}>{d.name[0]}</div>
                    <div>
                      <h3 className="font-bold">{d.name} {d.is_ours && '★'}</h3>
                      <p className="text-xs text-[var(--muted)]">참여율 {d.engagement_rate}%</p>
                    </div>
                  </div>

                  {/* 기본 지표 */}
                  <div className="grid grid-cols-4 gap-2 text-center mb-3">
                    <div className="p-2 rounded-lg bg-[var(--muted-bg)]">
                      <p className="text-lg font-black">{(d.total_views || 0).toLocaleString()}</p>
                      <p className="text-[10px] text-[var(--muted)]">조회수</p>
                    </div>
                    <div className="p-2 rounded-lg bg-[var(--muted-bg)]">
                      <p className="text-lg font-black">{d.total_videos || 0}</p>
                      <p className="text-[10px] text-[var(--muted)]">영상</p>
                    </div>
                    <div className="p-2 rounded-lg bg-[var(--muted-bg)]">
                      <p className="text-lg font-black">{(d.total_likes || 0).toLocaleString()}</p>
                      <p className="text-[10px] text-[var(--muted)]">좋아요</p>
                    </div>
                    <div className="p-2 rounded-lg bg-[var(--muted-bg)]">
                      <p className="text-lg font-black">{(d.total_comments || 0).toLocaleString()}</p>
                      <p className="text-[10px] text-[var(--muted)]">댓글</p>
                    </div>
                  </div>

                  {/* Shorts vs 일반 */}
                  <div className="flex items-center gap-2 mb-3 text-xs">
                    <span className="text-[var(--muted)]">일반 {d.regular_count}건</span>
                    <div className="flex-1 h-1.5 rounded-full bg-[var(--muted-bg)] overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full"
                        style={{ width: d.total_videos > 0 ? `${d.regular_count / d.total_videos * 100}%` : '0%' }} />
                    </div>
                    <span className="text-[var(--muted)]">Shorts {d.shorts_count}건</span>
                  </div>

                  {/* 영상 감성 분포 */}
                  <div className="mb-3">
                    <p className="text-xs font-semibold mb-1">영상 감성</p>
                    <div className="h-3 rounded-full overflow-hidden flex bg-[var(--muted-bg)]">
                      {sentEffective > 0 && <>
                        <div className="bg-green-500 h-full" style={{ width: `${posRate}%` }} />
                        <div className="bg-red-500 h-full" style={{ width: `${negRate}%` }} />
                      </>}
                    </div>
                    <div className="flex justify-between text-[10px] text-[var(--muted)] mt-0.5">
                      <span className="text-green-500">긍정 {d.sentiment?.positive || 0}건 ({posRate}%)</span>
                      <span className="text-red-500">부정 {d.sentiment?.negative || 0}건 ({negRate}%)</span>
                      <span>중립 {d.sentiment?.neutral || 0}건</span>
                    </div>
                  </div>

                  {/* 댓글 감성 */}
                  {cmtTotal > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-1">댓글 감성</p>
                      <div className="h-2 rounded-full overflow-hidden flex bg-[var(--muted-bg)]">
                        <div className="bg-green-500 h-full" style={{ width: `${cmtPosRate}%` }} />
                        <div className="bg-red-500 h-full" style={{ width: `${cmtTotal ? Math.round((d.comment_sentiment?.negative || 0) / cmtTotal * 100) : 0}%` }} />
                      </div>
                      <div className="flex justify-between text-[10px] text-[var(--muted)] mt-0.5">
                        <span className="text-green-500">긍정 {d.comment_sentiment?.positive || 0}</span>
                        <span className="text-red-500">부정 {d.comment_sentiment?.negative || 0}</span>
                        <span>중립 {d.comment_sentiment?.neutral || 0}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 참여율 비교 */}
          <div className="card">
            <h3 className="font-bold mb-3">참여율 비교 (좋아요+댓글/조회수)</h3>
            <div className="space-y-3">
              {ytCandidates.map((d: any) => {
                const maxEngagement = Math.max(...ytCandidates.map((c: any) => c.engagement_rate || 0), 0.1);
                return (
                  <div key={d.name} className="flex items-center gap-3">
                    <span className="w-20 text-sm font-semibold truncate">{d.name}</span>
                    <div className="flex-1 h-6 bg-[var(--muted-bg)] rounded-full overflow-hidden relative">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${(d.engagement_rate || 0) / maxEngagement * 100}%`, backgroundColor: colorMap[d.name] }} />
                      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold">
                        {d.engagement_rate}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ═══ 영상 목록 ═══ */}
      {tab === 'videos' && (
        <>
          {ytCandidates.map((d: any) => (
            d.videos?.length > 0 && (
              <div key={d.name} className="card">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: colorMap[d.name] }}>{d.name[0]}</div>
                  <h3 className="font-semibold">{d.name} 관련 영상 ({d.videos.length}건)</h3>
                  {d.is_ours && <span className="text-xs bg-blue-500/10 text-blue-500 px-2 py-0.5 rounded-full">우리 후보</span>}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[...d.videos]
                    .sort((a: any, b: any) => {
                      const ta = a.published_at || a.collected_at || '';
                      const tb = b.published_at || b.collected_at || '';
                      return tb.localeCompare(ta);
                    })
                    .slice(0, 9).map((v: any, i: number) => (
                    <div key={i}
                      className="rounded-xl border border-[var(--card-border)] p-3 hover:border-blue-500/30 transition">
                      {v.thumbnail_url ? (
                        <img src={v.thumbnail_url} alt={v.title} className="w-full h-28 object-cover rounded-lg mb-2" />
                      ) : (
                        <div className="bg-[var(--muted-bg)] rounded-lg h-28 flex items-center justify-center mb-2">
                          <svg className="w-10 h-10 text-[var(--muted)]" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                        </div>
                      )}
                      <div className="flex items-center gap-1 mb-1">
                        {v.is_short && <span className="text-[9px] bg-red-500 text-white px-1.5 py-0.5 rounded">Shorts</span>}
                        <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                          v.sentiment === 'positive' ? 'bg-green-500/10 text-green-500' :
                          v.sentiment === 'negative' ? 'bg-red-500/10 text-red-500' : 'bg-[var(--muted-bg)] text-[var(--muted)]'
                        }`}>
                          {v.sentiment === 'positive' ? '긍정' : v.sentiment === 'negative' ? '부정' : '중립'}
                        </span>
                      </div>
                      <a href={`https://www.youtube.com/watch?v=${v.video_id}`} target="_blank" rel="noopener noreferrer"
                        className="font-medium text-sm line-clamp-2 hover:text-blue-500 block">{v.title}</a>
                      <p className="text-xs text-[var(--muted)] mt-1">
                        {v.channel} | {v.published_at ? (
                          <span>{v.published_at}</span>
                        ) : (
                          <span className="text-amber-500 italic" title="유튜브 업로드 날짜 미복원 (YouTube API 쿼터 대기 중)">작성일 미상</span>
                        )}
                      </p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-[var(--muted)]">
                        <span>조회 {(v.views || 0).toLocaleString()}</span>
                        <span>좋아요 {(v.likes || 0).toLocaleString()}</span>
                        <span>댓글 {v.comments_count || 0}</span>
                        {v.id && <span role="button" style={{cursor:'pointer'}} onClick={async (e) => {
                          e.preventDefault(); e.stopPropagation();
                          if (!window.confirm('이 영상을 삭제하시겠습니까?')) return;
                          try { await api.deleteYoutubeItem(v.id); await loadData(); } catch (err) { console.error('delete failed', err); }
                        }} className="ml-auto text-gray-400 hover:text-red-400">삭제</span>}
                      </div>
                    </div>
                  ))}
                </div>
                {d.videos.length > 9 && (
                  <button onClick={() => {
                    const el = document.getElementById(`yt-more-${d.name}`);
                    if (el) el.style.display = el.style.display === 'none' ? 'grid' : 'none';
                  }} className="mt-3 w-full py-2 text-sm text-[var(--muted)] hover:text-primary-500 border border-[var(--card-border)] rounded-lg transition">
                    더보기 (+{d.videos.length - 9}건)
                  </button>
                )}
                <div id={`yt-more-${d.name}`} style={{ display: 'none' }} className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                  {[...d.videos]
                    .sort((a: any, b: any) => (b.published_at || b.collected_at || '').localeCompare(a.published_at || a.collected_at || ''))
                    .slice(9).map((v: any, i: number) => (
                    <a key={i} href={`https://www.youtube.com/watch?v=${v.video_id}`}
                      target="_blank" rel="noopener noreferrer"
                      className="rounded-xl border border-[var(--card-border)] p-3 hover:border-blue-500/30 transition block">
                      {v.thumbnail_url ? (
                        <img src={v.thumbnail_url} alt={v.title} className="w-full h-28 object-cover rounded-lg mb-2" />
                      ) : (
                        <div className="bg-[var(--muted-bg)] rounded-lg h-28 flex items-center justify-center mb-2">
                          <svg className="w-10 h-10 text-[var(--muted)]" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                        </div>
                      )}
                      <h4 className="font-medium text-sm line-clamp-2">{v.title}</h4>
                      <div className="flex items-center gap-3 mt-2 text-xs text-[var(--muted)]">
                        <span>조회 {(v.views || 0).toLocaleString()}</span>
                        <span>좋아요 {(v.likes || 0).toLocaleString()}</span>
                        {v.id && <button onClick={async (e) => {
                          e.preventDefault(); e.stopPropagation();
                          if (!confirm('이 영상을 삭제하시겠습니까?')) return;
                          try { await api.deleteYoutubeItem(v.id); loadData(); } catch {}
                        }} className="ml-auto text-gray-400 hover:text-red-400">삭제</button>}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )
          ))}
        </>
      )}

      {/* ═══ 채널 분석 ═══ */}
      {tab === 'channels' && (
        <div className="card">
          <h3 className="font-bold mb-4">주요 채널별 후보 언급</h3>
          {channelAnalysis.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-[var(--muted)] border-b border-[var(--card-border)]">
                    <th className="text-left py-2 font-medium">채널</th>
                    <th className="text-right py-2 font-medium">총 영상</th>
                    {ytCandidates.map((c: any) => (
                      <th key={c.name} className="text-center py-2 font-medium" style={{ color: colorMap[c.name] }}>
                        {c.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {channelAnalysis.map((ch: any, i: number) => (
                    <tr key={i} className="border-b border-[var(--card-border)]/50 hover:bg-[var(--muted-bg)]/50">
                      <td className="py-2 font-semibold">{ch.channel}</td>
                      <td className="py-2 text-right">{ch.total}</td>
                      {ytCandidates.map((c: any) => (
                        <td key={c.name} className="py-2 text-center">
                          <span className={`font-bold ${(ch.candidates?.[c.name] || 0) > 0 ? '' : 'text-[var(--muted)]'}`}>
                            {ch.candidates?.[c.name] || 0}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-[var(--muted)]">채널 분석 데이터가 없습니다.</div>
          )}
        </div>
      )}

      {/* ═══ 위험 모니터링 ═══ */}
      {tab === 'danger' && (
        <>
          {dangerVideos.length > 0 ? (
            <div className="space-y-4">
              {/* 우리 후보 위기 — 즉시 방어 */}
              {ourCrisisVideos.length > 0 && (
                <div className="card border-red-500/30">
                  <h3 className="font-bold mb-2 text-red-500">🚨 우리 후보 위기 ({ourCrisisVideos.length}건)</h3>
                  <p className="text-xs text-[var(--muted)] mb-4">우리 후보를 부정적으로 다룬 조회수 5,000+ 영상 — 즉시 방어/해명 필요</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {ourCrisisVideos.map((v: any, i: number) => (
                      <a key={i} href={`https://www.youtube.com/watch?v=${v.video_id}`}
                        target="_blank" rel="noopener noreferrer"
                        className="rounded-xl border-2 border-red-500/40 bg-red-500/5 p-4 hover:border-red-500/60 transition block">
                        <div className="flex items-start gap-3">
                          {v.thumbnail_url && (
                            <img src={v.thumbnail_url} alt="" className="w-24 h-16 object-cover rounded" />
                          )}
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded font-bold">우리 위기</span>
                              <span className="text-xs font-bold" style={{ color: colorMap[v.candidate] }}>{v.candidate}</span>
                            </div>
                            <h4 className="font-medium text-sm line-clamp-2">{v.title}</h4>
                            <div className="flex items-center gap-3 mt-1 text-xs text-[var(--muted)]">
                              <span>{v.channel}</span>
                              <span className="text-red-500 font-bold">조회 {(v.views || 0).toLocaleString()}</span>
                              <span>{v.published_at}</span>
                            </div>
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* 경쟁자 리스크 — 공격 기회 */}
              {rivalRiskVideos.length > 0 && (
                <div className="card border-orange-500/30">
                  <h3 className="font-bold mb-2 text-orange-500">🔥 경쟁자 리스크 ({rivalRiskVideos.length}건)</h3>
                  <p className="text-xs text-[var(--muted)] mb-4">경쟁자를 부정적으로 다룬 조회수 5,000+ 영상 — 우리 캠프의 공격/대응 콘텐츠 기회</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {rivalRiskVideos.map((v: any, i: number) => (
                      <a key={i} href={`https://www.youtube.com/watch?v=${v.video_id}`}
                        target="_blank" rel="noopener noreferrer"
                        className="rounded-xl border-2 border-orange-500/40 bg-orange-500/5 p-4 hover:border-orange-500/60 transition block">
                        <div className="flex items-start gap-3">
                          {v.thumbnail_url && (
                            <img src={v.thumbnail_url} alt="" className="w-24 h-16 object-cover rounded" />
                          )}
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs bg-orange-500 text-white px-2 py-0.5 rounded font-bold">경쟁자 리스크</span>
                              <span className="text-xs font-bold" style={{ color: colorMap[v.candidate] }}>{v.candidate}</span>
                            </div>
                            <h4 className="font-medium text-sm line-clamp-2">{v.title}</h4>
                            <div className="flex items-center gap-3 mt-1 text-xs text-[var(--muted)]">
                              <span>{v.channel}</span>
                              <span className="text-orange-500 font-bold">조회 {(v.views || 0).toLocaleString()}</span>
                              <span>{v.published_at}</span>
                            </div>
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="card text-center py-12">
              <p className="text-green-500 font-bold text-lg mb-2">위험 영상 없음</p>
              <p className="text-sm text-[var(--muted)]">현재 조회수 5,000 이상의 부정 영상이 감지되지 않았습니다.</p>
            </div>
          )}

          {/* 부정 영상 전체 (위험 기준 미달 포함) */}
          <div className="card">
            <h3 className="font-bold mb-3">부정 감성 영상 전체</h3>
            <div className="space-y-2">
              {ytCandidates.flatMap((c: any) =>
                (c.videos || [])
                  .filter((v: any) => v.sentiment === 'negative')
                  .map((v: any) => ({ ...v, candidate: c.name }))
              ).sort((a: any, b: any) => (b.views || 0) - (a.views || 0))
              .slice(0, 10)
              .map((v: any, i: number) => (
                <a key={i} href={`https://www.youtube.com/watch?v=${v.video_id}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--muted-bg)] transition">
                  <span className="text-xs font-bold w-16" style={{ color: colorMap[v.candidate] }}>{v.candidate}</span>
                  <span className="flex-1 text-sm line-clamp-1">{v.title}</span>
                  <span className="text-xs text-[var(--muted)]">조회 {(v.views || 0).toLocaleString()}</span>
                  <span className="text-[9px] bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded">부정</span>
                </a>
              ))}
              {ytCandidates.flatMap((c: any) => (c.videos || []).filter((v: any) => v.sentiment === 'negative')).length === 0 && (
                <p className="text-center py-4 text-[var(--muted)] text-sm">부정 영상이 없습니다.</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* ═══ 커뮤니티 분석 ═══ */}
      {tab === 'community' && (() => {
        const cmCands = communityData?.candidates || [];
        const totalIssues = communityData?.total_issues || {};
        const platformSummary = communityData?.platform_summary || {};
        const totalPosts = cmCands.reduce((s: number, c: any) => s + (c.total_posts || 0), 0);

        if (totalPosts === 0) {
          return (
            <div className="card text-center py-12">
              <p className="text-[var(--muted)] mb-2">수집된 커뮤니티 데이터가 없습니다.</p>
              <p className="text-[var(--muted)] text-sm">대시보드에서 "지금 수집" → 전체를 눌러 커뮤니티 데이터를 수집하세요.</p>
            </div>
          );
        }

        return (
          <>
            {/* 플랫폼 요약 */}
            <div className="card">
              <h3 className="font-bold mb-3">플랫폼별 수집 현황</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(platformSummary).map(([platform, count]: [string, any]) => (
                  <div key={platform} className="p-3 rounded-xl bg-[var(--muted-bg)] text-center">
                    <div className="text-xl font-black">{count}</div>
                    <div className="text-xs text-[var(--muted)]">
                      {platform === 'naver_cafe' ? '네이버 카페' :
                       platform === 'naver_blog' ? '네이버 블로그' :
                       platform === 'tistory' ? '티스토리' : platform}
                    </div>
                  </div>
                ))}
                <div className="p-3 rounded-xl bg-blue-500/10 text-center">
                  <div className="text-xl font-black text-blue-500">{totalPosts}</div>
                  <div className="text-xs text-[var(--muted)]">총 게시글</div>
                </div>
              </div>
            </div>

            {/* 이슈 카테고리 분포 */}
            {Object.keys(totalIssues).length > 0 && (
              <div className="card">
                <h3 className="font-bold mb-3">이슈 카테고리별 게시글</h3>
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(totalIssues).map(([issue, count]: [string, any]) => {
                    const maxCount = Math.max(...Object.values(totalIssues).map(Number), 1);
                    const intensity = count / maxCount;
                    return (
                      <div key={issue} className={`px-3 py-1.5 rounded-full text-sm ${
                        intensity > 0.7 ? 'bg-blue-500/20 text-blue-500 font-bold' :
                        intensity > 0.3 ? 'bg-blue-500/10 text-blue-400' :
                        'bg-[var(--muted-bg)] text-[var(--muted)]'
                      }`}>
                        {issue} <span className="font-bold">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 후보별 커뮤니티 분석 */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {cmCands.map((c: any) => {
                const sentEffective = (c.sentiment?.positive || 0) + (c.sentiment?.negative || 0);
                const posRate = sentEffective > 0 ? Math.round((c.sentiment?.positive || 0) / sentEffective * 100) : 0;
                const negRate = sentEffective > 0 ? Math.round((c.sentiment?.negative || 0) / sentEffective * 100) : 0;

                return (
                  <div key={c.name} className={`card ${c.is_ours ? 'ring-1 ring-blue-500/30 bg-blue-500/5' : ''}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
                        style={{ backgroundColor: colorMap[c.name] }}>{c.name[0]}</div>
                      <div>
                        <h3 className="font-bold">{c.name} {c.is_ours && '★'}</h3>
                        <p className="text-xs text-[var(--muted)]">{c.total_posts}건</p>
                      </div>
                    </div>

                    {/* 감성 분포 */}
                    {sentEffective > 0 && (
                      <div className="mb-3">
                        <div className="h-2.5 rounded-full overflow-hidden flex bg-[var(--muted-bg)]">
                          <div className="bg-green-500 h-full" style={{ width: `${posRate}%` }} />
                          <div className="bg-red-500 h-full" style={{ width: `${negRate}%` }} />
                        </div>
                        <div className="flex justify-between text-[10px] text-[var(--muted)] mt-0.5">
                          <span className="text-green-500">긍정 {c.sentiment?.positive || 0} ({posRate}%)</span>
                          <span className="text-red-500">부정 {c.sentiment?.negative || 0} ({negRate}%)</span>
                          <span>중립 {c.sentiment?.neutral || 0}</span>
                        </div>
                      </div>
                    )}

                    {/* 플랫폼별 */}
                    <div className="flex gap-2 flex-wrap mb-3">
                      {Object.entries(c.platforms || {}).map(([p, cnt]: [string, any]) => (
                        <span key={p} className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--muted-bg)]">
                          {p === 'naver_cafe' ? '카페' : p === 'naver_blog' ? '블로그' : p} {cnt}
                        </span>
                      ))}
                    </div>

                    {/* 이슈 카테고리 */}
                    {Object.keys(c.issues || {}).length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {Object.entries(c.issues || {}).slice(0, 5).map(([issue, cnt]: [string, any]) => (
                          <span key={issue} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500">
                            {issue} {cnt}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 핫 게시글 */}
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold">전체 게시글</h3>
                <span className="text-xs text-[var(--muted)]">총 {cmPosts.filter((p: any) => {
                  if (cmFilterCand !== 'all' && p.candidate !== cmFilterCand) return false;
                  if (cmFilterSent !== 'all' && p.sentiment !== cmFilterSent) return false;
                  return true;
                }).length}건</span>
              </div>

              {/* 필터 */}
              <div className="flex gap-2 mb-3 flex-wrap">
                <select className="text-xs px-2 py-1 rounded bg-[var(--muted-bg)] border border-[var(--card-border)]"
                  value={cmFilterCand} onChange={e => { setCmFilterCand(e.target.value); setCmPage(1); }}>
                  <option value="all">전체 후보</option>
                  {cmCands.map((c: any) => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                <select className="text-xs px-2 py-1 rounded bg-[var(--muted-bg)] border border-[var(--card-border)]"
                  value={cmFilterSent} onChange={e => { setCmFilterSent(e.target.value); setCmPage(1); }}>
                  <option value="all">전체 감성</option>
                  <option value="positive">긍정</option>
                  <option value="negative">부정</option>
                  <option value="neutral">중립</option>
                </select>
              </div>

              {(() => {
                const filteredPosts = cmPosts
                  .filter((p: any) => {
                    if (cmFilterCand !== 'all' && p.candidate !== cmFilterCand) return false;
                    if (cmFilterSent !== 'all' && p.sentiment !== cmFilterSent) return false;
                    return true;
                  })
                  .sort((a: any, b: any) => {
                    const ta = a.published_at || a.collected_at || '';
                    const tb = b.published_at || b.collected_at || '';
                    return tb.localeCompare(ta);
                  });
                const cmTotalPages = Math.ceil(filteredPosts.length / CM_PAGE_SIZE);
                const pagedPosts = filteredPosts.slice((cmPage - 1) * CM_PAGE_SIZE, cmPage * CM_PAGE_SIZE);
                return (
                  <>
              <div className="space-y-2">
                {pagedPosts.map((p: any, i: number) => (
                  <a key={i} href={p.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--muted-bg)] transition block">
                    <span className="text-[10px] w-24 shrink-0" title={p.published_at ? `작성일: ${p.published_at}` : `작성일 미상 (수집 시각: ${p.collected_at || '미상'})`}>
                      {p.published_at ? (
                        <span className="text-[var(--muted)]">{p.published_at.substring(0, 10)}</span>
                      ) : (
                        <span className="text-amber-500 italic text-[9px]">수집: {(p.collected_at || '').substring(0, 10) || '미상'}</span>
                      )}
                    </span>
                    <span className="text-xs font-bold w-16 shrink-0" style={{ color: colorMap[p.candidate] }}>{p.candidate}</span>
                    <span className="flex-1 text-sm line-clamp-1 min-w-0">{p.title}</span>
                    {(p.engagement?.views || p.engagement?.comments) ? (
                      <span className="text-[10px] text-[var(--muted)] shrink-0">
                        {p.engagement?.views ? `조회 ${p.engagement.views.toLocaleString()}` : ''}
                        {p.engagement?.comments ? ` · 댓글 ${p.engagement.comments}` : ''}
                      </span>
                    ) : null}
                    {p.ai_threat_level && p.ai_threat_level !== 'none' && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0 ${
                        p.ai_threat_level === 'high' ? 'bg-red-500 text-white' :
                        p.ai_threat_level === 'medium' ? 'bg-amber-500 text-white' :
                        'bg-amber-500/10 text-amber-500'
                      }`}>
                        {p.ai_threat_level === 'high' ? '심각' : p.ai_threat_level === 'medium' ? '주의' : '낮음'}
                      </span>
                    )}
                    <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${
                      p.sentiment === 'positive' ? 'bg-green-500/10 text-green-500' :
                      p.sentiment === 'negative' ? 'bg-red-500/10 text-red-500' : 'bg-[var(--muted-bg)] text-[var(--muted)]'
                    }`}>
                      {p.sentiment === 'positive' ? '긍정' : p.sentiment === 'negative' ? '부정' : '중립'}
                    </span>
                    {p.issue_category && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 shrink-0">{p.issue_category}</span>
                    )}
                    <span className="text-[10px] text-[var(--muted)] shrink-0">
                      {p.platform === 'naver_cafe' ? '카페' : p.platform === 'naver_blog' ? '블로그' : p.platform || ''}
                    </span>
                    {p.id && <span role="button" style={{cursor:'pointer'}} onClick={async (e) => {
                      e.preventDefault(); e.stopPropagation();
                      if (!window.confirm('이 게시글을 삭제하시겠습니까?')) return;
                      try { await api.deleteCommunityItem(p.id); await loadData(); } catch (err) { console.error(err); }
                    }} className="text-[9px] text-gray-400 hover:text-red-400 shrink-0 px-1">삭제</span>}
                  </a>
                ))}
                {filteredPosts.length === 0 && (
                  <p className="text-center py-4 text-[var(--muted)] text-sm">게시글 데이터가 없습니다.</p>
                )}
              </div>
              {cmTotalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-4">
                  <button onClick={() => setCmPage(p => Math.max(1, p - 1))} disabled={cmPage === 1}
                    className="px-3 py-1 text-xs rounded bg-[var(--muted-bg)] disabled:opacity-50">이전</button>
                  <span className="text-xs text-[var(--muted)]">{cmPage} / {cmTotalPages}</span>
                  <button onClick={() => setCmPage(p => Math.min(cmTotalPages, p + 1))} disabled={cmPage === cmTotalPages}
                    className="px-3 py-1 text-xs rounded bg-[var(--muted-bg)] disabled:opacity-50">다음</button>
                </div>
              )}
                  </>
                );
              })()}
            </div>
          </>
        );
      })()}
    </div>
  );
}
