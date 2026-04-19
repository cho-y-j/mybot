'use client';
import { useState, useEffect } from 'react';
import { useElection } from '@/hooks/useElection';
import { api } from '@/services/api';

import UnifiedHistoryView from '@/components/history/views/UnifiedHistoryView';

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

// 모든 선거 유형이 하나의 통합 뷰 사용 (범용)
// — 정당/진영 토글, 년도 전역 적용, 청주·수원·성남 등 자동 그룹핑

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
    return <div className="card text-center py-12 text-[var(--muted)]">선거를 먼저 설정해주세요.</div>;
  }

  if (analyzing && !data) {
    return (
      <div className="card text-center py-16">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
        <div className="text-sm text-[var(--muted)]">과거 선거 데이터 분석 중...</div>
      </div>
    );
  }

  if (error) {
    return <div className="card text-center py-12 text-red-500">{error}</div>;
  }

  if (data?.error) {
    return (
      <div className="space-y-4">
        <div className="card text-center py-12">
          <div className="text-lg font-bold mb-2">데이터 부족</div>
          <p className="text-sm text-[var(--muted)]">{data.error}</p>
          <button
            onClick={loadData}
            className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
          >
            재시도
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">과거 선거 심층 분석</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            {election.region_sido} · {TYPE_LABEL[election.election_type] || election.election_type} ·
            {' '}{data?.elections_count || 0}회 선거 분석
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={analyzing}
          className="px-3 py-1.5 rounded-lg border border-[var(--card-border)] text-sm hover:bg-[var(--muted-bg)] disabled:opacity-50"
        >
          {analyzing ? '재분석 중...' : '새로고침'}
        </button>
      </div>

      {data?.fallback_notice && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
          {data.fallback_notice}
        </div>
      )}

      <UnifiedHistoryView data={data} electionId={election.id} onRefresh={loadData} />
    </div>
  );
}
