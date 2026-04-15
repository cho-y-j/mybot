"use client";

import { useEffect, useState } from "react";

// Map block types to section DOM IDs
const BLOCK_TYPE_TO_SECTION_ID: Record<string, string> = {
  hero: "hero",
  intro: "about",
  career: "about",
  goals: "pledges",
  gallery: "gallery",
  schedule: "schedule",
  news: "news",
  videos: "video",
  contacts: "contact",
};

const ALL_NAV_ITEMS = [
  {
    id: "hero",
    label: "홈",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    id: "about",
    label: "소개",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
  {
    id: "pledges",
    label: "공약",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    id: "gallery",
    label: "사진",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: "video",
    label: "영상",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: "contact",
    label: "연락",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
      </svg>
    ),
  },
];

interface Props {
  blocks?: Array<{ type: string; [key: string]: unknown }>;
}

export default function ElectionNav({ blocks }: Props) {
  const [activeId, setActiveId] = useState("hero");

  // Filter nav items based on visible blocks
  const navItems = (() => {
    if (!blocks || blocks.length === 0) return ALL_NAV_ITEMS;

    // Build set of section IDs from blocks (public data only includes visible blocks)
    const visibleSectionIds = new Set<string>();
    for (const block of blocks) {
      const sectionId = BLOCK_TYPE_TO_SECTION_ID[block.type];
      if (sectionId) visibleSectionIds.add(sectionId);
    }

    return ALL_NAV_ITEMS.filter((item) => visibleSectionIds.has(item.id));
  })();

  useEffect(() => {
    const sectionIds = navItems.map((item) => item.id);
    const observers: IntersectionObserver[] = [];

    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              setActiveId(id);
            }
          });
        },
        { rootMargin: "-40% 0px -40% 0px", threshold: 0 }
      );

      observer.observe(el);
      observers.push(observer);
    });

    return () => {
      observers.forEach((obs) => obs.disconnect());
    };
  }, [navItems]);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white shadow-[0_-2px_10px_rgba(0,0,0,0.1)] border-t-2 border-gray-200 safe-area-inset-bottom">
      <div className="mx-auto flex h-16 max-w-lg items-center justify-around px-2">
        {navItems.map((item) => {
          const isActive = activeId === item.id;
          return (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={(e) => {
                e.preventDefault();
                const el = document.getElementById(item.id);
                if (el) {
                  el.scrollIntoView({ behavior: "smooth" });
                  setActiveId(item.id);
                }
              }}
              className={`relative flex flex-col items-center gap-0.5 px-2 py-2 text-[11px] font-medium transition-colors ${
                isActive ? "font-bold" : "text-gray-400"
              }`}
              style={isActive ? { color: "var(--primary)" } : undefined}
            >
              {/* Active indicator — top border */}
              {isActive && (
                <span
                  className="absolute top-0 left-1 right-1 h-[3px] rounded-b-full"
                  style={{ backgroundColor: "var(--primary)" }}
                />
              )}
              {item.icon}
              <span>{item.label}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
