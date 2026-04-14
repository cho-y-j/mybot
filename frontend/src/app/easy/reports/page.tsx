'use client';
import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useElection } from '@/hooks/useElection';
import { api } from '@/services/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function ReportsInner() {
  const { election } = useElection();
  const params = useSearchParams();
  const [reports, setReports] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!election?.id) return;
    loadReports();
  }, [election?.id]);

  const loadReports = async () => {
    try {
      const rp = await api.getReports(election!.id);
      const sorted = (rp || []).sort((a: any, b: any) =>
        new Date(b.created_at || b.report_date).getTime() - new Date(a.created_at || a.report_date).getTime()
      );
      setReports(sorted);
      const targetId = params.get('report_id');
      if (targetId) {
        const r = sorted.find((x: any) => x.id === targetId);
        if (r) loadDetail(r.id);
      } else if (sorted.length > 0) {
        loadDetail(sorted[0].id);
      }
    } catch {}
    finally { setLoading(false); }
  };

  const loadDetail = async (id: string) => {
    if (!election?.id) return;
    try {
      const r = await api.getReport(election.id, id);
      setSelected(r);
    } catch {}
  };

  const generateBriefing = async () => {
    if (!election?.id) return;
    setGenerating(true);
    try {
      const r = await api.generateReport(election.id, 'daily');
      if (r?.report_id) {
        await loadReports();
        await loadDetail(r.report_id);
      }
    } catch (e: any) {
      alert('생성 실패: ' + e.message);
    } finally { setGenerating(false); }
  };

  const typeLabel: Record<string, string> = {
    morning_brief: '오전 브리핑', afternoon_brief: '오후 브리핑',
    morning: '오전 브리핑', afternoon: '오후 브리핑',
    daily: '일일 종합', ai_daily: '일일 종합',
    weekly: '주간 전략', ai_morning_brief: '오전 브리핑', ai_afternoon_brief: '오후 브리핑',
    custom: '자유 보고서', survey: '여론조사',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">📊 보고서</h1>
          <p className="text-sm text-[var(--muted)] mt-1">매일 자동 생성 + 언제든 AI에게 요청</p>
        </div>
        <button onClick={generateBriefing} disabled={generating}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
          {generating ? '생성 중...' : '+ 지금 만들기'}
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="h-40 bg-[var(--muted-bg)] rounded-xl animate-pulse" />)}
        </div>
      ) : reports.length === 0 ? (
        <div className="text-center py-16 bg-[var(--muted-bg)] rounded-xl">
          <div className="text-4xl mb-2">📝</div>
          <p className="text-sm text-[var(--muted)]">아직 보고서가 없어요.</p>
          <button onClick={generateBriefing}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">첫 보고서 만들기</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* 목록 */}
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {reports.slice(0, 20).map(r => (
              <button key={r.id} onClick={() => loadDetail(r.id)}
                className={`w-full text-left p-3 rounded-lg border transition ${
                  selected?.id === r.id ? 'border-blue-500 bg-blue-500/5' : 'border-[var(--card-border)] hover:border-blue-300'
                }`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-blue-500">{typeLabel[r.type || r.report_type] || r.type}</span>
                  <span className="text-[10px] text-[var(--muted)]">{r.date || r.report_date}</span>
                </div>
                <p className="text-xs mt-1 line-clamp-2">{r.title}</p>
                {r.ai_generated && <span className="text-[10px] text-purple-500 mt-1 inline-block">AI 생성</span>}
              </button>
            ))}
          </div>

          {/* 내용 */}
          <div className="lg:col-span-2">
            {selected ? (
              <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5">
                <div className="flex items-start justify-between mb-3 pb-3 border-b border-[var(--card-border)]">
                  <div>
                    <h3 className="font-bold">{selected.title}</h3>
                    <div className="text-xs text-[var(--muted)] mt-1">
                      {typeLabel[selected.type || selected.report_type] || ''} · {selected.date || selected.report_date}
                    </div>
                  </div>
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none max-h-[500px] overflow-y-auto">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selected.content || selected.content_text || '(내용 없음)'}
                  </ReactMarkdown>
                </div>

                {/* 다음 액션 */}
                <div className="mt-4 pt-4 border-t border-[var(--card-border)]">
                  <div className="text-xs font-semibold text-[var(--muted)] mb-2">이 보고서를 바탕으로:</div>
                  <div className="flex gap-2 flex-wrap">
                    <Link href={`/easy/content?type=sns&topic=${encodeURIComponent(selected.title || '')}`}
                      className="text-xs px-3 py-2 bg-[var(--muted-bg)] rounded-lg hover:bg-blue-500/10">
                      📱 SNS 포스팅 만들기
                    </Link>
                    <Link href="/easy/assistant"
                      className="text-xs px-3 py-2 bg-[var(--muted-bg)] rounded-lg hover:bg-blue-500/10">
                      💬 AI에게 더 물어보기
                    </Link>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-16 text-[var(--muted)] bg-[var(--muted-bg)] rounded-xl">
                왼쪽에서 보고서를 선택하세요
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Reports() {
  return (
    <Suspense fallback={<div className="animate-pulse">로딩 중...</div>}>
      <ReportsInner />
    </Suspense>
  );
}
