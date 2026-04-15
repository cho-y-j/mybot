'use client';
import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useElection } from '@/hooks/useElection';
import { api } from '@/services/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type ReportType = 'daily' | 'weekly' | 'morning' | 'afternoon' | 'custom';

const REPORT_TYPES: { value: ReportType; label: string; desc: string; hasPdf: boolean }[] = [
  { value: 'daily', label: '일일 전략 보고서', desc: '종합 현황 + AI 전략 + PDF', hasPdf: true },
  { value: 'weekly', label: '주간 전략 보고서', desc: '7일 추이 분석 + PDF', hasPdf: true },
  { value: 'morning', label: '오전 브리핑', desc: '간단 텍스트 요약', hasPdf: false },
  { value: 'afternoon', label: '오후 브리핑', desc: '간단 텍스트 요약', hasPdf: false },
  { value: 'custom', label: '자유 보고서', desc: '주제 직접 입력', hasPdf: true },
];

function ReportsInner() {
  const { election } = useElection();
  const params = useSearchParams();

  const [reports, setReports] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // 생성 옵션
  const [showGenerate, setShowGenerate] = useState(false);
  const [genType, setGenType] = useState<ReportType>('daily');
  const [genTopic, setGenTopic] = useState('');
  const [generating, setGenerating] = useState(false);

  // PDF 미리보기
  const [showPdf, setShowPdf] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);

  const pdfUrl = selected && election
    ? `/api/reports/${election.id}/${selected.id}/download-pdf`
    : null;

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
      setShowPdf(false);
      if (pdfBlobUrl) { URL.revokeObjectURL(pdfBlobUrl); setPdfBlobUrl(null); }
    } catch {}
  };

  const handleGenerate = async () => {
    if (!election?.id) return;
    setGenerating(true);
    try {
      const r = await api.generateReport(election.id, genType, genTopic || undefined);
      setShowGenerate(false);
      setGenTopic('');
      await loadReports();
      if (r?.report_id) {
        await loadDetail(r.report_id);
      }
    } catch (e: any) {
      alert('생성 실패: ' + e.message);
    } finally { setGenerating(false); }
  };

  const loadPdfPreview = async () => {
    if (!pdfUrl) return;
    if (pdfBlobUrl) { setShowPdf(true); return; }
    setLoadingPdf(true);
    try {
      const res = await fetch(pdfUrl, {
        headers: { Authorization: `Bearer ${(sessionStorage.getItem('access_token') || localStorage.getItem('access_token'))}` },
      });
      if (res.ok) {
        const blob = await res.blob();
        setPdfBlobUrl(URL.createObjectURL(blob));
        setShowPdf(true);
      }
    } catch {}
    finally { setLoadingPdf(false); }
  };

  const typeLabel: Record<string, string> = {
    morning_brief: '오전 브리핑', afternoon_brief: '오후 브리핑',
    morning: '오전 브리핑', afternoon: '오후 브리핑',
    daily: '일일 종합', ai_daily: '일일 종합',
    weekly: '주간 전략', ai_morning_brief: '오전 브리핑', ai_afternoon_brief: '오후 브리핑',
    custom: '자유 보고서', survey: '여론조사',
  };

  const typeColors: Record<string, string> = {
    daily: 'bg-blue-500', weekly: 'bg-purple-500', morning: 'bg-yellow-500',
    afternoon: 'bg-orange-500', morning_brief: 'bg-yellow-500', afternoon_brief: 'bg-orange-500',
    ai_daily: 'bg-blue-500', ai_morning_brief: 'bg-yellow-500', ai_afternoon_brief: 'bg-orange-500',
    custom: 'bg-gray-500', survey: 'bg-green-500',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">📊 보고서</h1>
          <p className="text-sm text-[var(--muted)] mt-1">매일 자동 생성 + 원하는 보고서 즉시 요청</p>
        </div>
        <button onClick={() => setShowGenerate(!showGenerate)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">
          + 보고서 생성
        </button>
      </div>

      {/* 생성 패널 */}
      {showGenerate && (
        <div className="border border-blue-500/30 rounded-xl p-4 bg-blue-500/5">
          <h3 className="font-bold mb-3">어떤 보고서를 만들까요?</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-4">
            {REPORT_TYPES.map(rt => (
              <button key={rt.value} onClick={() => setGenType(rt.value)}
                className={`p-3 rounded-lg border text-left text-sm transition ${
                  genType === rt.value
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-[var(--card-border)] hover:border-blue-300'
                }`}>
                <div className="font-medium">{rt.label}</div>
                <div className="text-[10px] text-[var(--muted)] mt-1">{rt.desc}</div>
                {rt.hasPdf && <div className="text-[10px] text-blue-500 mt-1">📄 PDF 포함</div>}
              </button>
            ))}
          </div>

          {genType === 'custom' && (
            <div className="mb-4">
              <label className="text-sm font-medium mb-1 block">보고서 주제</label>
              <input value={genTopic} onChange={e => setGenTopic(e.target.value)}
                placeholder="예: 최근 여론조사 결과 분석, 경쟁자 동향 정리"
                className="w-full px-3 py-2 border rounded-lg bg-[var(--card-bg)] border-[var(--card-border)]" />
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={handleGenerate} disabled={generating}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {generating ? 'AI 분석 중... (최대 10분)' : '✨ 생성하기'}
            </button>
            <button onClick={() => setShowGenerate(false)}
              className="px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
              취소
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="h-40 bg-[var(--muted-bg)] rounded-xl animate-pulse" />)}
        </div>
      ) : reports.length === 0 ? (
        <div className="text-center py-16 bg-[var(--muted-bg)] rounded-xl">
          <div className="text-4xl mb-2">📝</div>
          <p className="text-sm text-[var(--muted)]">아직 보고서가 없어요.</p>
          <button onClick={() => setShowGenerate(true)}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">첫 보고서 만들기</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* 목록 */}
          <div className="space-y-2 max-h-[700px] overflow-y-auto">
            {reports.slice(0, 30).map(r => (
              <button key={r.id} onClick={() => loadDetail(r.id)}
                className={`w-full text-left p-3 rounded-lg border transition ${
                  selected?.id === r.id ? 'border-blue-500 bg-blue-500/5' : 'border-[var(--card-border)] hover:border-blue-300'
                }`}>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${typeColors[r.type || r.report_type] || 'bg-gray-400'}`} />
                  <span className="text-xs font-medium">{typeLabel[r.type || r.report_type] || r.type}</span>
                  <span className="text-[10px] text-[var(--muted)] ml-auto">{r.date || r.report_date}</span>
                </div>
                <p className="text-xs mt-1 line-clamp-2">{r.title}</p>
                <div className="flex gap-1 mt-1">
                  {r.has_pdf && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500">PDF</span>}
                  {r.ai_generated && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500">AI</span>}
                </div>
              </button>
            ))}
          </div>

          {/* 내용 */}
          <div className="lg:col-span-2">
            {selected ? (
              <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5">
                <div className="flex items-start justify-between mb-3 pb-3 border-b border-[var(--card-border)] flex-wrap gap-2">
                  <div>
                    <h3 className="font-bold">{selected.title}</h3>
                    <div className="text-xs text-[var(--muted)] mt-1">
                      {typeLabel[selected.type || selected.report_type] || ''} · {selected.date || selected.report_date}
                      {selected.ai_generated && <span className="text-purple-500 ml-2">AI 생성</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {pdfUrl && (
                      <>
                        <button onClick={() => showPdf ? setShowPdf(false) : loadPdfPreview()}
                          disabled={loadingPdf}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50">
                          {loadingPdf ? '로딩...' : showPdf ? '📄 텍스트 보기' : '📄 PDF 미리보기'}
                        </button>
                        <a href={pdfUrl} download
                          onClick={async (e) => {
                            e.preventDefault();
                            const res = await fetch(pdfUrl, { headers: { Authorization: `Bearer ${(sessionStorage.getItem('access_token') || localStorage.getItem('access_token'))}` } });
                            if (res.ok) {
                              const blob = await res.blob();
                              const a = document.createElement('a');
                              a.href = URL.createObjectURL(blob);
                              a.download = `${selected.title || 'report'}.pdf`;
                              a.click();
                            }
                          }}
                          className="px-3 py-1.5 bg-violet-600 text-white rounded-lg text-xs hover:bg-violet-700">
                          ⬇ 다운로드
                        </a>
                      </>
                    )}
                    <button onClick={async () => {
                      if (!confirm(`이 보고서를 삭제하시겠습니까?\n\n"${selected.title}"\n\n복구할 수 없습니다.`)) return;
                      const t = (sessionStorage.getItem('access_token') || localStorage.getItem('access_token'));
                      const r = await fetch(`/api/reports/${election?.id}/${selected.id}`, {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${t}` },
                      });
                      if (r.ok) {
                        setReports(reports.filter((x: any) => x.id !== selected.id));
                        setSelected(null);
                      } else {
                        alert('삭제 실패');
                      }
                    }}
                      className="px-3 py-1.5 bg-red-500/10 border border-red-500/30 text-red-500 rounded-lg text-xs hover:bg-red-500/20">
                      🗑 삭제
                    </button>
                  </div>
                </div>

                {/* PDF 뷰어 or 텍스트 */}
                {showPdf && pdfBlobUrl ? (
                  <iframe src={pdfBlobUrl} className="w-full rounded-lg border border-[var(--card-border)] h-[400px] lg:h-[600px]" />
                ) : (
                  <div className="max-h-[600px] overflow-y-auto">
                    {/\n[=#]/.test((selected.content || selected.content_text || '')) && !/^#\s/.test((selected.content || selected.content_text || '')) ? (
                      <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed bg-[var(--muted-bg)] p-4 rounded">
                        {selected.content || selected.content_text || '(내용 없음)'}
                      </pre>
                    ) : (
                      <div className="prose prose-sm dark:prose-invert max-w-none prose-th:bg-[var(--card-bg)] prose-th:border prose-th:border-[var(--card-border)] prose-th:p-2 prose-td:border prose-td:border-[var(--card-border)] prose-td:p-2">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {selected.content || selected.content_text || '(내용 없음)'}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}

                {/* 다음 액션 */}
                <div className="mt-4 pt-4 border-t border-[var(--card-border)]">
                  <div className="text-xs font-semibold text-[var(--muted)] mb-2">이 보고서를 바탕으로:</div>
                  <div className="flex gap-2 flex-wrap">
                    <Link href={`/easy/content?type=sns&topic=${encodeURIComponent(selected.title || '')}`}
                      className="text-xs px-3 py-2 bg-[var(--muted-bg)] rounded-lg hover:bg-blue-500/10">
                      📱 SNS 포스팅 만들기
                    </Link>
                    <Link href={`/easy/content?type=blog&topic=${encodeURIComponent(selected.title || '')}`}
                      className="text-xs px-3 py-2 bg-[var(--muted-bg)] rounded-lg hover:bg-blue-500/10">
                      📝 블로그 글 만들기
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
