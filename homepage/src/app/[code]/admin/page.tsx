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
  { label: "오늘 방문자", icon: "solar:eye-bold", color: "text-blue-400", period: "today" },
  { label: "이번 주", icon: "solar:calendar-bold", color: "text-green-400", period: "week" },
  { label: "이번 달", icon: "solar:chart-2-bold", color: "text-purple-400", period: "month" },
];

const QUICK_LINKS = [
  { label: "일정 관리", icon: "solar:calendar-bold", tab: "schedule" },
  { label: "사진첩", icon: "solar:gallery-bold", tab: "photos" },
  { label: "기사 관리", icon: "solar:document-text-bold", tab: "articles" },
  { label: "영상 관리", icon: "solar:play-circle-bold", tab: "videos" },
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
    <div>
      <h1 className="mb-6 text-2xl font-bold text-zinc-100">대시보드</h1>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {STAT_CARDS.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-white/5 bg-zinc-900/50 p-5"
          >
            <div className="mb-3 flex items-center gap-2">
              <IconifyIcon icon={card.icon} width="18" height="18" />
              <span className="text-sm text-zinc-400">{card.label}</span>
            </div>
            <div className={`text-3xl font-bold ${card.color}`}>
              {(visitorCounts[card.period] ?? 0).toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {/* Quick links */}
      <div className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-zinc-200">콘텐츠 관리</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.tab}
              href={`/${code}/admin/content?tab=${link.tab}`}
              className="flex flex-col items-center gap-2 rounded-2xl border border-white/5 bg-zinc-900/50 p-5 transition-colors hover:border-accent/20 hover:bg-zinc-900"
            >
              <IconifyIcon icon={link.icon} width="24" height="24" />
              <span className="text-sm text-zinc-300">{link.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Last updated */}
      <div className="text-xs text-zinc-600">
        마지막 업데이트: {now || "..."}
      </div>
    </div>
  );
}
