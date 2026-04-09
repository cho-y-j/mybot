'use client';
import { useState, useEffect } from 'react';
import { useElection } from '@/hooks/useElection';
import { api } from '@/services/api';

export default function AdsPage() {
  const { election, loading: elLoading } = useElection();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);

  const load = async () => {
    if (!election) return;
    setLoading(true);
    try {
      const result = await api.getAdAnalysis(election.id);
      setData(result);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const collect = async () => {
    if (!election) return;
    setCollecting(true);
    try {
      const result = await api.collectAds(election.id);
      alert(`수집 완료: ${result.collected}건${result.errors?.length ? `, 오류 ${result.errors.length}건` : ''}`);
      await load();
    } catch (e: any) {
      alert(e.message || '수집 실패');
    } finally {
      setCollecting(false);
    }
  };

  useEffect(() => { if (election) load(); }, [election]);

  if (elLoading) return <div className="p-6 text-gray-500">로딩 중...</div>;
  if (!election) return <div className="p-6 text-red-500">선거를 선택하세요</div>;

  const formatKRW = (n: number) => n >= 10000 ? `${(n / 10000).toFixed(0)}만원` : `${n.toLocaleString()}원`;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">광고 추적</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Meta(Facebook/Instagram) Ad Library에서 경쟁 후보의 광고 집행 현황을 추적합니다.
          </p>
        </div>
        <button onClick={collect} disabled={collecting}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
          {collecting ? '수집 중...' : '광고 수집'}
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
        </div>
      )}

      {data && !loading && (
        <>
          {/* KPI 카드 */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 text-center">
              <div className="text-2xl font-bold">{data.total_campaigns}</div>
              <div className="text-sm text-gray-500">총 광고 캠페인</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 text-center">
              <div className="text-2xl font-bold">{formatKRW(data.total_spend_upper)}</div>
              <div className="text-sm text-gray-500">총 추정 광고비 (상한)</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 text-center">
              <div className="text-2xl font-bold">{data.platform}</div>
              <div className="text-sm text-gray-500">플랫폼</div>
            </div>
          </div>

          {/* 후보별 광고비 비교 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-5">
            <h2 className="font-bold mb-4">후보별 광고 집행 현황</h2>
            {data.candidates?.length === 0 || data.candidates?.every((c: any) => c.campaigns === 0) ? (
              <div className="text-center py-8 text-gray-500">
                <p className="text-lg mb-2">수집된 광고 데이터가 없습니다</p>
                <p className="text-sm">상단의 &quot;광고 수집&quot; 버튼을 눌러 Meta Ad Library에서 데이터를 수집하세요.</p>
                <p className="text-xs mt-2 text-yellow-600">META_AD_LIBRARY_TOKEN 환경변수 설정이 필요합니다.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {data.candidates?.map((c: any, i: number) => {
                  const maxSpend = Math.max(...data.candidates.map((x: any) => x.spend_range.upper), 1);
                  const pct = Math.round(c.spend_range.upper / maxSpend * 100);
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{c.name}</span>
                          {c.is_ours && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">우리</span>}
                        </div>
                        <div className="text-sm text-gray-500">
                          {c.campaigns}개 캠페인 | {formatKRW(c.spend_range.lower)}~{formatKRW(c.spend_range.upper)}
                        </div>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-4">
                        <div className={`h-4 rounded-full ${c.is_ours ? 'bg-blue-500' : 'bg-red-400'}`}
                          style={{ width: `${pct}%` }} />
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        노출: {c.impressions_range.lower.toLocaleString()}~{c.impressions_range.upper.toLocaleString()}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 크리에이티브 갤러리 */}
          {data.candidates?.some((c: any) => c.creatives?.length > 0) && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-5">
              <h2 className="font-bold mb-4">광고 크리에이티브</h2>
              <div className="space-y-4">
                {data.candidates?.filter((c: any) => c.creatives?.length > 0).map((c: any, i: number) => (
                  <div key={i}>
                    <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">{c.name}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {c.creatives.map((cr: any, j: number) => (
                        <div key={j} className="border dark:border-gray-600 rounded p-3">
                          <div className="text-xs text-gray-500 mb-1">{cr.type}</div>
                          {cr.text && <p className="text-sm">{cr.text}</p>}
                          {cr.link && (
                            <a href={cr.link} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-blue-500 hover:underline mt-1 block truncate">{cr.link}</a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
