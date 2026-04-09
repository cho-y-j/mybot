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

  const riskColors: Record<string, string> = {
    high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
    low: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">스윙보터 분석</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            지역 민감 이슈 + 커뮤니티 부정 감성 교차 분석으로 이탈 위험 유권자 키워드를 감지합니다.
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
          {/* 전체 위험도 */}
          <div className={`p-4 rounded-lg ${riskColors[data.overall_risk] || riskColors.low}`}>
            <div className="text-lg font-bold">
              전체 이탈 위험도: {data.overall_risk === 'high' ? '높음' : data.overall_risk === 'medium' ? '보통' : '낮음'}
            </div>
            <div className="text-sm mt-1">
              분석 이슈 {data.total_issues_analyzed}개 중 위험 이슈 {data.swing_issues?.length || 0}개
            </div>
          </div>

          {/* 스윙 이슈 목록 */}
          {data.swing_issues?.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-bold">이탈 위험 이슈</h2>
              {data.swing_issues.map((issue: any, i: number) => (
                <div key={i} className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-lg">{issue.issue}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        issue.risk_score >= 50 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                          : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                      }`}>
                        위험도 {issue.risk_score}%
                      </span>
                      {issue.trend === 'rising' && (
                        <span className="text-xs text-red-500">📈 상승세</span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-sm mb-2">
                    <div>
                      <span className="text-gray-500">지역 관심도</span>
                      <div className="font-medium">{issue.regional_boost > 0 ? `+${issue.regional_boost}` : issue.regional_boost}</div>
                    </div>
                    <div>
                      <span className="text-gray-500">부정 감성률</span>
                      <div className="font-medium text-red-600">{issue.negative_ratio}%</div>
                    </div>
                    <div>
                      <span className="text-gray-500">게시글 수</span>
                      <div className="font-medium">{issue.total_posts}건</div>
                    </div>
                  </div>
                  {/* 위험도 바 */}
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-2">
                    <div className={`h-2 rounded-full ${issue.risk_score >= 50 ? 'bg-red-500' : 'bg-yellow-500'}`}
                      style={{ width: `${Math.min(issue.risk_score, 100)}%` }} />
                  </div>
                  <div className="text-sm text-blue-600 dark:text-blue-400">
                    {issue.recommendation}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* AI 추천 */}
          {data.recommendations?.length > 0 && (
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 p-4">
              <h3 className="font-bold mb-2">AI 대응 전략 추천</h3>
              <div className="space-y-2">
                {data.recommendations.map((r: any, i: number) => (
                  <div key={i} className="text-sm">
                    <span className="font-medium">{r.issue}:</span> {r.strategy}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 안전 이슈 */}
          {data.safe_issues?.length > 0 && (
            <details className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700">
              <summary className="p-4 cursor-pointer font-medium text-green-700 dark:text-green-300">
                안전 이슈 ({data.safe_issues.length}개)
              </summary>
              <div className="px-4 pb-4 space-y-2">
                {data.safe_issues.map((issue: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1 border-b dark:border-gray-700 last:border-0">
                    <span>{issue.issue}</span>
                    <span className="text-gray-500">위험도 {issue.risk_score}%</span>
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
