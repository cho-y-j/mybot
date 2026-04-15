"use client";

import { useState } from "react";
import type { SiteData } from "@/types/site";

interface Props {
  videos: SiteData["videos"];
  sectionTitle?: string;
  showCount?: number;
}

export default function ElectionVideos({ videos, sectionTitle, showCount = 4 }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  if (videos.length === 0) return null;

  const sorted = [...videos].sort((a, b) => a.sortOrder - b.sortOrder);
  const visible = showAll ? sorted : sorted.slice(0, showCount);

  return (
    <section id="video" className="bg-gray-50 py-16 sm:py-20">
      <div className="mx-auto max-w-4xl px-6">
        {/* Section heading */}
        <div className="mb-10 text-center">
          <h2 className="section-heading text-2xl font-bold sm:text-3xl text-gray-900">
            {sectionTitle || "영상"}
          </h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {visible.map((video) => (
            <div key={video.id} className="overflow-hidden rounded-2xl bg-white shadow-sm">
              {activeId === video.videoId ? (
                <div className="relative aspect-video">
                  <iframe
                    src={`https://www.youtube.com/embed/${video.videoId}?autoplay=1`}
                    title={video.title ?? "YouTube video"}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="absolute inset-0 h-full w-full"
                  />
                </div>
              ) : (
                <button
                  onClick={() => setActiveId(video.videoId)}
                  className="group relative block w-full"
                >
                  <div className="aspect-video overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://img.youtube.com/vi/${video.videoId}/maxresdefault.jpg`}
                      alt={video.title ?? ""}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.src = `https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg`;
                      }}
                    />
                  </div>

                  {/* Play button overlay */}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors group-hover:bg-black/30">
                    <div
                      className="flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg transition-transform group-hover:scale-110"
                      style={{ backgroundColor: "var(--primary)" }}
                    >
                      <svg className="h-7 w-7 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>
                </button>
              )}

              {/* Title + YouTube link below thumbnail */}
              <div className="p-4">
                {video.title && (
                  <p className="font-semibold text-gray-900 line-clamp-2">
                    {video.title}
                  </p>
                )}
                <a
                  href={`https://www.youtube.com/watch?v=${video.videoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700 transition-colors"
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                  </svg>
                  유튜브에서 보기
                </a>
              </div>
            </div>
          ))}
        </div>

        {/* Show more button */}
        {sorted.length > showCount && !showAll && (
          <div className="mt-8 text-center">
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
      </div>
    </section>
  );
}
