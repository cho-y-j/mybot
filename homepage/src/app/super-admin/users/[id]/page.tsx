"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { IconifyIcon } from "@/components/ui/iconify-icon";

interface UserDetail {
  id: number;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  plan: string;
  templateType: string;
  templateTheme: string;
  isActive: boolean;
  memo: string | null;
  gaMeasurementId: string | null;
  customDomain: string | null;
  createdAt: string;
  usage: {
    fileCount: number;
    totalFileSize: number;
    visitCount: number;
    galleryCount: number;
    pledgeCount: number;
  };
}

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/super/users/${params.id}`)
      .then((r) => r.json())
      .then((r) => r.success && setUser(r.data));
  }, [params.id]);

  if (!user) return <div className="text-zinc-500">불러오는 중...</div>;

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    await fetch(`/api/super/users/${params.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: user.name,
        email: user.email,
        phone: user.phone,
        plan: user.plan,
        templateType: user.templateType,
        isActive: user.isActive,
        memo: user.memo,
      }),
    });
    setSaving(false);
  }

  async function handleToggleActive() {
    if (!user) return;
    const updated = !user.isActive;
    await fetch(`/api/super/users/${params.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: updated }),
    });
    setUser({ ...user, isActive: updated });
  }

  const update = (field: string, value: string | boolean) =>
    setUser(user ? { ...user, [field]: value } : null);

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <button onClick={() => router.back()} className="text-zinc-400 hover:text-zinc-200">
          <IconifyIcon icon="solar:arrow-left-linear" width="20" height="20" />
        </button>
        <h1 className="text-2xl font-bold text-zinc-100">{user.name}</h1>
        <span className="font-mono text-sm text-zinc-500">/{user.code}</span>
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <Link
          href={`/${user.code}`}
          target="_blank"
          className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
        >
          <IconifyIcon icon="solar:eye-linear" width="14" height="14" />
          사이트 보기
        </Link>
        <button
          onClick={handleToggleActive}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${
            user.isActive ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"
          }`}
        >
          {user.isActive ? "비활성화" : "활성화"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl border border-white/5 bg-zinc-900/50 p-5">
            <h2 className="mb-4 text-lg font-semibold text-zinc-200">기본 정보</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-zinc-500">이름</label>
                <input value={user.name} onChange={(e) => update("name", e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent/50" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">이메일</label>
                <input value={user.email || ""} onChange={(e) => update("email", e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent/50" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">전화번호</label>
                <input value={user.phone || ""} onChange={(e) => update("phone", e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent/50" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">등급</label>
                <select value={user.plan} onChange={(e) => update("plan", e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent/50">
                  <option value="basic">Basic</option>
                  <option value="premium">Premium</option>
                </select>
              </div>
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-xs text-zinc-500">관리자 메모</label>
              <textarea value={user.memo || ""} onChange={(e) => update("memo", e.target.value)} rows={2}
                className="w-full rounded-xl border border-white/10 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent/50" />
            </div>
            <button onClick={handleSave} disabled={saving}
              className="mt-4 rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-zinc-950 disabled:opacity-50">
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/5 bg-zinc-900/50 p-5">
            <h2 className="mb-3 text-sm font-semibold text-zinc-400">사용량</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-zinc-500">파일</span><span className="text-zinc-200">{user.usage.fileCount}개</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">용량</span><span className="text-zinc-200">{(user.usage.totalFileSize / 1024 / 1024).toFixed(1)}MB</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">방문자</span><span className="text-zinc-200">{user.usage.visitCount.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">갤러리</span><span className="text-zinc-200">{user.usage.galleryCount}장</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">공약</span><span className="text-zinc-200">{user.usage.pledgeCount}개</span></div>
            </div>
          </div>
          <div className="rounded-2xl border border-white/5 bg-zinc-900/50 p-5 text-sm text-zinc-500">
            가입일: {new Date(user.createdAt).toLocaleDateString("ko-KR")}
          </div>
        </div>
      </div>
    </div>
  );
}
