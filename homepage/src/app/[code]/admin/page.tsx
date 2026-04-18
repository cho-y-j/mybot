"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { IconifyIcon } from "@/components/ui/iconify-icon";

interface StatCard {
  label: string;
  icon: string;
  color: string;
  period: "today" | "week" | "month";
}

const STAT_CARDS: StatCard[] = [
  { label: "오늘 방문자", icon: "solar:eye-linear", color: "text-[#006400]", period: "today" },
  { label: "이번 주", icon: "solar:calendar-linear", color: "text-airtable-blue", period: "week" },
  { label: "이번 달", icon: "solar:chart-2-linear", color: "text-airtable-navy", period: "month" },
];

const QUICK_LINKS = [
  { label: "일정 관리", icon: "solar:calendar-linear", tab: "schedule" },
  { label: "사진첩", icon: "solar:gallery-linear", tab: "photos" },
  { label: "기사 관리", icon: "solar:document-text-linear", tab: "articles" },
  { label: "영상 관리", icon: "solar:play-circle-linear", tab: "videos" },
];

export default function CustomerDashboardPage() {
  const params = useParams();
  const code = params.code as string;
  const [now, setNow] = useState<string>("");
  const [visitorCounts, setVisitorCounts] = useState<Record<string, number>>({
    today: 0,
    week: 0,
    month: 0,
  });

  const fetchStats = useCallback(async () => {
    const periods = ["today", "week", "month"] as const;
    const results = await Promise.all(
      periods.map(async (period) => {
        try {
          const res = await fetch(`/api/analytics/overview?period=${period}`);
          if (!res.ok) return { period, count: 0 };
          const json = await res.json();
          return { period, count: json.data?.uniqueVisitors ?? 0 };
        } catch {
          return { period, count: 0 };
        }
      })
    );
    const counts: Record<string, number> = {};
    for (const r of results) {
      counts[r.period] = r.count;
    }
    setVisitorCounts(counts);
  }, []);

  useEffect(() => {
    setNow(new Date().toLocaleString("ko-KR"));
    fetchStats();
  }, [fetchStats]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-end justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-airtable-navy">대시보드</h1>
        <div className="text-[13px] text-[#333333]">
          업데이트: <span className="text-airtable-textWeak">{now || "..."}</span>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {STAT_CARDS.map((card) => (
          <div
            key={card.label}
            className="flex flex-col rounded-[16px] border border-airtable-border bg-airtable-surface p-5 shadow-sm transition-all hover:shadow-airtable-subtle"
          >
            <div className="mb-4 flex items-center gap-2">
              <IconifyIcon icon={card.icon} width="16" height="16" className="text-[#333333]" />
              <span className="text-[14px] font-medium text-[#333333] tracking-airtable-card">{card.label}</span>
            </div>
            <div className={`text-4xl font-bold tracking-tight ${card.color}`}>
              {(visitorCounts[card.period] ?? 0).toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {/* Quick links */}
      <div className="mb-8 rounded-[16px] border border-airtable-border bg-airtable-surface p-6 shadow-sm">
        <h2 className="mb-5 text-[16px] font-medium tracking-airtable-card text-airtable-navy">콘텐츠 바로가기</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.tab}
              href={`/${code}/admin/content?tab=${link.tab}`}
              className="flex items-center gap-3 rounded-[12px] border border-airtable-border bg-airtable-bg p-3 transition-colors hover:border-airtable-blue/50 hover:bg-airtable-blue/5"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-airtable-surface border border-airtable-border text-airtable-blue shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                <IconifyIcon icon={link.icon} width="16" height="16" />
              </div>
              <span className="text-[14px] font-medium text-airtable-navy tracking-airtable-card">{link.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
