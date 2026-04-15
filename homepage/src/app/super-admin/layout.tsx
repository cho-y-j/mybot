"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/admin/sidebar";
import { AdminHeader } from "@/components/admin/admin-header";

export default function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isLogin = pathname.endsWith("/login");

  if (isLogin) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-[100dvh] bg-zinc-950">
      <Sidebar />
      <div className="md:ml-60">
        <AdminHeader />
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
