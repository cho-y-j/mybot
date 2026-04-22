"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

export default function CustomerSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const currentSegment = params.code as string;

  // ── 비밀번호 변경 ──
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwMessage, setPwMessage] = useState("");
  const [pwError, setPwError] = useState("");

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMessage(""); setPwError("");
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (data.success) {
      setPwMessage("비밀번호가 변경되었습니다");
      setCurrentPassword(""); setNewPassword("");
    } else {
      setPwError(data.error);
    }
  }

  // ── 사이트 주소(slug) 변경 ──
  const [currentSlug, setCurrentSlug] = useState<string | null>(null);
  const [currentCode, setCurrentCode] = useState<string>("");
  const [newSlug, setNewSlug] = useState("");
  const [slugChecking, setSlugChecking] = useState(false);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [slugReason, setSlugReason] = useState("");
  const [slugMessage, setSlugMessage] = useState("");
  const [slugError, setSlugError] = useState("");
  const [slugSaving, setSlugSaving] = useState(false);

  // 현재 상태 로드
  useEffect(() => {
    fetch("/api/site/auth/me")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d?.data?.user) {
          setCurrentSlug(d.data.user.slug || null);
          setCurrentCode(d.data.user.code || "");
        }
      })
      .catch(() => {});
  }, []);

  // 실시간 체크
  useEffect(() => {
    const v = newSlug.trim();
    if (!v) { setSlugAvailable(null); setSlugReason(""); return; }
    if (v.length < 3) { setSlugAvailable(null); setSlugReason(""); return; }
    if (v === currentSlug) { setSlugAvailable(true); setSlugReason("현재 사용 중"); return; }

    setSlugChecking(true);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/public/slug/check?value=${encodeURIComponent(v)}`);
        const d = await r.json();
        setSlugAvailable(!!d?.data?.available);
        setSlugReason(d?.data?.reason || "");
      } catch {
        setSlugAvailable(null);
      } finally {
        setSlugChecking(false);
      }
    }, 300);
    return () => { clearTimeout(timer); setSlugChecking(false); };
  }, [newSlug, currentSlug]);

  async function handleSaveSlug(e: React.FormEvent) {
    e.preventDefault();
    setSlugMessage(""); setSlugError("");
    setSlugSaving(true);
    try {
      const r = await fetch("/api/site/slug", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: newSlug.trim() || null }),
      });
      const d = await r.json();
      if (!d.success) {
        setSlugError(d.error || "저장 실패");
        return;
      }
      setSlugMessage("저장되었습니다. 새 주소로 이동합니다…");
      setCurrentSlug(d.data.slug);
      const target = d.data.slug || currentCode;
      setTimeout(() => { router.push(`/${target}/admin/settings`); }, 800);
    } finally {
      setSlugSaving(false);
    }
  }

  async function handleRemoveSlug() {
    if (!confirm("짧은 주소를 없애고 기본 주소로 돌아갈까요?")) return;
    setSlugSaving(true);
    try {
      const r = await fetch("/api/site/slug", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: null }),
      });
      const d = await r.json();
      if (d.success) {
        setCurrentSlug(null);
        setNewSlug("");
        setSlugMessage("기본 주소로 되돌렸습니다");
        setTimeout(() => { router.push(`/${currentCode}/admin/settings`); }, 800);
      } else {
        setSlugError(d.error || "실패");
      }
    } finally {
      setSlugSaving(false);
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const activeUrl = currentSlug ? `${origin}/${currentSlug}` : `${origin}/${currentCode}`;
  const legacyUrl = currentSlug && currentCode ? `${origin}/${currentCode}` : null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[var(--foreground)]">설정</h1>

      {/* ── 사이트 주소 ── */}
      <div className="max-w-xl rounded-2xl border border-white/5 bg-[var(--card-bg)] p-5">
        <h2 className="mb-1 text-lg font-semibold text-[var(--foreground)]">사이트 주소</h2>
        <p className="mb-4 text-xs text-[var(--muted)]">
          명함·SMS·SNS에 올릴 짧은 주소를 지정하세요. 기존 주소도 영구적으로 동작합니다.
        </p>

        <div className="mb-4 rounded-xl border border-white/10 bg-[var(--muted-bg)] p-3 text-sm">
          <p className="text-[var(--muted)] mb-1">현재 사용 중</p>
          <p className="font-mono text-[var(--foreground)]">{activeUrl}</p>
          {legacyUrl && (
            <>
              <p className="mt-2 text-[var(--muted)] mb-1">기본 주소 (항상 유효)</p>
              <p className="font-mono text-[var(--muted)] text-xs">{legacyUrl}</p>
            </>
          )}
        </div>

        <form onSubmit={handleSaveSlug} className="space-y-3">
          <label className="block text-sm font-medium text-[var(--foreground)]">
            {currentSlug ? "주소 변경" : "짧은 주소 지정"}
          </label>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[var(--muted-bg)] px-3">
            <span className="text-xs text-[var(--muted)]">ai.on1.kr/</span>
            <input
              type="text"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder={currentSlug || "jinkyun"}
              maxLength={30}
              className="flex-1 bg-transparent py-2.5 text-sm text-[var(--foreground)] outline-none"
            />
            {newSlug.length >= 3 && (
              <span className={`text-xs ${
                slugChecking ? "text-[var(--muted)]" :
                slugAvailable === true ? "text-green-400" :
                slugAvailable === false ? "text-red-400" : "text-[var(--muted)]"
              }`}>
                {slugChecking ? "확인 중…" : slugAvailable === true ? "사용 가능" : slugAvailable === false ? "불가" : ""}
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--muted)]">
            영소문자·숫자·하이픈(-), 3~30자. 변경 후 30일간 재변경 불가.
          </p>
          {slugAvailable === false && slugReason && (
            <p className="text-xs text-red-400">{slugReason}</p>
          )}
          {slugError && <p className="text-sm text-red-400">{slugError}</p>}
          {slugMessage && <p className="text-sm text-green-400">{slugMessage}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={slugSaving || slugAvailable !== true || !newSlug.trim() || newSlug.trim() === currentSlug}
              className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {slugSaving ? "저장 중…" : "저장"}
            </button>
            {currentSlug && (
              <button
                type="button"
                onClick={handleRemoveSlug}
                disabled={slugSaving}
                className="rounded-xl border border-white/10 bg-[var(--muted-bg)] px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
              >
                기본 주소로 복구
              </button>
            )}
          </div>
        </form>
      </div>

      {/* ── 비밀번호 변경 ── */}
      <div className="max-w-xl rounded-2xl border border-white/5 bg-[var(--card-bg)] p-5">
        <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)]">비밀번호 변경</h2>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <input
            type="password"
            placeholder="현재 비밀번호"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            className="w-full rounded-xl border border-white/10 bg-[var(--muted-bg)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none focus:border-accent/50"
          />
          <input
            type="password"
            placeholder="새 비밀번호 (8자 이상)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            className="w-full rounded-xl border border-white/10 bg-[var(--muted-bg)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none focus:border-accent/50"
          />
          {pwError && <p className="text-sm text-red-400">{pwError}</p>}
          {pwMessage && <p className="text-sm text-green-400">{pwMessage}</p>}
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
