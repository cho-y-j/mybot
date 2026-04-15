"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { IconifyIcon } from "@/components/ui/iconify-icon";

const NAV_ITEMS = [
  { href: "/super-admin", icon: "solar:widget-bold", label: "대시보드" },
  { href: "/super-admin/users", icon: "solar:users-group-rounded-bold", label: "사용자 관리" },
  { href: "/super-admin/analytics", icon: "solar:chart-2-bold", label: "전체 통계" },
  { href: "/super-admin/settings", icon: "solar:settings-bold", label: "시스템 설정" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-30 hidden h-full w-60 border-r border-white/5 bg-zinc-900/50 p-4 md:block">
      <div className="mb-8 flex items-center gap-2 px-3">
        <IconifyIcon icon="solar:home-2-bold" width="22" height="22" />
        <span className="text-lg font-bold text-zinc-100">MyHome</span>
        <span className="ml-auto rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
          Admin
        </span>
      </div>

      <nav className="space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/super-admin"
              ? pathname === "/super-admin"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
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
  );
}
