'use client';
import { useState } from 'react';

interface Citation {
  id: string;
  type: string;
  title?: string;
  source?: string;
  url?: string;
  published_at?: string;
  preview?: string;
  similarity?: number;
}

export function CitationBadge({ citation, num }: { citation: Citation; num: number }) {
  const [open, setOpen] = useState(false);

  const typeColors: Record<string, string> = {
    news: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    community: 'bg-green-500/20 text-green-400 border-green-500/30',
    youtube: 'bg-red-500/20 text-red-400 border-red-500/30',
    report: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    briefing: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    realtime_news: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    nec: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };
  const color = typeColors[citation.type] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';

  const typeLabel: Record<string, string> = {
    news: '📰',
    community: '💬',
    youtube: '📺',
    report: '📋',
    briefing: '📝',
    realtime_news: '⚡️실시간',
    nec: '🏛️NEC',
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] font-medium mx-0.5 ${color} hover:scale-110 transition-transform cursor-pointer`}
        title={citation.title}
      >
        <span>{typeLabel[citation.type] || '📎'}</span>
        <span>{num}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5 max-w-lg w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{typeLabel[citation.type] || '📎'}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${color}`}>
                  출처 {num} · {citation.type}
                </span>
              </div>
              <button onClick={() => setOpen(false)} className="text-[var(--muted)] hover:text-white text-lg">
                ✕
              </button>
            </div>

            {citation.title && (
              <h4 className="font-bold text-base mb-2 leading-snug">{citation.title}</h4>
            )}

            <div className="space-y-1 text-xs text-[var(--muted)] mb-3">
              {citation.source && <div>출처: <span className="text-[var(--foreground)]">{citation.source}</span></div>}
              {citation.published_at && (
                <div>발행: <span className="text-[var(--foreground)]">
                  {new Date(citation.published_at).toLocaleString('ko', {
                    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                  })}
                </span></div>
              )}
              {citation.similarity !== undefined && (
                <div>AI 관련도: <span className="text-[var(--foreground)]">{(citation.similarity * 100).toFixed(1)}%</span></div>
              )}
            </div>

            {citation.preview && (
              <div className="bg-[var(--muted-bg)] rounded p-3 text-sm leading-relaxed mb-3 max-h-40 overflow-y-auto">
                {citation.preview}
              </div>
            )}

            {citation.url && (
              <a
                href={citation.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-500 hover:text-blue-400"
              >
                원문 보기 →
              </a>
            )}
          </div>
        </div>
      )}
    </>
  );
}
