'use client';
import { useState, useEffect } from 'react';
import { api } from '@/services/api';

export default function ReportsPage() {
  const [elections, setElections] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const el = await api.getElections();
      setElections(el);
      if (el.length > 0) {
        const rp = await api.getReports(el[0].id);
        setReports(rp);
      }
    } catch {} finally { setLoading(false); }
  };

  const viewReport = async (reportId: string) => {
    if (!elections[0]) return;
    try {
      const rp = await api.getReport(elections[0].id, reportId);
      setSelectedReport(rp);
    } catch {}
  };

  const handleGenerate = async () => {
    if (!elections[0]) return;
    setGenerating(true);
    try {
      await api.generateReport(elections[0].id, 'daily');
      loadData();
    } catch {} finally { setGenerating(false); }
  };

  const typeLabels: Record<string, string> = {
    morning_brief: '오전 브리핑', afternoon_brief: '오후 브리핑',
    daily: '일일 보고서', weekly: '주간 보고서', custom: '맞춤 보고서',
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64">
      <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" />
    </div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">보고서</h1>
        <button onClick={handleGenerate} className="btn-primary" disabled={generating}>
          {generating ? '생성 중...' : '보고서 생성'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Report List */}
        <div className="space-y-2">
          {reports.map((r) => (
            <button
              key={r.id}
              onClick={() => viewReport(r.id)}
              className={`w-full text-left card p-4 hover:shadow-md transition-shadow ${
                selectedReport?.id === r.id ? 'ring-2 ring-primary-500' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{typeLabels[r.type] || r.type}</span>
                {r.sent_telegram && <span className="text-xs text-green-600">TG</span>}
              </div>
              <p className="text-xs text-gray-500 mt-1">{r.date}</p>
              {r.has_pdf && <span className="text-xs text-primary-500">PDF</span>}
            </button>
          ))}

          {reports.length === 0 && (
            <div className="card text-center py-8 text-gray-500 text-sm">
              아직 생성된 보고서가 없습니다.
            </div>
          )}
        </div>

        {/* Report Content */}
        <div className="lg:col-span-2">
          {selectedReport ? (
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">{selectedReport.title}</h3>
                <div className="flex gap-2">
                  {selectedReport.has_pdf && (
                    <a
                      href={`/api/reports/${elections[0]?.id}/${selectedReport.id}/download-pdf`}
                      className="btn-secondary text-sm"
                    >
                      PDF 다운로드
                    </a>
                  )}
                </div>
              </div>
              <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 p-4 rounded-lg max-h-[600px] overflow-y-auto">
                {selectedReport.content_text || '(내용 없음)'}
              </pre>
            </div>
          ) : (
            <div className="card text-center py-12 text-gray-500">
              왼쪽에서 보고서를 선택하세요.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
