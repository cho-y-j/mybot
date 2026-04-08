'use client';
import { useEffect, useState } from 'react';
import { api } from '@/services/api';

const QUADRANT_STYLES: Record<string, { bg: string; border: string; text: string; iconBg: string }> = {
  strength: {
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-200 dark:border-blue-800',
    text: 'text-blue-700 dark:text-blue-300',
    iconBg: 'bg-blue-100 dark:bg-blue-900',
  },
  weakness: {
    bg: 'bg-red-50 dark:bg-red-950/30',
    border: 'border-red-200 dark:border-red-800',
    text: 'text-red-700 dark:text-red-300',
    iconBg: 'bg-red-100 dark:bg-red-900',
  },
  opportunity: {
    bg: 'bg-orange-50 dark:bg-orange-950/30',
    border: 'border-orange-200 dark:border-orange-800',
    text: 'text-orange-700 dark:text-orange-300',
    iconBg: 'bg-orange-100 dark:bg-orange-900',
  },
  threat: {
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-800',
    text: 'text-amber-700 dark:text-amber-300',
    iconBg: 'bg-amber-100 dark:bg-amber-900',
  },
};

const QUADRANT_ORDER: Array<keyof typeof QUADRANT_STYLES> = ['weakness', 'opportunity', 'strength', 'threat'];

interface Props {
  electionId: string;
  itemsPerQuadrant?: number;
}

export default function StrategicQuadrant({ electionId, itemsPerQuadrant = 4 }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const d = await api.getStrategicQuadrant(electionId, 'all', itemsPerQuadrant);
      setData(d);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (electionId) load(); }, [electionId]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      await api.triggerStrategicAnalysis(electionId, 30);
      // 1분 후 자동 새로고침
      setTimeout(() => { load(); setAnalyzing(false); }, 60000);
    } catch (e) {
      setAnalyzing(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="card">
        <div className="animate-pulse h-32 bg-gray-100 dark:bg-gray-800 rounded" />
      </div>
    );
  }

  if (!data) return null;

  const { quadrants, counts, analysis_progress } = data;
  const total = (counts.strength || 0) + (counts.weakness || 0) + (counts.opportunity || 0) + (counts.threat || 0);

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            🎯 전략 4사분면 <span className="text-sm font-normal text-gray-500">— AI가 분류한 액션 가능 콘텐츠</span>
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            AI 분석 진행률: {analysis_progress.analyzed}/{analysis_progress.total} ({analysis_progress.pct}%) ·
            분류 완료 {total}건
          </p>
        </div>
        {analysis_progress.pct < 100 && (
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="px-3 py-1.5 text-xs rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {analyzing ? '분석 중... (1~5분)' : `+ 추가 분석 (30건)`}
          </button>
        )}
      </div>

      {/* 4사분면 그리드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {QUADRANT_ORDER.map(key => {
          const q = quadrants[key];
          if (!q) return null;
          const style = QUADRANT_STYLES[key];
          return (
            <div key={key} className={`rounded-xl border-2 ${style.border} ${style.bg} p-4`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`text-2xl w-10 h-10 flex items-center justify-center rounded-lg ${style.iconBg}`}>
                    {q.icon}
                  </span>
                  <div>
                    <div className={`font-bold ${style.text}`}>{q.label}</div>
                    <div className="text-xs text-gray-500">→ {q.action}</div>
                  </div>
                </div>
                <div className={`text-2xl font-black ${style.text}`}>{counts[key] || 0}</div>
              </div>

              {q.items.length === 0 ? (
                <div className="text-xs text-gray-400 text-center py-6">
                  분류된 콘텐츠 없음
                </div>
              ) : (
                <div className="space-y-2">
                  {q.items.slice(0, itemsPerQuadrant).map((it: any) => (
                    <div key={it.id} className="bg-white dark:bg-gray-900 rounded-lg p-3 border border-gray-100 dark:border-gray-800">
                      <div className="flex items-start gap-2">
                        {it.action_priority === 'high' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500 text-white font-bold">HIGH</span>
                        )}
                        {it.action_priority === 'medium' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500 text-white font-bold">MED</span>
                        )}
                        <a href={it.url} target="_blank" rel="noreferrer"
                          className="text-sm font-semibold flex-1 hover:underline line-clamp-2">
                          {it.title}
                        </a>
                      </div>
                      {it.candidate && (
                        <div className="text-[11px] mt-1 flex items-center gap-1.5 flex-wrap">
                          {it.is_about_our_candidate ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-600 text-white font-bold">
                              내 캠프 · {it.candidate}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-400 text-white font-bold">
                              경쟁 · {it.candidate}
                            </span>
                          )}
                          <span className="text-gray-500">{it.date}</span>
                          <span className="text-gray-400">
                            {it.media_table === 'youtube_videos' && '· 유튜브'}
                            {it.media_table === 'community_posts' && '· 커뮤니티'}
                            {it.media_table === 'news_articles' && '· 뉴스'}
                          </span>
                        </div>
                      )}
                      {it.action_summary && (
                        <div className={`text-xs mt-2 ${style.text} font-medium`}>
                          → {it.action_summary}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
