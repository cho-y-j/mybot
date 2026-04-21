"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter, useParams } from "next/navigation";
import { IconifyIcon } from "@/components/ui/iconify-icon";

/* ─── Tab definitions ─── */
/* 자주 업데이트하는 항목을 앞에, 초기 설정은 뒤에 배치 */
const TABS = [
  { key: "schedule", label: "일정", icon: "solar:calendar-bold", group: "daily" },
  { key: "photos", label: "사진첩", icon: "solar:gallery-bold", group: "daily" },
  { key: "articles", label: "기사", icon: "solar:document-text-bold", group: "daily" },
  { key: "videos", label: "영상", icon: "solar:play-circle-bold", group: "daily" },
  { key: "pledges", label: "공약", icon: "solar:clipboard-list-bold", group: "core" },
  { key: "profile", label: "프로필", icon: "solar:user-bold", group: "core" },
  { key: "donation", label: "후원", icon: "solar:hand-money-bold", group: "core" },
  { key: "contacts", label: "연락처", icon: "solar:phone-bold", group: "core" },
  { key: "settings", label: "기본설정", icon: "solar:settings-bold", group: "setup" },
  { key: "qrcode", label: "QR코드", icon: "solar:qr-code-bold", group: "setup" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/* ─── Shared styles ─── */
const inputClass =
  "w-full rounded-xl border border-white/10 bg-[var(--card-bg)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-accent/50 focus:ring-1 focus:ring-accent/50";
const labelClass = "mb-1.5 block text-sm font-medium text-[var(--muted)]";
const btnPrimary =
  "rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-zinc-950 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50";
const btnSecondary =
  "rounded-xl border border-white/10 bg-[var(--card-bg)] px-4 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--muted-bg)]";

/* ─── 이미지 업로드 컴포넌트 ─── */
function ImageUploadField({
  label, description, value, onChange, uploadType, previewClass,
}: {
  label: string; description: string; value: string;
  onChange: (url: string) => void; uploadType: string; previewClass: string;
}) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/upload/${uploadType}`, { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) {
        onChange(data.data.url);
      } else {
        alert(data.error || "업로드 실패");
      }
    } catch {
      alert("업로드에 실패했습니다");
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div>
      <label className={labelClass}>{label}</label>
      <div className="flex gap-2">
        <input
          className={`${inputClass} flex-1`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="URL 직접 입력 또는 아래 버튼으로 업로드"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="shrink-0 rounded-xl bg-[var(--muted-bg)] px-4 py-2.5 text-sm text-[var(--foreground)] hover:bg-[var(--muted-bg)] disabled:opacity-50"
        >
          {uploading ? "업로드 중..." : "파일 선택"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      </div>
      <p className="mt-1 text-xs text-[var(--muted)]">{description}</p>
      {value && (
        <div className="mt-2 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt={label} className={previewClass}
            onError={e => (e.target as HTMLImageElement).style.display = "none"} />
          <button type="button" onClick={() => onChange("")}
            className="text-xs text-red-400 hover:text-red-300">제거</button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Main content page
   ═══════════════════════════════════════════════ */
export default function ContentPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = params.code as string;

  const activeTab = (searchParams.get("tab") as TabKey) || "schedule";

  function setTab(tab: TabKey) {
    router.push(`/${code}/admin/content?tab=${tab}`);
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--foreground)]">콘텐츠 관리</h1>

      {/* Tabs — 그룹별 구분 */}
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-2xl border border-white/5 bg-[var(--background)]/50 p-1.5">
        {TABS.map((tab, i) => (
          <div key={tab.key} className="flex items-center">
            {i > 0 && TABS[i - 1].group !== tab.group && (
              <div className="mx-1 h-6 w-px bg-white/10" />
            )}
            <button
              onClick={() => setTab(tab.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm transition-all ${
                activeTab === tab.key
                  ? "bg-accent/10 font-medium text-accent"
                  : "text-[var(--muted)] hover:bg-white/5 hover:text-[var(--foreground)]"
              }`}
            >
              <IconifyIcon icon={tab.icon} width="16" height="16" />
              {tab.label}
            </button>
          </div>
        ))}
      </div>

      {/* Tab content */}
      <div className="rounded-2xl border border-white/5 bg-[var(--background)]/50 p-5">
        {activeTab === "settings" && <SettingsTab />}
        {activeTab === "profile" && <ProfileTab />}
        {activeTab === "pledges" && <PledgesTab />}
        {activeTab === "donation" && <DonationTab />}
        {activeTab === "contacts" && <ContactsTab />}
        {activeTab === "photos" && <GalleryTab />}
        {activeTab === "schedule" && <ScheduleTab />}
        {activeTab === "articles" && <NewsTab />}
        {activeTab === "videos" && <VideosTab />}
        {activeTab === "qrcode" && <PlaceholderTab label="QR코드" />}
      </div>
    </div>
  );
}

