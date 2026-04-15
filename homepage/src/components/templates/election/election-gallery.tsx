"use client";

import { useState, useCallback } from "react";
import type { SiteData } from "@/types/site";

interface Props {
  gallery: SiteData["gallery"];
  sectionTitle?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  all: "전체",
  campaign: "선거운동",
  activity: "의정활동",
  local: "지역활동",
  event: "행사",
  media: "언론보도",
};

export default function ElectionGallery({ gallery, sectionTitle }: Props) {
  const [activeCategory, setActiveCategory] = useState("all");
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const handlePrev = useCallback(() => {
    setLightboxIdx((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
  }, []);

  const handleNext = useCallback(
    (max: number) => {
      setLightboxIdx((prev) =>
        prev !== null && prev < max - 1 ? prev + 1 : prev
      );
    },
    []
  );

  if (gallery.length === 0) return null;

  const sorted = [...gallery].sort((a, b) => a.sortOrder - b.sortOrder);

  const categories = [
    "all",
    ...Array.from(new Set(sorted.map((g) => g.category))),
  ];

  const filtered =
    activeCategory === "all"
      ? sorted
      : sorted.filter((g) => g.category === activeCategory);

  return (
    <section id="gallery" className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
      {/* Section heading */}
      <div className="mb-10 text-center">
        <h2 className="section-heading text-2xl font-bold sm:text-3xl text-gray-900">
          {sectionTitle || "사진첩"}
        </h2>
      </div>

      {/* Category filter tabs */}
      {categories.length > 2 && (
        <div className="mb-8 flex flex-wrap justify-center gap-2">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                setActiveCategory(cat);
                setLightboxIdx(null);
              }}
              className={`rounded-full px-5 py-2 text-sm font-medium transition-all ${
                activeCategory === cat
                  ? "text-white shadow-md"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
              style={
                activeCategory === cat
                  ? { backgroundColor: "var(--primary)" }
                  : undefined
              }
            >
              {CATEGORY_LABELS[cat] ?? cat}
            </button>
          ))}
        </div>
      )}

      {/* Image grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {filtered.map((img, idx) => (
            <button
              key={img.id}
              onClick={() => setLightboxIdx(idx)}
              className="group relative aspect-square overflow-hidden rounded-xl bg-gray-100"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={img.altText ?? ""}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20" />
            </button>
          ))}
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && filtered[lightboxIdx] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightboxIdx(null)}
        >
          {/* Close button */}
          <button
            className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
            onClick={() => setLightboxIdx(null)}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Counter */}
          <div className="absolute top-4 left-4 text-sm text-white/60">
            {lightboxIdx + 1} / {filtered.length}
          </div>

          {/* Nav prev */}
          {lightboxIdx > 0 && (
            <button
              className="absolute left-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                handlePrev();
              }}
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          {/* Nav next */}
          {lightboxIdx < filtered.length - 1 && (
            <button
              className="absolute right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                handleNext(filtered.length);
              }}
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={filtered[lightboxIdx].url}
            alt={filtered[lightboxIdx].altText ?? ""}
            className="max-h-[85vh] max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </section>
  );
}
