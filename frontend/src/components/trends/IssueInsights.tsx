'use client';
import { useState, useEffect, useMemo } from 'react';
import { api } from '@/services/api';
import { SearchTrendLine, CANDIDATE_COLORS } from '@/components/charts';

interface IssueInfo {
  latest: number;
  avg_7d: number;
  avg_30d: number;
  trend: string;
  data?: { date: string; ratio: number }[];
}

interface IssueInsightsProps {
  election: any;
  issueData: Record<string, IssueInfo>;
  onNavigateToSearch: (keyword: string) => void;
}

export default function IssueInsights({ election, issueData, onNavigateToSearch }: IssueInsightsProps) {
  const [matrix, setMatrix] = useState<any>(null);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [showMatrix, setShowMatrix] = useState(false);
  // 시계열 비교
  const [compareKeywords, setCompareKeywords] = useState<string[]>([]);

  const loadMatrix = async () => {
    if (matrix) return;
    setMatrixLoading(true);
    try {
      const data = await api.getIssueCandidateMatrix(election.id);
      setMatrix(data);
    } catch (e) {
      console.error('matrix error:', e);
    } finally {
      setMatrixLoading(false);
    }
  };

  // 히트맵 색상 계산
  const getCellColor = (score: number, maxScore: number, isOurs: boolean) => {
    if (score === 0) return 'bg-[var(--muted-bg)]';
    const intensity = maxScore > 0 ? score / maxScore : 0;
    if (isOurs) {
      if (intensity > 0.7) return 'bg-blue-500/40 text-blue-200';
      if (intensity > 0.3) return 'bg-blue-500/20 text-blue-300';
      return 'bg-blue-500/10 text-blue-400';
    }
    if (intensity > 0.7) return 'bg-red-500/30 text-red-200';
    if (intensity > 0.3) return 'bg-amber-500/20 text-amber-300';
    return 'bg-[var(--muted-bg)]';
  };

  // 시계열 비교 데이터
  const compareData = useMemo(() => {
    if (compareKeywords.length === 0) return { data: [], keywords: [] };

    const keywords = compareKeywords.filter(k => issueData[k]);
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
  }, [compareKeywords, issueData]);

  const toggleCompare = (kw: string) => {
    setCompareKeywords(prev => {
      if (prev.includes(kw)) return prev.filter(k => k !== kw);
      if (prev.length >= 5) return prev;
      return [...prev, kw];
    });
  };

  const allIssueNames = Object.keys(issueData).sort((a, b) => (issueData[b]?.latest || 0) - (issueData[a]?.latest || 0));

  return (
    <div className="space-y-4">
      {/* ═══ 이슈-후보 교차 분석 ═══ */}
      <div className="card">
        <button
          onClick={() => { setShowMatrix(!showMatrix); if (!showMatrix) loadMatrix(); }}
          className="w-full flex items-center justify-between"
        >
          <div>
            <h3 className="font-bold">이슈-후보 교차 분석</h3>
            <p className="text-xs text-[var(--muted)]">어떤 이슈에서 어떤 후보가 많이 검색되는지 매트릭스 분석</p>
          </div>
          <span className={`text-sm transition-transform ${showMatrix ? 'rotate-90' : ''}`}>▶</span>
        </button>

        {showMatrix && (
          <div className="mt-4">
            {matrixLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin h-6 w-6 border-3 border-blue-500 border-t-transparent rounded-full" />
                <span className="ml-2 text-sm text-[var(--muted)]">교차 분석 중... (최대 30초)</span>
              </div>
            ) : matrix ? (
              <>
                {/* 기회 알림 */}
                {matrix.opportunities?.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {matrix.opportunities.map((opp: any, i: number) => (
                      <div key={i} className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-amber-500 font-bold">기회</span>
                          <span className="flex-1">{opp.action}</span>
                        </div>
                        <div className="text-xs text-[var(--muted)] mt-1">
                          {opp.leader}({opp.leader_score}) vs 우리({opp.our_score}) — 격차 {opp.gap}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 히트맵 테이블 */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--card-border)]">
                        <th className="text-left py-2 px-2 font-medium text-xs text-[var(--muted)]">이슈 \ 후보</th>
                        {matrix.candidates?.map((name: string) => (
                          <th key={name} className={`text-center py-2 px-2 font-semibold text-xs ${
                            name === matrix.our_candidate ? 'text-blue-500' : ''
                          }`}>
                            {name}{name === matrix.our_candidate ? ' ★' : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.issues?.map((issue: string) => {
                        const row = matrix.matrix?.[issue] || {};
                        const maxScore = Math.max(...Object.values(row).map((v: any) => v?.score || 0));
                        return (
                          <tr key={issue} className="border-b border-[var(--card-border)]/50 hover:bg-[var(--muted-bg)]/30">
                            <td className="py-2 px-2 font-semibold text-blue-500 cursor-pointer hover:underline"
                              onClick={() => onNavigateToSearch(issue)}>
                              {issue}
                            </td>
                            {matrix.candidates?.map((name: string) => {
                              const cell = row[name] || { score: 0, trend: 'insufficient' };
                              const isOurs = name === matrix.our_candidate;
                              return (
                                <td key={name} className={`py-2 px-2 text-center rounded ${getCellColor(cell.score, maxScore, isOurs)}`}>
                                  <div className="font-bold">{cell.score > 0 ? cell.score : '-'}</div>
                                  {cell.score > 0 && (
                                    <div className={`text-[9px] ${
                                      cell.trend === 'rising' ? 'text-green-500' :
                                      cell.trend === 'falling' ? 'text-red-500' : 'text-[var(--muted)]'
                                    }`}>
                                      {cell.trend === 'rising' ? '↑' : cell.trend === 'falling' ? '↓' : '→'}
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-[var(--muted)] mt-2">* 수치는 "후보+이슈" 검색의 7일 평균 상대량 (0-100). 높을수록 해당 이슈에서 후보 검색이 많음</p>
              </>
            ) : (
              <div className="text-center py-6 text-[var(--muted)] text-sm">데이터를 불러올 수 없습니다.</div>
            )}
          </div>
        )}
      </div>

      {/* ═══ 이슈 시계열 비교 ═══ */}
      <div className="card">
        <h3 className="font-bold mb-2">이슈 시계열 비교</h3>
        <p className="text-xs text-[var(--muted)] mb-3">이슈를 선택하여 추이를 비교하세요 (최대 5개)</p>

        <div className="flex gap-2 flex-wrap mb-4">
          {allIssueNames.map(kw => (
            <button
              key={kw}
              onClick={() => toggleCompare(kw)}
              className={`text-xs px-2.5 py-1 rounded-full transition ${
                compareKeywords.includes(kw)
                  ? 'bg-blue-500 text-white'
                  : 'bg-[var(--muted-bg)] text-[var(--muted)] hover:bg-blue-500/10'
              }`}
            >
              {kw}
            </button>
          ))}
        </div>

        {compareData.data.length > 0 ? (
          <SearchTrendLine data={compareData.data} keywords={compareData.keywords} />
        ) : (
          <div className="text-center py-8 text-[var(--muted)] text-sm">
            위에서 비교할 이슈를 선택하세요
          </div>
        )}
      </div>
    </div>
  );
}
