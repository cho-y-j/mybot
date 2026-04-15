"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IconifyIcon } from "@/components/ui/iconify-icon";

interface User {
  id: number;
  code: string;
  name: string;
  email: string | null;
  plan: string;
  templateType: string;
  isActive: boolean;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  const fetchUsers = async () => {
    const params = new URLSearchParams({ page: String(page), search });
    const res = await fetch(`/api/super/users?${params}`);
    const data = await res.json();
    if (data.success) {
      setUsers(data.data.users);
      setPagination(data.data.pagination);
    }
  };

  useEffect(() => { fetchUsers(); }, [page, search]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-100">사용자 관리</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <IconifyIcon icon="solar:add-circle-bold" width="18" height="18" />
          새 사용자
        </button>
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder="이름 또는 코드로 검색..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full max-w-sm rounded-xl border border-white/10 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-100 outline-none focus:border-accent/50"
        />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/5 bg-zinc-900/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-left text-zinc-500">
              <th className="px-4 py-3">코드</th>
              <th className="px-4 py-3">이름</th>
              <th className="px-4 py-3">등급</th>
              <th className="px-4 py-3">템플릿</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3">가입일</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-mono text-zinc-300">{user.code}</td>
                <td className="px-4 py-3 text-zinc-200">{user.name}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    user.plan === "premium" ? "bg-amber-500/10 text-amber-400" : "bg-zinc-800 text-zinc-400"
                  }`}>
                    {user.plan}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-400">{user.templateType}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    user.isActive ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                  }`}>
                    {user.isActive ? "활성" : "비활성"}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-500">{new Date(user.createdAt).toLocaleDateString("ko-KR")}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/super-admin/users/${user.id}`}
                    className="text-accent hover:underline"
                  >
                    상세
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 hover:bg-white/5 disabled:opacity-30"
          >
            이전
          </button>
          <span className="text-sm text-zinc-500">{page} / {pagination.totalPages}</span>
          <button
            onClick={() => setPage(Math.min(pagination.totalPages, page + 1))}
            disabled={page === pagination.totalPages}
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 hover:bg-white/5 disabled:opacity-30"
          >
            다음
          </button>
        </div>
      )}

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchUsers(); }}
        />
      )}
    </div>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ code: "", name: "", email: "", phone: "", password: "", plan: "basic", templateType: "election", memo: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/super/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setLoading(false);

    if (!data.success) {
      setError(data.error);
      return;
    }
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-900 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-zinc-100">새 사용자 생성</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="코드 (URL 경로)" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
              className="rounded-xl border border-white/10 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-accent/50" />
            <input placeholder="이름" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="rounded-xl border border-white/10 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-accent/50" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="이메일" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="rounded-xl border border-white/10 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-accent/50" />
            <input placeholder="전화번호" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="rounded-xl border border-white/10 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-accent/50" />
          </div>
          <input placeholder="비밀번호" type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="w-full rounded-xl border border-white/10 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-accent/50" />
          <div className="grid grid-cols-2 gap-3">
            <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}
              className="rounded-xl border border-white/10 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-accent/50">
              <option value="basic">Basic</option>
              <option value="premium">Premium</option>
            </select>
            <select value={form.templateType} onChange={(e) => setForm({ ...form, templateType: e.target.value })}
              className="rounded-xl border border-white/10 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-accent/50">
              <option value="election">선거</option>
              <option value="namecard">명함</option>
              <option value="store">가게</option>
            </select>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm text-zinc-400 hover:bg-white/5">취소</button>
            <button type="submit" disabled={loading} className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-zinc-950 disabled:opacity-50">
              {loading ? "생성 중..." : "생성"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
