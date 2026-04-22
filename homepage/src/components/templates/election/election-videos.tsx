"use client";

import { useEffect, useState } from "react";
import type { SiteData } from "@/types/site";

interface Props {
  videos: SiteData["videos"];
  code?: string;
  sectionTitle?: string;
  showCount?: number;
}

type DisplayVideo = {
  videoId: string;
  title?: string | null;
  id: string | number;
  publishedAt?: string | null;
  pinOrder?: number | null;
  isManual: boolean;
};

export default function ElectionVideos({ videos, code, sectionTitle, showCount = 4 }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [feed, setFeed] = useState<DisplayVideo[]>([]);

  // 등록한 YouTube 채널의 최신 영상 자동 표시 (수동 등록 영상과 병합)
  useEffect(() => {
    if (!code) return;
    let alive = true;
    fetch(`/api/public/youtube-feed/${code}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const items: DisplayVideo[] = (d?.data?.items || []).map((v: { video_id: string; title?: string; published_at?: string; pin_order?: number | null }) => ({
          id: `feed-${v.video_id}`,
          videoId: v.video_id,
          title: v.title,
          publishedAt: v.published_at || null,
          pinOrder: v.pin_order ?? null,
          isManual: false,
        }));
        setFeed(items);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [code]);

  // 수동 영상(isManual=true)과 채널 피드(isManual=false) 중복 제거 후 병합
  const manualIds = new Set(videos.map((v) => v.videoId));
  const manualList: DisplayVideo[] = videos.map((v) => ({
    id: v.id,
    videoId: v.videoId,
    title: v.title,
    publishedAt: null, // 수동 등록은 날짜 없음
    pinOrder: null,    // 수동은 자체 sortOrder 드래그 순서 사용
    isManual: true,
  }));
  const merged = [...manualList, ...feed.filter((f) => !manualIds.has(f.videoId))];
  if (merged.length === 0) return null;

  // 정렬 규칙 (사용자 불만 "순서 엉망" 수정):
  // 1) 핀된 것 먼저 (pinOrder ASC — 음수일수록 최근 핀이라 위로)
  // 2) 그 다음 수동 등록 영상 (videos.sort_order — 드래그 순서)
  // 3) 마지막 채널 자동 피드 (publishedAt DESC — 최신 먼저)
  const sorted = [...merged].sort((a, b) => {
    const aPinned = a.pinOrder != null;
    const bPinned = b.pinOrder != null;
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    if (aPinned && bPinned) return (a.pinOrder ?? 0) - (b.pinOrder ?? 0);
    // 둘 다 미핀: 수동 > 피드 순
    if (a.isManual && !b.isManual) return -1;
    if (!a.isManual && b.isManual) return 1;
    if (a.isManual && b.isManual) {
      const av = videos.find((v) => String(v.id) === String(a.id));
      const bv = videos.find((v) => String(v.id) === String(b.id));
      return (av?.sortOrder ?? 0) - (bv?.sortOrder ?? 0);
    }
    // 둘 다 피드: 날짜 DESC
    return (b.publishedAt || "").localeCompare(a.publishedAt || "");
  });
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
