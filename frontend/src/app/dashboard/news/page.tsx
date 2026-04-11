'use client';
import { useState, useEffect, useMemo } from 'react';
import { useElection, getCandidateColorMap } from '@/hooks/useElection';
import { api } from '@/services/api';
import { SentimentPie, CandidateNewsBar } from '@/components/charts';

export default function NewsAnalysisPage() {
  const { election, candidates, ourCandidate, loading: elLoading } = useElection();
  const colorMap = useMemo(() => getCandidateColorMap(candidates), [candidates]);
  const [data, setData] = useState<any>(null);
  const [allNews, setAllNews] = useState<any[]>([]);
  const [filterCand, setFilterCand] = useState('all');
  const [filterSent, setFilterSent] = useState('all');
  const [period, setPeriod] = useState<'today' | '7d' | '30d' | 'all'>('all');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 30;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 후보 이름 (우리 후보 우선)
  const orderedNames = useMemo(() => {
    const names = candidates.filter(c => c.enabled).map(c => c.name);
    if (!ourCandidate) return names;
    return [ourCandidate.name, ...names.filter(n => n !== ourCandidate.name)];
  }, [candidates, ourCandidate]);

  useEffect(() => { if (election) loadData(); }, [election]);

  const loadData = async () => {
    if (!election) return;
    setLoading(true); setError('');
    try {
      const [ov, news] = await Promise.all([
        api.getAnalysisOverview(election.id, 30),
        api.getCollectedNews(election.id, 200),
      ]);
      setData(ov);
      // 발행일(date=published_at) 역순 — 모든 후보 섞여서 최신순
      const sorted = (news || []).sort((a: any, b: any) => {
        const ta = a.date || a.collected_at || '';
        const tb = b.date || b.collected_at || '';
        return tb.localeCompare(ta);
      });
      setAllNews(sorted);
    } catch (e: any) {
      setError(e?.message || '뉴스 데이터를 불러올 수 없습니다.');
    } finally { setLoading(false); }
  };

  if (elLoading || loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" /></div>;
  if (error) return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">뉴스 분석</h1>
      <div className="card text-center py-12">
        <p className="text-red-500 mb-3">{error}</p>
        <button onClick={loadData} className="btn-primary text-sm">다시 시도</button>
      </div>
    </div>
  );
  if (!election || !data) return <div className="card text-center py-12 text-[var(--muted)]">선거를 먼저 설정해주세요.</div>;

  const newsByCand = data.news_by_candidate || [];

  // 날짜 범위 계산
  const allDates = allNews.map(n => n.date || '').filter(Boolean).sort();
  const dateRange = allDates.length > 0 ? `${allDates[0]} ~ ${allDates[allDates.length - 1]}` : '';
  const today = new Date().toISOString().slice(0, 10);
  const d7ago = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const d30ago = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // 기간별 필터
  const periodFilter = (n: any) => {
    const d = n.date || '';
    if (period === 'today') return d === today;
    if (period === '7d') return d >= d7ago;
    if (period === '30d') return d >= d30ago;
    return true;
  };

  const periodNews = allNews.filter(periodFilter);

  const stats = {
    total: periodNews.length,
    positive: periodNews.filter((n: any) => n.sentiment === 'positive').length,
    negative: periodNews.filter((n: any) => n.sentiment === 'negative').length,
    neutral: periodNews.filter((n: any) => n.sentiment === 'neutral' || !n.sentiment).length,
  };

  // 후보별 비교 — 모든 후보 표시 (뉴스 0건인 후보도 포함)
  const defaultNames = ['윤건영', '김진균', '김성근', '신문규', '조동욱'];
  const allCandNames = orderedNames.length > 0 ? orderedNames : defaultNames;
  // 뉴스에만 있는 후보도 추가
  const newsOnlyNames = (Array.from(new Set(allNews.map((n: any) => n.candidate).filter(Boolean))) as string[]).filter(n => !allCandNames.includes(n));
  const newsNames = [...allCandNames, ...newsOnlyNames];
  const candComparison = newsNames.map(name => {
    const cNews = periodNews.filter((n: any) => n.candidate === name);
    return {
      name,
      total: cNews.length,
      positive: cNews.filter((n: any) => n.sentiment === 'positive').length,
      negative: cNews.filter((n: any) => n.sentiment === 'negative').length,
      isOurs: name === ourCandidate?.name,
    };
  }).sort((a, b) => b.total - a.total);

  // 필터링 (기간 + 후보 + 감성) → 발행일 역순
  const filtered = periodNews.filter((n: any) => {
    if (filterCand !== 'all' && n.candidate !== filterCand) return false;
    if (filterSent !== 'all' && n.sentiment !== filterSent) return false;
    return true;
  }).sort((a: any, b: any) => {
    const ta = a.date || a.collected_at || '';
    const tb = b.date || b.collected_at || '';
    return tb.localeCompare(ta);
  });

  // 페이지네이션
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pagedNews = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // 페이지 내 날짜별 그룹핑 (날짜 내에서도 시간순 유지)
  const groupedByDate: Record<string, any[]> = {};
  pagedNews.forEach(n => {
    const date = n.date || n.collected_at?.substring(0, 10) || '날짜 없음';
    if (!groupedByDate[date]) groupedByDate[date] = [];
    groupedByDate[date].push(n);
  });
  const sortedDates = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">뉴스 분석</h1>
          <p className="text-sm text-[var(--muted)]">수집 기간: {dateRange || '-'} | 기사 작성일 기준</p>
        </div>
        <div className="flex items-center gap-2">
          {([
            { key: 'today', label: '오늘' },
            { key: '7d', label: '7일' },
            { key: '30d', label: '30일' },
            { key: 'all', label: '전체' },
          ] as { key: typeof period; label: string }[]).map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`px-3 py-1.5 rounded-lg text-xs transition ${
                period === p.key ? 'bg-blue-500 text-white font-bold' : 'bg-[var(--muted-bg)] text-[var(--muted)]'
              }`}>{p.label}</button>
          ))}
        </div>
      </div>

      {/* 감성 통계 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card text-center">
          <div className="text-3xl font-black">{stats.total}</div>
          <div className="text-xs text-[var(--muted)] mt-1">전체 뉴스</div>
        </div>
        <div className="card text-center bg-green-500/5 border-green-500/20">
          <div className="text-3xl font-black text-green-500">{stats.positive}</div>
          <div className="text-xs text-[var(--muted)] mt-1">긍정 ({stats.total > 0 ? Math.round(stats.positive / stats.total * 100) : 0}%)</div>
        </div>
        <div className="card text-center bg-red-500/5 border-red-500/20">
          <div className="text-3xl font-black text-red-500">{stats.negative}</div>
          <div className="text-xs text-[var(--muted)] mt-1">부정 ({stats.total > 0 ? Math.round(stats.negative / stats.total * 100) : 0}%)</div>
        </div>
        <div className="card text-center">
          <div className="text-3xl font-black text-[var(--muted)]">{stats.neutral}</div>
          <div className="text-xs text-[var(--muted)] mt-1">중립 ({stats.total > 0 ? Math.round(stats.neutral / stats.total * 100) : 0}%)</div>
        </div>
      </div>

      {/* 차트 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="card">
          <h3 className="font-bold mb-3">전체 감성 비율</h3>
          <SentimentPie positive={stats.positive} negative={stats.negative} neutral={stats.neutral} />
        </div>
        <div className="card lg:col-span-2">
          <h3 className="font-bold mb-3">후보별 뉴스 감성</h3>
          <CandidateNewsBar data={newsByCand} />
        </div>
      </div>

      {/* 후보별 뉴스 비교 */}
      {candComparison.length > 0 && (
        <div className="card">
          <h3 className="font-bold mb-3">후보별 뉴스 비교 <span className="text-xs font-normal text-[var(--muted)]">({period === 'today' ? '오늘' : period === '7d' ? '최근 7일' : period === '30d' ? '최근 30일' : '전체'})</span></h3>
          <div className="space-y-2">
            {candComparison.map((c, i) => {
              const maxTotal = Math.max(...candComparison.map(x => x.total), 1);
              const effective = (c.positive || 0) + (c.negative || 0);
              const posRate = effective > 0 ? Math.round(c.positive / effective * 100) : 0;
              return (
                <div key={c.name} className={`flex items-center gap-3 p-3 rounded-xl ${c.isOurs ? 'bg-blue-500/10 ring-1 ring-blue-500/30' : 'bg-[var(--muted-bg)]'}`}>
                  <span className="text-xs font-bold w-5 text-[var(--muted)]">{i + 1}</span>
                  <span className={`font-semibold w-20 truncate ${c.isOurs ? 'text-blue-500' : ''}`}>{c.name}</span>
                  <div className="flex-1 h-3 bg-[var(--card-border)] rounded-full overflow-hidden">
                    <div className="h-full rounded-full flex">
                      <div className="bg-green-500 h-full" style={{ width: `${c.positive / maxTotal * 100}%` }} />
                      <div className="bg-red-500 h-full" style={{ width: `${c.negative / maxTotal * 100}%` }} />
                      <div className="bg-gray-400 h-full" style={{ width: `${(c.total - c.positive - c.negative) / maxTotal * 100}%` }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs w-36 justify-end">
                    <span className="font-bold">{c.total}건</span>
                    <span className="text-green-500">{c.positive}</span>
                    <span className="text-red-500">{c.negative}</span>
                    <span className="text-[var(--muted)]">긍{posRate}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 필터 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-[var(--muted)]">후보:</span>
        {['all', ...(ourCandidate ? [ourCandidate.name, ...newsNames.filter(n => n !== ourCandidate.name)] : newsNames)].map(c => (
          <button key={c} onClick={() => { setFilterCand(c); setPage(1); }}
            className={`px-3 py-1.5 rounded-full text-xs transition ${
              filterCand === c
                ? 'bg-blue-500 text-white font-bold'
                : 'bg-[var(--muted-bg)] text-[var(--muted)] hover:text-[var(--foreground)]'
            }`}>
            {c === 'all' ? '전체' : c}{c === ourCandidate?.name ? ' ★' : ''}
          </button>
        ))}
        <div className="h-4 w-px bg-[var(--card-border)] mx-1" />
        <span className="text-sm text-[var(--muted)]">감성:</span>
        {[
          { key: 'all', label: '전체' },
          { key: 'positive', label: '긍정' },
          { key: 'negative', label: '부정' },
          { key: 'neutral', label: '중립' },
        ].map(s => (
          <button key={s.key} onClick={() => { setFilterSent(s.key); setPage(1); }}
            className={`px-3 py-1.5 rounded-full text-xs transition ${
              filterSent === s.key
                ? s.key === 'positive' ? 'bg-green-500 text-white font-bold'
                  : s.key === 'negative' ? 'bg-red-500 text-white font-bold'
                  : 'bg-blue-500 text-white font-bold'
                : 'bg-[var(--muted-bg)] text-[var(--muted)] hover:text-[var(--foreground)]'
            }`}>
            {s.label}
          </button>
        ))}
        <span className="text-xs text-[var(--muted)] ml-auto">{filtered.length}건</span>
      </div>

      {/* 날짜별 뉴스 목록 */}
      {filtered.length === 0 && (
        <div className="card text-center py-12 text-[var(--muted)]">
          {allNews.length === 0 ? '수집된 뉴스가 없습니다. 대시보드에서 "지금 수집"을 실행하세요.' : '해당 필터 조건에 맞는 뉴스가 없습니다.'}
        </div>
      )}

      {sortedDates.map(date => (
        <div key={date}>
          {/* 날짜 헤더 */}
          <div className="flex items-center gap-3 mb-2 mt-4">
            <div className="text-sm font-bold">{date}</div>
            <div className="flex-1 h-px bg-[var(--card-border)]" />
            <span className="text-xs text-[var(--muted)]">{groupedByDate[date].length}건</span>
          </div>

          {/* 해당 날짜 뉴스 */}
          <div className="space-y-1.5">
            {groupedByDate[date].map((news: any, i: number) => (
              <a key={i} href={news.url || '#'} target="_blank" rel="noopener noreferrer"
                className={`block p-3 rounded-xl border transition-all hover:shadow-md ${
                  news.sentiment === 'negative' ? 'bg-red-500/5 border-red-500/20' :
                  news.sentiment === 'positive' ? 'bg-green-500/5 border-green-500/10' :
                  'bg-[var(--card-bg)] border-[var(--card-border)]'
                }`}>
                <div className="flex items-start gap-2">
                  <div className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    news.sentiment === 'negative' ? 'bg-red-500' : news.sentiment === 'positive' ? 'bg-green-500' : 'bg-gray-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        news.sentiment === 'negative' ? 'bg-red-500/20 text-red-400' :
                        news.sentiment === 'positive' ? 'bg-green-500/20 text-green-400' : 'bg-[var(--muted-bg)] text-[var(--muted)]'
                      }`}>{news.sentiment === 'negative' ? '부정' : news.sentiment === 'positive' ? '긍정' : '중립'}</span>
                      <span className="text-xs font-bold" style={{ color: colorMap[news.candidate] || 'var(--muted)' }}>{news.candidate}</span>
                      <span className="text-[10px] text-[var(--muted)]">{news.source}</span>
                      <span className="text-[10px] text-[var(--muted)] ml-auto">{news.date || ''}</span>
                    </div>
                    <h4 className="font-medium text-sm">{news.title}</h4>
                    {news.summary ? (
                      <p className="text-xs text-[var(--muted)] mt-1 line-clamp-2">{news.summary}</p>
                    ) : (
                      <p className="text-[10px] text-[var(--muted)] mt-1 opacity-50">요약 없음</p>
                    )}
                  </div>
                  {news.sentiment === 'negative' && (
                    <span className="text-[9px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-bold flex-shrink-0 mt-1">대응</span>
                  )}
                </div>
              </a>
            ))}
          </div>
        </div>
      ))}

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 rounded-lg text-sm bg-[var(--muted-bg)] disabled:opacity-30">이전</button>
          <span className="text-sm text-[var(--muted)]">{page} / {totalPages} ({filtered.length}건)</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1.5 rounded-lg text-sm bg-[var(--muted-bg)] disabled:opacity-30">다음</button>
        </div>
      )}
    </div>
  );
}
