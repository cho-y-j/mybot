"use client";

import { useState } from "react";
import type { SiteData } from "@/types/site";

interface Props {
  news: SiteData["news"];
  sectionTitle?: string;
  showCount?: number;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export default function ElectionNews({ news, sectionTitle, showCount = 3 }: Props) {
  const [showAll, setShowAll] = useState(false);

  if (news.length === 0) return null;

  const sorted = [...news].sort((a, b) => a.sortOrder - b.sortOrder);
  const visible = showAll ? sorted : sorted.slice(0, showCount);

  return (
    <section id="news" className="mx-auto max-w-4xl px-6 py-16 sm:py-20">
      {/* Section heading */}
      <div className="mb-10 text-center">
        <h2 className="section-heading text-2xl font-bold sm:text-3xl text-gray-900">
          {sectionTitle || "관련기사"}
        </h2>
      </div>

      <div className="space-y-3">
        {visible.map((item) => {
          const content = (
            <div className="flex items-center gap-4 rounded-xl border border-gray-100 bg-white p-5 transition-all hover:shadow-md hover:border-gray-200 group">
              <div className="min-w-0 flex-1">
                <h3 className="line-clamp-2 font-bold text-gray-900 group-hover:underline">
                  {item.title}
                </h3>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                  {item.source && (
                    <span className="font-medium text-gray-500">{item.source}</span>
                  )}
                  {item.publishedDate && (
                    <span>{formatDate(item.publishedDate)}</span>
                  )}
                </div>
              </div>

              {/* External link icon */}
              {item.url && (
                <svg
                  className="h-5 w-5 flex-shrink-0 text-gray-300 group-hover:text-gray-500 transition-colors"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              )}
            </div>
          );

          if (item.url) {
            return (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {content}
              </a>
            );
          }

          return <div key={item.id}>{content}</div>;
        })}
      </div>

      {/* Show more button */}
      {sorted.length > showCount && !showAll && (
        <div className="mt-6 text-center">
          <button
            onClick={() => setShowAll(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-6 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:shadow-md hover:border-gray-300"
          >
            더보기
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      )}
    </section>
  );
}
