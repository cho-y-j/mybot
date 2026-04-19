"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { IconifyIcon } from "@/components/ui/iconify-icon";

export default function CustomerLoginPage() {
  const router = useRouter();
  const params = useParams();
  const code = params.code as string;

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`/${code}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.error);
        return;
      }

      router.push(`/${code}/admin`);
    } catch {
      setError("서버에 연결할 수 없습니다");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-airtable-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-airtable-blue/10 text-airtable-blue">
            <IconifyIcon icon="solar:lock-keyhole-bold" width="28" height="28" />
          </div>
          <h1 className="text-2xl font-bold text-airtable-navy">사이트 관리자</h1>
          <p className="mt-1 text-sm text-[#333333]">
            <span className="font-mono">{code}</span> 사이트 로그인
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-airtable-border bg-airtable-surface p-6 shadow-airtable-subtle">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-airtable-navy">
              비밀번호
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-airtable-border bg-white px-4 py-3 text-sm text-airtable-navy outline-none transition-colors focus:border-airtable-blue focus:ring-1 focus:ring-airtable-blue/40 placeholder:text-[#999]"
              placeholder="비밀번호 입력"
              required
              autoFocus
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-airtable-blue px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-airtable-blue/90 active:scale-[0.99] disabled:opacity-50"
          >
            {loading ? "로그인 중..." : "로그인"}
          </button>

          <p className="text-center text-[11px] text-[#666]">
            가입 시 등록한 비밀번호로 로그인
          </p>
        </form>
      </div>
    </div>
  );
}
