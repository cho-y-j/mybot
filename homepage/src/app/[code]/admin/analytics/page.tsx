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
      const authRes = await fetch("/api/site/auth/me");
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
            <div className="absolute inset-0 rounded-full border-2 border-[var(--card-border)]" />
            <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-emerald-500" />
          </div>
          <p className="text-sm text-[var(--muted)]">분석 데이터를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-airtable-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-airtable-navy">방문자 분석</h1>
          <p className="mt-1 text-[13px] text-[#666666]">웹사이트 실시간 방문자 통계 및 이벤트 분석</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-airtable-border bg-airtable-bg p-0.5">
            {(["week", "month"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded-[4px] px-3 py-1.5 text-[13px] font-medium transition-all ${
                  period === p
                    ? "bg-white text-airtable-navy shadow-[0_1px_3px_rgba(0,0,0,0.1)]"
                    : "text-[#666666] hover:text-airtable-navy"
                }`}
              >
                {p === "week" ? "최근 7일" : "최근 30일"}
              </button>
            ))}
          </div>
          <button
            onClick={fetchData}
            className="flex h-[32px] w-[32px] items-center justify-center rounded-md border border-airtable-border bg-airtable-surface text-[#666666] transition-colors hover:bg-airtable-bg hover:text-airtable-navy"
            title="새로고침"
          >
            ↻
          </button>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="오늘 방문자" value={todayVisits} suffix="명" trend={todayUnique > 0 ? `순방문 ${todayUnique}명` : undefined} color="emerald" />
        <StatCard label="총 방문자" value={total} suffix="명" trend={`순방문 ${overview?.uniqueVisitors ?? 0}명`} color="blue" />
        <StatCard label="모바일 접속률" value={mobilePercent} suffix="%" trend={`${mobile.toLocaleString()}명 접속`} color="violet" />
        <StatCard label="총 발생 이벤트" value={totalEvents} suffix="건" trend={eventData.length > 0 ? `최다: ${eventData[0].name}` : undefined} color="amber" />
      </div>

      {/* ── Visitor Trend (Area Chart) ── */}
      <div className="rounded-[12px] border border-airtable-border bg-airtable-surface p-6 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-[15px] font-medium tracking-airtable-card text-airtable-navy">방문자 추이</h2>
          <span className="text-[12px] text-[#666666]">기간: {period === "week" ? "7일" : "30일"}</span>
        </div>
        {chartData.length === 0 ? (
          <EmptyState message="방문자 데이터가 수집되지 않았습니다" />
        ) : (
          <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorVisit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1b61c9" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#1b61c9" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorUnique" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e2e6" vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "#666666", fontSize: 11 }} dy={10} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: "#666666", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: "#ffffff", border: "1px solid #e0e2e6", borderRadius: "8px", fontSize: "12px", boxShadow: "0 4px 6px rgba(0,0,0,0.05)" }}
                labelStyle={{ color: "#333333", fontWeight: "bold", marginBottom: "4px" }}
                itemStyle={{ color: "#181d26" }}
              />
              <Legend wrapperStyle={{ fontSize: "12px", color: "#666666", paddingTop: "10px" }} iconType="circle" />
              <Area type="monotone" name="전체 방문자" dataKey="방문자" stroke="#1b61c9" strokeWidth={2} fill="url(#colorVisit)" activeDot={{ r: 6, strokeWidth: 0 }} />
              <Area type="monotone" name="순수 방문자" dataKey="순방문자" stroke="#10b981" strokeWidth={2} fill="url(#colorUnique)" activeDot={{ r: 6, strokeWidth: 0 }} />
            </AreaChart>
          </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── Middle Row: Device + Bar ── */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Device Breakdown (Pie) */}
        <div className="rounded-[12px] border border-airtable-border bg-airtable-surface p-6 lg:col-span-2 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <h2 className="mb-6 text-[15px] font-medium tracking-airtable-card text-airtable-navy">접속 기기 분석</h2>
          {deviceData.length === 0 ? (
            <EmptyState message="데이터 없음" />
          ) : (
            <div className="flex flex-col items-center gap-6">
              <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={deviceData}
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={85}
                    paddingAngle={2}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {deviceData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color === "#10b981" ? "#1b61c9" : "#64748b"} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: "#ffffff", border: "1px solid #e0e2e6", borderRadius: "8px", fontSize: "12px", boxShadow: "0 4px 6px rgba(0,0,0,0.05)" }}
                    formatter={(value: unknown) => [`${Number(value).toLocaleString()}명`, ""]}
                  />
                </PieChart>
              </ResponsiveContainer>
              </div>
              <div className="flex w-full justify-center gap-8 border-t border-airtable-border pt-4">
                {deviceData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color === "#10b981" ? "#1b61c9" : "#64748b" }} />
                    <div className="flex flex-col">
                      <span className="text-[13px] font-medium text-airtable-navy">{d.name}</span>
                      <span className="text-[12px] text-[#666666]">
                        {total > 0 ? Math.round((d.value / total) * 100) : 0}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Daily Bar Chart (Mobile vs Desktop) */}
        <div className="rounded-[12px] border border-airtable-border bg-airtable-surface p-6 lg:col-span-3 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <h2 className="mb-6 text-[15px] font-medium tracking-airtable-card text-airtable-navy">기기별 일간 방문 추이</h2>
          {chartData.length === 0 ? (
            <EmptyState message="데이터 없음" />
          ) : (
            <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e2e6" vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "#666666", fontSize: 11 }} dy={10} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: "#666666", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#ffffff", border: "1px solid #e0e2e6", borderRadius: "8px", fontSize: "12px", boxShadow: "0 4px 6px rgba(0,0,0,0.05)" }}
                  cursor={{ fill: '#f8fafc' }}
                />
                <Legend wrapperStyle={{ fontSize: "12px", color: "#666666", paddingTop: "10px" }} iconType="circle" />
                <Bar dataKey="모바일" stackId="a" fill="#1b61c9" radius={[0, 0, 0, 0]} maxBarSize={40} />
                <Bar dataKey="데스크톱" stackId="a" fill="#64748b" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom Row: Events ── */}
      <div className="rounded-[12px] border border-airtable-border bg-airtable-surface p-6 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
        <h2 className="mb-6 text-[15px] font-medium tracking-airtable-card text-airtable-navy">특정 행동(이벤트) 발생 내역</h2>
        {eventData.length === 0 ? (
          <EmptyState message="기록된 이벤트가 없습니다" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {eventData.map((event, i) => {
              const percent = totalEvents > 0 ? Math.round((event.value / totalEvents) * 100) : 0;
              // Clean color array for Airtable style (Blues, teals, slates)
              const cleanColors = ["#1b61c9", "#0f766e", "#64748b", "#475569", "#334155"];
              const c = cleanColors[i % cleanColors.length];
              return (
                <div key={event.name} className="flex flex-col rounded-[8px] border border-airtable-border bg-white p-4 transition-all hover:border-airtable-blue/50 hover:shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[14px] font-medium text-airtable-navy">{event.name}</span>
                    <span className="flex h-5 items-center justify-center rounded-full px-2 text-[11px] font-bold" style={{ backgroundColor: `${c}15`, color: c }}>
                      {percent}%
                    </span>
                  </div>
                  <div className="mb-3 text-2xl font-bold tracking-tight text-airtable-navy">
                    {event.value.toLocaleString()}<span className="ml-[2px] text-[13px] font-normal text-[#666666]">회</span>
                  </div>
                  <div className="h-[4px] w-full overflow-hidden rounded-full bg-airtable-bg">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${percent}%`, backgroundColor: c }}
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
function StatCard({ label, value, suffix, trend }: {
  label: string; value: number; suffix: string; trend?: string;
  color: "emerald" | "blue" | "violet" | "amber";
}) {
  return (
    <div className="flex flex-col justify-between rounded-[8px] border border-airtable-border bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-shadow hover:shadow-airtable-subtle">
      <div className="mb-2">
        <span className="text-[13px] font-medium tracking-airtable-card text-[#666666]">{label}</span>
      </div>
      <div className="mb-2 text-3xl font-bold tracking-tight text-airtable-navy">
        {value.toLocaleString()}<span className="ml-[2px] text-[14px] font-normal text-[#666666]">{suffix}</span>
      </div>
      {trend ? (
        <p className="text-[12px] font-medium text-airtable-blue tracking-airtable-btn">{trend}</p>
      ) : (
        <p className="text-[12px] text-transparent select-none">-</p>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[8px] border border-dashed border-airtable-border bg-airtable-bg py-16">
      <p className="text-[14px] font-medium text-[#666666]">{message}</p>
    </div>
  );
}
