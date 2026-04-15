"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconifyIcon } from "@/components/ui/iconify-icon";

export default function SuperAdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          userType: "super_admin",
        }),
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.error);
        return;
      }

      router.push("/super-admin");
    } catch {
      setError("서버에 연결할 수 없습니다");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10">
            <IconifyIcon icon="solar:shield-keyhole-bold" width="28" height="28" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">관리자 로그인</h1>
          <p className="mt-1 text-sm text-zinc-500">MyHome 관리 시스템</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-400">
              사용자명
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 outline-none transition-colors focus:border-accent/50 focus:ring-1 focus:ring-accent/50"
              placeholder="admin"
              required
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-400">
              비밀번호
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 outline-none transition-colors focus:border-accent/50 focus:ring-1 focus:ring-accent/50"
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-zinc-950 transition-all duration-300 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
          >
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>
      </div>
    </div>
  );
}
