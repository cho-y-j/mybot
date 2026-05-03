"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface Slide {
  imageUrl: string;
  title?: string;
  subtitle?: string;
  link?: string;
}

interface Props {
  slides: Slide[];
  autoplay?: boolean;
  intervalSec?: number;
  sectionTitle?: string;
}

const SWIPE_THRESHOLD = 40; // px

export default function ElectionCarousel({
  slides,
  autoplay = true,
  intervalSec = 5,
  sectionTitle,
}: Props) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const total = slides.length;

  const goNext = useCallback(() => {
    if (total === 0) return;
    setIdx((i) => (i + 1) % total);
  }, [total]);

  const goPrev = useCallback(() => {
    if (total === 0) return;
    setIdx((i) => (i - 1 + total) % total);
  }, [total]);

  // 자동 슬라이드
  useEffect(() => {
    if (!autoplay || paused || total <= 1) return;
    const t = setInterval(goNext, Math.max(2, intervalSec) * 1000);
    return () => clearInterval(t);
  }, [autoplay, paused, intervalSec, goNext, total]);

  // 키보드 좌우 화살표
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext]);

  // 모바일 스와이프
  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    // 가로 우세 + 임계값 초과만 스와이프로 판정 (수직 스크롤 보존)
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
      if (dx < 0) goNext();
      else goPrev();
    }
    touchStartX.current = null;
    touchStartY.current = null;
  }

  if (total === 0) return null;

  return (
    <section
      id="carousel"
      className="mx-auto max-w-5xl px-6 py-16 sm:py-20"
    >
      {sectionTitle && (
        <div className="mb-8 text-center">
          <h2 className="section-heading text-2xl font-bold sm:text-3xl text-gray-900">
            {sectionTitle}
          </h2>
        </div>
      )}

      <div
        className="relative overflow-hidden rounded-2xl bg-gray-100 shadow-sm"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* 슬라이드 트랙 */}
        <div
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${idx * 100}%)` }}
        >
          {slides.map((s, i) => (
            <div key={i} className="relative w-full shrink-0">
              {s.link ? (
                <a href={s.link} target="_blank" rel="noopener noreferrer" className="block">
                  <SlideContent slide={s} />
                </a>
              ) : (
                <SlideContent slide={s} />
              )}
            </div>
          ))}
        </div>

        {/* 좌/우 화살표 (슬라이드 2장 이상일 때만) */}
        {total > 1 && (
          <>
            <button
              type="button"
              aria-label="이전 슬라이드"
              onClick={goPrev}
              className="absolute left-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition hover:bg-black/60"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="다음 슬라이드"
              onClick={goNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition hover:bg-black/60"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </>
        )}

        {/* 페이지네이션 dots */}
        {total > 1 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`슬라이드 ${i + 1}로 이동`}
                onClick={() => setIdx(i)}
                className={`h-2 rounded-full transition-all ${
                  i === idx ? "w-6 bg-white" : "w-2 bg-white/50 hover:bg-white/80"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function SlideContent({ slide }: { slide: Slide }) {
  // object-contain: 원본 비율 보존 (위아래/좌우 잘림 없음).
  // 컨테이너는 16:9 고정으로 캐러셀 높이 흔들림 방지, 빈 공간은 검정 배경(letterbox).
  return (
    <div className="relative aspect-[16/9] w-full bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={slide.imageUrl}
        alt={slide.title || "슬라이드 이미지"}
        className="absolute inset-0 h-full w-full object-contain"
        loading="lazy"
      />
      {(slide.title || slide.subtitle) && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-6 sm:p-8">
          {slide.title && (
            <h3 className="text-xl font-bold text-white sm:text-2xl">{slide.title}</h3>
          )}
          {slide.subtitle && (
            <p className="mt-1 text-sm text-white/85 sm:text-base">{slide.subtitle}</p>
          )}
        </div>
      )}
    </div>
  );
}
