'use client';
import { useState, useEffect } from 'react';
import { api } from '@/services/api';

type ReportType = 'daily' | 'weekly' | 'morning' | 'afternoon' | 'survey' | 'custom';

const REPORT_TYPES: { value: ReportType; label: string; desc: string; hasPdf: boolean }[] = [
  { value: 'daily', label: '일일 전략 보고서', desc: '종합 현황 + AI 전략 + PDF', hasPdf: true },
  { value: 'weekly', label: '주간 전략 보고서', desc: '7일 추이 분석 + PDF', hasPdf: true },
  { value: 'morning', label: '오전 브리핑', desc: '간단 텍스트 요약', hasPdf: false },
  { value: 'afternoon', label: '오후 브리핑', desc: '간단 텍스트 요약', hasPdf: false },
  { value: 'custom', label: '자유 보고서', desc: '주제 직접 입력', hasPdf: true },
];

export default function ReportsPage() {
  const [elections, setElections] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  // 생성 옵션
  const [showGenerate, setShowGenerate] = useState(false);
  const [genType, setGenType] = useState<ReportType>('daily');
  const [genTopic, setGenTopic] = useState('');

  // 편집 모드
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  // PDF 미리보기
  const [showPdf, setShowPdf] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);

  const pdfUrl = selectedReport && elections[0]
    ? `/api/reports/${elections[0].id}/${selectedReport.id}/download-pdf`
    : null;

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const el = await api.getElections();
      setElections(el);
      if (el.length > 0) {
        const rp = await api.getReports(el[0].id);
        setReports(rp);
      }
    } catch (e) {
      console.error('reports load error:', e);
    } finally { setLoading(false); }
  };

  const viewReport = async (reportId: string) => {
    if (!elections[0]) return;
    try {
      const rp = await api.getReport(elections[0].id, reportId);
      setSelectedReport(rp);
      setEditing(false);
      setEditContent('');
      setShowPdf(false);
      if (pdfBlobUrl) { URL.revokeObjectURL(pdfBlobUrl); setPdfBlobUrl(null); }
    } catch (e) {
      console.error('report view error:', e);
    }
  };

  const handleGenerate = async () => {
    if (!elections[0]) return;
    setGenerating(true);
    try {
      const result = await api.generateReport(elections[0].id, genType, genTopic || undefined);
      setShowGenerate(false);
      setGenTopic('');
      await loadData();
      // 방금 생성된 보고서 자동 선택
      if (result?.report_id) {
        await viewReport(result.report_id);
      }
    } catch (e: any) {
      alert('생성 실패: ' + (e?.message || ''));
    } finally { setGenerating(false); }
  };

  const startEdit = () => {
    setEditing(true);
    setEditContent(selectedReport?.content || selectedReport?.content_text || '');
  };

  const saveEdit = async () => {
    if (!selectedReport || !elections[0]) return;
    setSaving(true);
    try {
      await fetch(`/api/reports/${elections[0].id}/${selectedReport.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(sessionStorage.getItem('access_token') || localStorage.getItem('access_token'))}`,
        },
        body: JSON.stringify({ content_text: editContent, status: 'confirmed' }),
      });
      setEditing(false);
      await viewReport(selectedReport.id);
      alert('보고서가 확정 저장되었습니다.');
    } catch (e: any) {
      alert('저장 실패: ' + (e?.message || ''));
    } finally { setSaving(false); }
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
    } catch (e) { console.error('PDF load error:', e); }
    finally { setLoadingPdf(false); }
  };

  const typeLabels: Record<string, string> = {
    morning_brief: '오전', afternoon_brief: '오후', morning: '오전',
    afternoon: '오후', daily: '일일', weekly: '주간', custom: '맞춤',
    survey: '여론조사',
  };

  const typeColors: Record<string, string> = {
    daily: 'bg-blue-500', weekly: 'bg-purple-500', morning_brief: 'bg-yellow-500',
    afternoon_brief: 'bg-orange-500', morning: 'bg-yellow-500', afternoon: 'bg-orange-500',
    custom: 'bg-gray-500', survey: 'bg-green-500',
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64">
      <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">보고서</h1>
        <button onClick={() => setShowGenerate(!showGenerate)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          + 보고서 생성
        </button>
      </div>

      {/* 생성 패널 */}
      {showGenerate && (
        <div className="card border-blue-500/30">
          <h3 className="font-bold mb-3">보고서 생성</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-4">
            {REPORT_TYPES.map(rt => (
              <button key={rt.value} onClick={() => setGenType(rt.value)}
                className={`p-3 rounded-lg border text-left text-sm transition ${
                  genType === rt.value
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-[var(--card-border)] hover:border-blue-300'
                }`}>
                <div className="font-medium">{rt.label}</div>
                <div className="text-[10px] text-[var(--muted)] mt-1">{rt.desc}</div>
              </button>
            ))}
          </div>

          {genType === 'custom' && (
            <div className="mb-4">
              <label className="text-sm font-medium mb-1 block">보고서 주제</label>
              <input value={genTopic} onChange={e => setGenTopic(e.target.value)}
                placeholder="예: 최근 여론조사 결과 분석, 경쟁자 동향 정리"
                className="w-full px-3 py-2 border rounded dark:bg-gray-700 dark:border-gray-600" />
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={handleGenerate} disabled={generating}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {generating ? 'AI 분석 중...' : '생성하기'}
            </button>
            <button onClick={() => setShowGenerate(false)}
              className="px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
              취소
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 보고서 목록 — 모바일에서 보고서 선택 시 숨김 */}
        <div className={`space-y-2 max-h-[700px] overflow-y-auto ${selectedReport ? 'hidden lg:block' : ''}`}>
          {[...reports].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((r) => (
            <button key={r.id} onClick={() => viewReport(r.id)}
              className={`w-full text-left p-3 rounded-lg border transition ${
                selectedReport?.id === r.id
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-[var(--card-border)] hover:border-blue-300'
              }`}>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${typeColors[r.type] || 'bg-gray-400'}`} />
                <span className="text-xs font-medium">{typeLabels[r.type] || r.type}</span>
                <span className="text-[10px] text-[var(--muted)] ml-auto">{r.date}</span>
              </div>
              <p className="text-xs text-[var(--muted)] mt-1 truncate">{r.title}</p>
              <div className="flex gap-1 mt-1">
                {r.has_pdf && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">PDF</span>}
                {r.sent_telegram && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400">TG</span>}
                {r.ai_generated && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">AI</span>}
                <span role="button" style={{cursor:'pointer'}} onClick={async (e) => {
                  e.stopPropagation();
                  if (!window.confirm('이 보고서를 삭제하시겠습니까?')) return;
                  try {
                    await api.deleteReport(elections[0]?.id, r.id);
                    setReports(prev => prev.filter(p => p.id !== r.id));
                    if (selectedReport?.id === r.id) setSelectedReport(null);
                  } catch {}
                }} className="text-[10px] text-gray-400 hover:text-red-400 ml-auto">삭제</span>
              </div>
            </button>
          ))}

          {reports.length === 0 && (
            <div className="text-center py-8 text-[var(--muted)] text-sm">
              아직 생성된 보고서가 없습니다.
            </div>
          )}
        </div>

        {/* 보고서 내용 */}
        <div className="lg:col-span-2">
          {selectedReport ? (
            <div className="card">
              {/* 헤더 */}
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                  {/* 모바일 뒤로가기 */}
                  <button onClick={() => setSelectedReport(null)}
                    className="lg:hidden text-sm text-blue-500 mb-2 flex items-center gap-1">
                    ← 목록으로
                  </button>
                  <h3 className="font-semibold">{selectedReport.title}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded text-white ${typeColors[selectedReport.type || selectedReport.report_type] || 'bg-gray-500'}`}>
                      {typeLabels[selectedReport.type || selectedReport.report_type] || '보고서'}
                    </span>
                    <span className="text-xs text-[var(--muted)]">{selectedReport.date || selectedReport.report_date}</span>
                    {selectedReport.ai_generated && <span className="text-xs text-purple-500">AI 생성</span>}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {!editing && (
                    <button onClick={startEdit}
                      className="px-3 py-1.5 border border-[var(--card-border)] rounded-lg text-sm hover:bg-[var(--muted-bg)]">
                      수정/확정
                    </button>
                  )}
                  {pdfUrl && !editing && (
                    <>
                      <button onClick={() => showPdf ? setShowPdf(false) : loadPdfPreview()}
                        disabled={loadingPdf}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                        {loadingPdf ? '...' : showPdf ? '텍스트' : 'PDF'}
                      </button>
                      <button
                        className="px-3 py-1.5 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-700"
                        onClick={async () => {
                          const res = await fetch(pdfUrl, { headers: { Authorization: `Bearer ${(sessionStorage.getItem('access_token') || localStorage.getItem('access_token'))}` } });
                          if (res.ok) {
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `${selectedReport?.title || 'report'}.pdf`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            setTimeout(() => URL.revokeObjectURL(url), 1000);
                          }
                        }}>
                        다운로드
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* 내용 */}
              {editing ? (
                <div className="space-y-3">
                  <div className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg">
                    AI 초안을 검토하고 수정하세요. 잘못된 내용을 고치거나 현장 의견을 추가한 후 "확정 저장"을 누르면 최종 보고서로 저장됩니다.
                  </div>
                  <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    className="w-full h-[500px] px-4 py-3 text-sm font-mono border rounded-lg bg-[var(--background)] leading-relaxed resize-y"
                    spellCheck={false}
                  />
                  <div className="flex gap-2">
                    <button onClick={saveEdit} disabled={saving}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                      {saving ? '저장 중...' : '확정 저장'}
                    </button>
                    <button onClick={() => setEditing(false)}
                      className="px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
                      취소
                    </button>
                  </div>
                </div>
              ) : showPdf && pdfBlobUrl ? (
                <div>
                  {/* iframe PDF는 모바일(iOS Safari 등)에서 안 뜨는 경우가 많음 — 새 탭 열기 버튼 병행 */}
                  <div className="lg:hidden mb-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded text-xs">
                    모바일에서 PDF가 안 보이면 아래 버튼으로 새 탭에서 여세요.
                    <a href={pdfBlobUrl} target="_blank" rel="noopener"
                      className="block mt-2 px-3 py-2 bg-blue-600 text-white rounded text-center">
                      PDF 새 탭에서 열기
                    </a>
                  </div>
                  <iframe src={pdfBlobUrl} className="w-full rounded-lg border h-[400px] lg:h-[700px] hidden lg:block" />
                </div>
              ) : (
                <pre className="text-sm whitespace-pre-wrap font-sans bg-[var(--muted-bg)] p-4 rounded-lg max-h-[calc(100vh-200px)] lg:max-h-[600px] overflow-y-auto leading-relaxed">
                  {selectedReport.content || selectedReport.content_text || '(내용 없음)'}
                </pre>
              )}

              {/* AI 생성물 표기 */}
              {selectedReport.ai_generated && !editing && (
                <div className="mt-3 text-[10px] text-[var(--muted)] text-center">
                  [AI 생성물] 본 보고서는 CampAI가 수집 데이터 기반으로 생성한 참고자료입니다. 사실 확인 후 활용하세요.
                </div>
              )}
            </div>
          ) : (
            <div className="card text-center py-12 text-[var(--muted)]">
              왼쪽에서 보고서를 선택하거나 새 보고서를 생성하세요.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
