"use client";

import { useState } from "react";

export default function SettingsPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");

    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();

    if (data.success) {
      setMessage("비밀번호가 변경되었습니다");
      setCurrentPassword("");
      setNewPassword("");
    } else {
      setError(data.error);
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-zinc-100">시스템 설정</h1>

      <div className="max-w-md rounded-2xl border border-white/5 bg-zinc-900/50 p-5">
        <h2 className="mb-4 text-lg font-semibold text-zinc-200">비밀번호 변경</h2>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <input
            type="password"
            placeholder="현재 비밀번호"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            className="w-full rounded-xl border border-white/10 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-accent/50"
          />
          <input
            type="password"
            placeholder="새 비밀번호 (8자 이상)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            className="w-full rounded-xl border border-white/10 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-accent/50"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          {message && <p className="text-sm text-green-400">{message}</p>}
          <button
            type="submit"
            className="rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-zinc-950"
          >
            변경
          </button>
        </form>
      </div>
    </div>
  );
}
