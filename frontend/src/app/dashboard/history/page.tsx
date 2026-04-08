'use client';
import { useState, useEffect } from 'react';
import { useElection } from '@/hooks/useElection';
import { CANDIDATE_COLORS } from '@/components/charts';
import { api } from '@/services/api';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, AreaChart, Area,
} from 'recharts';

export default function HistoryPage() {
  const { election, candidates, loading } = useElection();
  const [data, setData] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [expandedAI, setExpandedAI] = useState(false);

  useEffect(() => {
    if (!election) return;
    loadData();
  }, [election?.id]);

  async function loadData() {
    if (!election) return;
    setAnalyzing(true);
    setError('');
    try {
      const result = await api.getHistoryDeepAnalysis(election.id);
      setData(result);
    } catch (e: any) {
      setError(e?.message || '과거 선거 데이터를 불러올 수 없습니다.');
    } finally {
      setAnalyzing(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" /></div>;
  if (!election) return <div className="card text-center py-12 text-gray-500">선거를 먼저 설정해주세요.</div>;

  const typeLabel: Record<string, string> = { superintendent: '교육감', mayor: '시장/군수', congressional: '국회의원', governor: '시도지사', council: '시의원/도의원' };
  const regionShort = election.region_sido?.substring(0, 2) || '';
  const sections = data?.sections || {};
  const wp = sections.winner_pattern || {};
  const da = sections.district_analysis || {};
  const ta = sections.turnout_analysis || {};
  const pa = sections.political_context || {};
  const sw = sections.swing_districts || {};
  const ai = sections.ai_strategy || {};

  // 투표율 추이 차트 데이터
  const turnoutChartData = (wp.elections || []).map((e: any) => ({
    name: `${e.year}`,
    득표율_1위: e.winner?.vote_rate || 0,
    득표율_2위: e.runner_up?.vote_rate || 0,
    격차: e.margin || 0,
  }));

  // 사전투표 추이 데이터
  const earlyChartData = (ta.total_trend || []).map((t: any) => ({
    name: `${t.year}`,
    전체투표율: t.total_rate || 0,
    사전투표율: t.early_rate || 0,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">과거 선거 심층 분석</h1>
          <p className="text-gray-500 mt-1">
            {regionShort} {typeLabel[election.election_type] || election.election_type} 역대 {data?.elections_count || 0}회 선거 데이터
          </p>
        </div>
        <button onClick={loadData} disabled={analyzing}
          className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 text-sm">
          {analyzing ? '분석 중...' : '다시 분석'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>
      )}

      {data?.fallback_notice && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
          <span className="text-xl">ℹ️</span>
          <div className="text-sm text-amber-900 leading-relaxed">
            <div className="font-semibold mb-1">데이터 보강 안내 (자동 fallback)</div>
            {data.fallback_notice}
          </div>
        </div>
      )}

      {analyzing && !data && (
        <div className="card text-center py-16">
          <div className="animate-spin h-10 w-10 border-4 border-violet-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-600">선관위 데이터 분석 중...</p>
          <p className="text-gray-400 text-sm mt-1">AI 심층 분석을 포함하여 최대 30초 소요</p>
        </div>
      )}

      {data && (
        <>
          {/* AI 심층 분석 카드 */}
          {ai.text && (
            <div className="bg-gradient-to-r from-violet-50 to-indigo-50 rounded-xl border border-violet-200 p-5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{ai.ai_generated ? '🤖' : '📊'}</span>
                  <h3 className="font-bold text-violet-900">
                    AI 심층 전략 분석 {ai.ai_generated && <span className="text-xs font-normal text-violet-500 ml-1">Claude 생성</span>}
                  </h3>
                </div>
                <button onClick={() => setExpandedAI(!expandedAI)}
                  className="text-xs text-violet-600 hover:text-violet-800">
                  {expandedAI ? '접기' : '전체 보기'}
                </button>
              </div>
              <div className={`text-sm text-gray-700 leading-relaxed whitespace-pre-line ${!expandedAI ? 'max-h-32 overflow-hidden' : ''}`}>
                {ai.text}
              </div>
              {!expandedAI && ai.text.length > 200 && (
                <div className="bg-gradient-to-t from-violet-50 to-transparent h-8 -mt-8 relative" />
              )}
            </div>
          )}

          {/* 역대 당선자 테이블 + 득표율 차트 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 역대 당선자 테이블 */}
            <div className="card">
              <h3 className="font-semibold mb-4">역대 당선자 현황</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--card-border)]">
                      <th className="text-left p-2 text-[var(--muted)]">연도</th>
                      <th className="text-left p-2 text-[var(--muted)]">당선자</th>
                      <th className="text-left p-2 text-[var(--muted)]">성향</th>
                      <th className="text-right p-2 text-[var(--muted)]">득표율</th>
                      <th className="text-right p-2 text-[var(--muted)]">격차</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(wp.elections || []).map((e: any, i: number) => (
                      <tr key={i} className="border-b border-[var(--card-border)] hover:bg-[var(--muted-bg)]">
                        <td className="p-2 font-medium">{e.year}년</td>
                        <td className="p-2 font-semibold">{e.winner?.name}</td>
                        <td className="p-2">
                          <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                            e.winner?.party === '진보' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'
                          }`}>{e.winner?.party}</span>
                        </td>
                        <td className="p-2 text-right font-bold">{e.winner?.vote_rate?.toFixed(1)}%</td>
                        <td className="p-2 text-right text-[var(--muted)]">+{e.margin}%p</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* 패턴 분석 */}
              <div className="mt-3 p-4 rounded-xl bg-violet-500/10 text-sm space-y-2">
                <div className="font-bold text-base">
                  {(wp.elections || []).map((e: any) => (
                    <span key={e.year} className={`inline-block mr-1 px-2 py-0.5 rounded text-xs font-bold ${
                      e.winner?.party === '진보' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'
                    }`}>{e.year} {e.winner?.party}</span>
                  ))}
                </div>
                <div className="font-semibold">
                  핵심 패턴: 최근 3회 연속(2014~2022) 교육감 당선자 성향이 도지사 당선 정당과 일치
                </div>
                <div className="text-[var(--muted)]">
                  2010년(직선제 첫 회)은 예외였으나, 2014년 이후 도지사와 교육감 당선 성향이 3회 연속 같은 방향.
                  이 패턴이 유지된다면 2026년 도지사 선거 결과가 교육감 당선에도 영향을 줄 가능성이 높음.
                  현재 이재명 정부(민주당) 환경에서 도지사 민주당 후보가 유리할 경우, 교육감도 진보 후보에게 유리한 구도.
                </div>
              </div>
            </div>

            {/* 득표율 추이 차트 */}
            <div className="card">
              <h3 className="font-semibold mb-4">역대 1위/2위 득표율 추이</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={turnoutChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} unit="%" domain={[0, 70]} />
                  <Tooltip formatter={(val: number) => `${val.toFixed(1)}%`} />
                  <Legend />
                  <Bar dataKey="득표율_1위" fill="#3b82f6" radius={[4, 4, 0, 0]} name="1위" />
                  <Bar dataKey="득표율_2위" fill="#94a3b8" radius={[4, 4, 0, 0]} name="2위" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 투표율 + 사전투표 */}
          {earlyChartData.length > 0 && (
            <div className="card">
              <h3 className="font-semibold mb-4">투표율 추이 (전체 + 사전투표)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={earlyChartData}>
                  <defs>
                    <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="earlyGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} unit="%" domain={[0, 80]} />
                  <Tooltip formatter={(val: number) => `${val?.toFixed(1) || 0}%`} />
                  <Legend />
                  <Area type="monotone" dataKey="전체투표율" stroke="#3b82f6" fill="url(#totalGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="사전투표율" stroke="#10b981" fill="url(#earlyGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
              <div className="mt-2 text-sm text-gray-500">{ta.insight}</div>
            </div>
          )}

          {/* 구시군별 성향 분석 — 강세/공략필요 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 강세 지역 */}
            <div className="card">
              <h3 className="font-semibold mb-4">
                강세 지역 <span className="text-xs text-green-500 font-normal">교육감+도지사 합산 60%+</span>
              </h3>
              {(da.strong_districts || []).length > 0 ? (
                <div className="space-y-2">
                  {(da.strong_districts || []).map((d: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-green-500/5">
                      <div>
                        <span className="font-medium">{d.district}</span>
                        <span className={`text-xs ml-2 ${d.dominant === '진보' ? 'text-blue-500' : 'text-red-500'}`}>{d.dominant}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-blue-500">진보 {d.progressive_rate}%</span>
                        <span className="text-[var(--muted)]">vs</span>
                        <span className="text-red-500">보수 {d.conservative_rate}%</span>
                        <span className="font-bold text-green-600 ml-1">{d.strength_rate}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[var(--muted)] text-sm">강세 지역 없음 — 접전 구도</p>
              )}
            </div>

            {/* 공략 필요 지역 */}
            <div className="card">
              <h3 className="font-semibold mb-4">
                공략 필요 지역 <span className="text-xs text-amber-500 font-normal">스윙+약세 통합</span>
              </h3>
              {(da.target_districts || []).length > 0 ? (
                <div className="space-y-2">
                  {(da.target_districts || []).map((d: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-amber-500/5">
                      <div>
                        <span className="font-medium">{d.district}</span>
                        <span className={`text-xs ml-2 ${d.dominant === '진보' ? 'text-blue-500' : 'text-red-500'}`}>{d.dominant}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-blue-500">진보 {d.progressive_rate}%</span>
                        <span className="text-[var(--muted)]">vs</span>
                        <span className="text-red-500">보수 {d.conservative_rate}%</span>
                        <span className="font-bold text-amber-600 ml-1">{d.strength_rate}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-sm">스윙 지역 없음 — 안정적 구도</p>
              )}
              <div className="mt-3 p-3 bg-amber-50 rounded-lg text-sm text-amber-700">
                {sw.strategy_note || '스윙 지역 분석 데이터 부족'}
              </div>
            </div>
          </div>

          {/* 정치 환경 */}
          {pa.current && (
            <div className="card">
              <h3 className="font-semibold mb-4">현재 정치 환경</h3>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center p-4 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">{pa.current.president_approval?.toFixed(1) || '-'}%</div>
                  <div className="text-xs text-gray-500 mt-1">대통령 지지율</div>
                </div>
                <div className="text-center p-4 bg-red-50 rounded-lg">
                  <div className="text-2xl font-bold text-red-600">{pa.current.ruling_party?.toFixed(1) || '-'}%</div>
                  <div className="text-xs text-gray-500 mt-1">여당 지지율</div>
                </div>
                <div className="text-center p-4 bg-indigo-50 rounded-lg">
                  <div className="text-2xl font-bold text-indigo-600">{pa.current.opposition_party?.toFixed(1) || '-'}%</div>
                  <div className="text-xs text-gray-500 mt-1">야당 지지율</div>
                </div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-700">
                {pa.correlation_note}
              </div>
            </div>
          )}

          {/* 구시군별 성향 테이블 */}
          {(da.districts || []).length > 0 && (
            <div className="card">
              <h3 className="font-semibold mb-4">구시군별 성향 분석 (교육감+도지사 합산)</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--card-border)]">
                      <th className="text-left p-2 text-[var(--muted)]">지역</th>
                      <th className="text-left p-2 text-[var(--muted)]">우세 성향</th>
                      <th className="text-right p-2 text-blue-500">진보 평균</th>
                      <th className="text-right p-2 text-red-500">보수 평균</th>
                      <th className="text-right p-2 text-[var(--muted)]">강세율</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(da.districts || []).map((d: any, i: number) => (
                      <tr key={i} className="border-b border-[var(--card-border)] hover:bg-[var(--muted-bg)]">
                        <td className="p-2 font-medium">{d.district}</td>
                        <td className="p-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${d.dominant === '진보' ? 'bg-blue-500/10 text-blue-500' : 'bg-red-500/10 text-red-500'}`}>{d.dominant}</span>
                        </td>
                        <td className="p-2 text-right text-blue-500">{d.progressive_rate || 0}%</td>
                        <td className="p-2 text-right text-red-500">{d.conservative_rate || 0}%</td>
                        <td className="p-2 text-right">
                          <span className={`font-bold ${d.strength_rate >= 60 ? 'text-green-600' : 'text-amber-600'}`}>
                            {d.strength_rate || 0}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 데이터 출처 */}
          <div className="text-xs text-gray-400 text-center">
            데이터 출처: 중앙선거관리위원회 공공데이터 API | {data?.elections_count || 0}회 선거 데이터 분석 완료
          </div>
        </>
      )}
    </div>
  );
}
