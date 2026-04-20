"use client";

import { usePathname, useParams } from "next/navigation";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconifyIcon } from "@/components/ui/iconify-icon";

const NAV_ITEMS = [
  { path: "", icon: "solar:widget-linear", label: "대시보드" },
  { path: "/builder", icon: "solar:layers-linear", label: "페이지 빌더" },
  { path: "/content", icon: "solar:document-text-linear", label: "콘텐츠 관리" },
  { path: "/analytics", icon: "solar:chart-2-linear", label: "분석" },
  { path: "/settings", icon: "solar:settings-linear", label: "설정" },
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
    await fetch("/api/site/auth/logout", { method: "POST" });
    router.push(`/${code}/admin/login`);
  }

  // Don't show layout on login page
  if (pathname.endsWith("/login")) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-[100dvh] bg-airtable-bg tracking-airtable-body text-airtable-navy font-sans">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 z-30 hidden h-full w-64 border-r border-airtable-border bg-airtable-surface p-4 md:block">
        <div className="mb-8 flex items-center gap-2 px-3">
          <IconifyIcon icon="solar:home-2-bold" width="22" height="22" className="text-airtable-blue" />
          <span className="text-lg font-bold tracking-normal text-airtable-navy">MyHome</span>
          <span className="ml-auto rounded-md border border-airtable-border bg-airtable-bg px-2 py-0.5 text-[11px] font-medium text-[#333333]">
            Site Admin
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
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors ${
                  isActive
                    ? "bg-airtable-blue/10 font-medium text-airtable-blue tracking-airtable-btn"
                    : "text-[#333333] hover:bg-airtable-bg hover:text-airtable-navy hover:shadow-airtable-subtle"
                }`}
              >
                <IconifyIcon icon={isActive ? item.icon.replace('-linear', '-bold') : item.icon} width="18" height="18" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <div className="md:ml-64">
        {/* Header */}
        <header className="sticky top-0 z-20 flex h-[52px] items-center justify-between border-b border-airtable-border bg-airtable-surface/95 px-6 backdrop-blur-md">
          {/* Mobile menu button */}
          <div className="flex items-center gap-3 md:hidden">
            <IconifyIcon icon="solar:home-2-bold" width="20" height="20" className="text-airtable-blue" />
            <span className="font-semibold text-airtable-navy">MyHome</span>
          </div>

          <div className="hidden items-center gap-2 text-sm text-[#333333] md:flex">
            <span className="font-medium text-airtable-navy tracking-airtable-card">{code}</span>
            <span>사이트 관리</span>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={`/${code}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium text-[#333333] transition-colors hover:bg-airtable-bg hover:text-airtable-navy"
            >
              <IconifyIcon icon="solar:square-top-down-linear" width="16" height="16" />
              사이트 보기
            </a>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium text-[#333333] transition-colors hover:bg-airtable-bg hover:text-airtable-navy"
            >
              <IconifyIcon icon="solar:logout-2-linear" width="16" height="16" />
              로그아웃
            </button>
          </div>
        </header>

        {/* Mobile bottom navigation */}
        <nav className="fixed bottom-0 left-0 z-30 flex w-full border-t border-airtable-border bg-airtable-surface/95 backdrop-blur-md md:hidden">
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
                className={`flex flex-1 flex-col items-center justify-center gap-1 py-3 text-[11px] font-medium transition-colors ${
                  isActive ? "text-airtable-blue" : "text-[#333333]"
                }`}
              >
                <IconifyIcon icon={isActive ? item.icon.replace('-linear', '-bold') : item.icon} width="20" height="20" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <main className="min-h-[calc(100vh-52px)] p-6 md:p-8 pb-24 md:pb-8">{children}</main>
      </div>
    </div>
  );
}
