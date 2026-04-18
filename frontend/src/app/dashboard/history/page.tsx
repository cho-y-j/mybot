'use client';
import { useState, useEffect } from 'react';
import { useElection } from '@/hooks/useElection';
import { api } from '@/services/api';

import MayorView from '@/components/history/views/MayorView';
import GovernorView from '@/components/history/views/GovernorView';
import SuperintendentView from '@/components/history/views/SuperintendentView';
import CouncilView from '@/components/history/views/CouncilView';

const TYPE_LABEL: Record<string, string> = {
  superintendent: '교육감',
  mayor: '시장',
  gun_head: '군수',
  gu_head: '구청장',
  congressional: '국회의원',
  governor: '시도지사',
  metro_council: '시도의원',
  basic_council: '시군구의원',
  council: '시·도의원/구·시·군의원',
};

const VIEW_BY_LAYOUT: Record<string, any> = {
  mayor: MayorView,
  governor: GovernorView,
  superintendent: SuperintendentView,
  council: CouncilView,
  congressional: MayorView, // 임시
};

export default function HistoryPage() {
  const { election, loading } = useElection();
  const [data, setData] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!election) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" />
      </div>
    );
  }
  if (!election) {
    return <div className="card text-center py-12 text-gray-500">선거를 먼저 설정해주세요.</div>;
  }

  if (analyzing && !data) {
    return (
      <div className="card text-center py-16">
        <div className="animate-spin h-8 w-8 border-4 border-violet-500 border-t-transparent rounded-full mx-auto mb-4" />
        <div className="text-sm text-gray-500">과거 선거 데이터 분석 중...</div>
      </div>
    );
  }

  if (error) {
    return <div className="card text-center py-12 text-red-600">{error}</div>;
  }

  if (data?.error) {
    return (
      <div className="space-y-4">
        <div className="card text-center py-12">
          <div className="text-lg font-bold text-gray-800 dark:text-gray-200 mb-2">데이터 부족</div>
          <p className="text-sm text-gray-500">{data.error}</p>
          <button
            onClick={loadData}
            className="mt-4 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm hover:bg-violet-700"
          >
            재시도
          </button>
        </div>
      </div>
    );
  }

  const layout = data?.layout || 'mayor';
  const View = VIEW_BY_LAYOUT[layout] || MayorView;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">과거 선거 심층 분석</h1>
          <p className="text-sm text-gray-500 mt-1">
            {election.region_sido} · {TYPE_LABEL[election.election_type] || election.election_type} ·
            {' '}{data?.elections_count || 0}회 선거 분석
            <span className="ml-2 text-[11px] px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300">
              {layout} 특화 화면
            </span>
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={analyzing}
          className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          {analyzing ? '재분석 중...' : '↻ 새로고침'}
        </button>
      </div>

      {data?.fallback_notice && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 text-xs text-amber-800 dark:text-amber-200">
           {data.fallback_notice}
        </div>
      )}

      <View data={data} electionId={election.id} onRefresh={loadData} />
    </div>
  );
}
