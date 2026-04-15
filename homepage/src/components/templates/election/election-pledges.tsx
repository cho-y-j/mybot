"use client";

import { useState } from "react";
import type { SiteData } from "@/types/site";

interface Props {
  pledges: SiteData["pledges"];
  sectionTitle?: string;
}

// Parse details: supports old string[] format and new { items, imageUrl } format
function parseDetails(details: unknown): { items: string[]; imageUrl: string | null } {
  if (Array.isArray(details)) return { items: details, imageUrl: null };
  if (details && typeof details === "object" && "items" in (details as Record<string, unknown>)) {
    const d = details as { items: string[]; imageUrl?: string };
    return { items: d.items || [], imageUrl: d.imageUrl || null };
  }
  return { items: [], imageUrl: null };
}

function PledgeCard({
  pledge,
  index,
}: {
  pledge: SiteData["pledges"][number];
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const parsed = parseDetails(pledge.details);
  const hasDetails = parsed.items.length > 0;
  const number = String(index + 1).padStart(2, "0");

  return (
    <div
      className="rounded-2xl bg-white p-6 shadow-sm transition-shadow hover:shadow-md border-l-4"
      style={{ borderLeftColor: "var(--primary)" }}
    >
      <div className="flex items-start gap-4">
        {/* Number */}
        <span
          className="flex-shrink-0 text-3xl font-extrabold leading-none"
          style={{ color: "var(--primary)" }}
        >
          {number}
        </span>

        <div className="min-w-0 flex-1">
          {/* Title */}
          <h3 className="text-lg font-bold text-gray-900 leading-snug">
            {pledge.title}
          </h3>

          {/* Description */}
          {pledge.description && (
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              {pledge.description}
            </p>
          )}

          {/* Pledge image */}
          {parsed.imageUrl && (
            <div className="mt-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={parsed.imageUrl}
                alt={pledge.title}
                className="w-full rounded-xl"
                loading="lazy"
              />
            </div>
          )}

          {/* Expandable details */}
          {hasDetails && (
            <>
              <button
                onClick={() => setExpanded(!expanded)}
                className="mt-3 inline-flex items-center gap-1 text-sm font-semibold transition-colors"
                style={{ color: "var(--primary)" }}
              >
                {expanded ? "접기" : "세부 공약 보기"}
                <svg
                  className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {expanded && (
                <ul className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                  {parsed.items.map((detail, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-gray-600"
                    >
                      <span
                        className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: "var(--primary)" }}
                      />
                      {detail}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ElectionPledges({ pledges, sectionTitle }: Props) {
  if (pledges.length === 0) return null;

  const sorted = [...pledges].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <section id="pledges" className="bg-gray-50 py-16 sm:py-20">
      <div className="mx-auto max-w-4xl px-6">
        {/* Section heading */}
        <div className="mb-4 text-center">
          <h2 className="section-heading text-2xl font-bold sm:text-3xl text-gray-900">
            {sectionTitle || "핵심 공약"}
          </h2>
        </div>
        <p className="mb-10 text-center text-sm text-gray-500">
          지역 발전과 주민 행복을 위한 핵심 공약입니다
        </p>

        <div className="space-y-4">
          {sorted.map((pledge, idx) => (
            <PledgeCard key={pledge.id} pledge={pledge} index={idx} />
          ))}
        </div>
      </div>
    </section>
  );
}