/* ─── Placeholder ─── */
function PlaceholderTab({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-[var(--muted)]">
      <IconifyIcon icon="solar:inbox-bold" width="48" height="48" />
      <p className="mt-4 text-lg font-medium">{label} 관리</p>
      <p className="mt-1 text-sm">준비 중입니다</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Settings Tab
   ═══════════════════════════════════════════════ */
interface SiteSettings {
  heroSlogan?: string;
  heroSubSlogan?: string;
  heroImageUrl?: string;
  profileImageUrl?: string;
  partyName?: string;
  positionTitle?: string;
  subtitle?: string;
  introText?: string;
  primaryColor?: string;
  accentColor?: string;
  electionName?: string;
  electionDate?: string;
}

function SettingsTab() {
  const [form, setForm] = useState<SiteSettings>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/site/settings")
      .then((r) => r.json())
      .then((r) => {
        if (r.success && r.data) setForm(r.data);
      });
  }, []);

  function update(key: keyof SiteSettings, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const res = await fetch("/api/site/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        setMessage("저장되었습니다");
      } else {
        setError(data.error);
      }
    } catch {
      setError("저장에 실패했습니다");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="max-w-2xl space-y-5">
      <h2 className="text-lg font-semibold text-[var(--foreground)]">사이트 기본설정</h2>

      {/* 이미지 설정 */}
      <div className="rounded-xl border border-white/10 bg-[var(--card-bg)]/30 p-4 space-y-5">
        <p className="text-sm font-medium text-[var(--foreground)]">이미지 설정</p>

        {/* 히어로 배경 이미지 */}
        <ImageUploadField
          label="히어로 배경 이미지"
          description="메인 상단 배경 이미지. 비워두면 정당 컬러 그라데이션으로 표시됩니다."
          value={form.heroImageUrl ?? ""}
          onChange={(url) => update("heroImageUrl", url)}
          uploadType="hero"
          previewClass="h-20 rounded-lg object-cover"
        />

        {/* 후보 소개 프로필 사진 */}
        <ImageUploadField
          label="후보 소개 프로필 사진"
          description="후보 소개 섹션에 표시되는 인물 사진. 비워두면 텍스트만 표시됩니다."
          value={form.profileImageUrl ?? ""}
          onChange={(url) => update("profileImageUrl", url)}
          uploadType="image"
          previewClass="h-20 w-20 rounded-full object-cover"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>히어로 슬로건</label>
          <input
            className={inputClass}
            value={form.heroSlogan ?? ""}
            onChange={(e) => update("heroSlogan", e.target.value)}
            placeholder="변화를 만드는 힘"
          />
        </div>
        <div>
          <label className={labelClass}>서브 슬로건</label>
          <input
            className={inputClass}
            value={form.heroSubSlogan ?? ""}
            onChange={(e) => update("heroSubSlogan", e.target.value)}
            placeholder="함께하는 미래"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>정당명</label>
          <input
            className={inputClass}
            value={form.partyName ?? ""}
            onChange={(e) => update("partyName", e.target.value)}
            placeholder="소속 정당"
          />
        </div>
        <div>
          <label className={labelClass}>직위</label>
          <input
            className={inputClass}
            value={form.positionTitle ?? ""}
            onChange={(e) => update("positionTitle", e.target.value)}
            placeholder="국회의원 후보"
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>부제목</label>
        <input
          className={inputClass}
          value={form.subtitle ?? ""}
          onChange={(e) => update("subtitle", e.target.value)}
          placeholder="○○시 ○○구"
        />
      </div>

      <div>
        <label className={labelClass}>소개 텍스트</label>
        <textarea
          className={`${inputClass} min-h-[120px] resize-y`}
          value={form.introText ?? ""}
          onChange={(e) => update("introText", e.target.value)}
          placeholder="후보자 소개 메시지를 입력하세요"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>선거명</label>
          <input
            className={inputClass}
            value={form.electionName ?? "제22대 전국동시지방선거"}
            onChange={(e) => update("electionName", e.target.value)}
            placeholder="제22대 전국동시지방선거"
          />
        </div>
        <div>
          <label className={labelClass}>선거일</label>
          <input
            type="date"
            className={inputClass}
            value={form.electionDate ?? "2026-06-03"}
            onChange={(e) => update("electionDate", e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>주 컬러</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={form.primaryColor ?? "#C9151E"}
              onChange={(e) => update("primaryColor", e.target.value)}
              className="h-10 w-10 cursor-pointer rounded-lg border border-white/10 bg-transparent"
            />
            <input
              className={inputClass}
              value={form.primaryColor ?? "#C9151E"}
              onChange={(e) => update("primaryColor", e.target.value)}
              placeholder="#C9151E"
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>보조 컬러</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={form.accentColor ?? "#1A56DB"}
              onChange={(e) => update("accentColor", e.target.value)}
              className="h-10 w-10 cursor-pointer rounded-lg border border-white/10 bg-transparent"
            />
            <input
              className={inputClass}
              value={form.accentColor ?? "#1A56DB"}
              onChange={(e) => update("accentColor", e.target.value)}
              placeholder="#1A56DB"
            />
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {message && <p className="text-sm text-green-400">{message}</p>}

      <button type="submit" disabled={saving} className={btnPrimary}>
        {saving ? "저장 중..." : "저장"}
      </button>
    </form>
  );
}

/* ═══════════════════════════════════════════════
   Profile Tab (education / career)
   ═══════════════════════════════════════════════ */
interface Profile {
  id: number;
  type: "education" | "career";
  title: string;
  isCurrent: boolean;
}

function ProfileTab() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState<"education" | "career">("education");
  const [newTitle, setNewTitle] = useState("");
  const [newIsCurrent, setNewIsCurrent] = useState(false);

  const load = useCallback(() => {
    fetch("/api/site/profiles")
      .then((r) => r.json())
      .then((r) => r.success && setProfiles(r.data));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!newTitle.trim()) return;
    const res = await fetch("/api/site/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: newType, title: newTitle, isCurrent: newIsCurrent }),
    });
    const data = await res.json();
    if (data.success) {
      setNewTitle("");
      setNewIsCurrent(false);
      setAdding(false);
      load();
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("삭제하시겠습니까?")) return;
    const res = await fetch(`/api/site/profiles/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) load();
  }

  async function handleUpdate() {
    if (!editing) return;
    const res = await fetch(`/api/site/profiles/${editing.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: editing.type, title: editing.title, isCurrent: editing.isCurrent }),
    });
    const data = await res.json();
    if (data.success) {
      setEditing(null);
      load();
    }
  }

  const educationItems = profiles.filter((p) => p.type === "education");
  const careerItems = profiles.filter((p) => p.type === "career");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">프로필 관리</h2>
        <button onClick={() => setAdding(true)} className={btnPrimary}>
          <span className="flex items-center gap-1.5">
            <IconifyIcon icon="solar:add-circle-bold" width="16" height="16" />
            추가
          </span>
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <div className="rounded-xl border border-white/10 bg-[var(--card-bg)]/50 p-4 space-y-3">
          <div className="flex gap-3">
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as "education" | "career")}
              className={`${inputClass} max-w-[140px]`}
            >
              <option value="education">학력</option>
              <option value="career">경력</option>
            </select>
            <input
              className={inputClass}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="내용을 입력하세요"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <input
              type="checkbox"
              checked={newIsCurrent}
              onChange={(e) => setNewIsCurrent(e.target.checked)}
              className="rounded border-white/10"
            />
            현재 진행 중
          </label>
          <div className="flex gap-2">
            <button onClick={handleAdd} className={btnPrimary}>저장</button>
            <button onClick={() => setAdding(false)} className={btnSecondary}>취소</button>
          </div>
        </div>
      )}

      {/* Edit modal inline */}
      {editing && (
        <div className="rounded-xl border border-accent/20 bg-[var(--card-bg)]/50 p-4 space-y-3">
          <p className="text-sm font-medium text-[var(--foreground)]">수정</p>
          <div className="flex gap-3">
            <select
              value={editing.type}
              onChange={(e) => setEditing({ ...editing, type: e.target.value as "education" | "career" })}
              className={`${inputClass} max-w-[140px]`}
            >
              <option value="education">학력</option>
              <option value="career">경력</option>
            </select>
            <input
              className={inputClass}
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <input
              type="checkbox"
              checked={editing.isCurrent}
              onChange={(e) => setEditing({ ...editing, isCurrent: e.target.checked })}
              className="rounded border-white/10"
            />
            현재 진행 중
          </label>
          <div className="flex gap-2">
            <button onClick={handleUpdate} className={btnPrimary}>저장</button>
            <button onClick={() => setEditing(null)} className={btnSecondary}>취소</button>
          </div>
        </div>
      )}

      {/* Education list */}
      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
          <IconifyIcon icon="solar:square-academic-cap-bold" width="18" height="18" />
          학력
        </h3>
        {educationItems.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">등록된 학력이 없습니다</p>
        ) : (
          <div className="space-y-2">
            {educationItems.map((item) => (
              <ProfileRow key={item.id} item={item} onEdit={setEditing} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      {/* Career list */}
      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
          <IconifyIcon icon="solar:case-bold" width="18" height="18" />
          경력
        </h3>
        {careerItems.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">등록된 경력이 없습니다</p>
        ) : (
          <div className="space-y-2">
            {careerItems.map((item) => (
              <ProfileRow key={item.id} item={item} onEdit={setEditing} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileRow({
  item,
  onEdit,
  onDelete,
}: {
  item: Profile;
  onEdit: (p: Profile) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/5 bg-[var(--card-bg)]/30 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-[var(--foreground)]">{item.title}</span>
        {item.isCurrent && (
          <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-400">
            현재
          </span>
        )}
      </div>
      <div className="flex gap-1.5">
        <button
          onClick={() => onEdit(item)}
          className="rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:bg-white/5 hover:text-[var(--foreground)]"
        >
          <IconifyIcon icon="solar:pen-bold" width="16" height="16" />
        </button>
        <button
          onClick={() => onDelete(item.id)}
          className="rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:bg-red-500/10 hover:text-red-400"
        >
          <IconifyIcon icon="solar:trash-bin-trash-bold" width="16" height="16" />
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Pledges Tab
   ═══════════════════════════════════════════════ */
interface Pledge {
  id: number;
  title: string;
  description?: string;
  details?: string[];
  category?: string;
  sortOrder: number;
}

function PledgesTab() {
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Pledge | null>(null);
  const [form, setForm] = useState({ title: "", description: "", category: "", details: "" });

  const load = useCallback(() => {
    fetch("/api/site/pledges")
      .then((r) => r.json())
      .then((r) => r.success && setPledges(r.data));
  }, []);

  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setForm({ title: "", description: "", category: "", details: "" });
    setAdding(false);
    setEditing(null);
  }

  async function handleAdd() {
    if (!form.title.trim()) return;
    const detailsArr = form.details.split("\n").map((s) => s.trim()).filter(Boolean);
    const res = await fetch("/api/site/pledges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, details: detailsArr }),
    });
    const data = await res.json();
    if (data.success) { resetForm(); load(); }
  }

  async function handleUpdate() {
    if (!editing) return;
    const detailsArr = form.details.split("\n").map((s) => s.trim()).filter(Boolean);
    const res = await fetch(`/api/site/pledges/${editing.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, details: detailsArr }),
    });
    const data = await res.json();
    if (data.success) { resetForm(); load(); }
  }

  async function handleDelete(id: number) {
    if (!confirm("삭제하시겠습니까?")) return;
    const res = await fetch(`/api/site/pledges/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) load();
  }

  function startEdit(p: Pledge) {
    setEditing(p);
    const detailsStr = (p.details ?? []).join("\n");
    setForm({ title: p.title, description: p.description ?? "", category: p.category ?? "", details: detailsStr });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">공약 관리</h2>
        <button onClick={() => { resetForm(); setAdding(true); }} className={btnPrimary}>
          <span className="flex items-center gap-1.5">
            <IconifyIcon icon="solar:add-circle-bold" width="16" height="16" />
            추가
          </span>
        </button>
      </div>

      {/* Add / Edit form */}
      {(adding || editing) && (
        <div className="rounded-xl border border-white/10 bg-[var(--card-bg)]/50 p-4 space-y-3">
          <p className="text-sm font-medium text-[var(--foreground)]">{editing ? "공약 수정" : "공약 추가"}</p>
          <div>
            <label className={labelClass}>제목</label>
            <input
              className={inputClass}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="공약 제목"
            />
          </div>
          <div>
            <label className={labelClass}>카테고리</label>
            <input
              className={inputClass}
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="예: 경제, 교육, 복지"
            />
          </div>
          <div>
            <label className={labelClass}>설명</label>
            <textarea
              className={`${inputClass} min-h-[80px] resize-y`}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="공약 상세 설명"
            />
          </div>
          <div>
            <label className={labelClass}>세부 공약 (줄바꿈으로 구분)</label>
            <textarea
              className={`${inputClass} min-h-[100px] resize-y`}
              value={form.details}
              onChange={(e) => setForm({ ...form, details: e.target.value })}
              placeholder={"세부 항목 1\n세부 항목 2\n세부 항목 3"}
            />
            <p className="mt-1 text-xs text-[var(--muted)]">한 줄에 하나씩 입력하면 공개 사이트에서 목록으로 표시됩니다</p>
          </div>
          <div className="flex gap-2">
            <button onClick={editing ? handleUpdate : handleAdd} className={btnPrimary}>
              저장
            </button>
            <button onClick={resetForm} className={btnSecondary}>취소</button>
          </div>
        </div>
      )}

      {/* Pledges list */}
      {pledges.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted)]">등록된 공약이 없습니다</p>
      ) : (
        <div className="space-y-3">
          {pledges.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-white/5 bg-[var(--card-bg)]/30 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-[var(--foreground)]">{p.title}</h3>
                    {p.category && (
                      <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                        {p.category}
                      </span>
                    )}
                  </div>
                  {p.description && (
                    <p className="mt-1 text-sm text-[var(--muted)] line-clamp-2">{p.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => startEdit(p)}
                    className="rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:bg-white/5 hover:text-[var(--foreground)]"
                  >
                    <IconifyIcon icon="solar:pen-bold" width="16" height="16" />
                  </button>
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:bg-red-500/10 hover:text-red-400"
                  >
                    <IconifyIcon icon="solar:trash-bin-trash-bold" width="16" height="16" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Videos Tab
   ═══════════════════════════════════════════════ */
interface VideoItem { id: number; videoId: string; title?: string; sortOrder: number }

function VideosTab() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const dragIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const load = useCallback(() => {
    fetch("/api/site/videos").then(r => r.json()).then(r => r.success && setVideos(r.data));
  }, []);
  useEffect(() => { load(); }, [load]);

  function extractVideoId(input: string): string {
    const match = input.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : input.trim();
  }

  function resetForm() {
    setUrl(""); setTitle(""); setAdding(false); setEditingId(null);
  }

  async function handleAdd() {
    const videoId = extractVideoId(url);
    if (!videoId) return;
    await fetch("/api/site/videos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId, title: title || undefined }),
    });
    resetForm(); load();
  }

  async function handleUpdate() {
    if (editingId === null) return;
    const videoId = extractVideoId(url);
    if (!videoId) return;
    const res = await fetch(`/api/site/videos/${editingId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId, title: title || undefined }),
    });
    const data = await res.json();
    if (data.success) { resetForm(); load(); }
  }

  async function handleDelete(id: number) {
    if (!confirm("삭제하시겠습니까?")) return;
    await fetch(`/api/site/videos/${id}`, { method: "DELETE" }); load();
  }

  function startEdit(v: VideoItem) {
    setEditingId(v.id);
    setAdding(false);
    setUrl(v.videoId);
    setTitle(v.title ?? "");
  }

  async function handleDrop(targetIdx: number) {
    if (dragIdx.current === null || dragIdx.current === targetIdx) {
      dragIdx.current = null; setDragOverIdx(null); return;
    }
    const reordered = [...videos];
    const [moved] = reordered.splice(dragIdx.current, 1);
    reordered.splice(targetIdx, 0, moved);
    setVideos(reordered);
    dragIdx.current = null;
    setDragOverIdx(null);
    await fetch("/api/site/videos/reorder", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: reordered.map(v => v.id) }),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">영상 관리</h2>
        <button onClick={() => { resetForm(); setAdding(true); }} className={btnPrimary}>
          <span className="flex items-center gap-1.5"><IconifyIcon icon="solar:add-circle-bold" width="16" height="16" />추가</span>
        </button>
      </div>
      {(adding || editingId !== null) && (
        <div className="rounded-xl border border-white/10 bg-[var(--card-bg)]/50 p-4 space-y-3">
          <p className="text-sm font-medium text-[var(--foreground)]">{editingId !== null ? "영상 수정" : "영상 추가"}</p>
          <div><label className={labelClass}>YouTube URL 또는 영상 ID</label>
            <input className={inputClass} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." /></div>
          <div><label className={labelClass}>제목 (선택)</label>
            <input className={inputClass} value={title} onChange={e => setTitle(e.target.value)} placeholder="영상 제목" /></div>
          <div className="flex gap-2">
            <button onClick={editingId !== null ? handleUpdate : handleAdd} className={btnPrimary}>저장</button>
            <button onClick={resetForm} className={btnSecondary}>취소</button>
          </div>
        </div>
      )}
      {videos.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted)]">등록된 영상이 없습니다</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {videos.map((v, idx) => (
            <div key={v.id}
              draggable
              onDragStart={() => { dragIdx.current = idx; }}
              onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
              onDragLeave={() => setDragOverIdx(null)}
              onDrop={(e) => { e.preventDefault(); handleDrop(idx); }}
              onDragEnd={() => { dragIdx.current = null; setDragOverIdx(null); }}
              className={`rounded-xl border overflow-hidden transition-all ${
                dragOverIdx === idx ? "border-accent/50 ring-1 ring-accent/30" : "border-white/5"
              } ${dragIdx.current === idx ? "opacity-50" : ""} bg-[var(--card-bg)]/30`}
            >
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`} alt={v.title || ""} className="w-full aspect-video object-cover" />
                <div className="absolute top-1.5 left-1.5 cursor-grab active:cursor-grabbing rounded-lg bg-black/50 p-1 text-white/70 hover:text-white">
                  <span className="text-sm">&#9776;</span>
                </div>
              </div>
              <div className="flex items-center justify-between p-3">
                <span className="text-sm text-[var(--foreground)] truncate">{v.title || v.videoId}</span>
                <div className="flex gap-1.5">
                  <button onClick={() => startEdit(v)}
                    className="rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:bg-white/5 hover:text-[var(--foreground)]">
                    <IconifyIcon icon="solar:pen-bold" width="16" height="16" />
                  </button>
                  <button onClick={() => handleDelete(v.id)} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-red-500/10 hover:text-red-400">
                    <IconifyIcon icon="solar:trash-bin-trash-bold" width="16" height="16" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   News Tab
   ═══════════════════════════════════════════════ */
interface NewsItem { id: number; title: string; source?: string; url?: string; publishedDate?: string; sortOrder: number }

function NewsTab() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ title: "", source: "", url: "", publishedDate: "" });
  const dragIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const load = useCallback(() => {
    fetch("/api/site/news").then(r => r.json()).then(r => r.success && setNews(r.data));
  }, []);
  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setForm({ title: "", source: "", url: "", publishedDate: "" });
    setAdding(false);
    setEditingId(null);
  }

  async function handleAdd() {
    if (!form.title.trim()) return;
    await fetch("/api/site/news", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, publishedDate: form.publishedDate || undefined }),
    });
    resetForm(); load();
  }

  async function handleUpdate() {
    if (editingId === null) return;
    const res = await fetch(`/api/site/news/${editingId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, publishedDate: form.publishedDate || undefined }),
    });
    const data = await res.json();
    if (data.success) { resetForm(); load(); }
  }

  async function handleDelete(id: number) {
    if (!confirm("삭제하시겠습니까?")) return;
    await fetch(`/api/site/news/${id}`, { method: "DELETE" }); load();
  }

  function startEdit(n: NewsItem) {
    setEditingId(n.id);
    setAdding(false);
    const dateStr = n.publishedDate ? new Date(n.publishedDate).toISOString().split("T")[0] : "";
    setForm({ title: n.title, source: n.source ?? "", url: n.url ?? "", publishedDate: dateStr });
  }

  async function handleDrop(targetIdx: number) {
    if (dragIdx.current === null || dragIdx.current === targetIdx) {
      dragIdx.current = null; setDragOverIdx(null); return;
    }
    const reordered = [...news];
    const [moved] = reordered.splice(dragIdx.current, 1);
    reordered.splice(targetIdx, 0, moved);
    setNews(reordered);
    dragIdx.current = null;
    setDragOverIdx(null);
    await fetch("/api/site/news/reorder", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: reordered.map(n => n.id) }),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">기사 관리</h2>
        <button onClick={() => { resetForm(); setAdding(true); }} className={btnPrimary}>
          <span className="flex items-center gap-1.5"><IconifyIcon icon="solar:add-circle-bold" width="16" height="16" />추가</span>
        </button>
      </div>
      {(adding || editingId !== null) && (
        <div className="rounded-xl border border-white/10 bg-[var(--card-bg)]/50 p-4 space-y-3">
          <p className="text-sm font-medium text-[var(--foreground)]">{editingId !== null ? "기사 수정" : "기사 추가"}</p>
          <div><label className={labelClass}>기사 제목</label>
            <input className={inputClass} value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="기사 제목" /></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className={labelClass}>매체명</label>
              <input className={inputClass} value={form.source} onChange={e => setForm({...form, source: e.target.value})} placeholder="서울경제" /></div>
            <div><label className={labelClass}>게시일</label>
              <input type="date" className={inputClass} value={form.publishedDate} onChange={e => setForm({...form, publishedDate: e.target.value})} /></div>
          </div>
          <div><label className={labelClass}>기사 URL</label>
            <input className={inputClass} value={form.url} onChange={e => setForm({...form, url: e.target.value})} placeholder="https://..." /></div>
          <div className="flex gap-2">
            <button onClick={editingId !== null ? handleUpdate : handleAdd} className={btnPrimary}>저장</button>
            <button onClick={resetForm} className={btnSecondary}>취소</button>
          </div>
        </div>
      )}
      {news.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted)]">등록된 기사가 없습니다</p>
      ) : (
        <div className="space-y-2">
          {news.map((n, idx) => (
            <div key={n.id}
              draggable
              onDragStart={() => { dragIdx.current = idx; }}
              onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
              onDragLeave={() => setDragOverIdx(null)}
              onDrop={(e) => { e.preventDefault(); handleDrop(idx); }}
              onDragEnd={() => { dragIdx.current = null; setDragOverIdx(null); }}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-all ${
                dragOverIdx === idx ? "border-accent/50 ring-1 ring-accent/30" : "border-white/5"
              } ${dragIdx.current === idx ? "opacity-50" : ""} bg-[var(--card-bg)]/30`}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="cursor-grab active:cursor-grabbing text-[var(--muted)] hover:text-[var(--foreground)]">&#9776;</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--foreground)] truncate">{n.title}</p>
                  <p className="text-xs text-[var(--muted)]">{n.source}{n.publishedDate ? ` · ${new Date(n.publishedDate).toLocaleDateString("ko-KR")}` : ""}</p>
                </div>
              </div>
              <div className="flex gap-1.5 ml-2">
                <button onClick={() => startEdit(n)}
                  className="rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:bg-white/5 hover:text-[var(--foreground)]">
                  <IconifyIcon icon="solar:pen-bold" width="16" height="16" />
                </button>
                <button onClick={() => handleDelete(n.id)} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-red-500/10 hover:text-red-400">
                  <IconifyIcon icon="solar:trash-bin-trash-bold" width="16" height="16" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Gallery Tab
   ═══════════════════════════════════════════════ */
interface GalleryItem { id: number; url: string; altText?: string; category: string; sortOrder: number }

function GalleryTab() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ url: "", altText: "", category: "campaign" });
  const [filterCat, setFilterCat] = useState("all");
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const galleryFileRef = useRef<HTMLInputElement>(null);
  const dragIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const load = useCallback(() => {
    fetch("/api/site/gallery").then(r => r.json()).then(r => r.success && setItems(r.data));
  }, []);
  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setForm({ url: "", altText: "", category: "campaign" });
    setPreviewUrl(null);
    setAdding(false);
    setEditingId(null);
  }

  async function handleAddPhoto() {
    if (!form.url.trim()) return;
    await fetch("/api/site/gallery", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    resetForm(); load();
  }

  async function handleUpdate() {
    if (editingId === null) return;
    const res = await fetch(`/api/site/gallery/${editingId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (data.success) { resetForm(); load(); }
  }

  async function handleDelete(id: number) {
    if (!confirm("삭제하시겠습니까?")) return;
    await fetch(`/api/site/gallery/${id}`, { method: "DELETE" }); load();
  }

  function startEdit(g: GalleryItem) {
    setEditingId(g.id);
    setAdding(false);
    setForm({ url: g.url, altText: g.altText ?? "", category: g.category });
    setPreviewUrl(null);
  }

  async function handleDrop(targetIdx: number) {
    if (dragIdx.current === null || dragIdx.current === targetIdx) {
      dragIdx.current = null; setDragOverIdx(null); return;
    }
    const reordered = [...filtered];
    const [moved] = reordered.splice(dragIdx.current, 1);
    reordered.splice(targetIdx, 0, moved);
    // Update local state: replace filtered items in the full items array
    if (filterCat === "all") {
      setItems(reordered);
    } else {
      const otherItems = items.filter(g => g.category !== filterCat);
      setItems([...reordered, ...otherItems]);
    }
    dragIdx.current = null;
    setDragOverIdx(null);
    // Send reorder for the full list if "all", or just the filtered category
    const idsToReorder = filterCat === "all" ? reordered.map(g => g.id) : reordered.map(g => g.id);
    await fetch("/api/site/gallery/reorder", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: idsToReorder }),
    });
  }

  const categories = ["all", ...Array.from(new Set(items.map(g => g.category)))];
  const filtered = filterCat === "all" ? items : items.filter(g => g.category === filterCat);
  const catLabels: Record<string, string> = {
    all: "전체", campaign: "선거운동", activity: "의정활동",
    local: "지역활동", event: "행사", media: "언론보도",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">사진첩 관리</h2>
        <button onClick={() => { resetForm(); setAdding(true); }} className={btnPrimary}>
          <span className="flex items-center gap-1.5"><IconifyIcon icon="solar:add-circle-bold" width="16" height="16" />추가</span>
        </button>
      </div>

      {/* 추가 / 수정 폼 */}
      {(adding || editingId !== null) && (
        <div className="rounded-xl border border-white/10 bg-[var(--card-bg)]/50 p-4 space-y-4">
          <p className="text-sm font-medium text-[var(--foreground)]">{editingId !== null ? "사진 수정" : "사진 추가"}</p>
          <div className="space-y-3">
            {/* 이미지 업로드 */}
            <div>
              <label className={labelClass}>사진 업로드</label>
              <input
                ref={galleryFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setPreviewUrl(URL.createObjectURL(file));
                  setUploading(true);
                  const fd = new FormData();
                  fd.append("file", file);
                  const res = await fetch("/api/upload/image", { method: "POST", body: fd });
                  const json = await res.json();
                  setUploading(false);
                  if (json.success) {
                    setForm((prev) => ({ ...prev, url: json.data.url }));
                  } else {
                    alert(json.error || "업로드 실패");
                  }
                  if (galleryFileRef.current) galleryFileRef.current.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => galleryFileRef.current?.click()}
                disabled={uploading}
                className={`${btnSecondary} w-full flex items-center justify-center gap-2`}
              >
                <IconifyIcon icon="solar:gallery-add-bold" width="18" height="18" />
                {uploading ? "업로드 중..." : "이미지 선택"}
              </button>
            </div>
            {/* 미리보기 */}
            {(previewUrl || form.url) && (
              <div className="rounded-lg border border-white/5 p-2">
                <p className="mb-1 text-xs text-[var(--muted)]">미리보기</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl || form.url} alt="미리보기" className="max-h-40 rounded-lg object-cover" />
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><label className={labelClass}>설명</label>
                <input className={inputClass} value={form.altText} onChange={e => setForm({...form, altText: e.target.value})} placeholder="사진 설명" /></div>
              <div><label className={labelClass}>카테고리</label>
                <select className={inputClass} value={form.category} onChange={e => setForm({...form, category: e.target.value})}>
                  <option value="campaign">선거운동</option><option value="activity">의정활동</option>
                  <option value="local">지역활동</option><option value="event">행사</option>
                  <option value="media">언론보도</option>
                </select></div>
            </div>
            <div className="flex gap-2">
              <button onClick={editingId !== null ? handleUpdate : handleAddPhoto} disabled={!form.url} className={btnPrimary}>저장</button>
              <button onClick={resetForm} className={btnSecondary}>취소</button>
            </div>
          </div>
        </div>
      )}

      {/* 카테고리 필터 */}
      {items.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto">
          {categories.map(cat => (
            <button key={cat} onClick={() => setFilterCat(cat)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors ${filterCat === cat ? "bg-accent/10 text-accent font-medium" : "bg-[var(--card-bg)] text-[var(--muted)] hover:bg-[var(--muted-bg)]"}`}>
              {catLabels[cat] || cat} ({cat === "all" ? items.length : items.filter(g => g.category === cat).length})
            </button>
          ))}
        </div>
      )}

      {/* 사진 그리드 */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-[var(--muted)]">
          <IconifyIcon icon="solar:gallery-bold" width="48" height="48" />
          <p className="mt-4 text-sm">등록된 사진이 없습니다</p>
          <p className="mt-1 text-xs text-[var(--muted)]">이미지를 업로드하여 추가해보세요</p>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((g, idx) => (
            <div key={g.id}
              draggable
              onDragStart={() => { dragIdx.current = idx; }}
              onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
              onDragLeave={() => setDragOverIdx(null)}
              onDrop={(e) => { e.preventDefault(); handleDrop(idx); }}
              onDragEnd={() => { dragIdx.current = null; setDragOverIdx(null); }}
              className={`group relative rounded-xl overflow-hidden border transition-all ${
                dragOverIdx === idx ? "border-accent/50 ring-1 ring-accent/30" : "border-white/5"
              } ${dragIdx.current === idx ? "opacity-50" : ""}`}
            >
              {g.category === "blog" ? (
                /* 블로그 링크 카드 */
                <a href={g.url} target="_blank" rel="noopener noreferrer"
                  className="flex aspect-square flex-col items-center justify-center gap-2 bg-[var(--card-bg)] hover:bg-zinc-750 transition-colors">
                  <IconifyIcon icon="solar:link-bold" width="32" height="32" />
                  <span className="px-2 text-center text-xs text-[var(--foreground)] line-clamp-2">{g.altText || "블로그 게시글"}</span>
                  <span className="text-[10px] text-[var(--muted)] truncate max-w-[90%]">{g.url.replace(/https?:\/\//, "").split("/")[0]}</span>
                </a>
              ) : (
                /* 이미지 카드 */
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={g.url} alt={g.altText || ""} className="w-full aspect-square object-cover" loading="lazy" />
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                    <span className="text-[10px] text-white/80">{catLabels[g.category] || g.category}</span>
                  </div>
                </>
              )}
              {/* Drag handle */}
              <div className="absolute top-1.5 left-1.5 cursor-grab active:cursor-grabbing rounded-lg bg-black/50 p-1 text-white/70 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-sm">&#9776;</span>
              </div>
              {/* Action buttons */}
              <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => startEdit(g)}
                  className="rounded-full bg-[var(--background)]/90 p-1.5 text-white shadow-lg hover:bg-[var(--muted-bg)]">
                  <IconifyIcon icon="solar:pen-bold" width="14" height="14" />
                </button>
                <button onClick={() => handleDelete(g.id)}
                  className="rounded-full bg-red-500/90 p-1.5 text-white shadow-lg hover:bg-red-600">
                  <IconifyIcon icon="solar:trash-bin-trash-bold" width="14" height="14" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Schedule Tab
   ═══════════════════════════════════════════════ */
interface ScheduleItem { id: number; title: string; date: string; time?: string; location?: string }

function ScheduleTab() {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ title: "", date: "", time: "", location: "" });

  const load = useCallback(() => {
    fetch("/api/site/schedules").then(r => r.json()).then(r => r.success && setItems(r.data));
  }, []);
  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setForm({ title: "", date: "", time: "", location: "" });
    setAdding(false);
    setEditingId(null);
  }

  async function handleAdd() {
    if (!form.title.trim() || !form.date) return;
    await fetch("/api/site/schedules", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    resetForm(); load();
  }

  async function handleUpdate() {
    if (editingId === null) return;
    const res = await fetch(`/api/site/schedules/${editingId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (data.success) { resetForm(); load(); }
  }

  async function handleDelete(id: number) {
    if (!confirm("삭제하시겠습니까?")) return;
    await fetch(`/api/site/schedules/${id}`, { method: "DELETE" }); load();
  }

  function startEdit(s: ScheduleItem) {
    setEditingId(s.id);
    setAdding(false);
    const dateStr = s.date ? new Date(s.date).toISOString().split("T")[0] : "";
    setForm({ title: s.title, date: dateStr, time: s.time ?? "", location: s.location ?? "" });
  }

  return (
    <div className="space-y-6">
      {/* 2026-04-21: mybot 캘린더 통합 안내 */}
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-2">
        <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
          일정 관리가 mybot 대시보드로 통합됩니다
        </p>
        <p className="text-xs text-[var(--muted)]">
          <strong>새 일정·수정·반복 설정은 mybot 캘린더에서</strong> 입력해주세요. 한 줄 받아쓰기 · 카톡 복붙 · 음성 입력 · 자동 지오코딩 · 어제 회고가 모두 지원됩니다.
          <br />
          공개로 설정한 일정은 자동으로 이 홈페이지에 표시됩니다.
        </p>
        <a
          href="/dashboard/calendar"
          className="inline-flex items-center gap-1.5 mt-1 text-sm font-medium text-blue-500 hover:underline"
        >
          mybot 캘린더로 이동 →
        </a>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">
          일정 관리 <span className="text-xs text-[var(--muted)] font-normal">(legacy — 수동 입력)</span>
        </h2>
        <button onClick={() => { resetForm(); setAdding(true); }} className={btnPrimary}>
          <span className="flex items-center gap-1.5"><IconifyIcon icon="solar:add-circle-bold" width="16" height="16" />추가</span>
        </button>
      </div>
      {(adding || editingId !== null) && (
        <div className="rounded-xl border border-white/10 bg-[var(--card-bg)]/50 p-4 space-y-3">
          <p className="text-sm font-medium text-[var(--foreground)]">{editingId !== null ? "일정 수정" : "일정 추가"}</p>
          <div><label className={labelClass}>일정 제목</label>
            <input className={inputClass} value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="일정 제목" /></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><label className={labelClass}>날짜</label>
              <input type="date" className={inputClass} value={form.date} onChange={e => setForm({...form, date: e.target.value})} /></div>
            <div><label className={labelClass}>시간</label>
              <input className={inputClass} value={form.time} onChange={e => setForm({...form, time: e.target.value})} placeholder="14:00" /></div>
            <div><label className={labelClass}>장소</label>
              <input className={inputClass} value={form.location} onChange={e => setForm({...form, location: e.target.value})} placeholder="장소" /></div>
          </div>
          <div className="flex gap-2">
            <button onClick={editingId !== null ? handleUpdate : handleAdd} className={btnPrimary}>저장</button>
            <button onClick={resetForm} className={btnSecondary}>취소</button>
          </div>
        </div>
      )}
      {items.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted)]">등록된 일정이 없습니다</p>
      ) : (
        <div className="space-y-2">
          {items.map(s => (
            <div key={s.id} className="flex items-center justify-between rounded-xl border border-white/5 bg-[var(--card-bg)]/30 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">{s.title}</p>
                <p className="text-xs text-[var(--muted)]">
                  {new Date(s.date).toLocaleDateString("ko-KR")}{s.time ? ` ${s.time}` : ""}{s.location ? ` · ${s.location}` : ""}
                </p>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => startEdit(s)}
                  className="rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:bg-white/5 hover:text-[var(--foreground)]">
                  <IconifyIcon icon="solar:pen-bold" width="16" height="16" />
                </button>
                <button onClick={() => handleDelete(s.id)} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-red-500/10 hover:text-red-400">
                  <IconifyIcon icon="solar:trash-bin-trash-bold" width="16" height="16" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Contacts Tab
   ═══════════════════════════════════════════════ */
interface Contact {
  id: number;
  type: string;
  label?: string;
  value: string;
  sortOrder: number;
}

const CONTACT_TYPES = [
  { value: "phone", label: "전화" },
  { value: "email", label: "이메일" },
  { value: "address", label: "주소" },
  { value: "website", label: "웹사이트" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "youtube", label: "YouTube" },
  { value: "blog", label: "블로그" },
  { value: "kakao", label: "카카오톡" },
  { value: "other", label: "기타" },
];

/* ─── 후원 탭 ─── */
function DonationTab() {
  const [block, setBlock] = useState<{ id: number; content: { imageUrl?: string; description?: string } | null } | null>(null);
  const [form, setForm] = useState({ imageUrl: "", description: "" });
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/site/blocks").then(r => r.json()).then(r => {
      if (r.success && r.data) {
        const donationBlock = r.data.find((b: { type: string }) => b.type === "donation");
        if (donationBlock) {
          setBlock(donationBlock);
          const c = donationBlock.content || {};
          setForm({ imageUrl: c.imageUrl || "", description: c.description || "" });
        }
      }
    });
  }, []);

  async function createBlock() {
    const res = await fetch("/api/site/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "donation", content: form }),
    });
    const data = await res.json();
    if (data.success) {
      setBlock(data.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  async function save() {
    if (!block) {
      await createBlock();
      return;
    }
    const res = await fetch(`/api/site/blocks/${block.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: form }),
    });
    const data = await res.json();
    if (data.success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">후원 안내</h2>
        <button onClick={save} className={btnPrimary}>
          {saved ? "저장됨 ✓" : "저장"}
        </button>
      </div>

      <div>
        <label className={labelClass}>후원 이미지 (계좌번호 등)</label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          disabled={uploading}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setPreviewUrl(URL.createObjectURL(file));
            setUploading(true);
            const fd = new FormData();
            fd.append("file", file);
            const res = await fetch("/api/upload/image", { method: "POST", body: fd });
            const json = await res.json();
            setUploading(false);
            if (json.success) {
              setForm((prev) => ({ ...prev, imageUrl: json.data.url }));
            } else {
              alert(json.error || "업로드 실패");
            }
            if (fileRef.current) fileRef.current.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className={`${btnSecondary} flex items-center gap-2`}
        >
          <IconifyIcon icon="solar:gallery-add-bold" width="18" height="18" />
          {uploading ? "업로드 중..." : "이미지 선택"}
        </button>
        {(previewUrl || form.imageUrl) && (
          <div className="mt-3 rounded-xl border border-white/5 p-2">
            <p className="mb-1 text-xs text-[var(--muted)]">미리보기</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl || form.imageUrl} alt="후원 이미지" className="max-h-80 rounded-lg" />
          </div>
        )}
      </div>

      <div>
        <label className={labelClass}>안내 설명 (선택)</label>
        <textarea
          className={`${inputClass} min-h-[100px] resize-y`}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="후원 안내 문구를 입력하세요"
        />
      </div>
    </div>
  );
}

function ContactsTab() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [form, setForm] = useState({ type: "phone", label: "", value: "" });

  const load = useCallback(() => {
    fetch("/api/site/contacts")
      .then((r) => r.json())
      .then((r) => r.success && setContacts(r.data));
  }, []);

  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setForm({ type: "phone", label: "", value: "" });
    setAdding(false);
    setEditing(null);
  }

  async function handleAdd() {
    if (!form.value.trim()) return;
    const res = await fetch("/api/site/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (data.success) { resetForm(); load(); }
  }

  async function handleUpdate() {
    if (!editing) return;
    const res = await fetch(`/api/site/contacts/${editing.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (data.success) { resetForm(); load(); }
  }

  async function handleDelete(id: number) {
    if (!confirm("삭제하시겠습니까?")) return;
    const res = await fetch(`/api/site/contacts/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) load();
  }

  function startEdit(c: Contact) {
    setEditing(c);
    setForm({ type: c.type, label: c.label ?? "", value: c.value });
  }

  function getTypeLabel(type: string) {
    return CONTACT_TYPES.find((t) => t.value === type)?.label ?? type;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">연락처 관리</h2>
        <button onClick={() => { resetForm(); setAdding(true); }} className={btnPrimary}>
          <span className="flex items-center gap-1.5">
            <IconifyIcon icon="solar:add-circle-bold" width="16" height="16" />
            추가
          </span>
        </button>
      </div>

      {/* Add / Edit form */}
      {(adding || editing) && (
        <div className="rounded-xl border border-white/10 bg-[var(--card-bg)]/50 p-4 space-y-3">
          <p className="text-sm font-medium text-[var(--foreground)]">{editing ? "연락처 수정" : "연락처 추가"}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>유형</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className={inputClass}
              >
                {CONTACT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>표시 이름 (선택)</label>
              <input
                className={inputClass}
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="선거사무소"
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>값</label>
            <input
              className={inputClass}
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              placeholder="010-1234-5678"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={editing ? handleUpdate : handleAdd} className={btnPrimary}>
              저장
            </button>
            <button onClick={resetForm} className={btnSecondary}>취소</button>
          </div>
        </div>
      )}

      {/* Contacts list */}
      {contacts.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted)]">등록된 연락처가 없습니다</p>
      ) : (
        <div className="space-y-2">
          {contacts.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-xl border border-white/5 bg-[var(--card-bg)]/30 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="rounded-lg bg-[var(--muted-bg)]/50 px-2 py-1 text-xs font-medium text-[var(--foreground)]">
                  {getTypeLabel(c.type)}
                </span>
                <div>
                  {c.label && <span className="mr-2 text-sm text-[var(--muted)]">{c.label}</span>}
                  <span className="text-sm text-[var(--foreground)]">{c.value}</span>
                </div>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => startEdit(c)}
                  className="rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:bg-white/5 hover:text-[var(--foreground)]"
                >
                  <IconifyIcon icon="solar:pen-bold" width="16" height="16" />
                </button>
                <button
                  onClick={() => handleDelete(c.id)}
                  className="rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:bg-red-500/10 hover:text-red-400"
                >
                  <IconifyIcon icon="solar:trash-bin-trash-bold" width="16" height="16" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
