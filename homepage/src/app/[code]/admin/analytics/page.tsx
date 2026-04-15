"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

/* ─── Types ─── */
interface OverviewData {
  totalVisits: number;
  uniqueVisitors: number;
  deviceBreakdown: { mobile: number; desktop: number };
}

interface DailyStat {
  date: string;
  totalVisits: number;
  uniqueVisitors: number;
  mobileVisits: number;
  desktopVisits: number;
}

interface EventByType {
  [key: string]: number;
}

/* ─── Constants ─── */
const EVENT_LABELS: Record<string, string> = {
  share_kakao: "카카오 공유",
  share_copy: "링크 복사",
  video_play: "영상 재생",
  phone_click: "전화 클릭",
  pledge_view: "공약 조회",
};

const COLORS = ["#10b981", "#3b82f6", "#a855f7", "#f59e0b", "#ef4444", "#ec4899"];

function shortDate(d: string) {
  const date = new Date(d);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/* ─── Main Page ─── */
export default function AnalyticsPage() {
  const params = useParams();
  const router = useRouter();
  const code = params.code as string;

  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"week" | "month">("month");
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [todayOverview, setTodayOverview] = useState<OverviewData | null>(null);
  const [daily, setDaily] = useState<DailyStat[]>([]);
  const [eventsByType, setEventsByType] = useState<EventByType>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const authRes = await fetch("/api/auth/me");
      if (!authRes.ok) { router.push(`/${code}/admin/login`); return; }

      const [overviewRes, todayRes, visitorsRes, eventsRes] = await Promise.all([
        fetch(`/api/analytics/overview?period=${period}`),
        fetch(`/api/analytics/overview?period=today`),
        fetch("/api/analytics/visitors"),
        fetch("/api/analytics/events"),
      ]);

      if (overviewRes.ok) {
        const j = await overviewRes.json();
        if (j.success && j.data) setOverview(j.data);
      }
      if (todayRes.ok) {
        const j = await todayRes.json();
        if (j.success && j.data) setTodayOverview(j.data);
      }
      if (visitorsRes.ok) {
        const j = await visitorsRes.json();
        if (j.success && Array.isArray(j.data)) setDaily(j.data);
        else setDaily([]);
      }
      if (eventsRes.ok) {
        const j = await eventsRes.json();
        if (j.success && j.data?.byType && typeof j.data.byType === "object") {
          setEventsByType(j.data.byType);
        }
      }
    } catch (err) {
      console.error("Analytics fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [code, router, period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const mobile = overview?.deviceBreakdown?.mobile ?? 0;
  const desktop = overview?.deviceBreakdown?.desktop ?? 0;
  const total = (overview?.totalVisits ?? 0);
  const mobilePercent = total > 0 ? Math.round((mobile / total) * 100) : 0;

  const todayVisits = todayOverview?.totalVisits ?? 0;
  const todayUnique = todayOverview?.uniqueVisitors ?? 0;

  // Chart data
  const chartData = daily.map((d) => ({
    date: shortDate(d.date),
    fullDate: d.date,
    방문자: d.totalVisits,
    순방문자: d.uniqueVisitors,
    모바일: d.mobileVisits,
    데스크톱: d.desktopVisits,
  }));

  const deviceData = [
    { name: "모바일", value: mobile, color: "#10b981" },
    { name: "데스크톱", value: desktop, color: "#3b82f6" },
  ].filter((d) => d.value > 0);

  const eventData = Object.entries(eventsByType).map(([type, count]) => ({
    name: EVENT_LABELS[type] || type,
    value: count,
  })).sort((a, b) => b.value - a.value);

  const totalEvents = eventData.reduce((s, e) => s + e.value, 0);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative h-12 w-12">
            <div className="absolute inset-0 rounded-full border-2 border-zinc-800" />
            <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-emerald-500" />
          </div>
          <p className="text-sm text-zinc-500">분석 데이터를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">📊 방문자 분석</h1>
          <p className="mt-1 text-sm text-zinc-500">실시간 방문자 통계 및 인사이트</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-white/10 bg-zinc-800 p-0.5">
            {(["week", "month"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  period === p
                    ? "bg-emerald-500 text-zinc-950"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {p === "week" ? "7일" : "30일"}
              </button>
            ))}
          </div>
          <button
            onClick={fetchData}
            className="rounded-lg border border-white/10 bg-zinc-800 p-2 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
          >
            ↻
          </button>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="오늘 방문자" value={todayVisits} suffix="명" icon="👤" trend={todayUnique > 0 ? `순방문 ${todayUnique}명` : undefined} color="emerald" />
        <StatCard label="총 방문자" value={total} suffix="명" icon="👥" trend={`순방문 ${overview?.uniqueVisitors ?? 0}명`} color="blue" />
        <StatCard label="모바일 비율" value={mobilePercent} suffix="%" icon="📱" trend={`${mobile.toLocaleString()}명`} color="violet" />
        <StatCard label="이벤트" value={totalEvents} suffix="건" icon="⚡" trend={eventData.length > 0 ? `${eventData[0].name} ${eventData[0].value}건` : undefined} color="amber" />
      </div>

      {/* ── Visitor Trend (Area Chart) ── */}
      <div className="rounded-2xl border border-white/5 bg-zinc-900/80 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-200">📈 방문자 추이</h2>
          <span className="text-xs text-zinc-600">최근 {period === "week" ? "7" : "30"}일</span>
        </div>
        {chartData.length === 0 ? (
          <EmptyState message="방문자 데이터가 없습니다" />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorVisit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorUnique" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 11 }} axisLine={{ stroke: "#27272a" }} />
              <YAxis tick={{ fill: "#71717a", fontSize: 11 }} axisLine={{ stroke: "#27272a" }} />
              <Tooltip
                contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }}
                labelStyle={{ color: "#a1a1aa", marginBottom: 4 }}
                itemStyle={{ color: "#e4e4e7" }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }} />
              <Area type="monotone" dataKey="방문자" stroke="#10b981" strokeWidth={2} fill="url(#colorVisit)" />
              <Area type="monotone" dataKey="순방문자" stroke="#3b82f6" strokeWidth={2} fill="url(#colorUnique)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Middle Row: Device + Bar ── */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Device Breakdown (Pie) */}
        <div className="rounded-2xl border border-white/5 bg-zinc-900/80 p-5 lg:col-span-2">
          <h2 className="mb-4 text-base font-semibold text-zinc-200">📱 기기별 분석</h2>
          {deviceData.length === 0 ? (
            <EmptyState message="데이터가 없습니다" />
          ) : (
            <div className="flex flex-col items-center gap-4">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={deviceData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {deviceData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }}
                    formatter={(value: unknown) => [`${Number(value).toLocaleString()}명`, ""]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex gap-6">
                {deviceData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: d.color }} />
                    <div>
                      <span className="text-sm font-medium text-zinc-300">{d.name}</span>
                      <span className="ml-2 text-xs text-zinc-500">
                        {d.value.toLocaleString()}명 ({total > 0 ? Math.round((d.value / total) * 100) : 0}%)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Daily Bar Chart (Mobile vs Desktop) */}
        <div className="rounded-2xl border border-white/5 bg-zinc-900/80 p-5 lg:col-span-3">
          <h2 className="mb-4 text-base font-semibold text-zinc-200">💻 기기별 방문 추이</h2>
          {chartData.length === 0 ? (
            <EmptyState message="데이터가 없습니다" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 10 }} axisLine={{ stroke: "#27272a" }} />
                <YAxis tick={{ fill: "#71717a", fontSize: 10 }} axisLine={{ stroke: "#27272a" }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }}
                  labelStyle={{ color: "#a1a1aa" }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
                <Bar dataKey="모바일" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                <Bar dataKey="데스크톱" stackId="a" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Bottom Row: Events ── */}
      <div className="rounded-2xl border border-white/5 bg-zinc-900/80 p-5">
        <h2 className="mb-4 text-base font-semibold text-zinc-200">⚡ 이벤트 통계</h2>
        {eventData.length === 0 ? (
          <EmptyState message="이벤트 데이터가 없습니다" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {eventData.map((event, i) => {
              const percent = totalEvents > 0 ? Math.round((event.value / totalEvents) * 100) : 0;
              return (
                <div key={event.name} className="rounded-xl border border-white/5 bg-zinc-800/50 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-zinc-300">{event.name}</span>
                    <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: `${COLORS[i % COLORS.length]}20`, color: COLORS[i % COLORS.length] }}>
                      {percent}%
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-zinc-100 mb-2">
                    {event.value.toLocaleString()}<span className="text-sm font-normal text-zinc-500 ml-1">건</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-700">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${percent}%`, backgroundColor: COLORS[i % COLORS.length] }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Sub Components ── */
function StatCard({ label, value, suffix, icon, trend, color }: {
  label: string; value: number; suffix: string; icon: string; trend?: string;
  color: "emerald" | "blue" | "violet" | "amber";
}) {
  const bg: Record<string, string> = {
    emerald: "from-emerald-500/10 to-emerald-500/5 border-emerald-500/20",
    blue: "from-blue-500/10 to-blue-500/5 border-blue-500/20",
    violet: "from-violet-500/10 to-violet-500/5 border-violet-500/20",
    amber: "from-amber-500/10 to-amber-500/5 border-amber-500/20",
  };
  return (
    <div className={`rounded-2xl border bg-gradient-to-br p-4 ${bg[color]}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{icon}</span>
        <span className="text-xs font-medium text-zinc-500">{label}</span>
      </div>
      <div className="text-2xl font-bold text-zinc-100">
        {value.toLocaleString()}<span className="text-sm font-normal text-zinc-500 ml-1">{suffix}</span>
      </div>
      {trend && <p className="mt-1 text-[11px] text-zinc-600">{trend}</p>}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="text-4xl mb-3 opacity-30">📊</div>
      <p className="text-sm text-zinc-600">{message}</p>
      <p className="mt-1 text-xs text-zinc-700">사이트에 방문자가 생기면 여기에 표시됩니다</p>
    </div>
  );
}
