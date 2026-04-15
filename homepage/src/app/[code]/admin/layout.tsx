"use client";

import { usePathname, useParams } from "next/navigation";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconifyIcon } from "@/components/ui/iconify-icon";

const NAV_ITEMS = [
  { path: "", icon: "solar:widget-bold", label: "대시보드" },
  { path: "/builder", icon: "solar:layers-bold", label: "페이지 빌더" },
  { path: "/content", icon: "solar:document-text-bold", label: "콘텐츠 관리" },
  { path: "/analytics", icon: "solar:chart-2-bold", label: "분석" },
  { path: "/settings", icon: "solar:settings-bold", label: "설정" },
];

export default function CustomerAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const code = params.code as string;
  const basePath = `/${code}/admin`;

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push(`/${code}/admin/login`);
  }

  // Don't show layout on login page
  if (pathname.endsWith("/login")) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-[100dvh] bg-zinc-950">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 z-30 hidden h-full w-60 border-r border-white/5 bg-zinc-900/50 p-4 md:block">
        <div className="mb-8 flex items-center gap-2 px-3">
          <IconifyIcon icon="solar:home-2-bold" width="22" height="22" />
          <span className="text-lg font-bold text-zinc-100">MyHome</span>
          <span className="ml-auto rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-400">
            Site
          </span>
        </div>

        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const href = basePath + item.path;
            const isActive =
              item.path === ""
                ? pathname === basePath
                : pathname.startsWith(href);

            return (
              <Link
                key={item.path}
                href={href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200 ${
                  isActive
                    ? "bg-accent/10 font-medium text-accent"
                    : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                }`}
              >
                <IconifyIcon icon={item.icon} width="18" height="18" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <div className="md:ml-60">
        {/* Header */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-white/5 bg-zinc-950/80 px-6 backdrop-blur-xl">
          {/* Mobile menu button */}
          <div className="flex items-center gap-3 md:hidden">
            <IconifyIcon icon="solar:home-2-bold" width="20" height="20" />
            <span className="font-semibold text-zinc-100">MyHome</span>
          </div>

          <div className="hidden items-center gap-2 text-sm text-zinc-400 md:flex">
            <span className="font-mono text-zinc-300">{code}</span>
            <span>사이트 관리</span>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={`/${code}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200"
            >
              <IconifyIcon icon="solar:square-top-down-linear" width="16" height="16" />
              사이트 보기
            </a>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200"
            >
              <IconifyIcon icon="solar:logout-2-linear" width="16" height="16" />
              로그아웃
            </button>
          </div>
        </header>

        {/* Mobile bottom navigation */}
        <nav className="fixed bottom-0 left-0 z-30 flex w-full border-t border-white/5 bg-zinc-900/95 backdrop-blur-xl md:hidden">
          {NAV_ITEMS.map((item) => {
            const href = basePath + item.path;
            const isActive =
              item.path === ""
                ? pathname === basePath
                : pathname.startsWith(href);

            return (
              <Link
                key={item.path}
                href={href}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] transition-colors ${
                  isActive ? "text-accent" : "text-zinc-500"
                }`}
              >
                <IconifyIcon icon={item.icon} width="20" height="20" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <main className="p-6 pb-24 md:pb-6">{children}</main>
      </div>
    </div>
  );
}
