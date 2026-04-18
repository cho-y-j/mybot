'use client';
import { useState, useEffect } from 'react';
import { useElection } from '@/hooks/useElection';
import { api } from '@/services/api';

export default function SwingVotersPage() {
  const { election, loading: elLoading } = useElection();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);

  const load = async () => {
    if (!election) return;
    setLoading(true);
    try {
      const result = await api.getSwingVoterAnalysis(election.id, days);
      setData(result);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (election) load(); }, [election, days]);

  if (elLoading) return <div className="p-6 text-gray-500">로딩 중...</div>;
  if (!election) return <div className="p-6 text-red-500">선거를 선택하세요</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">스윙보터 이슈 발굴</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            커뮤니티에서 찬반이 갈리는 뜨거운 이슈를 찾아 행동 유도를 제공합니다.
          </p>
        </div>
        <select value={days} onChange={e => setDays(Number(e.target.value))}
          className="px-3 py-2 border rounded dark:bg-gray-700 dark:border-gray-600">
          <option value={7}>7일</option>
          <option value={14}>14일</option>
          <option value={30}>30일</option>
          <option value={60}>60일</option>
        </select>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
        </div>
      )}

      {data && !loading && (
        <>
          {/* 요약 카드 */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 text-center">
              <div className="text-3xl font-bold text-red-500">{data.hot_count || 0}</div>
              <div className="text-sm text-gray-500">뜨거운 이슈</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 text-center">
              <div className="text-3xl font-bold">{data.total_issues || 0}</div>
              <div className="text-sm text-gray-500">전체 분석 이슈</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 text-center">
              <div className="text-3xl font-bold text-blue-500">{data.recommendations?.length || 0}</div>
              <div className="text-sm text-gray-500">AI 행동 지침</div>
            </div>
          </div>

          {/* AI 행동 유도 (최상단) */}
          {data.recommendations?.length > 0 && (
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-300 dark:border-blue-800 p-5">
              <h2 className="text-lg font-bold mb-3">AI 행동 지침</h2>
              <div className="space-y-4">
                {data.recommendations.map((r: any, i: number) => (
                  <div key={i} className="bg-white dark:bg-gray-800 rounded-lg p-4 border dark:border-gray-700">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 px-2 py-0.5 rounded">
                        {r.issue}
                      </span>
                    </div>
                    <div className="text-sm text-orange-600 dark:text-orange-400 mb-1">
                      {r.situation}
                    </div>
                    <div className="font-medium mb-2">
                      {r.action}
                    </div>
                    {r.message_example && (
                      <div className="bg-gray-50 dark:bg-gray-700 rounded p-3 text-sm italic flex items-center justify-between">
                        <span>&ldquo;{r.message_example}&rdquo;</span>
                        <button onClick={() => { navigator.clipboard.writeText(r.message_example); }}
                          className="text-xs text-blue-500 hover:underline ml-2 flex-shrink-0">복사</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 뜨거운 이슈 */}
          {data.hot_issues?.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-bold">뜨거운 이슈 (찬반 대립)</h2>
              {data.hot_issues.map((issue: any, i: number) => (
                <IssueCard key={i} issue={issue} />
              ))}
            </div>
          )}

          {/* 뜨거운 이슈 없을 때 */}
          {data.hot_issues?.length === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-8 text-center">
              <p className="text-lg mb-2">현재 찬반이 갈리는 뜨거운 이슈가 없습니다</p>
              <p className="text-sm text-gray-500">커뮤니티 데이터가 더 수집되면 자동으로 감지됩니다</p>
            </div>
          )}

          {/* 안정 이슈 */}
          {data.cold_issues?.length > 0 && (
            <details className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700">
              <summary className="p-4 cursor-pointer font-medium text-gray-500">
                안정 이슈 ({data.cold_issues.length}개) — 한쪽 의견 우세
              </summary>
              <div className="px-4 pb-4 space-y-2">
                {data.cold_issues.map((issue: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm py-2 border-b dark:border-gray-700 last:border-0">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{issue.issue}</span>
                      <span className="text-xs text-gray-400">{issue.total_posts}건</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-green-600">긍정 {issue.positive}</span>
                      <span className="text-xs text-red-600">부정 {issue.negative}</span>
                      <span className="text-xs text-gray-400">{issue.verdict}</span>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function IssueCard({ issue }: { issue: any }) {
  const [open, setOpen] = useState(false);
  const total = issue.positive + issue.negative;
  const posPercent = total > 0 ? Math.round(issue.positive / total * 100) : 50;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">{issue.issue}</span>
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${
            issue.split_ratio >= 40
              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
          }`}>
            찬반 {issue.split_ratio}% 대립
          </span>
          <span className="text-xs text-gray-400">{issue.total_posts}건</span>
        </div>
        <span className="text-xs text-gray-400">{issue.latest}</span>
      </div>

      {/* 찬반 비율 바 */}
      <div className="mb-2">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-green-600">긍정 {issue.positive}건 ({posPercent}%)</span>
          <span className="text-red-600">부정 {issue.negative}건 ({100 - posPercent}%)</span>
        </div>
        <div className="w-full h-3 rounded-full overflow-hidden flex">
          <div className="bg-green-500 h-full" style={{ width: `${posPercent}%` }} />
          <div className="bg-gray-300 dark:bg-gray-600 h-full" style={{ width: `${Math.round(issue.neutral / issue.total_posts * 100)}%` }} />
          <div className="bg-red-500 h-full" style={{ width: `${100 - posPercent - Math.round(issue.neutral / issue.total_posts * 100)}%` }} />
        </div>
      </div>

      <div className="text-sm text-orange-600 dark:text-orange-400 mb-2">
        {issue.verdict}
      </div>

      {/* 샘플 게시글 */}
      {issue.sample_posts?.length > 0 && (
        <div>
          <button onClick={() => setOpen(!open)} className="text-xs text-blue-500 hover:underline">
            {open ? '접기' : `관련 게시글 ${issue.sample_posts.length}건 보기`}
          </button>
          {open && (
            <div className="mt-2 space-y-1">
              {issue.sample_posts.map((p: any, j: number) => (
                <div key={j} className="flex items-center gap-2 text-xs py-1">
                  <span className={
                    p.sentiment === 'positive' ? 'text-green-500' :
                    p.sentiment === 'negative' ? 'text-red-500' : 'text-gray-400'
                  }>
                    {p.sentiment === 'positive' ? '' : p.sentiment === 'negative' ? '' : ''}
                  </span>
                  <span className="text-gray-400">[{p.source}]</span>
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="hover:underline truncate">{p.title}</a>
                  ) : (
                    <span className="truncate">{p.title}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
