"use client";

import { useEffect, useState } from "react";
import type { SiteData } from "@/types/site";

interface Props {
  settings: SiteData["settings"];
  candidateName: string;
  button1Text?: string;
  button1Link?: string;
  button2Text?: string;
  button2Link?: string;
  badgeFontSize?: number;
  electionFontSize?: number;
}

function useDDay(dateStr: string | null) {
  const [dDay, setDDay] = useState<number | null>(null);

  useEffect(() => {
    if (!dateStr) return;
    const target = new Date(dateStr);
    target.setHours(0, 0, 0, 0);

    function calc() {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const diff = Math.ceil(
        (target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      setDDay(diff);
    }

    calc();
    const id = setInterval(calc, 60_000);
    return () => clearInterval(id);
  }, [dateStr]);

  return dDay;
}

function formatDDay(d: number): string {
  if (d > 0) return `D-${d}`;
  if (d === 0) return "D-Day";
  return `D+${Math.abs(d)}`;
}

export default function ElectionHero({
  settings,
  candidateName,
  button1Text,
  button1Link,
  button2Text,
  button2Link,
  badgeFontSize = 12,
  electionFontSize = 12,
}: Props) {
  const dDay = useDDay(settings.electionDate);
  const [copied, setCopied] = useState(false);

  function copyLink() {
    try {
      navigator.clipboard.writeText(window.location.href);
    } catch {
      const input = document.createElement("input");
      input.value = window.location.href;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  /* ── Badges (당명 + 선거 D-day) ── */
  const badges = (
    <div className="flex items-center justify-center gap-3 flex-wrap">
      {settings.partyName && (
        <span
          className="rounded-full bg-white/90 px-4 py-1.5 font-bold tracking-wide shadow-sm"
          style={{ color: "var(--primary)", fontSize: `${badgeFontSize}px` }}
        >
          {settings.partyName}
        </span>
      )}
      {dDay !== null && settings.electionDate && (
        <span
          className="rounded-full px-4 py-1.5 font-bold text-white tracking-wide shadow-sm"
          style={{ backgroundColor: "var(--primary)", fontSize: `${electionFontSize}px` }}
        >
          {settings.electionName ? `${settings.electionName} ` : ""}
          {formatDDay(dDay)}
        </span>
      )}
    </div>
  );

  /* ── Slogan area ── */
  // 2026-04-18: 큰 h1을 candidateName(= user.name, "XX캠프")로 박았던 구조 →
  //             사용자 편집이 반영되지 않는 문제 → heroSlogan을 메인 h1으로.
  //             positionTitle 라인에 후보자 실명 병기.
  const mainHeadline = settings.heroSlogan || candidateName;
  const nameLine = [settings.positionTitle, candidateName].filter(Boolean).join(" · ");
  const sloganArea = (
    <div className="text-center text-white px-6 py-12 sm:py-16">
      {nameLine && (
        <p className="text-sm font-medium tracking-widest uppercase opacity-90 mb-3">
          {nameLine}
        </p>
      )}

      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl mb-4 leading-tight">
        {mainHeadline}
      </h1>

      {settings.heroSubSlogan && (
        <p className="text-base sm:text-lg opacity-90 leading-relaxed max-w-2xl mx-auto mb-8">
          {settings.heroSubSlogan}
        </p>
      )}

      <div className="flex items-center justify-center gap-2 flex-wrap">
        <a
          href={button1Link || "#pledges"}
          className="rounded-full px-5 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-lg"
          style={{ backgroundColor: "var(--primary)", filter: "brightness(0.85)" }}
        >
          {button1Text || "공약 보기"}
        </a>
        <a
          href={button2Link || "#about"}
          className="rounded-full border-2 border-white/50 bg-white/10 px-5 py-3 text-sm font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
        >
          {button2Text || "후보 소개"}
        </a>
        <a
          href="#donation"
          className="rounded-full border-2 border-white/50 bg-white/10 px-5 py-3 text-sm font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
        >
          후원 안내
        </a>
        <button
          onClick={copyLink}
          className="rounded-full border-2 border-white/50 bg-white/10 px-5 py-3 text-sm font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/20 flex items-center gap-1.5"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          {copied ? "복사됨!" : "링크 복사"}
        </button>
      </div>
    </div>
  );

  return (
    <section id="hero" className="w-full">
      {settings.heroImageUrl ? (
        <>
          {/* ① 컬러 바 — 이미지 위 별도 영역 */}
          <div
            className="w-full px-4 py-4"
            style={{ backgroundColor: "var(--primary)" }}
          >
            {badges}
          </div>

          {/* ② 히어로 이미지 — 풀 너비, 오버레이 없음 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={settings.heroImageUrl}
            alt={candidateName}
            className="w-full"
          />

          {/* ③ 슬로건 영역 — 이미지 아래 별도 섹션 */}
          <div
            style={{
              background: `linear-gradient(180deg, var(--primary) 0%, #1a1a2e 100%)`,
            }}
          >
            {sloganArea}
          </div>
        </>
      ) : (
        /* 이미지 없으면: 뱃지 + 슬로건 하나의 그라데이션 섹션 */
        <div
          className="w-full"
          style={{
            background: `linear-gradient(180deg, var(--primary) 0%, #1a1a2e 100%)`,
          }}
        >
          <div className="px-4 pt-10 pb-4">
            {badges}
          </div>
          {sloganArea}
        </div>
      )}
    </section>
  );
}
