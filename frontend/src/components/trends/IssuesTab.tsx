'use client';
import { useState, useEffect, useMemo } from 'react';
import { api } from '@/services/api';
import { SearchTrendLine, CANDIDATE_COLORS } from '@/components/charts';
import IssueInsights from './IssueInsights';

interface IssueInfo {
  latest: number;
  avg_7d: number;
  avg_30d: number;
  trend: string;
  data?: { date: string; ratio: number }[];
}

interface VolumeInfo {
  keyword: string;
  pc: number;
  mobile: number;
  total: number;
  competition: string;
}

interface IssuesTabProps {
  election: any;
  issueData: Record<string, IssueInfo>;
  onNavigateToSearch: (keyword: string) => void;
}

const MEDALS = ['🥇', '🥈', '🥉'];

export default function IssuesTab({ election, issueData, onNavigateToSearch }: IssuesTabProps) {
  const [categories, setCategories] = useState<Record<string, { keywords: string[]; count: number }>>({});
  const [volumes, setVolumes] = useState<Record<string, VolumeInfo>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [volumesLoading, setVolumesLoading] = useState(false);
  const [chartCategory, setChartCategory] = useState<string>('all');
  // Phase 2
  const [regionalData, setRegionalData] = useState<any>(null);
  const [regionalLoading, setRegionalLoading] = useState(false);
  const [showRegional, setShowRegional] = useState(false);
  const [blogTags, setBlogTags] = useState<Record<string, any[]>>({});
  const [showExplorer, setShowExplorer] = useState(false);
  const [copiedTag, setCopiedTag] = useState<string | null>(null);
  // 커스텀 키워드 추가
  const [showAddKeyword, setShowAddKeyword] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [customKeywords, setCustomKeywords] = useState<string[]>([]);
  const [addingKeyword, setAddingKeyword] = useState(false);

  useEffect(() => {
    loadCategories();
    loadVolumes();
    loadCustomKeywords();
  }, [election]);

  const loadCategories = async () => {
    try {
      const data = await api.getKeywordCategories(election.election_type || 'superintendent');
      setCategories(data.categories || {});
      // 첫 3개 카테고리 기본 펼침
      const cats = Object.keys(data.categories || {});
      setExpanded(new Set(cats.slice(0, 3)));
    } catch (e) {
      console.error('categories error:', e);
    }
  };

  const loadVolumes = async () => {
    setVolumesLoading(true);
    try {
      const data = await api.getKeywordVolumes(election.id);
      const map: Record<string, VolumeInfo> = {};
      for (const item of [...(data.issues || []), ...(data.candidates || []), ...(data.all || [])]) {
        if (!map[item.keyword]) map[item.keyword] = item;
      }
      setVolumes(map);
    } catch (e) {
      console.error('volumes error:', e);
    } finally {
      setVolumesLoading(false);
    }
  };

  const loadCustomKeywords = async () => {
    try {
      const keywords = await api.getKeywords(election.id);
      const custom = (keywords || [])
        .filter((k: any) => k.category === 'custom' && k.enabled)
        .map((k: any) => k.word);
      setCustomKeywords(custom);
    } catch {}
  };

  const handleAddKeyword = async () => {
    if (!newKeyword.trim() || !election) return;
    setAddingKeyword(true);
    try {
      await api.addKeyword(election.id, { word: newKeyword.trim(), category: 'custom' });
      setCustomKeywords(prev => [...prev, newKeyword.trim()]);
      setNewKeyword('');
      setShowAddKeyword(false);
    } catch (e: any) {
      alert('키워드 추가 실패: ' + (e?.message || '이미 존재하는 키워드'));
    } finally { setAddingKeyword(false); }
  };

  const loadRegional = async () => {
    if (regionalData) return; // 이미 로딩됨
    setRegionalLoading(true);
    try {
      const data = await api.getRegionalKeywordTrends(election.id);
      setRegionalData(data);
    } catch (e) {
      console.error('regional error:', e);
    } finally {
      setRegionalLoading(false);
    }
  };

  const loadBlogTags = async () => {
    if (Object.keys(blogTags).length > 0) return;
    try {
      const data = await api.getBlogTags(election.id);
      setBlogTags(data.categories || {});
    } catch (e) {
      console.error('blog tags error:', e);
    }
  };

  const copyTag = (tag: string) => {
    navigator.clipboard.writeText(tag);
    setCopiedTag(tag);
    setTimeout(() => setCopiedTag(null), 1500);
  };

  // 전체 이슈를 검색량 순으로 정렬 (상위 3개 메달용)
  const rankedIssues = useMemo(() => {
    const all = Object.entries(issueData)
      .map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.latest - a.latest);
    return all;
  }, [issueData]);

  const topNames = useMemo(() => rankedIssues.slice(0, 3).map(r => r.name), [rankedIssues]);

  // 카테고리에 매핑되지 않는 이슈 → "기타"
  const categorized = useMemo(() => {
    const allCatKeywords = new Set<string>();
    Object.values(categories).forEach(c => c.keywords.forEach(k => allCatKeywords.add(k)));

    const uncategorized = Object.keys(issueData).filter(k => !allCatKeywords.has(k));

    const result: Record<string, string[]> = {};
    for (const [cat, { keywords }] of Object.entries(categories)) {
      // 카테고리 키워드 중 issueData가 있는 것만 + 없어도 volumes 있으면 포함
      const relevant = keywords.filter(k => issueData[k] || volumes[k]);
      if (relevant.length > 0) result[cat] = relevant;
    }
    if (uncategorized.length > 0) result['기타'] = uncategorized;
    // 커스텀 키워드 카테고리 추가
    const customWithData = customKeywords.filter(k => !allCatKeywords.has(k));
    if (customWithData.length > 0) {
      result['사용자 추가'] = customWithData;
    }
    return result;
  }, [categories, issueData, volumes, customKeywords]);

  // 차트 데이터
  const chartData = useMemo(() => {
    let keywords: string[];
    if (chartCategory === 'all') {
      keywords = rankedIssues.slice(0, 5).map(r => r.name);
    } else {
      const catKws = categorized[chartCategory] || [];
      keywords = catKws
        .filter(k => issueData[k])
        .sort((a, b) => (issueData[b]?.latest || 0) - (issueData[a]?.latest || 0))
        .slice(0, 5);
    }

    if (keywords.length === 0) return { data: [], keywords: [] };

    const firstData = issueData[keywords[0]]?.data || [];
    const data = firstData.map((point, i) => {
      const row: any = { date: point.date?.substring(5) || '' };
      keywords.forEach(name => {
        const d = issueData[name]?.data?.[i];
        if (d) row[name] = d.ratio;
      });
      return row;
    });
    return { data, keywords };
  }, [chartCategory, categorized, issueData, rankedIssues]);

  const toggleCategory = (cat: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const getChangePercent = (avg7d: number, avg30d: number) => {
    if (!avg30d || avg30d === 0) return null;
    return ((avg7d - avg30d) / avg30d * 100);
  };

  const catNames = Object.keys(categorized);

  return (
    <div className="space-y-4">
      {/* 키워드 추가 */}
      <div className="flex items-center gap-2">
        {showAddKeyword ? (
          <div className="flex gap-2 flex-1">
            <input
              className="input-field flex-1"
              value={newKeyword}
              onChange={e => setNewKeyword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddKeyword()}
              placeholder="모니터링할 키워드 입력 (예: 통학버스, 학교급식...)"
              autoFocus
            />
            <button onClick={handleAddKeyword} disabled={addingKeyword || !newKeyword.trim()}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 shrink-0">
              {addingKeyword ? '추가중...' : '추가'}
            </button>
            <button onClick={() => { setShowAddKeyword(false); setNewKeyword(''); }}
              className="px-3 py-1.5 text-[var(--muted)] hover:text-[var(--foreground)] text-sm shrink-0">
              취소
            </button>
          </div>
        ) : (
          <button onClick={() => setShowAddKeyword(true)}
            className="px-3 py-1.5 border border-dashed border-[var(--card-border)] rounded-lg text-sm text-[var(--muted)] hover:border-blue-500/30 hover:text-blue-500 transition">
            + 키워드 추가
          </button>
        )}
        {customKeywords.length > 0 && !showAddKeyword && (
          <span className="text-xs text-[var(--muted)]">사용자 추가: {customKeywords.join(', ')}</span>
        )}
      </div>

      {/* 카테고리 아코디언 */}
      {catNames.length > 0 ? (
        catNames.map(cat => {
          const keywords = categorized[cat];
          const isOpen = expanded.has(cat);
          const hasData = keywords.some(k => issueData[k]);

          return (
            <div key={cat} className="card overflow-hidden">
              {/* 헤더 */}
              <button
                onClick={() => toggleCategory(cat)}
                className="w-full flex items-center justify-between p-4 hover:bg-[var(--muted-bg)]/50 transition"
              >
                <div className="flex items-center gap-2">
                  <span className={`text-sm transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                  <span className="font-bold">{cat}</span>
                  <span className="text-xs text-[var(--muted)] bg-[var(--muted-bg)] px-2 py-0.5 rounded-full">
                    {keywords.length}개
                  </span>
                </div>
                {!hasData && (
                  <span className="text-[10px] text-[var(--muted)]">트렌드 데이터 없음</span>
                )}
              </button>

              {/* 키워드 그리드 */}
              {isOpen && (
                <div className="px-4 pb-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {keywords.map(kw => {
                      const issue = issueData[kw];
                      const vol = volumes[kw];
                      const medalIdx = topNames.indexOf(kw);
                      const change = issue ? getChangePercent(issue.avg_7d, issue.avg_30d) : null;

                      return (
                        <div
                          key={kw}
                          onClick={() => onNavigateToSearch(kw)}
                          className="p-3 rounded-xl border border-[var(--card-border)] hover:border-blue-500/30 hover:bg-blue-500/5 transition cursor-pointer group"
                        >
                          {/* 키워드 이름 + 메달 */}
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="font-semibold text-sm">
                              {medalIdx >= 0 && <span className="mr-1">{MEDALS[medalIdx]}</span>}
                              {kw}
                            </span>
                            {issue && (
                              <span className={`text-[10px] font-bold ${
                                issue.trend === 'rising' ? 'text-green-500' :
                                issue.trend === 'falling' ? 'text-red-500' : 'text-[var(--muted)]'
                              }`}>
                                {issue.trend === 'rising' ? '↑상승' : issue.trend === 'falling' ? '↓하락' : '→유지'}
                              </span>
                            )}
                          </div>

                          {/* 상대 검색량 */}
                          {issue ? (
                            <>
                              <div className="text-xl font-black">{issue.latest.toFixed(1)}</div>
                              <div className="text-[10px] text-[var(--muted)] flex items-center gap-1">
                                <span>7d {issue.avg_7d.toFixed(1)}</span>
                                <span>|</span>
                                <span>30d {issue.avg_30d.toFixed(1)}</span>
                                {change !== null && (
                                  <span className={`ml-1 font-bold ${change > 0 ? 'text-green-500' : change < 0 ? 'text-red-500' : ''}`}>
                                    {change > 0 ? '+' : ''}{change.toFixed(0)}%
                                  </span>
                                )}
                              </div>
                            </>
                          ) : (
                            <div className="text-xs text-[var(--muted)]">데이터 수집 중...</div>
                          )}

                          {/* 실제 검색량 */}
                          {vol ? (
                            <div className="mt-2 pt-2 border-t border-[var(--card-border)]/50">
                              <div className="text-xs font-bold">{vol.total.toLocaleString()}<span className="text-[var(--muted)] font-normal">/월</span></div>
                              <div className="flex items-center gap-2 mt-1">
                                <div className="flex-1 h-1.5 rounded-full bg-[var(--muted-bg)] overflow-hidden">
                                  <div
                                    className="h-full bg-blue-500 rounded-full"
                                    style={{ width: vol.total > 0 ? `${(vol.pc / vol.total) * 100}%` : '0%' }}
                                  />
                                </div>
                                <span className="text-[9px] text-[var(--muted)]">
                                  PC {vol.pc.toLocaleString()} · M {vol.mobile.toLocaleString()}
                                </span>
                              </div>
                            </div>
                          ) : volumesLoading ? (
                            <div className="mt-2 pt-2 border-t border-[var(--card-border)]/50">
                              <div className="h-3 w-16 bg-[var(--muted-bg)] rounded animate-pulse" />
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })
      ) : (
        /* 카테고리 로딩 전 — 기존 방식으로 평면 표시 */
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {rankedIssues.map((t, i) => (
            <div key={t.name} className="card text-center cursor-pointer hover:border-blue-500/30"
              onClick={() => onNavigateToSearch(t.name)}>
              <div className="text-xl font-black">{t.latest.toFixed(1)}</div>
              <div className="font-medium text-sm mt-1">{t.name}</div>
              <div className={`text-[10px] mt-0.5 ${
                t.trend === 'rising' ? 'text-green-500' : t.trend === 'falling' ? 'text-red-500' : 'text-[var(--muted)]'
              }`}>
                {t.trend === 'rising' ? '↑ 상승' : t.trend === 'falling' ? '↓ 하락' : '→ 유지'}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 이슈 추이 차트 */}
      {chartData.data.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold">이슈 키워드 추이</h3>
            <select
              value={chartCategory}
              onChange={e => setChartCategory(e.target.value)}
              className="text-xs px-2 py-1 rounded-lg bg-[var(--muted-bg)] border border-[var(--card-border)] text-[var(--foreground)]"
            >
              <option value="all">전체 TOP 5</option>
              {catNames.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <SearchTrendLine data={chartData.data} keywords={chartData.keywords} />
        </div>
      )}

      {/* ═══ 지역 트렌딩 ═══ */}
      <div className="card">
        <button
          onClick={() => { setShowRegional(!showRegional); if (!showRegional) loadRegional(); }}
          className="w-full flex items-center justify-between"
        >
          <div>
            <h3 className="font-bold">지역 트렌딩 이슈</h3>
            <p className="text-xs text-[var(--muted)]">전국 대비 우리 지역에서 특히 관심 높은 이슈</p>
          </div>
          <span className={`text-sm transition-transform ${showRegional ? 'rotate-90' : ''}`}>▶</span>
        </button>

        {showRegional && (
          <div className="mt-4">
            {regionalLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin h-6 w-6 border-3 border-blue-500 border-t-transparent rounded-full" />
                <span className="ml-2 text-sm text-[var(--muted)]">지역 데이터 분석 중...</span>
              </div>
            ) : regionalData ? (
              <>
                {/* 지역 강세 이슈 */}
                {regionalData.hot_local?.length > 0 && (
                  <div className="mb-4">
                    <div className="text-xs font-semibold text-amber-500 mb-2">
                      {regionalData.region} 지역 강세 이슈
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {regionalData.hot_local.map((item: any) => (
                        <button key={item.keyword} onClick={() => onNavigateToSearch(item.keyword)}
                          className="px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-sm hover:bg-amber-500/20 transition">
                          <span className="font-semibold">{item.keyword}</span>
                          <span className="text-amber-500 ml-1.5 text-xs">+{item.regional_boost.toFixed(0)}%</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 전체 비교 테이블 */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-[var(--muted)] border-b border-[var(--card-border)]">
                        <th className="text-left py-2 font-medium">이슈</th>
                        <th className="text-right py-2 font-medium">전국 7d</th>
                        <th className="text-right py-2 font-medium">{regionalData.region} 7d</th>
                        <th className="text-right py-2 font-medium">지역 강도</th>
                        <th className="text-center py-2 font-medium">전국</th>
                        <th className="text-center py-2 font-medium">지역</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(regionalData.issues || {}).map(([kw, d]: [string, any]) => (
                        <tr key={kw} className="border-b border-[var(--card-border)]/50 hover:bg-[var(--muted-bg)]/50 cursor-pointer"
                          onClick={() => onNavigateToSearch(kw)}>
                          <td className="py-2 font-semibold text-blue-500">{kw}</td>
                          <td className="py-2 text-right">{d.national_avg_7d}</td>
                          <td className="py-2 text-right">{d.regional_avg_7d}</td>
                          <td className={`py-2 text-right font-bold ${
                            d.regional_boost > 10 ? 'text-amber-500' : d.regional_boost < -10 ? 'text-blue-400' : 'text-[var(--muted)]'
                          }`}>
                            {d.regional_boost > 0 ? '+' : ''}{d.regional_boost.toFixed(0)}%
                          </td>
                          <td className="py-2 text-center">
                            <span className={`text-[10px] ${
                              d.national_trend === 'rising' ? 'text-green-500' : d.national_trend === 'falling' ? 'text-red-500' : 'text-[var(--muted)]'
                            }`}>
                              {d.national_trend === 'rising' ? '↑' : d.national_trend === 'falling' ? '↓' : '→'}
                            </span>
                          </td>
                          <td className="py-2 text-center">
                            <span className={`text-[10px] ${
                              d.regional_trend === 'rising' ? 'text-green-500' : d.regional_trend === 'falling' ? 'text-red-500' : 'text-[var(--muted)]'
                            }`}>
                              {d.regional_trend === 'rising' ? '↑' : d.regional_trend === 'falling' ? '↓' : '→'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="text-center py-6 text-[var(--muted)] text-sm">데이터를 불러올 수 없습니다.</div>
            )}
          </div>
        )}
      </div>

      {/* ═══ 전체 키워드 카테고리 탐색기 ═══ */}
      <div className="card">
        <button
          onClick={() => { setShowExplorer(!showExplorer); if (!showExplorer) loadBlogTags(); }}
          className="w-full flex items-center justify-between"
        >
          <div>
            <h3 className="font-bold">전체 키워드 카테고리</h3>
            <p className="text-xs text-[var(--muted)]">태그 변형 (키워드 · 지역+키워드 · 후보+키워드) — 클릭하여 복사</p>
          </div>
          <span className={`text-sm transition-transform ${showExplorer ? 'rotate-90' : ''}`}>▶</span>
        </button>

        {showExplorer && Object.keys(blogTags).length > 0 && (
          <div className="mt-4 space-y-4">
            {Object.entries(blogTags).map(([cat, tags]) => (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-semibold text-sm">{cat}</span>
                  <span className="text-[10px] text-[var(--muted)] bg-[var(--muted-bg)] px-1.5 py-0.5 rounded-full">
                    {tags.length}개
                  </span>
                </div>
                <div className="space-y-1.5">
                  {tags.map((t: any) => (
                    <div key={t.tag} className="flex items-center gap-2 flex-wrap">
                      {t.variations?.map((v: string, i: number) => (
                        <button
                          key={i}
                          onClick={() => copyTag(`#${v.replace(/\s/g, '')}`)}
                          className={`text-xs px-2.5 py-1 rounded-full transition cursor-pointer ${
                            copiedTag === `#${v.replace(/\s/g, '')}`
                              ? 'bg-green-500/20 text-green-500 border border-green-500/30'
                              : i === 0
                                ? 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20'
                                : 'bg-[var(--muted-bg)] text-[var(--muted)] hover:bg-blue-500/10 hover:text-blue-500'
                          }`}
                        >
                          {copiedTag === `#${v.replace(/\s/g, '')}` ? '복사됨!' : `#${v.replace(/\s/g, '')}`}
                        </button>
                      ))}
                      <button
                        onClick={() => onNavigateToSearch(t.tag)}
                        className="text-[10px] text-[var(--muted)] hover:text-blue-500 transition"
                      >
                        검색량 조회
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {showExplorer && Object.keys(blogTags).length === 0 && (
          <div className="mt-4 flex items-center justify-center py-6">
            <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full" />
            <span className="ml-2 text-sm text-[var(--muted)]">태그 로딩 중...</span>
          </div>
        )}
      </div>

      {/* ═══ 이슈 인사이트 (Phase 3) ═══ */}
      {Object.keys(issueData).length > 0 && (
        <IssueInsights
          election={election}
          issueData={issueData}
          onNavigateToSearch={onNavigateToSearch}
        />
      )}

      {Object.keys(issueData).length === 0 && (
        <div className="card text-center py-12 text-[var(--muted)]">
          이슈 키워드 데이터가 없습니다. "지금 업데이트"를 눌러주세요.
        </div>
      )}
    </div>
  );
}
