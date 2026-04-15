"use client";

import { useEffect, useState } from "react";
import { IconifyIcon } from "@/components/ui/iconify-icon";

interface DashboardData {
  stats: {
    totalUsers: number;
    basicUsers: number;
    premiumUsers: number;
    activeUsers: number;
    inactiveUsers: number;
    todayVisits: number;
  };
  recentUsers: Array<{
    id: number;
    code: string;
    name: string;
    plan: string;
    createdAt: string;
  }>;
}

const STAT_CARDS = [
  { key: "totalUsers", label: "전체 사용자", icon: "solar:users-group-rounded-bold", color: "text-blue-400" },
  { key: "activeUsers", label: "활성 사용자", icon: "solar:check-circle-bold", color: "text-green-400" },
  { key: "premiumUsers", label: "프리미엄", icon: "solar:crown-bold", color: "text-amber-400" },
  { key: "todayVisits", label: "오늘 방문자", icon: "solar:eye-bold", color: "text-purple-400" },
] as const;

export default function SuperAdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    fetch("/api/super/dashboard")
      .then((r) => r.json())
      .then((r) => r.success && setData(r.data));
  }, []);

  if (!data) {
    return <div className="text-zinc-500">불러오는 중...</div>;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-zinc-100">대시보드</h1>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STAT_CARDS.map((card) => (
          <div
            key={card.key}
            className="rounded-2xl border border-white/5 bg-zinc-900/50 p-5"
          >
            <div className="mb-3 flex items-center gap-2">
              <IconifyIcon icon={card.icon} width="18" height="18" />
              <span className="text-sm text-zinc-400">{card.label}</span>
            </div>
            <div className={`text-3xl font-bold ${card.color}`}>
              {data.stats[card.key].toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-white/5 bg-zinc-900/50 p-5">
        <h2 className="mb-4 text-lg font-semibold text-zinc-200">최근 가입 사용자</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-left text-zinc-500">
              <th className="pb-2">코드</th>
              <th className="pb-2">이름</th>
              <th className="pb-2">등급</th>
              <th className="pb-2">가입일</th>
            </tr>
          </thead>
          <tbody>
            {data.recentUsers.map((user) => (
              <tr key={user.id} className="border-b border-white/5">
                <td className="py-2.5 font-mono text-zinc-300">{user.code}</td>
                <td className="py-2.5 text-zinc-300">{user.name}</td>
                <td className="py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      user.plan === "premium"
                        ? "bg-amber-500/10 text-amber-400"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {user.plan}
                  </span>
                </td>
                <td className="py-2.5 text-zinc-500">
                  {new Date(user.createdAt).toLocaleDateString("ko-KR")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
