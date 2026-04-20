"use client";

import { useRouter } from "next/navigation";
import { IconifyIcon } from "@/components/ui/iconify-icon";

interface AdminHeaderProps {
  userName?: string;
}

export function AdminHeader({ userName = "관리자" }: AdminHeaderProps) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/site/auth/logout", { method: "POST" });
    router.push("/super-admin/login");
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-white/5 bg-zinc-950/80 px-6 backdrop-blur-xl">
      <div className="text-sm text-zinc-400">
        안녕하세요, <span className="font-medium text-zinc-200">{userName}</span>님
      </div>
      <button
        onClick={handleLogout}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200"
      >
        <IconifyIcon icon="solar:logout-2-linear" width="16" height="16" />
        로그아웃
      </button>
    </header>
  );
}
