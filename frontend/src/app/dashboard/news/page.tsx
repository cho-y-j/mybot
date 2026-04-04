'use client';
import { useState, useEffect, useMemo } from 'react';
import { useElection, getCandidateColorMap } from '@/hooks/useElection';
import { api } from '@/services/api';
import { SentimentPie, CandidateNewsBar } from '@/components/charts';

export default function NewsAnalysisPage() {
  const { election, candidates, candidateNames, loading: elLoading } = useElection();
  const colorMap = useMemo(() => getCandidateColorMap(candidates), [candidates]);
  const [data, setData] = useState<any>(null);
  const [allNews, setAllNews] = useState<any[]>([]);
  const [filterCand, setFilterCand] = useState('all');
  const [filterSent, setFilterSent] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (election) loadData(); }, [election]);

  const loadData = async () => {
    if (!election) return;
    setLoading(true);
    try {
      const [ov, news] = await Promise.all([
        api.getAnalysisOverview(election.id, 30),
        api.getCollectedNews(election.id, 100),
      ]);
      setData(ov);
      setAllNews(news || []);
    } catch {} finally { setLoading(false); }
  };

  if (elLoading || loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" /></div>;
  if (!election || !data) return <div className="card text-center py-12 text-gray-500">선거를 먼저 설정해주세요.</div>;

  const newsByCand = data.news_by_candidate || [];
  const stats = {
    total: allNews.length,
    positive: allNews.filter((n: any) => n.sentiment === 'positive').length,
    negative: allNews.filter((n: any) => n.sentiment === 'negative').length,
    neutral: allNews.filter((n: any) => n.sentiment === 'neutral').length,
  };

  const filtered = allNews.filter((n: any) => {
    if (filterCand !== 'all' && n.candidate !== filterCand) return false;
    if (filterSent !== 'all' && n.sentiment !== filterSent) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">뉴스 분석</h1>
        <span className="text-sm text-gray-400">총 {stats.total}건 실시간 데이터</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card">
          <h3 className="font-semibold mb-3">전체 감성</h3>
          <SentimentPie positive={stats.positive} negative={stats.negative} neutral={stats.neutral} />
          <div className="grid grid-cols-3 gap-2 text-center text-sm mt-2">
            <div className="bg-green-50 rounded p-1"><strong className="text-green-600">{stats.positive}</strong><br/><span className="text-xs">긍정</span></div>
            <div className="bg-red-50 rounded p-1"><strong className="text-red-600">{stats.negative}</strong><br/><span className="text-xs">부정</span></div>
            <div className="bg-gray-50 rounded p-1"><strong className="text-gray-500">{stats.neutral}</strong><br/><span className="text-xs">중립</span></div>
          </div>
        </div>
        <div className="card lg:col-span-2">
          <h3 className="font-semibold mb-3">후보별 감성</h3>
          <CandidateNewsBar data={newsByCand} />
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-gray-500">필터:</span>
        {['all', ...(() => {
          const ourCand = candidates.find(c => c.is_our_candidate);
          const ourName = ourCand?.name;
          if (!ourName) return candidateNames;
          return [ourName, ...candidateNames.filter(n => n !== ourName)];
        })()].map(c => (
          <button key={c} onClick={() => setFilterCand(c)}
            className={`px-3 py-1 rounded-full text-sm ${filterCand === c ? 'bg-primary-100 text-primary-700 font-medium' : 'bg-gray-100 text-gray-500'}`}>
            {c === 'all' ? '전체' : c}
          </button>
        ))}
        <div className="h-4 w-px bg-gray-200" />
        {['all', 'positive', 'negative', 'neutral'].map(s => (
          <button key={s} onClick={() => setFilterSent(s)}
            className={`px-3 py-1 rounded-full text-sm ${filterSent === s ? 'bg-primary-100 text-primary-700 font-medium' : 'bg-gray-100 text-gray-500'}`}>
            {s === 'all' ? '전체' : s === 'positive' ? '긍정' : s === 'negative' ? '부정' : '중립'}
          </button>
        ))}
        <span className="text-xs text-gray-400 ml-auto">{filtered.length}건</span>
      </div>

      <div className="space-y-2">
        {filtered.map((news: any, i: number) => (
          <a key={i} href={news.url || '#'} target="_blank" rel="noopener noreferrer"
            className={`block p-4 rounded-xl border transition-all hover:shadow-lg ${
              news.sentiment === 'negative' ? 'bg-red-50/60 border-red-200' :
              news.sentiment === 'positive' ? 'bg-green-50/30 border-green-100' : 'bg-white border-gray-100'
            }`}>
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 w-1.5 self-stretch rounded-full flex-shrink-0 ${
                news.sentiment === 'negative' ? 'bg-red-500' : news.sentiment === 'positive' ? 'bg-green-500' : 'bg-gray-300'
              }`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={`text-[11px] px-2 py-0.5 rounded-md font-bold ${
                    news.sentiment === 'negative' ? 'bg-red-100 text-red-700' :
                    news.sentiment === 'positive' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>{news.sentiment === 'negative' ? '부정' : news.sentiment === 'positive' ? '긍정' : '중립'}</span>
                  <span className="text-xs font-bold" style={{ color: colorMap[news.candidate] || '#666' }}>{news.candidate}</span>
                  <span className="text-[11px] text-gray-400">{news.source}</span>
                  <span className="text-[11px] text-gray-300 ml-auto">{news.date || ''}</span>
                </div>
                <h4 className={`font-semibold text-sm ${news.sentiment === 'negative' ? 'text-red-900' : 'text-gray-900'}`}>{news.title}</h4>
                {news.summary && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{news.summary}</p>}
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[10px] text-primary-500">기사 원문 →</span>
                  {news.sentiment === 'negative' && <span className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded font-medium">대응 필요</span>}
                </div>
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
