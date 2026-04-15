/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";

/* ─── Types ─── */
interface Block {
  id: number;
  type: string;
  title: string | null;
  content: unknown;
  visible: boolean;
  sortOrder: number;
}

interface ProfileItem {
  id?: number;
  type: string;
  title: string;
  isCurrent: boolean;
  sortOrder?: number;
}

interface PledgeItem {
  id?: number;
  icon: string;
  title: string;
  description: string | null;
  details: string[] | { items: string[]; imageUrl?: string };
  sortOrder?: number;
}

interface GalleryItem {
  id?: number;
  url: string;
  altText: string | null;
  category: string;
  sortOrder?: number;
}

interface ScheduleItem {
  id?: number;
  title: string;
  date: string;
  time: string | null;
  location: string | null;
}

interface NewsItem {
  id?: number;
  title: string;
  source: string | null;
  url: string | null;
  imageUrl?: string | null;
  publishedDate: string | null;
  sortOrder?: number;
}

interface VideoItem {
  id?: number;
  videoId: string;
  title: string | null;
  sortOrder?: number;
}

interface ContactItem {
  id?: number;
  type: string;
  label: string | null;
  value: string;
  url: string | null;
  sortOrder?: number;
}

interface LinkItem {
  title: string;
  url: string;
  description: string;
}

interface SiteSettings {
  heroImageUrl?: string;
  profileImageUrl?: string;
  heroSlogan?: string;
  heroSubSlogan?: string;
  introText?: string;
  subtitle?: string;
  partyName?: string;
  positionTitle?: string;
  primaryColor?: string;
  accentColor?: string;
  electionDate?: string;
  electionName?: string;
  kakaoAppKey?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImageUrl?: string;
}

/* ─── Constants ─── */
const BLOCK_TYPES: Record<string, { label: string; icon: string; defaultTitle: string }> = {
  hero: { label: "메인 배너", icon: "🖼", defaultTitle: "" },
  intro: { label: "후보 소개", icon: "📝", defaultTitle: "후보 소개" },
  career: { label: "학력/경력", icon: "📋", defaultTitle: "학력·경력" },
  goals: { label: "핵심 공약", icon: "🎯", defaultTitle: "핵심 공약" },
  gallery: { label: "활동 사진", icon: "📸", defaultTitle: "활동 사진" },
  schedule: { label: "선거 일정", icon: "📅", defaultTitle: "선거 일정" },
  news: { label: "보도자료", icon: "📰", defaultTitle: "보도자료" },
  videos: { label: "홍보 영상", icon: "🎬", defaultTitle: "홍보 영상" },
  donation: { label: "후원 안내", icon: "💝", defaultTitle: "후원 안내" },
  contacts: { label: "후원/연락", icon: "📞", defaultTitle: "후원·연락처" },
  links: { label: "관련 링크", icon: "🔗", defaultTitle: "관련 링크" },
};

const BLOCK_TYPE_KEYS = Object.keys(BLOCK_TYPES);

/* ─── Shared editor styles ─── */
const inputClass =
  "w-full rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 placeholder:text-zinc-600";
const labelClass =
  "mb-1 block text-xs font-medium text-zinc-400 uppercase tracking-wider";
const btnPrimary =
  "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-blue-500 active:scale-[0.98] disabled:opacity-50";
const btnSecondary =
  "rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-700";

/* ─── Helper: API fetch with JSON ─── */
async function apiFetch<T = unknown>(
  url: string,
  options?: RequestInit
): Promise<{ success: boolean; data?: T; error?: string }> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  return res.json();
}

/* ─── Date helpers ─── */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const weekday = weekdays[d.getDay()];
  return `${month}월 ${day}일 (${weekday})`;
}

function formatNewsDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function isPast(dateStr: string): boolean {
  const d = new Date(dateStr);
  d.setHours(23, 59, 59, 999);
  return d < new Date();
}

function formatDDay(d: number): string {
  if (d > 0) return `D-${d}`;
  if (d === 0) return "D-Day";
  return `D+${Math.abs(d)}`;
}

function calcDDay(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/* ═══════════════════════════════════════════════
   Main Builder Page
   ═══════════════════════════════════════════════ */
export default function BuilderPage() {
  const params = useParams();
  const router = useRouter();
  const code = params.code as string;

  /* ─── State ─── */
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [settings, setSettings] = useState<SiteSettings>({});
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [pledges, setPledges] = useState<PledgeItem[]>([]);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [siteName, setSiteName] = useState("");
  const [loading, setLoading] = useState(true);
  const [editingBlockType, setEditingBlockType] = useState<string | null>(null);
  const [hoveredBlock, setHoveredBlock] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [showSiteInfo, setShowSiteInfo] = useState(false);

  /* ─── Auth check ─── */
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (!data.success) {
          router.push(`/${code}/admin/login`);
          return;
        }
        const user = data.data?.user;
        // Verify the logged-in user's code matches the URL code.
        // Super admins may access any admin panel.
        if (user?.userType !== "super_admin" && user?.code !== code) {
          router.push(`/${code}/admin/login`);
          return;
        }
        setSiteName(user?.name || code);
      })
      .catch(() => router.push(`/${code}/admin/login`));
  }, [code, router]);

  /* ─── Load all data ─── */
  const loadAll = useCallback(async () => {
    setLoading(true);
    const [bRes, sRes, pRes, plRes, gRes, scRes, nRes, vRes, cRes] =
      await Promise.all([
        apiFetch<Block[]>("/api/site/blocks"),
        apiFetch<SiteSettings>("/api/site/settings"),
        apiFetch<ProfileItem[]>("/api/site/profiles"),
        apiFetch<PledgeItem[]>("/api/site/pledges"),
        apiFetch<GalleryItem[]>("/api/site/gallery"),
        apiFetch<ScheduleItem[]>("/api/site/schedules"),
        apiFetch<NewsItem[]>("/api/site/news"),
        apiFetch<VideoItem[]>("/api/site/videos"),
        apiFetch<ContactItem[]>("/api/site/contacts"),
      ]);
    if (bRes.success && bRes.data) setBlocks(bRes.data);
    if (sRes.success && sRes.data) setSettings(sRes.data);
    if (pRes.success && pRes.data) setProfiles(pRes.data);
    if (plRes.success && plRes.data) setPledges(plRes.data);
    if (gRes.success && gRes.data) setGallery(gRes.data);
    if (scRes.success && scRes.data) setSchedules(scRes.data);
    if (nRes.success && nRes.data) setNews(nRes.data);
    if (vRes.success && vRes.data) setVideos(vRes.data);
    if (cRes.success && cRes.data) setContacts(cRes.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  /* ─── Reload a single section ─── */
  async function reloadSection(type: string) {
    switch (type) {
      case "hero":
      case "intro": {
        const r = await apiFetch<SiteSettings>("/api/site/settings");
        if (r.success && r.data) setSettings(r.data);
        break;
      }
      case "career": {
        const r = await apiFetch<ProfileItem[]>("/api/site/profiles");
        if (r.success && r.data) setProfiles(r.data);
        break;
      }
      case "goals": {
        const r = await apiFetch<PledgeItem[]>("/api/site/pledges");
        if (r.success && r.data) setPledges(r.data);
        break;
      }
      case "gallery": {
        const r = await apiFetch<GalleryItem[]>("/api/site/gallery");
        if (r.success && r.data) setGallery(r.data);
        break;
      }
      case "schedule": {
        const r = await apiFetch<ScheduleItem[]>("/api/site/schedules");
        if (r.success && r.data) setSchedules(r.data);
        break;
      }
      case "news": {
        const r = await apiFetch<NewsItem[]>("/api/site/news");
        if (r.success && r.data) setNews(r.data);
        break;
      }
      case "videos": {
        const r = await apiFetch<VideoItem[]>("/api/site/videos");
        if (r.success && r.data) setVideos(r.data);
        break;
      }
      case "contacts": {
        const r = await apiFetch<ContactItem[]>("/api/site/contacts");
        if (r.success && r.data) setContacts(r.data);
        break;
      }
      case "links": {
        const r = await apiFetch<Block[]>("/api/site/blocks");
        if (r.success && r.data) setBlocks(r.data);
        break;
      }
    }
  }

  /* ─── Flash save message ─── */
  function flashSave(msg: string) {
    setSaveMessage(msg);
    setTimeout(() => setSaveMessage(null), 2000);
  }

  /* ─── Add block with example content ─── */
  async function addBlock(type: string, insertIndex: number) {
    const sortOrder = insertIndex >= 0 ? insertIndex + 1 : 0;
    const res = await apiFetch<Block>("/api/site/blocks", {
      method: "POST",
      body: JSON.stringify({ type, sortOrder }),
    });
    if (res.success) {
      // 예시 콘텐츠 자동 생성
      await seedExampleContent(type);
      const bRes = await apiFetch<Block[]>("/api/site/blocks");
      if (bRes.success && bRes.data) setBlocks(bRes.data);
      // 관련 데이터 리로드
      await reloadSection(type);
    }
    setShowAddMenu(null);
  }

  /* ─── Seed example content for new blocks ─── */
  async function seedExampleContent(type: string) {
    switch (type) {
      case "career": {
        const examples = [
          { type: "education", title: "○○대학교 행정학과 졸업", isCurrent: false },
          { type: "career", title: "제○대 ○○구 구의회 의원", isCurrent: false },
          { type: "career", title: "○○당 ○○시당 부위원장 (현)", isCurrent: true },
        ];
        for (const item of examples) {
          await apiFetch("/api/site/profiles", { method: "POST", body: JSON.stringify(item) });
        }
        break;
      }
      case "goals": {
        const examples = [
          { icon: "fas fa-road", title: "교통 인프라 확충", description: "출퇴근 시간 단축을 위한 교통 개선", details: ["버스 노선 신설", "주차장 확충"] },
          { icon: "fas fa-baby", title: "보육·교육 강화", description: "아이 키우기 좋은 지역 만들기", details: ["공립 어린이집 확대", "방과후 프로그램 지원"] },
        ];
        for (const item of examples) {
          await apiFetch("/api/site/pledges", { method: "POST", body: JSON.stringify(item) });
        }
        break;
      }
      case "schedule": {
        const today = new Date();
        const d1 = new Date(today); d1.setDate(d1.getDate() + 3);
        const d2 = new Date(today); d2.setDate(d2.getDate() + 7);
        const examples = [
          { title: "거리 유세", date: d1.toISOString().slice(0, 10), time: "10:00", location: "○○역 앞" },
          { title: "주민 간담회", date: d2.toISOString().slice(0, 10), time: "14:00", location: "○○동 주민센터" },
        ];
        for (const item of examples) {
          await apiFetch("/api/site/schedules", { method: "POST", body: JSON.stringify(item) });
        }
        break;
      }
      case "contacts": {
        const examples = [
          { type: "phone", value: "02-000-0000", label: "선거사무소" },
          { type: "email", value: "example@email.com", label: "이메일" },
        ];
        for (const item of examples) {
          await apiFetch("/api/site/contacts", { method: "POST", body: JSON.stringify(item) });
        }
        break;
      }
      case "intro": {
        await apiFetch("/api/site/settings", {
          method: "PUT",
          body: JSON.stringify({
            introText: "주민 여러분의 목소리에 귀 기울이겠습니다.\n지역 발전과 주민 복지를 위해 최선을 다하겠습니다.",
          }),
        });
        break;
      }
    }
  }

  /* ─── Toggle visibility ─── */
  async function toggleVisibility(block: Block) {
    const res = await apiFetch<Block>(`/api/site/blocks/${block.id}`, {
      method: "PUT",
      body: JSON.stringify({ visible: !block.visible }),
    });
    if (res.success && res.data) {
      setBlocks((prev) =>
        prev.map((b) => (b.id === res.data!.id ? res.data! : b))
      );
    }
  }

  /* ─── Delete block ─── */
  async function deleteBlock(block: Block) {
    if (!confirm(`"${BLOCK_TYPES[block.type]?.label || block.type}" 블록을 삭제하시겠습니까?`)) return;
    const res = await apiFetch(`/api/site/blocks/${block.id}`, { method: "DELETE" });
    if (res.success) {
      setBlocks((prev) => prev.filter((b) => b.id !== block.id));
      if (editingBlockType === block.type) setEditingBlockType(null);
    }
  }

  /* ─── Drag and drop ─── */
  function handleDragStart(index: number) {
    setDragIndex(index);
  }
  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    setDragOverIndex(index);
  }
  function handleDragLeave() {
    setDragOverIndex(null);
  }
  async function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const newBlocks = [...blocks];
    const [moved] = newBlocks.splice(dragIndex, 1);
    newBlocks.splice(targetIndex, 0, moved);
    setBlocks(newBlocks);
    setDragIndex(null);
    setDragOverIndex(null);
    await apiFetch("/api/site/blocks/reorder", {
      method: "PUT",
      body: JSON.stringify({ ids: newBlocks.map((b) => b.id) }),
    });
  }
  function handleDragEnd() {
    setDragIndex(null);
    setDragOverIndex(null);
  }

  const primaryColor = settings.primaryColor || "#C9151E";
  const accentColor = settings.accentColor || "#1A56DB";

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
          <p className="text-sm text-gray-500">페이지 빌더 로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-white text-gray-900"
      style={
        {
          "--primary": primaryColor,
          "--accent": accentColor,
        } as React.CSSProperties
      }
    >
      {/* ── Admin Top Bar ── */}
      <div className="fixed top-0 left-0 right-0 z-[100] flex h-12 items-center justify-between bg-zinc-900/95 px-4 backdrop-blur-sm border-b border-white/10 shadow-lg">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/${code}/admin`)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <span>&#8592;</span>
            <span>관리자</span>
          </button>
          <div className="h-4 w-px bg-white/20" />
          <span className="text-sm font-semibold text-white">{siteName}</span>
          <span className="rounded bg-blue-600/20 px-2 py-0.5 text-[10px] font-bold text-blue-400 uppercase tracking-wider">
            빌더
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSiteInfo(!showSiteInfo)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
              showSiteInfo
                ? "bg-blue-600 text-white"
                : "bg-white/10 text-zinc-300 hover:bg-white/20 hover:text-white"
            }`}
          >
            &#9881; 사이트 정보
          </button>
          <a
            href={`/${code}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-white/20 hover:text-white"
          >
            사이트 보기
            <span className="text-xs">&#8599;</span>
          </a>
        </div>
      </div>

      {/* ── Site Info Panel ── */}
      {showSiteInfo && (
        <SiteInfoPanel
          settings={settings}
          setSettings={setSettings}
          onClose={() => setShowSiteInfo(false)}
        />
      )}

      {/* ── Spacer for fixed top bar ── */}
      <div className="h-12" />

      {/* ── Split layout: preview left + edit panel right ── */}
      <div className="flex min-h-[calc(100vh-3rem)]">
        {/* Left: Live Preview */}
        <div className={`flex-1 transition-all duration-300 ${editingBlockType ? "lg:mr-[420px]" : ""}`}>
          {/* Add block at top */}
          <AddBlockButton
            index={-1}
            showAddMenu={showAddMenu}
            setShowAddMenu={setShowAddMenu}
            onAdd={addBlock}
            existingTypes={blocks.map((b) => b.type)}
          />

          {/* Empty state */}
          {blocks.length === 0 && (
            <div className="mx-auto max-w-2xl px-6 py-20 text-center">
              <div className="text-5xl mb-4">&#128230;</div>
              <p className="text-lg font-semibold text-gray-400">
                아직 블록이 없습니다
              </p>
              <p className="mt-2 text-sm text-gray-400">
                위의 + 버튼을 눌러 섹션을 추가하세요
              </p>
            </div>
          )}

          {/* Render blocks as live preview sections */}
          {blocks.map((block, index) => (
            <div key={block.id}>
              <SectionWrapper
                block={block}
                index={index}
                isEditing={editingBlockType === block.type}
                isHovered={hoveredBlock === block.type}
                isDragOver={dragOverIndex === index}
                isDragging={dragIndex === index}
                onHover={(h) => setHoveredBlock(h ? block.type : null)}
                onEdit={() =>
                  setEditingBlockType(
                    editingBlockType === block.type ? null : block.type
                  )
                }
                onToggleVisibility={() => toggleVisibility(block)}
                onDelete={() => deleteBlock(block)}
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={() => handleDrop(index)}
                onDragEnd={handleDragEnd}
              >
                <SectionPreview
                  block={block}
                  settings={settings}
                  siteName={siteName}
                  profiles={profiles}
                  pledges={pledges}
                  gallery={gallery}
                  schedules={schedules}
                  news={news}
                  videos={videos}
                  contacts={contacts}
                />
              </SectionWrapper>

              <AddBlockButton
                index={index}
                showAddMenu={showAddMenu}
                setShowAddMenu={setShowAddMenu}
                onAdd={addBlock}
                existingTypes={blocks.map((b) => b.type)}
              />
            </div>
          ))}
        </div>

        {/* Right: Edit Panel (desktop) / Bottom Sheet (mobile) */}
        {editingBlockType && (() => {
          const editBlock = blocks.find((b) => b.type === editingBlockType);
          if (!editBlock) return null;
          return (
            <>
              {/* Desktop: fixed right panel */}
              <div className="hidden lg:block fixed top-12 right-0 w-[420px] h-[calc(100vh-3rem)] bg-zinc-900 border-l border-white/10 shadow-2xl z-40 animate-in overflow-y-auto">
                <div className="p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <span>{BLOCK_TYPES[editBlock.type]?.icon}</span>
                      {BLOCK_TYPES[editBlock.type]?.label || editBlock.type} 편집
                    </h3>
                    <button
                      onClick={() => setEditingBlockType(null)}
                      className="rounded-lg p-1 text-zinc-500 hover:bg-white/10 hover:text-white transition-colors"
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <BlockTitleEditor
                    block={editBlock}
                    onTitleSaved={(updatedBlock) => {
                      setBlocks((prev) =>
                        prev.map((b) => (b.id === updatedBlock.id ? updatedBlock : b))
                      );
                    }}
                  />
                  <SectionEditor
                    block={editBlock}
                    settings={settings}
                    setSettings={setSettings}
                    setBlocks={setBlocks}
                    profiles={profiles}
                    pledges={pledges}
                    gallery={gallery}
                    schedules={schedules}
                    news={news}
                    videos={videos}
                    contacts={contacts}
                    onSaving={() => setSaving(true)}
                    onSaved={async () => {
                      setSaving(false);
                      await reloadSection(editBlock.type);
                      const bRes = await apiFetch<Block[]>("/api/site/blocks");
                      if (bRes.success && bRes.data) setBlocks(bRes.data);
                      flashSave("저장되었습니다");
                    }}
                    onCancel={() => setEditingBlockType(null)}
                  />
                </div>
              </div>

              {/* Mobile: bottom sheet */}
              <div className="lg:hidden fixed inset-x-0 bottom-0 z-40">
                {/* Backdrop */}
                <div
                  className="fixed inset-0 bg-black/40"
                  onClick={() => setEditingBlockType(null)}
                />
                {/* Sheet */}
                <div className="relative bg-zinc-900 rounded-t-2xl border-t border-white/10 shadow-2xl max-h-[70vh] overflow-y-auto animate-in">
                  {/* Handle */}
                  <div className="sticky top-0 bg-zinc-900 pt-2 pb-1 flex justify-center rounded-t-2xl z-10">
                    <div className="w-10 h-1 rounded-full bg-zinc-600" />
                  </div>
                  <div className="px-5 pb-8">
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <span>{BLOCK_TYPES[editBlock.type]?.icon}</span>
                        {BLOCK_TYPES[editBlock.type]?.label || editBlock.type} 편집
                      </h3>
                      <button
                        onClick={() => setEditingBlockType(null)}
                        className="rounded-lg p-1 text-zinc-500 hover:bg-white/10 hover:text-white transition-colors"
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <BlockTitleEditor
                      block={editBlock}
                      onTitleSaved={(updatedBlock) => {
                        setBlocks((prev) =>
                          prev.map((b) => (b.id === updatedBlock.id ? updatedBlock : b))
                        );
                      }}
                    />
                    <SectionEditor
                      block={editBlock}
                      settings={settings}
                      setSettings={setSettings}
                      setBlocks={setBlocks}
                      profiles={profiles}
                      pledges={pledges}
                      gallery={gallery}
                      schedules={schedules}
                      news={news}
                      videos={videos}
                      contacts={contacts}
                      onSaving={() => setSaving(true)}
                      onSaved={async () => {
                        setSaving(false);
                        await reloadSection(editBlock.type);
                        const bRes = await apiFetch<Block[]>("/api/site/blocks");
                        if (bRes.success && bRes.data) setBlocks(bRes.data);
                        flashSave("저장되었습니다");
                      }}
                      onCancel={() => setEditingBlockType(null)}
                    />
                  </div>
                </div>
              </div>
            </>
          );
        })()}
      </div>

      {/* ── Save toast ── */}
      {(saving || saveMessage) && (
        <div className="fixed bottom-6 right-6 z-[110] rounded-xl bg-zinc-900 px-5 py-3 text-sm text-white shadow-2xl border border-white/10 flex items-center gap-2">
          {saving ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              저장 중...
            </>
          ) : (
            <>
              <svg className="h-4 w-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {saveMessage}
            </>
          )}
        </div>
      )}

      {/* ── Animation style ── */}
      <style jsx global>{`
        .animate-in {
          animation: slideDown 0.2s ease-out;
        }
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Section Wrapper — hover overlay + toolbar
   ═══════════════════════════════════════════════ */
function SectionWrapper({
  block,
  index,
  isEditing,
  isHovered,
  isDragOver,
  isDragging,
  onHover,
  onEdit,
  onToggleVisibility,
  onDelete,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  children,
}: {
  block: Block;
  index: number;
  isEditing: boolean;
  isHovered: boolean;
  isDragOver: boolean;
  isDragging: boolean;
  onHover: (h: boolean) => void;
  onEdit: () => void;
  onToggleVisibility: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  children: React.ReactNode;
}) {
  const info = BLOCK_TYPES[block.type];

  return (
    <div
      className={`relative transition-all duration-200 ${
        isDragging ? "opacity-40" : ""
      } ${isDragOver ? "ring-2 ring-blue-500/50 ring-inset" : ""} ${
        !block.visible ? "opacity-40" : ""
      }`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      {/* Hover toolbar */}
      <div
        className={`absolute top-2 right-2 z-50 flex items-center gap-1 rounded-lg bg-zinc-900/90 px-2 py-1 shadow-lg backdrop-blur-sm border border-white/10 transition-opacity duration-150 ${
          isHovered || isEditing ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Drag handle */}
        <span
          className="cursor-grab text-zinc-500 hover:text-white text-sm px-1 active:cursor-grabbing"
          title="드래그하여 순서 변경"
        >
          &#9776;
        </span>
        <div className="w-px h-4 bg-white/10" />
        {/* Section name */}
        <span className="text-xs font-medium text-zinc-400 px-1">
          {info?.icon} {info?.label || block.type}
        </span>
        <div className="w-px h-4 bg-white/10" />
        {/* Visibility toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility();
          }}
          className={`rounded p-1 text-xs transition-colors ${
            block.visible
              ? "text-zinc-400 hover:text-white hover:bg-white/10"
              : "text-red-400 hover:text-red-300 hover:bg-white/10"
          }`}
          title={block.visible ? "섹션 숨기기" : "섹션 보이기"}
        >
          {block.visible ? (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            </svg>
          )}
        </button>
        {/* Edit button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className={`rounded p-1 text-xs transition-colors ${
            isEditing
              ? "text-blue-400 bg-blue-500/20"
              : "text-zinc-400 hover:text-white hover:bg-white/10"
          }`}
          title="편집"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        {/* Delete button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="rounded p-1 text-xs text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="삭제"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* Hidden badge */}
      {!block.visible && (
        <div className="absolute top-2 left-2 z-50 rounded bg-red-500/80 px-2 py-0.5 text-[10px] font-bold text-white">
          숨김
        </div>
      )}

      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Section Live Preview — renders actual content
   ═══════════════════════════════════════════════ */
function SectionPreview({
  block,
  settings,
  siteName,
  profiles,
  pledges,
  gallery,
  schedules,
  news,
  videos,
  contacts,
}: {
  block: Block;
  settings: SiteSettings;
  siteName: string;
  profiles: ProfileItem[];
  pledges: PledgeItem[];
  gallery: GalleryItem[];
  schedules: ScheduleItem[];
  news: NewsItem[];
  videos: VideoItem[];
  contacts: ContactItem[];
}) {
  switch (block.type) {
    case "hero":
      return <HeroPreview block={block} settings={settings} candidateName={siteName} />;
    case "intro":
      return (
        <IntroPreview
          block={block}
          settings={settings}
          profiles={profiles}
          candidateName={siteName}
        />
      );
    case "career":
      return (
        <CareerPreview
          block={block}
          profiles={profiles}
          candidateName={siteName}
          settings={settings}
        />
      );
    case "goals":
      return <GoalsPreview block={block} pledges={pledges} />;
    case "gallery":
      return <GalleryPreview block={block} gallery={gallery} />;
    case "schedule":
      return <SchedulePreview block={block} schedules={schedules} />;
    case "news":
      return <NewsPreview block={block} news={news} />;
    case "videos":
      return <VideosPreview block={block} videos={videos} />;
    case "donation":
      return <DonationPreview block={block} />;
    case "contacts":
      return <ContactsPreview block={block} contacts={contacts} />;
    case "links":
      return <LinksPreview block={block} />;
    default:
      return (
        <div className="py-12 text-center text-gray-400">
          알 수 없는 블록: {block.type}
        </div>
      );
  }
}

/* ─── Empty State Helper ─── */
function EmptySection({ label, icon }: { label: string; icon: string }) {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16 text-center">
      <div className="rounded-2xl border-2 border-dashed border-gray-200 py-12 px-6">
        <span className="text-3xl">{icon}</span>
        <p className="mt-3 text-sm font-medium text-gray-400">
          {label} 데이터가 없습니다
        </p>
        <p className="mt-1 text-xs text-gray-300">
          편집 버튼을 클릭하여 추가하세요
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   HERO Preview
   ═══════════════════════════════════════════════ */
function HeroPreview({
  block,
  settings,
  candidateName,
}: {
  block: Block;
  settings: SiteSettings;
  candidateName: string;
}) {
  const dDay = calcDDay(settings.electionDate);
  const heroContent = block.content as {
    button1Text?: string;
    button1Link?: string;
    button2Text?: string;
    button2Link?: string;
    badgeFontSize?: number;
    electionFontSize?: number;
  } | null;
  const button1Text = heroContent?.button1Text || "공약 보기";
  const button2Text = heroContent?.button2Text || "후보 소개";
  const partySize = heroContent?.badgeFontSize || 12;
  const electionSize = heroContent?.electionFontSize || 12;

  const badges = (
    <div className="flex items-center justify-center gap-3 flex-wrap">
      {settings.partyName && (
        <span
          className="rounded-full bg-white/90 px-4 py-1.5 font-bold tracking-wide shadow-sm"
          style={{ color: "var(--primary)", fontSize: `${partySize}px` }}
        >
          {settings.partyName}
        </span>
      )}
      {dDay !== null && settings.electionDate && (
        <span
          className="rounded-full px-4 py-1.5 font-bold text-white tracking-wide shadow-sm"
          style={{ backgroundColor: "var(--primary)", fontSize: `${electionSize}px` }}
        >
          {settings.electionName ? `${settings.electionName} ` : ""}
          {formatDDay(dDay)}
        </span>
      )}
    </div>
  );

  const sloganArea = (
    <div className="text-center text-white px-6 py-12 sm:py-16">
      {settings.positionTitle && (
        <p className="text-sm font-medium tracking-widest uppercase opacity-90 mb-3">
          {settings.positionTitle}
        </p>
      )}
      <h1 className="text-5xl font-bold tracking-tight sm:text-6xl md:text-7xl mb-4">
        {candidateName}
      </h1>
      {settings.heroSlogan && (
        <p className="text-xl font-semibold sm:text-2xl leading-snug mb-2">
          &ldquo;{settings.heroSlogan}&rdquo;
        </p>
      )}
      {settings.heroSubSlogan && (
        <p className="text-sm opacity-75 leading-relaxed max-w-md mx-auto mb-8">
          {settings.heroSubSlogan}
        </p>
      )}
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <span
          className="rounded-full px-5 py-3 text-sm font-bold text-white shadow-lg cursor-default"
          style={{
            backgroundColor: "var(--primary)",
            filter: "brightness(0.85)",
          }}
        >
          {button1Text}
        </span>
        <span className="rounded-full border-2 border-white/50 bg-white/10 px-5 py-3 text-sm font-bold text-white backdrop-blur-sm cursor-default">
          {button2Text}
        </span>
        <span className="rounded-full border-2 border-white/50 bg-white/10 px-5 py-3 text-sm font-bold text-white backdrop-blur-sm cursor-default">
          후원 안내
        </span>
        <span className="rounded-full border-2 border-white/50 bg-white/10 px-5 py-3 text-sm font-bold text-white backdrop-blur-sm cursor-default flex items-center gap-1.5">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          링크 복사
        </span>
      </div>
    </div>
  );

  return (
    <section className="w-full">
      {settings.heroImageUrl ? (
        <>
          <div
            className="w-full px-4 py-4"
            style={{ backgroundColor: "var(--primary)" }}
          >
            {badges}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={settings.heroImageUrl}
            alt={candidateName}
            className="w-full"
          />
          <div
            style={{
              background: `linear-gradient(180deg, var(--primary) 0%, #1a1a2e 100%)`,
            }}
          >
            {sloganArea}
          </div>
        </>
      ) : (
        <div
          className="w-full"
          style={{
            background: `linear-gradient(180deg, var(--primary) 0%, #1a1a2e 100%)`,
          }}
        >
          <div className="px-4 pt-10 pb-4">{badges}</div>
          {sloganArea}
        </div>
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════
   INTRO / Keywords Preview
   ═══════════════════════════════════════════════ */
function IntroPreview({
  block,
  settings,
  profiles,
  candidateName,
}: {
  block: Block;
  settings: SiteSettings;
  profiles: ProfileItem[];
  candidateName: string;
}) {
  if (!settings.introText && profiles.length === 0) {
    return <EmptySection label="소개" icon="📝" />;
  }

  return (
    <section className="mx-auto max-w-4xl px-6 py-16 sm:py-20">
      <div className="mb-10 text-center">
        <h2 className="text-2xl font-bold sm:text-3xl text-gray-900">
          {block.title || BLOCK_TYPES.intro.defaultTitle}
        </h2>
      </div>
      {settings.introText && (
        <div className="mx-auto mb-12 max-w-2xl text-center text-gray-600 leading-relaxed text-base sm:text-lg">
          {settings.introText.split("\n").map((line, i) => (
            <p key={i} className={i > 0 ? "mt-3" : ""}>
              {line}
            </p>
          ))}
        </div>
      )}
      {settings.profileImageUrl && (
        <div className="mx-auto mb-12 flex flex-col items-center">
          <div className="relative h-40 w-40 sm:h-48 sm:w-48 overflow-hidden rounded-full shadow-lg border-4 border-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={settings.profileImageUrl}
              alt={candidateName}
              className="h-full w-full object-cover object-top"
            />
          </div>
          <div className="mt-4 text-center">
            <p className="text-xl font-bold text-gray-900">{candidateName}</p>
            {settings.partyName && (
              <p
                className="text-sm font-medium"
                style={{ color: "var(--primary)" }}
              >
                {settings.partyName}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════
   CAREER Preview
   ═══════════════════════════════════════════════ */
function CareerPreview({
  block,
  profiles,
  candidateName,
  settings,
}: {
  block: Block;
  profiles: ProfileItem[];
  candidateName: string;
  settings: SiteSettings;
}) {
  const education = profiles
    .filter((p) => p.type === "education")
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const career = profiles
    .filter((p) => p.type === "career")
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  if (education.length === 0 && career.length === 0) {
    return <EmptySection label="이력" icon="📋" />;
  }

  return (
    <section className="mx-auto max-w-4xl px-6 py-16 sm:py-20">
      <div className="mb-10 text-center">
        <h2 className="text-2xl font-bold sm:text-3xl text-gray-900">
          {block.title || BLOCK_TYPES.career.defaultTitle}
        </h2>
      </div>
      <div className="grid gap-10 sm:grid-cols-2">
        {education.length > 0 && (
          <div className="rounded-2xl bg-gray-50 p-6">
            <h3 className="mb-5 flex items-center gap-2 text-lg font-bold text-gray-900">
              <svg
                className="h-5 w-5"
                style={{ color: "var(--primary)" }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342"
                />
              </svg>
              학력
            </h3>
            <ul className="relative">
              {education.map((item) => (
                <TimelineItem key={item.id} item={item} />
              ))}
            </ul>
          </div>
        )}
        {career.length > 0 && (
          <div className="rounded-2xl bg-gray-50 p-6">
            <h3 className="mb-5 flex items-center gap-2 text-lg font-bold text-gray-900">
              <svg
                className="h-5 w-5"
                style={{ color: "var(--primary)" }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0"
                />
              </svg>
              주요 경력
            </h3>
            <ul className="relative">
              {career.map((item) => (
                <TimelineItem key={item.id} item={item} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function TimelineItem({ item }: { item: ProfileItem }) {
  return (
    <li className="relative pl-7 pb-5 last:pb-0">
      <span className="absolute left-[5px] top-0 h-full w-0.5 bg-gray-200" />
      <span
        className="absolute left-0 top-1 h-3 w-3 rounded-full border-2 z-10"
        style={{
          borderColor: "var(--primary)",
          backgroundColor: item.isCurrent ? "var(--primary)" : "white",
        }}
      />
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-gray-800 sm:text-base leading-snug">
          {item.title}
        </p>
        {item.isCurrent && (
          <span
            className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
            style={{ backgroundColor: "var(--primary)" }}
          >
            현재
          </span>
        )}
      </div>
    </li>
  );
}

/* ═══════════════════════════════════════════════
   GOALS Preview
   ═══════════════════════════════════════════════ */
function GoalsPreview({ block, pledges }: { block: Block; pledges: PledgeItem[] }) {
  if (pledges.length === 0) {
    return <EmptySection label="핵심 목표" icon="🎯" />;
  }

  const sorted = [...pledges].sort(
    (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)
  );

  return (
    <section className="bg-gray-50 py-16 sm:py-20">
      <div className="mx-auto max-w-4xl px-6">
        <div className="mb-4 text-center">
          <h2 className="text-2xl font-bold sm:text-3xl text-gray-900">
            {block.title || BLOCK_TYPES.goals.defaultTitle}
          </h2>
        </div>
        <p className="mb-10 text-center text-sm text-gray-500">
          지역 발전과 주민 행복을 위한 핵심 공약입니다
        </p>
        <div className="space-y-4">
          {sorted.map((pledge, idx) => {
            const number = String(idx + 1).padStart(2, "0");
            const parsed = (() => {
              const d = pledge.details;
              if (Array.isArray(d)) return { items: d, imageUrl: null };
              if (d && typeof d === "object" && "items" in (d as Record<string, unknown>)) {
                const obj = d as { items: string[]; imageUrl?: string };
                return { items: obj.items || [], imageUrl: obj.imageUrl || null };
              }
              return { items: [], imageUrl: null };
            })();
            return (
              <div
                key={pledge.id || idx}
                className="rounded-2xl bg-white p-6 shadow-sm border-l-4"
                style={{ borderLeftColor: "var(--primary)" }}
              >
                <div className="flex items-start gap-4">
                  <span
                    className="flex-shrink-0 text-3xl font-extrabold leading-none"
                    style={{ color: "var(--primary)" }}
                  >
                    {number}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-bold text-gray-900 leading-snug">
                      {pledge.title}
                    </h3>
                    {pledge.description && (
                      <p className="mt-2 text-sm leading-relaxed text-gray-600">
                        {pledge.description}
                      </p>
                    )}
                    {parsed.imageUrl && (
                      <div className="mt-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={parsed.imageUrl} alt={pledge.title} className="w-full rounded-xl" loading="lazy" />
                      </div>
                    )}
                    {parsed.items.length > 0 && (
                      <ul className="mt-3 space-y-1 border-t border-gray-100 pt-3">
                        {parsed.items.map((detail, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                            <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: "var(--primary)" }} />
                            {detail}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════
   GALLERY Preview
   ═══════════════════════════════════════════════ */
function GalleryPreview({ block, gallery }: { block: Block; gallery: GalleryItem[] }) {
  if (gallery.length === 0) {
    return <EmptySection label="사진첩" icon="📸" />;
  }

  const sorted = [...gallery].sort(
    (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)
  );

  return (
    <section className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
      <div className="mb-10 text-center">
        <h2 className="text-2xl font-bold sm:text-3xl text-gray-900">
          {block.title || BLOCK_TYPES.gallery.defaultTitle}
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {sorted.map((img) => (
          <div
            key={img.id}
            className="relative aspect-square overflow-hidden rounded-xl bg-gray-100"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt={img.altText ?? ""}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════
   SCHEDULE Preview
   ═══════════════════════════════════════════════ */
function SchedulePreview({ block, schedules }: { block: Block; schedules: ScheduleItem[] }) {
  const [schedView, setSchedView] = useState<"list" | "calendar">("calendar");
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());

  if (schedules.length === 0) {
    return <EmptySection label="일정" icon="📅" />;
  }

  const colors = (block.content as { colors?: Record<string, string> } | null)?.colors || {};

  const sorted = [...schedules].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Calendar helpers
  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay = new Date(calYear, calMonth + 1, 0);
  const startWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const today = new Date();
  const isToday = (day: number) => today.getFullYear() === calYear && today.getMonth() === calMonth && today.getDate() === day;

  const dayMap: Record<number, ScheduleItem[]> = {};
  for (const item of schedules) {
    const d = new Date(item.date);
    if (d.getFullYear() === calYear && d.getMonth() === calMonth) {
      const day = d.getDate();
      if (!dayMap[day]) dayMap[day] = [];
      dayMap[day].push(item);
    }
  }

  function prevMonth() {
    if (calMonth === 0) { setCalYear(calYear - 1); setCalMonth(11); }
    else setCalMonth(calMonth - 1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalYear(calYear + 1); setCalMonth(0); }
    else setCalMonth(calMonth + 1);
  }

  return (
    <section className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold sm:text-3xl text-gray-900">{block.title || BLOCK_TYPES.schedule.defaultTitle}</h2>
      </div>

      {/* View toggle */}
      <div className="mb-6 flex justify-center gap-2">
        <button onClick={() => setSchedView("calendar")} className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${schedView === "calendar" ? "text-white" : "bg-gray-100 text-gray-600"}`} style={schedView === "calendar" ? { backgroundColor: "var(--primary)" } : undefined}>달력</button>
        <button onClick={() => setSchedView("list")} className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${schedView === "list" ? "text-white" : "bg-gray-100 text-gray-600"}`} style={schedView === "list" ? { backgroundColor: "var(--primary)" } : undefined}>목록</button>
      </div>

      {schedView === "calendar" ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <button onClick={prevMonth} className="rounded-lg p-1 hover:bg-gray-100"><svg className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg></button>
            <span className="text-lg font-bold text-gray-900">{calYear}년 {calMonth + 1}월</span>
            <button onClick={nextMonth} className="rounded-lg p-1 hover:bg-gray-100"><svg className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg></button>
          </div>
          <div className="grid grid-cols-7 text-center text-xs font-medium text-gray-400 mb-1">
            {["일","월","화","수","목","금","토"].map(d => <div key={d} className="py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-px">
            {Array.from({ length: startWeekday }).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const items = dayMap[day] || [];
              return (
                <div key={day} className={`min-h-[48px] rounded-lg p-1 text-xs ${isToday(day) ? "bg-blue-50 ring-1 ring-blue-300" : "hover:bg-gray-50"}`}>
                  <div className={`font-medium ${isToday(day) ? "text-blue-600" : "text-gray-700"}`}>{day}</div>
                  {items.slice(0, 2).map((it) => (
                    <div key={it.id} className="mt-0.5 truncate rounded px-1 py-0.5 text-[9px] font-medium text-white" style={{ backgroundColor: colors[String(it.id)] || "var(--primary)" }}>{it.title}</div>
                  ))}
                  {items.length > 2 && <div className="text-[9px] text-gray-400 mt-0.5">+{items.length - 2}</div>}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((item) => {
            const past = isPast(item.date);
            const d = new Date(item.date);
            const itemColor = colors[String(item.id)] || "var(--primary)";
            return (
              <div key={item.id} className={`flex items-start gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm ${past ? "opacity-50" : ""}`}>
                <div className="flex flex-shrink-0 flex-col items-center rounded-xl px-3 py-2 min-w-[52px] text-white" style={{ backgroundColor: past ? "#9ca3af" : itemColor }}>
                  <span className="text-2xl font-bold leading-tight">{d.getDate()}</span>
                  <span className="text-[10px] font-medium uppercase tracking-wider">{d.getMonth() + 1}월</span>
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-gray-900">{item.title}</h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
                    <span>{formatDate(item.date)}</span>
                    {item.time && <span>{item.time}</span>}
                    {item.location && <span>{item.location}</span>}
                  </div>
                </div>
                {past && <span className="flex-shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">종료</span>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════
   NEWS Preview
   ═══════════════════════════════════════════════ */
function NewsPreview({ block, news }: { block: Block; news: NewsItem[] }) {
  if (news.length === 0) {
    return <EmptySection label="관련기사" icon="📰" />;
  }

  return (
    <section className="mx-auto max-w-4xl px-6 py-16 sm:py-20">
      <div className="mb-10 text-center">
        <h2 className="text-2xl font-bold sm:text-3xl text-gray-900">
          {block.title || BLOCK_TYPES.news.defaultTitle}
        </h2>
      </div>
      <div className="space-y-3">
        {news.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-4 rounded-xl border border-gray-100 bg-white p-5"
          >
            <div className="min-w-0 flex-1">
              <h3 className="line-clamp-2 font-bold text-gray-900">
                {item.title}
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                {item.source && (
                  <span className="font-medium text-gray-500">
                    {item.source}
                  </span>
                )}
                {item.publishedDate && (
                  <span>{formatNewsDate(item.publishedDate)}</span>
                )}
              </div>
            </div>
            {item.url && (
              <svg
                className="h-5 w-5 flex-shrink-0 text-gray-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════
   VIDEOS Preview
   ═══════════════════════════════════════════════ */
function VideosPreview({ block, videos }: { block: Block; videos: VideoItem[] }) {
  if (videos.length === 0) {
    return <EmptySection label="영상" icon="🎬" />;
  }

  const sorted = [...videos].sort(
    (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)
  );

  return (
    <section className="bg-gray-50 py-16 sm:py-20">
      <div className="mx-auto max-w-4xl px-6">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-bold sm:text-3xl text-gray-900">
            {block.title || BLOCK_TYPES.videos.defaultTitle}
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {sorted.map((video) => (
            <div
              key={video.id}
              className="overflow-hidden rounded-2xl bg-white shadow-sm"
            >
              <div className="relative aspect-video overflow-hidden bg-gray-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg`}
                  alt={video.title ?? ""}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg"
                    style={{ backgroundColor: "var(--primary)" }}
                  >
                    <svg
                      className="h-6 w-6 ml-0.5"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
              </div>
              {video.title && (
                <div className="p-4">
                  <p className="font-semibold text-gray-900 line-clamp-2">
                    {video.title}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════
   DONATION Preview
   ═══════════════════════════════════════════════ */
function DonationPreview({ block }: { block: Block }) {
  const content = block.content as { imageUrl?: string; description?: string } | null;
  if (!content?.imageUrl) {
    return <EmptySection label="후원 안내" icon="💝" />;
  }
  return (
    <section id="donation" className="bg-gray-50 py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-6">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-bold sm:text-3xl text-gray-900">
            {block.title || BLOCK_TYPES.donation.defaultTitle}
          </h2>
          {content.description && (
            <p className="mt-3 text-sm text-gray-600 whitespace-pre-line">{content.description}</p>
          )}
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm border border-gray-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={content.imageUrl} alt="후원 안내" className="w-full rounded-xl" loading="lazy" />
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════
   CONTACTS Preview
   ═══════════════════════════════════════════════ */
function ContactsPreview({ block, contacts }: { block: Block; contacts: ContactItem[] }) {
  if (contacts.length === 0) {
    return <EmptySection label="연락처" icon="📞" />;
  }

  const sorted = [...contacts].sort(
    (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)
  );

  const typeLabels: Record<string, string> = {
    phone: "전화",
    email: "이메일",
    instagram: "인스타그램",
    facebook: "페이스북",
    youtube: "유튜브",
    blog: "블로그",
    threads: "Threads",
  };

  return (
    <section className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
      <div className="mb-10 text-center">
        <h2 className="text-2xl font-bold sm:text-3xl text-gray-900">
          {block.title || BLOCK_TYPES.contacts.defaultTitle}
        </h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {sorted.map((contact) => (
          <div
            key={contact.id}
            className="flex items-center gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
          >
            <div
              className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-white text-lg"
              style={{ backgroundColor: "var(--primary)" }}
            >
              {contact.type === "phone"
                ? "📞"
                : contact.type === "email"
                  ? "✉️"
                  : "🔗"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                {contact.label ??
                  typeLabels[contact.type] ??
                  contact.type}
              </p>
              <p className="truncate font-bold text-gray-900 mt-0.5">
                {contact.value}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════
   LINKS Preview
   ═══════════════════════════════════════════════ */
function LinksPreview({ block }: { block: Block }) {
  const content = block.content as { links?: LinkItem[] } | null;
  const links = content?.links || [];

  if (links.length === 0) {
    return <EmptySection label="링크" icon="🔗" />;
  }

  return (
    <section className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
      <div className="mb-10 text-center">
        <h2 className="text-2xl font-bold sm:text-3xl text-gray-900">{block.title || BLOCK_TYPES.links.defaultTitle}</h2>
      </div>
      <div className="space-y-3">
        {links.map((link, i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-xl border border-gray-100 bg-white p-5 shadow-sm"
          >
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-gray-900">{link.title}</h3>
              {link.description && (
                <p className="mt-1 text-sm text-gray-500">{link.description}</p>
              )}
              {link.url && (
                <p className="mt-1 text-xs text-blue-500 truncate">
                  {link.url}
                </p>
              )}
            </div>
            <svg
              className="h-5 w-5 flex-shrink-0 text-gray-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════
   Add Block Button
   ═══════════════════════════════════════════════ */
function AddBlockButton({
  index,
  showAddMenu,
  setShowAddMenu,
  onAdd,
  existingTypes,
}: {
  index: number;
  showAddMenu: number | null;
  setShowAddMenu: (v: number | null) => void;
  onAdd: (type: string, insertIndex: number) => void;
  existingTypes: string[];
}) {
  const isOpen = showAddMenu === index;
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowAddMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen, setShowAddMenu]);

  return (
    <div className="relative flex items-center justify-center py-1" ref={menuRef}>
      <div className="absolute inset-x-0 top-1/2 h-px bg-gray-100" />
      <button
        onClick={() => setShowAddMenu(isOpen ? null : index)}
        className={`relative z-10 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all ${
          isOpen
            ? "bg-blue-600 text-white shadow-lg"
            : "bg-white text-gray-400 hover:text-gray-600 border border-gray-200 shadow-sm hover:shadow"
        }`}
      >
        <span className="text-sm leading-none">{isOpen ? "×" : "+"}</span>
        블록 추가
      </button>

      {isOpen && (
        <div className="absolute top-full z-[60] mt-2 w-64 rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
          <p className="mb-2 px-2 text-xs font-medium text-gray-400">
            블록 유형 선택
          </p>
          <div className="grid grid-cols-2 gap-1">
            {BLOCK_TYPE_KEYS.map((type) => {
              const info = BLOCK_TYPES[type];
              const alreadyExists =
                (type === "hero" || type === "intro") &&
                existingTypes.includes(type);
              return (
                <button
                  key={type}
                  onClick={() => onAdd(type, index)}
                  disabled={alreadyExists}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                    alreadyExists
                      ? "cursor-not-allowed text-gray-300"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                  title={
                    alreadyExists
                      ? "이미 존재하는 블록입니다"
                      : `${info.label} 블록 추가`
                  }
                >
                  <span className="text-base">{info.icon}</span>
                  <span>{info.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Block Title Editor — common title field for all blocks
   ═══════════════════════════════════════════════ */
function BlockTitleEditor({
  block,
  onTitleSaved,
}: {
  block: Block;
  onTitleSaved: (updated: Block) => void;
}) {
  const defaultTitle = BLOCK_TYPES[block.type]?.defaultTitle || "";
  const [title, setTitle] = useState(block.title || "");
  const [saved, setSaved] = useState(false);

  async function saveTitle() {
    const res = await apiFetch<Block>(`/api/site/blocks/${block.id}`, {
      method: "PUT",
      body: JSON.stringify({ title: title || null }),
    });
    if (res.success && res.data) {
      onTitleSaved(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }

  if (block.type === "hero") return null;

  return (
    <div className="mb-4 pb-4 border-b border-white/10">
      <label className={labelClass}>섹션 제목</label>
      <div className="flex gap-2">
        <input
          className={inputClass}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={defaultTitle || "섹션 제목"}
        />
        <button onClick={saveTitle} className={btnSecondary}>
          {saved ? "저장됨" : "적용"}
        </button>
      </div>
      <p className="mt-1 text-xs text-zinc-600">
        비워두면 기본값 &ldquo;{defaultTitle}&rdquo;이 사용됩니다
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Section Editor — dispatches to type-specific editors
   ═══════════════════════════════════════════════ */
function SectionEditor({
  block,
  settings,
  setSettings,
  profiles,
  pledges,
  gallery,
  schedules,
  news,
  videos,
  contacts,
  onSaving,
  onSaved,
  onCancel,
  setBlocks,
}: {
  block: Block;
  settings: SiteSettings;
  setSettings: React.Dispatch<React.SetStateAction<SiteSettings>>;
  profiles: ProfileItem[];
  pledges: PledgeItem[];
  gallery: GalleryItem[];
  schedules: ScheduleItem[];
  news: NewsItem[];
  videos: VideoItem[];
  contacts: ContactItem[];
  onSaving: () => void;
  onSaved: () => void;
  onCancel: () => void;
  setBlocks: React.Dispatch<React.SetStateAction<Block[]>>;
}) {
  async function handleToggleVisibility() {
    const res = await apiFetch<Block>(`/api/site/blocks/${block.id}`, {
      method: "PUT",
      body: JSON.stringify({ visible: !block.visible }),
    });
    if (res.success && res.data) {
      setBlocks((prev) =>
        prev.map((b) => (b.id === res.data!.id ? res.data! : b))
      );
    }
  }

  const visibilityToggle = (
    <div className="mb-3 flex items-center justify-between rounded-lg border border-white/10 bg-zinc-800/50 px-3 py-2.5">
      <span className="text-xs text-zinc-400">공개 사이트에 표시</span>
      <button
        onClick={handleToggleVisibility}
        className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
        style={{ backgroundColor: block.visible ? "#22c55e" : "#3f3f46" }}
      >
        <span
          className="inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
          style={{ transform: block.visible ? "translateX(24px)" : "translateX(4px)" }}
        />
      </button>
    </div>
  );

  let editor: React.ReactNode = null;

  switch (block.type) {
    case "hero":
      editor = (
        <HeroEditor
          block={block}
          settings={settings}
          setSettings={setSettings}
          setBlocks={setBlocks}
          onSaving={onSaving}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      );
      break;
    case "intro":
      editor = (
        <IntroEditor
          block={block}
          settings={settings}
          setSettings={setSettings}
          onSaving={onSaving}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      );
      break;
    case "career":
      editor = (
        <CareerEditor
          block={block}
          items={profiles}
          onSaving={onSaving}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      );
      break;
    case "goals":
      editor = (
        <GoalsEditor
          block={block}
          items={pledges}
          onSaving={onSaving}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      );
      break;
    case "gallery":
      editor = (
        <GalleryEditor
          block={block}
          items={gallery}
          onSaving={onSaving}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      );
      break;
    case "schedule":
      editor = (
        <ScheduleEditor
          block={block}
          items={schedules}
          onSaving={onSaving}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      );
      break;
    case "news":
      editor = (
        <NewsEditor
          block={block}
          items={news}
          onSaving={onSaving}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      );
      break;
    case "videos":
      editor = (
        <VideosEditor
          block={block}
          items={videos}
          onSaving={onSaving}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      );
      break;
    case "donation":
      editor = (
        <DonationEditor
          block={block}
          onSaving={onSaving}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      );
      break;
    case "contacts":
      editor = (
        <ContactsEditor
          block={block}
          items={contacts}
          onSaving={onSaving}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      );
      break;
    case "links":
      editor = (
        <LinksEditor
          block={block}
          onSaving={onSaving}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      );
      break;
    default:
      editor = (
        <p className="text-sm text-zinc-500">알 수 없는 블록 유형입니다.</p>
      );
  }

  return (
    <div>
      {visibilityToggle}
      {editor}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Site Info Panel — OG 태그, 선거일 설정
   ═══════════════════════════════════════════════ */
function SiteInfoPanel({
  settings,
  setSettings,
  onClose,
}: {
  settings: SiteSettings;
  setSettings: React.Dispatch<React.SetStateAction<SiteSettings>>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    ogTitle: settings.ogTitle || "",
    ogDescription: settings.ogDescription || "",
    ogImageUrl: settings.ogImageUrl || "",
    electionDate: settings.electionDate ? String(settings.electionDate).slice(0, 10) : "",
    electionName: settings.electionName || "",
  });
  const [ogUploading, setOgUploading] = useState(false);
  const [ogPreviewUrl, setOgPreviewUrl] = useState<string | null>(null);
  const [showOgLibrary, setShowOgLibrary] = useState(false);
  const [ogLibraryFiles, setOgLibraryFiles] = useState<{ id: number; storedPath: string; originalName: string; fileType: string; createdAt: string }[]>([]);
  const [saved, setSaved] = useState(false);
  const ogFileRef = useRef<HTMLInputElement>(null);

  async function save() {
    const res = await apiFetch("/api/site/settings", {
      method: "PUT",
      body: JSON.stringify(form),
    });
    if (res.success) {
      setSettings((prev) => ({ ...prev, ...form }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  return (
    <div className="fixed top-12 left-0 right-0 z-[90] bg-zinc-900 border-b border-white/10 shadow-2xl animate-in">
      <div className="mx-auto max-w-5xl px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            &#9881; 사이트 정보 &amp; 공유 설정
          </h3>
          <div className="flex items-center gap-2">
            <button onClick={save} className={btnPrimary}>
              {saved ? "저장됨 ✓" : "저장"}
            </button>
            <button onClick={onClose} className="rounded-lg p-1 text-zinc-500 hover:bg-white/10 hover:text-white transition-colors">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 공유 썸네일 */}
          <div className="rounded-lg border border-white/10 bg-zinc-800/50 p-3 space-y-2">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">공유 썸네일 (SNS 미리보기)</p>
            <input
              ref={ogFileRef}
              type="file"
              accept="image/*"
              className="absolute w-0 h-0 opacity-0 overflow-hidden"
              disabled={ogUploading}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const previewUrl = URL.createObjectURL(file);
                setOgPreviewUrl(previewUrl);
                setOgUploading(true);
                const fd = new FormData();
                fd.append("file", file);
                const res = await fetch("/api/upload/og", { method: "POST", body: fd });
                const json = await res.json();
                setOgUploading(false);
                if (json.success) {
                  const newUrl = json.data.url;
                  setForm((prev) => ({ ...prev, ogImageUrl: newUrl }));
                  // 자동 저장
                  await apiFetch("/api/site/settings", {
                    method: "PUT",
                    body: JSON.stringify({ ogImageUrl: newUrl }),
                  });
                  setSettings((prev) => ({ ...prev, ogImageUrl: newUrl }));
                }
                e.target.value = "";
              }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className={`${btnSecondary} flex-1`}
                disabled={ogUploading}
                onClick={() => ogFileRef.current?.click()}
              >
                {ogUploading ? "업로드 중..." : "📷 이미지 선택"}
              </button>
              <button
                type="button"
                className={`${btnSecondary} inline-flex items-center gap-1`}
                onClick={async () => {
                  if (!showOgLibrary) {
                    const res = await apiFetch<{ id: number; storedPath: string; originalName: string; fileType: string; createdAt: string }[]>("/api/upload");
                    if (res.success && res.data) setOgLibraryFiles(res.data);
                  }
                  setShowOgLibrary(!showOgLibrary);
                }}
              >
                {showOgLibrary ? "닫기" : "📁 라이브러리"}
              </button>
            </div>
            {showOgLibrary && (
              <div className="rounded-lg border border-white/10 bg-zinc-800/50 p-2 max-h-48 overflow-y-auto">
                <p className="text-[10px] text-zinc-500 mb-1.5">이전에 업로드한 이미지를 선택하세요</p>
                {ogLibraryFiles.length === 0 && (
                  <p className="text-xs text-zinc-600 text-center py-4">업로드한 이미지가 없습니다</p>
                )}
                <div className="grid grid-cols-4 gap-1.5">
                  {ogLibraryFiles.map((f) => (
                    <button
                      key={f.id}
                      onClick={async () => {
                        const newUrl = f.storedPath;
                        setForm((prev) => ({ ...prev, ogImageUrl: newUrl }));
                        setOgPreviewUrl(null);
                        await apiFetch("/api/site/settings", {
                          method: "PUT",
                          body: JSON.stringify({ ogImageUrl: newUrl }),
                        });
                        setSettings((prev) => ({ ...prev, ogImageUrl: newUrl }));
                        setShowOgLibrary(false);
                      }}
                      className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors ${
                        form.ogImageUrl === f.storedPath ? "border-blue-500" : "border-transparent hover:border-white/20"
                      }`}
                      title={f.originalName || ""}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.storedPath} alt={f.originalName || ""} className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(ogPreviewUrl || form.ogImageUrl) && (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ogPreviewUrl || form.ogImageUrl} alt="OG preview" className="h-28 w-full object-cover rounded-lg" />
                <button
                  className="absolute top-1 right-1 rounded-full bg-red-500/80 p-0.5 text-white"
                  onClick={async () => {
                    setForm((prev) => ({ ...prev, ogImageUrl: "" }));
                    setOgPreviewUrl(null);
                    await apiFetch("/api/site/settings", {
                      method: "PUT",
                      body: JSON.stringify({ ogImageUrl: "" }),
                    });
                    setSettings((prev) => ({ ...prev, ogImageUrl: "" }));
                  }}
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
            <p className="text-[10px] text-zinc-600">카카오톡, 페이스북 등에 공유 시 표시되는 이미지</p>
          </div>

          {/* OG 제목/설명 */}
          <div className="rounded-lg border border-white/10 bg-zinc-800/50 p-3 space-y-2">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">공유 제목 / 설명</p>
            <div>
              <label className={labelClass}>제목</label>
              <input
                className={inputClass}
                value={form.ogTitle}
                onChange={(e) => setForm({ ...form, ogTitle: e.target.value })}
                placeholder="예: 홍길동 후보 홈페이지"
              />
            </div>
            <div>
              <label className={labelClass}>설명</label>
              <textarea
                className={`${inputClass} min-h-[60px] resize-y`}
                value={form.ogDescription}
                onChange={(e) => setForm({ ...form, ogDescription: e.target.value })}
                placeholder="예: 우리 지역을 바꾸겠습니다"
              />
            </div>
          </div>

          {/* 선거 정보 */}
          <div className="rounded-lg border border-white/10 bg-zinc-800/50 p-3 space-y-2">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">선거 정보</p>
            <div>
              <label className={labelClass}>선거명</label>
              <input
                className={inputClass}
                value={form.electionName}
                onChange={(e) => setForm({ ...form, electionName: e.target.value })}
                placeholder="예: 제22대 국회의원 선거"
              />
            </div>
            <div>
              <label className={labelClass}>선거일</label>
              <input
                type="date"
                className={inputClass}
                value={form.electionDate}
                onChange={(e) => setForm({ ...form, electionDate: e.target.value })}
              />
            </div>
            {form.electionDate && (
              <p className="text-xs text-zinc-400">
                {(() => {
                  const d = calcDDay(form.electionDate);
                  return d !== null ? `선거까지 ${formatDDay(d)}` : "";
                })()}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Editor Props
   ═══════════════════════════════════════════════ */
interface EditorBaseProps {
  block: Block;
  onSaving: () => void;
  onSaved: () => void;
  onCancel: () => void;
}

/* ── Editor Action Buttons ── */
function EditorActions({
  onSave,
  onCancel,
  saving,
}: {
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/10">
      <button onClick={onCancel} className={btnSecondary}>
        취소
      </button>
      <button onClick={onSave} className={btnPrimary} disabled={saving}>
        {saving ? "저장 중..." : "저장"}
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Hero Editor
   ═══════════════════════════════════════════════ */
function HeroEditor({
  block,
  settings: initialSettings,
  setSettings,
  setBlocks,
  onSaving,
  onSaved,
  onCancel,
}: EditorBaseProps & { settings: SiteSettings; setSettings: React.Dispatch<React.SetStateAction<SiteSettings>>; setBlocks: React.Dispatch<React.SetStateAction<Block[]>> }) {
  const heroContent = block.content as {
    button1Text?: string;
    button1Link?: string;
    button2Text?: string;
    button2Link?: string;
    badgeFontSize?: number;
    electionFontSize?: number;
  } | null;

  const [form, setForm] = useState({
    heroImageUrl: initialSettings.heroImageUrl || "",
    heroSlogan: initialSettings.heroSlogan || "",
    heroSubSlogan: initialSettings.heroSubSlogan || "",
    partyName: initialSettings.partyName || "",
    positionTitle: initialSettings.positionTitle || "",
    primaryColor: initialSettings.primaryColor || "#C9151E",
    accentColor: initialSettings.accentColor || "#1A56DB",
  });

  const [heroUploading, setHeroUploading] = useState(false);
  const [heroPreviewUrl, setHeroPreviewUrl] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryFiles, setLibraryFiles] = useState<{ id: number; storedPath: string; originalName: string; fileType: string; createdAt: string }[]>([]);
  const heroFileRef = useRef<HTMLInputElement>(null);

  // Update both local form and parent settings for live preview
  const updateField = (field: string, value: string) => {
    const newForm = { ...form, [field]: value };
    setForm(newForm);
    setSettings((prev: SiteSettings) => ({ ...prev, [field]: value }));
  };

  const [buttonForm, setButtonForm] = useState({
    button1Text: heroContent?.button1Text || "공약 보기",
    button1Link: heroContent?.button1Link || "#pledges",
    button2Text: heroContent?.button2Text || "후보 소개",
    button2Link: heroContent?.button2Link || "#about",
    badgeFontSize: heroContent?.badgeFontSize || 12,
    electionFontSize: heroContent?.electionFontSize || 12,
  });

  // 블록 콘텐츠 실시간 업데이트 (미리보기 즉시 반영)
  function updateBlockContent(updates: Record<string, unknown>) {
    const newButtonForm = { ...buttonForm, ...updates };
    setButtonForm(newButtonForm as typeof buttonForm);
    // blocks state 직접 업데이트 → 미리보기 즉시 반영
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === block.id
          ? { ...b, content: { ...heroContent, ...newButtonForm, ...updates } }
          : b
      )
    );
  }

  // Update CSS custom properties in real-time when colors change
  function handleColorChange(field: "primaryColor" | "accentColor", value: string) {
    updateField(field, value);
  }

  async function save() {
    onSaving();
    await apiFetch("/api/site/settings", {
      method: "PUT",
      body: JSON.stringify({
        heroImageUrl: form.heroImageUrl,
        heroSlogan: form.heroSlogan,
        heroSubSlogan: form.heroSubSlogan,
        partyName: form.partyName,
        positionTitle: form.positionTitle,
        primaryColor: form.primaryColor,
        accentColor: form.accentColor,
      }),
    });
    await apiFetch(`/api/site/blocks/${block.id}`, {
      method: "PUT",
      body: JSON.stringify({
        content: {
          heroImageUrl: form.heroImageUrl,
          heroSlogan: form.heroSlogan,
          heroSubSlogan: form.heroSubSlogan,
          button1Text: buttonForm.button1Text,
          button1Link: buttonForm.button1Link,
          button2Text: buttonForm.button2Text,
          button2Link: buttonForm.button2Link,
          badgeFontSize: buttonForm.badgeFontSize,
          electionFontSize: buttonForm.electionFontSize,
        },
      }),
    });
    onSaved();
  }

  return (
    <div className="space-y-3">
      {/* Color customization */}
      <div className="rounded-lg border border-white/10 bg-zinc-800/30 p-3 space-y-3">
        <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">색상 설정</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>메인 색상</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.primaryColor}
                onChange={(e) => handleColorChange("primaryColor", e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-white/10 bg-transparent p-0.5"
              />
              <input
                className={`${inputClass} flex-1`}
                value={form.primaryColor}
                onChange={(e) => handleColorChange("primaryColor", e.target.value)}
                placeholder="#C9151E"
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>강조 색상</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.accentColor}
                onChange={(e) => handleColorChange("accentColor", e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-white/10 bg-transparent p-0.5"
              />
              <input
                className={`${inputClass} flex-1`}
                value={form.accentColor}
                onChange={(e) => handleColorChange("accentColor", e.target.value)}
                placeholder="#1A56DB"
              />
            </div>
          </div>
        </div>
      </div>

      <div>
        <label className={labelClass}>히어로 이미지</label>
        <p className="text-[10px] text-zinc-600 mb-1.5">권장: 1600 x 900px (16:9)</p>
        <div className="flex gap-2 items-center flex-wrap">
          <input
            ref={heroFileRef}
            type="file"
            accept="image/*"
            className="absolute w-0 h-0 opacity-0 overflow-hidden"
            disabled={heroUploading}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const previewUrl = URL.createObjectURL(file);
              setHeroPreviewUrl(previewUrl);
              setHeroUploading(true);
              const fd = new FormData();
              fd.append("file", file);
              const res = await fetch("/api/upload/hero", { method: "POST", body: fd });
              const json = await res.json();
              setHeroUploading(false);
              if (json.success) {
                updateField("heroImageUrl", json.data.url);
              }
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className={`${btnSecondary} inline-flex items-center gap-1`}
            disabled={heroUploading}
            onClick={() => heroFileRef.current?.click()}
          >
            {heroUploading ? "업로드 중..." : "📷 새 이미지"}
          </button>
          <button
            type="button"
            className={`${btnSecondary} inline-flex items-center gap-1`}
            onClick={async () => {
              if (!showLibrary) {
                const res = await apiFetch<{ id: number; storedPath: string; originalName: string; fileType: string; createdAt: string }[]>("/api/upload");
                if (res.success && res.data) setLibraryFiles(res.data);
              }
              setShowLibrary(!showLibrary);
            }}
          >
            {showLibrary ? "닫기" : "📁 라이브러리"}
          </button>
          {form.heroImageUrl && (
            <button
              className="text-xs text-red-400 hover:text-red-300"
              onClick={() => { updateField("heroImageUrl", ""); setHeroPreviewUrl(null); }}
            >
              삭제
            </button>
          )}
        </div>
        {(heroPreviewUrl || form.heroImageUrl) && (
          <div className="mt-2 rounded-lg overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={heroPreviewUrl || form.heroImageUrl} alt="preview" className="h-24 w-full object-cover rounded-lg" />
          </div>
        )}
        {showLibrary && (
          <div className="mt-2 rounded-lg border border-white/10 bg-zinc-800/50 p-2 max-h-48 overflow-y-auto">
            <p className="text-[10px] text-zinc-500 mb-1.5">이전에 업로드한 이미지를 선택하세요</p>
            {libraryFiles.length === 0 && (
              <p className="text-xs text-zinc-600 text-center py-4">업로드한 이미지가 없습니다</p>
            )}
            <div className="grid grid-cols-4 gap-1.5">
              {libraryFiles.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    updateField("heroImageUrl", f.storedPath);
                    setHeroPreviewUrl(null);
                    setShowLibrary(false);
                  }}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors ${
                    form.heroImageUrl === f.storedPath ? "border-blue-500" : "border-transparent hover:border-white/20"
                  }`}
                  title={f.originalName || ""}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.storedPath} alt={f.originalName || ""} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div>
        <label className={labelClass}>슬로건 (제목)</label>
        <input
          className={inputClass}
          value={form.heroSlogan}
          onChange={(e) => updateField("heroSlogan", e.target.value)}
          placeholder="메인 슬로건"
        />
      </div>
      <div>
        <label className={labelClass}>서브 슬로건</label>
        <input
          className={inputClass}
          value={form.heroSubSlogan}
          onChange={(e) => updateField("heroSubSlogan", e.target.value)}
          placeholder="서브 슬로건"
        />
      </div>
      <div>
        <label className={labelClass}>당명</label>
        <input
          className={inputClass}
          value={form.partyName}
          onChange={(e) => updateField("partyName", e.target.value)}
          placeholder="정당명"
        />
      </div>
      <div>
        <label className={labelClass}>직함</label>
        <input
          className={inputClass}
          value={form.positionTitle}
          onChange={(e) => updateField("positionTitle", e.target.value)}
          placeholder="예: 제00대 국회의원 후보"
        />
      </div>

      {/* Font size controls */}
      <div className="rounded-lg border border-white/10 bg-zinc-800/30 p-3 space-y-3">
        <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">글씨 크기 (px)</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>당명</label>
            <input
              type="number"
              min={8}
              max={40}
              className={inputClass}
              value={buttonForm.badgeFontSize}
              onChange={(e) => updateBlockContent({ badgeFontSize: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className={labelClass}>선거 D-Day</label>
            <input
              type="number"
              min={8}
              max={40}
              className={inputClass}
              value={buttonForm.electionFontSize}
              onChange={(e) => updateBlockContent({ electionFontSize: Number(e.target.value) })}
            />
          </div>
        </div>
      </div>

      {/* Button customization */}
      <div className="rounded-lg border border-white/10 bg-zinc-800/30 p-3 space-y-3">
        <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">버튼 설정</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>버튼1 텍스트</label>
            <input
              className={inputClass}
              value={buttonForm.button1Text}
              onChange={(e) => setButtonForm({ ...buttonForm, button1Text: e.target.value })}
              placeholder="공약 보기"
            />
          </div>
          <div>
            <label className={labelClass}>버튼1 링크</label>
            <input
              className={inputClass}
              value={buttonForm.button1Link}
              onChange={(e) => setButtonForm({ ...buttonForm, button1Link: e.target.value })}
              placeholder="#pledges"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>버튼2 텍스트</label>
            <input
              className={inputClass}
              value={buttonForm.button2Text}
              onChange={(e) => setButtonForm({ ...buttonForm, button2Text: e.target.value })}
              placeholder="후보 소개"
            />
          </div>
          <div>
            <label className={labelClass}>버튼2 링크</label>
            <input
              className={inputClass}
              value={buttonForm.button2Link}
              onChange={(e) => setButtonForm({ ...buttonForm, button2Link: e.target.value })}
              placeholder="#about"
            />
          </div>
        </div>
      </div>

      <EditorActions onSave={save} onCancel={onCancel} />
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Intro Editor
   ═══════════════════════════════════════════════ */
function IntroEditor({
  block,
  settings: initialSettings,
  setSettings,
  onSaving,
  onSaved,
  onCancel,
}: EditorBaseProps & { settings: SiteSettings; setSettings: React.Dispatch<React.SetStateAction<SiteSettings>> }) {
  const [form, setForm] = useState({
    subtitle: initialSettings.subtitle || "",
    introText: initialSettings.introText || "",
    profileImageUrl: initialSettings.profileImageUrl || "",
  });
  const [profileUploading, setProfileUploading] = useState(false);
  const [profilePreviewUrl, setProfilePreviewUrl] = useState<string | null>(null);
  const [showProfileLibrary, setShowProfileLibrary] = useState(false);
  const [profileLibraryFiles, setProfileLibraryFiles] = useState<{ id: number; storedPath: string; originalName: string; fileType: string; createdAt: string }[]>([]);
  const profileFileRef = useRef<HTMLInputElement>(null);

  // Update both local form and parent settings for live preview
  const updateField = (field: string, value: string) => {
    const newForm = { ...form, [field]: value };
    setForm(newForm);
    setSettings((prev: SiteSettings) => ({ ...prev, [field]: value }));
  };

  async function save() {
    onSaving();
    await apiFetch("/api/site/settings", {
      method: "PUT",
      body: JSON.stringify(form),
    });
    await apiFetch(`/api/site/blocks/${block.id}`, {
      method: "PUT",
      body: JSON.stringify({
        content: { subtitle: form.subtitle, introText: form.introText },
      }),
    });
    onSaved();
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>프로필 이미지</label>
        <div className="flex gap-2 items-center">
          <input
            ref={profileFileRef}
            type="file"
            accept="image/*"
            className="absolute w-0 h-0 opacity-0 overflow-hidden"
            disabled={profileUploading}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const previewUrl = URL.createObjectURL(file);
              setProfilePreviewUrl(previewUrl);
              setProfileUploading(true);
              const fd = new FormData();
              fd.append("file", file);
              const res = await fetch("/api/upload/image", { method: "POST", body: fd });
              const json = await res.json();
              setProfileUploading(false);
              if (json.success) {
                updateField("profileImageUrl", json.data.url);
              }
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className={`${btnSecondary} inline-flex items-center gap-1`}
            disabled={profileUploading}
            onClick={() => profileFileRef.current?.click()}
          >
            {profileUploading ? "업로드 중..." : "📷 이미지 선택"}
          </button>
          <button
            type="button"
            className={`${btnSecondary} inline-flex items-center gap-1`}
            onClick={async () => {
              if (!showProfileLibrary) {
                const res = await apiFetch<{ id: number; storedPath: string; originalName: string; fileType: string; createdAt: string }[]>("/api/upload");
                if (res.success && res.data) setProfileLibraryFiles(res.data);
              }
              setShowProfileLibrary(!showProfileLibrary);
            }}
          >
            {showProfileLibrary ? "닫기" : "📁 라이브러리"}
          </button>
          {form.profileImageUrl && (
            <button className="text-xs text-red-400 hover:text-red-300" onClick={() => { updateField("profileImageUrl", ""); setProfilePreviewUrl(null); }}>삭제</button>
          )}
        </div>
        {(profilePreviewUrl || form.profileImageUrl) && (
          <div className="mt-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={profilePreviewUrl || form.profileImageUrl} alt="preview" className="h-16 w-16 object-cover rounded-full" />
          </div>
        )}
        {showProfileLibrary && (
          <div className="mt-2 rounded-lg border border-white/10 bg-zinc-800/50 p-2 max-h-48 overflow-y-auto">
            <p className="text-[10px] text-zinc-500 mb-1.5">이전에 업로드한 이미지를 선택하세요</p>
            {profileLibraryFiles.length === 0 && (
              <p className="text-xs text-zinc-600 text-center py-4">업로드한 이미지가 없습니다</p>
            )}
            <div className="grid grid-cols-4 gap-1.5">
              {profileLibraryFiles.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    updateField("profileImageUrl", f.storedPath);
                    setProfilePreviewUrl(null);
                    setShowProfileLibrary(false);
                  }}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors ${
                    form.profileImageUrl === f.storedPath ? "border-blue-500" : "border-transparent hover:border-white/20"
                  }`}
                  title={f.originalName || ""}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.storedPath} alt={f.originalName || ""} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div>
        <label className={labelClass}>제목 (부제)</label>
        <input
          className={inputClass}
          value={form.subtitle}
          onChange={(e) => updateField("subtitle", e.target.value)}
          placeholder="소개 섹션 제목"
        />
      </div>
      <div>
        <label className={labelClass}>소개 내용</label>
        <textarea
          className={`${inputClass} min-h-[100px] resize-y`}
          value={form.introText}
          onChange={(e) => updateField("introText", e.target.value)}
          placeholder="소개 내용을 입력해주세요"
        />
      </div>
      <EditorActions onSave={save} onCancel={onCancel} />
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Career Editor
   ═══════════════════════════════════════════════ */
function CareerEditor({
  block,
  items: initialItems,
  onSaving,
  onSaved,
  onCancel,
}: EditorBaseProps & { items: ProfileItem[] }) {
  const [items, setItems] = useState<ProfileItem[]>(
    [...initialItems].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  );
  const [newItem, setNewItem] = useState<ProfileItem>({
    type: "career",
    title: "",
    isCurrent: false,
  });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ type: "career", title: "", isCurrent: false });
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  async function addItem() {
    if (!newItem.title.trim()) return;
    onSaving();
    const res = await apiFetch<ProfileItem>("/api/site/profiles", {
      method: "POST",
      body: JSON.stringify(newItem),
    });
    if (res.success && res.data) {
      setItems((prev) => [res.data!, ...prev]);
      setNewItem({ type: "career", title: "", isCurrent: false });
    }
    onSaved();
  }

  async function removeItem(id: number) {
    onSaving();
    await apiFetch(`/api/site/profiles/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
    onSaved();
  }

  async function swapOrder(idx: number, direction: "up" | "down") {
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= items.length) return;
    const newItems = [...items];
    [newItems[idx], newItems[targetIdx]] = [newItems[targetIdx], newItems[idx]];
    setItems(newItems);
    const ids = newItems.map((i) => i.id!);
    await apiFetch("/api/site/profiles/reorder", {
      method: "PUT",
      body: JSON.stringify({ ids }),
    });
    onSaved();
  }

  function startEdit(item: ProfileItem) {
    setEditingId(item.id!);
    setEditForm({ type: item.type, title: item.title, isCurrent: item.isCurrent });
  }

  async function saveEdit() {
    if (!editingId) return;
    onSaving();
    const res = await apiFetch<ProfileItem>(`/api/site/profiles/${editingId}`, {
      method: "PUT",
      body: JSON.stringify({
        type: editForm.type,
        title: editForm.title,
        isCurrent: editForm.isCurrent,
      }),
    });
    if (res.success && res.data) {
      setItems((prev) => prev.map((i) => (i.id === editingId ? res.data! : i)));
    }
    setEditingId(null);
    onSaved();
  }

  return (
    <div className="space-y-3">
      {items.length > 0 && (
        <div className="space-y-1.5 max-h-60 overflow-y-auto">
          {items.map((item, idx) => {
            const isEditing = editingId === item.id;

            if (isEditing) {
              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-blue-500/30 bg-zinc-800/80 p-3 space-y-2"
                >
                  <p className="text-xs font-medium text-blue-400">항목 수정</p>
                  <div className="flex gap-2">
                    <select
                      className={`${inputClass} w-24`}
                      value={editForm.type}
                      onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                    >
                      <option value="career">경력</option>
                      <option value="education">학력</option>
                    </select>
                    <input
                      className={`${inputClass} flex-1`}
                      value={editForm.title}
                      onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                      placeholder="내용 입력"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editForm.isCurrent}
                      onChange={(e) => setEditForm({ ...editForm, isCurrent: e.target.checked })}
                      className="rounded"
                    />
                    현재 진행 중
                  </label>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditingId(null)} className={btnSecondary}>
                      취소
                    </button>
                    <button onClick={saveEdit} className={btnPrimary}>
                      저장
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={item.id}
                draggable
                onDragStart={() => setDragIdx(idx)}
                onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
                onDragLeave={() => setDragOverIdx(null)}
                onDrop={async () => {
                  if (dragIdx === null || dragIdx === idx) return;
                  const newItems = [...items];
                  const [moved] = newItems.splice(dragIdx, 1);
                  newItems.splice(idx, 0, moved);
                  setItems(newItems);
                  setDragIdx(null);
                  setDragOverIdx(null);
                  const ids = newItems.map((i) => i.id!);
                  await apiFetch("/api/site/profiles/reorder", { method: "PUT", body: JSON.stringify({ ids }) });
                  onSaved();
                }}
                onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-grab transition-all ${
                  dragIdx === idx ? "opacity-40 border-blue-500/30 bg-zinc-800/30" :
                  dragOverIdx === idx ? "border-blue-400/50 bg-blue-900/20" :
                  "border-white/5 bg-zinc-800/50"
                }`}
              >
                {/* Reorder buttons */}
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => swapOrder(idx, "up")}
                    disabled={idx === 0}
                    className="text-zinc-600 hover:text-zinc-300 disabled:opacity-20 transition-colors"
                    title="위로"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => swapOrder(idx, "down")}
                    disabled={idx === items.length - 1}
                    className="text-zinc-600 hover:text-zinc-300 disabled:opacity-20 transition-colors"
                    title="아래로"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>

                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    item.type === "education"
                      ? "bg-blue-500/20 text-blue-400"
                      : "bg-green-500/20 text-green-400"
                  }`}
                >
                  {item.type === "education" ? "학력" : "경력"}
                </span>
                <span className="flex-1 text-sm text-zinc-200 truncate">
                  {item.title}
                </span>
                {item.isCurrent && (
                  <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                    현재
                  </span>
                )}
                {/* Edit button */}
                <button
                  onClick={() => startEdit(item)}
                  className="text-zinc-600 hover:text-blue-400 transition-colors"
                  title="수정"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                {/* Delete button */}
                <button
                  onClick={() => item.id && removeItem(item.id)}
                  className="text-zinc-600 hover:text-red-400 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-lg border border-white/10 bg-zinc-800/30 p-3 space-y-2">
        <p className="text-xs font-medium text-zinc-500">새 항목 추가</p>
        <div className="flex gap-2">
          <select
            className={`${inputClass} w-24`}
            value={newItem.type}
            onChange={(e) => setNewItem({ ...newItem, type: e.target.value })}
          >
            <option value="career">경력</option>
            <option value="education">학력</option>
          </select>
          <input
            className={`${inputClass} flex-1`}
            value={newItem.title}
            onChange={(e) => setNewItem({ ...newItem, title: e.target.value })}
            placeholder="내용 입력"
            onKeyDown={(e) => e.key === "Enter" && addItem()}
          />
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={newItem.isCurrent}
              onChange={(e) =>
                setNewItem({ ...newItem, isCurrent: e.target.checked })
              }
              className="rounded"
            />
            현재 진행 중
          </label>
          <button onClick={addItem} className={btnPrimary}>
            추가
          </button>
        </div>
      </div>

      <EditorActions onSave={onCancel} onCancel={onCancel} />
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Goals Editor
   ═══════════════════════════════════════════════ */
function GoalsEditor({
  block,
  items: initialItems,
  onSaving,
  onSaved,
  onCancel,
}: EditorBaseProps & { items: PledgeItem[] }) {
  const [items, setItems] = useState<PledgeItem[]>(
    [...initialItems].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  );
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ title: "", description: "", details: "" as string, imageUrl: "" });
  const pledgeFileRef = useRef<HTMLInputElement>(null);
  const [pledgeUploading, setPledgeUploading] = useState(false);
  const [showPledgeLibrary, setShowPledgeLibrary] = useState(false);
  const [pledgeLibraryFiles, setPledgeLibraryFiles] = useState<{ id: number; storedPath: string; originalName: string; fileType: string; createdAt: string }[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Helper to parse details (supports old string[] and new {items, imageUrl} format)
  function parseDetails(details: unknown): { items: string[]; imageUrl: string | null } {
    if (Array.isArray(details)) return { items: details, imageUrl: null };
    if (details && typeof details === "object" && "items" in (details as Record<string, unknown>)) {
      const d = details as { items: string[]; imageUrl?: string };
      return { items: d.items || [], imageUrl: d.imageUrl || null };
    }
    return { items: [], imageUrl: null };
  }

  // Helper to build details for API
  function buildDetails(itemsList: string[], imageUrl: string | null): unknown {
    if (imageUrl) return { items: itemsList, imageUrl };
    return itemsList;
  }

  async function addItem() {
    if (!newTitle.trim()) return;
    onSaving();
    const res = await apiFetch<PledgeItem>("/api/site/pledges", {
      method: "POST",
      body: JSON.stringify({
        title: newTitle,
        description: newDesc || null,
        icon: "🎯",
        details: [],
      }),
    });
    if (res.success && res.data) {
      setItems((prev) => [res.data!, ...prev]);
      setNewTitle("");
      setNewDesc("");
    }
    onSaved();
  }

  async function removeItem(id: number) {
    onSaving();
    await apiFetch(`/api/site/pledges/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
    onSaved();
  }

  async function swapOrder(idx: number, direction: "up" | "down") {
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= items.length) return;
    const newItems = [...items];
    [newItems[idx], newItems[targetIdx]] = [newItems[targetIdx], newItems[idx]];
    setItems(newItems);
    // Persist reorder
    const ids = newItems.map((i) => i.id!);
    await apiFetch("/api/site/pledges/reorder", {
      method: "PUT",
      body: JSON.stringify({ ids }),
    });
    onSaved();
  }

  function startEdit(item: PledgeItem) {
    const parsed = parseDetails(item.details);
    setEditingId(item.id!);
    setEditForm({
      title: item.title,
      description: item.description || "",
      details: parsed.items.join("\n"),
      imageUrl: parsed.imageUrl || "",
    });
    // Scroll preview to pledges section
    const previewFrame = document.querySelector("[data-preview-frame]");
    if (previewFrame) {
      const pledgeEl = previewFrame.querySelector("#pledges");
      pledgeEl?.scrollIntoView({ behavior: "smooth" });
    }
  }

  async function saveEdit() {
    if (!editingId) return;
    onSaving();
    const detailItems = editForm.details.split("\n").map((s) => s.trim()).filter(Boolean);
    const details = buildDetails(detailItems, editForm.imageUrl || null);
    const res = await apiFetch<PledgeItem>(`/api/site/pledges/${editingId}`, {
      method: "PUT",
      body: JSON.stringify({
        title: editForm.title,
        description: editForm.description || null,
        details,
      }),
    });
    if (res.success && res.data) {
      setItems((prev) => prev.map((i) => (i.id === editingId ? res.data! : i)));
    }
    setEditingId(null);
    onSaved();
  }

  async function handlePledgeImageUpload(file: File) {
    setPledgeUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const uploadRes = await fetch("/api/upload/image", { method: "POST", body: fd });
    const uploadJson = await uploadRes.json();
    if (uploadJson.success) {
      setEditForm((prev) => ({ ...prev, imageUrl: uploadJson.data.url }));
    }
    setPledgeUploading(false);
  }

  return (
    <div className="space-y-3">
      {/* Hidden file input for pledge image */}
      <input
        ref={pledgeFileRef}
        type="file"
        accept="image/*"
        className="absolute w-0 h-0 opacity-0 overflow-hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handlePledgeImageUpload(file);
          e.target.value = "";
        }}
      />

      {items.length > 0 && (
        <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
          {items.map((item, idx) => {
            const parsed = parseDetails(item.details);
            const isEditing = editingId === item.id;

            if (isEditing) {
              return (
                <div
                  key={item.id || idx}
                  className="rounded-lg border border-blue-500/30 bg-zinc-800/80 p-3 space-y-2"
                >
                  <p className="text-xs font-medium text-blue-400">공약 수정</p>
                  <input
                    className={inputClass}
                    value={editForm.title}
                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    placeholder="공약 제목"
                  />
                  <input
                    className={inputClass}
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    placeholder="공약 설명 (선택)"
                  />
                  <textarea
                    className={`${inputClass} min-h-[60px] resize-y`}
                    value={editForm.details}
                    onChange={(e) => setEditForm({ ...editForm, details: e.target.value })}
                    placeholder="세부 공약 (줄바꿈으로 구분)"
                    rows={3}
                  />
                  {/* Image section */}
                  <div className="space-y-1">
                    <label className={labelClass}>공약 이미지</label>
                    {editForm.imageUrl && (
                      <div className="relative inline-block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={editForm.imageUrl} alt="" className="h-20 w-auto rounded-lg object-cover" />
                        <button
                          onClick={() => setEditForm({ ...editForm, imageUrl: "" })}
                          className="absolute -top-1 -right-1 rounded-full bg-red-500 p-0.5 text-white"
                        >
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    )}
                    <div className="flex gap-2 items-center flex-wrap">
                      <button
                        type="button"
                        className={`${btnSecondary} text-xs`}
                        disabled={pledgeUploading}
                        onClick={() => pledgeFileRef.current?.click()}
                      >
                        {pledgeUploading ? "업로드 중..." : editForm.imageUrl ? "이미지 변경" : "이미지 추가"}
                      </button>
                      <button
                        type="button"
                        className={`${btnSecondary} text-xs`}
                        onClick={async () => {
                          if (!showPledgeLibrary) {
                            const res = await apiFetch<{ id: number; storedPath: string; originalName: string; fileType: string; createdAt: string }[]>("/api/upload");
                            if (res.success && res.data) setPledgeLibraryFiles(res.data);
                          }
                          setShowPledgeLibrary(!showPledgeLibrary);
                        }}
                      >
                        {showPledgeLibrary ? "닫기" : "📁 라이브러리"}
                      </button>
                    </div>
                    {showPledgeLibrary && (
                      <div className="mt-1 rounded-lg border border-white/10 bg-zinc-800/50 p-2 max-h-48 overflow-y-auto">
                        <p className="text-[10px] text-zinc-500 mb-1.5">이전에 업로드한 이미지를 선택하세요</p>
                        {pledgeLibraryFiles.length === 0 && (
                          <p className="text-xs text-zinc-600 text-center py-4">업로드한 이미지가 없습니다</p>
                        )}
                        <div className="grid grid-cols-4 gap-1.5">
                          {pledgeLibraryFiles.map((f) => (
                            <button
                              key={f.id}
                              onClick={() => {
                                setEditForm((prev) => ({ ...prev, imageUrl: f.storedPath }));
                                setShowPledgeLibrary(false);
                              }}
                              className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors ${
                                editForm.imageUrl === f.storedPath ? "border-blue-500" : "border-transparent hover:border-white/20"
                              }`}
                              title={f.originalName || ""}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={f.storedPath} alt={f.originalName || ""} className="h-full w-full object-cover" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditingId(null)} className={btnSecondary}>
                      취소
                    </button>
                    <button onClick={saveEdit} className={btnPrimary}>
                      저장
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={item.id || idx}
                draggable
                onDragStart={() => setDragIdx(idx)}
                onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
                onDragLeave={() => setDragOverIdx(null)}
                onDrop={async () => {
                  if (dragIdx === null || dragIdx === idx) return;
                  const newItems = [...items];
                  const [moved] = newItems.splice(dragIdx, 1);
                  newItems.splice(idx, 0, moved);
                  setItems(newItems);
                  setDragIdx(null);
                  setDragOverIdx(null);
                  const ids = newItems.map((i) => i.id!);
                  await apiFetch("/api/site/pledges/reorder", { method: "PUT", body: JSON.stringify({ ids }) });
                  onSaved();
                }}
                onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-grab transition-all ${
                  dragIdx === idx ? "opacity-40 border-blue-500/30 bg-zinc-800/30" :
                  dragOverIdx === idx ? "border-blue-400/50 bg-blue-900/20" :
                  "border-white/5 bg-zinc-800/50"
                }`}
              >
                {/* Reorder buttons */}
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => swapOrder(idx, "up")}
                    disabled={idx === 0}
                    className="text-zinc-600 hover:text-zinc-300 disabled:opacity-20 transition-colors"
                    title="위로"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => swapOrder(idx, "down")}
                    disabled={idx === items.length - 1}
                    className="text-zinc-600 hover:text-zinc-300 disabled:opacity-20 transition-colors"
                    title="아래로"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>

                <span className="text-zinc-500 text-xs font-bold">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                {parsed.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={parsed.imageUrl} alt="" className="h-8 w-8 rounded object-cover flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-zinc-200 truncate block">
                    {item.title}
                  </span>
                  {item.description && (
                    <span className="text-xs text-zinc-500 truncate block">
                      {item.description}
                    </span>
                  )}
                </div>
                {/* Edit button */}
                <button
                  onClick={() => startEdit(item)}
                  className="text-zinc-600 hover:text-blue-400 transition-colors"
                  title="수정"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                {/* Delete button */}
                <button
                  onClick={() => item.id && removeItem(item.id)}
                  className="text-zinc-600 hover:text-red-400 transition-colors"
                  title="삭제"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-lg border border-white/10 bg-zinc-800/30 p-3 space-y-2">
        <p className="text-xs font-medium text-zinc-500">새 공약 추가</p>
        <input
          className={inputClass}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="공약 제목"
        />
        <input
          className={inputClass}
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          placeholder="공약 설명 (선택)"
        />
        <div className="flex justify-end">
          <button onClick={addItem} className={btnPrimary}>
            추가
          </button>
        </div>
      </div>

      <EditorActions onSave={onCancel} onCancel={onCancel} />
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Gallery Editor
   ═══════════════════════════════════════════════ */
function GalleryEditor({
  block,
  items: initialItems,
  onSaving,
  onSaved,
  onCancel,
}: EditorBaseProps & { items: GalleryItem[] }) {
  const [items, setItems] = useState<GalleryItem[]>(
    [...initialItems].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  );
  const [newUrl, setNewUrl] = useState("");
  const [newAlt, setNewAlt] = useState("");
  const [newCat, setNewCat] = useState("campaign");
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [galleryPreviewUrl, setGalleryPreviewUrl] = useState<string | null>(null);
  const [showGalleryLibrary, setShowGalleryLibrary] = useState(false);
  const [galleryLibraryFiles, setGalleryLibraryFiles] = useState<{ id: number; storedPath: string; originalName: string; fileType: string; createdAt: string }[]>([]);
  const galleryFileRef = useRef<HTMLInputElement>(null);
  const [editingGalleryId, setEditingGalleryId] = useState<number | null>(null);
  const [galleryEditForm, setGalleryEditForm] = useState({ altText: "", category: "" });
  const [galDragIdx, setGalDragIdx] = useState<number | null>(null);
  const [galDragOverIdx, setGalDragOverIdx] = useState<number | null>(null);

  async function addItem() {
    if (!newUrl.trim()) return;
    onSaving();
    const res = await apiFetch<GalleryItem>("/api/site/gallery", {
      method: "POST",
      body: JSON.stringify({
        url: newUrl,
        altText: newAlt || null,
        category: newCat,
      }),
    });
    if (res.success && res.data) {
      // New uploads appear at the top (sortOrder = 0, shift others)
      setItems((prev) => [res.data!, ...prev]);
      // Reorder to persist: new item first, then the rest
      const newIds = [res.data!.id!, ...items.map((i) => i.id!)];
      await apiFetch("/api/site/gallery/reorder", {
        method: "PUT",
        body: JSON.stringify({ ids: newIds }),
      });
      setNewUrl("");
      setNewAlt("");
    }
    onSaved();
  }

  async function removeItem(id: number) {
    onSaving();
    await apiFetch(`/api/site/gallery/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
    onSaved();
  }

  async function swapGalleryOrder(idx: number, direction: "up" | "down") {
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= items.length) return;
    const newItems = [...items];
    [newItems[idx], newItems[targetIdx]] = [newItems[targetIdx], newItems[idx]];
    setItems(newItems);
    const ids = newItems.map((i) => i.id!);
    await apiFetch("/api/site/gallery/reorder", {
      method: "PUT",
      body: JSON.stringify({ ids }),
    });
    onSaved();
  }

  function startGalleryEdit(item: GalleryItem) {
    setEditingGalleryId(item.id!);
    setGalleryEditForm({ altText: item.altText || "", category: item.category });
  }

  async function saveGalleryEdit() {
    if (!editingGalleryId) return;
    onSaving();
    const res = await apiFetch<GalleryItem>(`/api/site/gallery/${editingGalleryId}`, {
      method: "PUT",
      body: JSON.stringify({
        altText: galleryEditForm.altText || null,
        category: galleryEditForm.category,
      }),
    });
    if (res.success && res.data) {
      setItems((prev) => prev.map((i) => (i.id === editingGalleryId ? res.data! : i)));
    }
    setEditingGalleryId(null);
    onSaved();
  }

  return (
    <div className="space-y-3">
      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-2 max-h-[300px] overflow-y-auto">
          {items.map((item, idx) => (
            <div
              key={item.id}
              className={`relative group cursor-grab transition-all ${
                galDragIdx === idx ? "opacity-40 ring-2 ring-blue-500/30" :
                galDragOverIdx === idx ? "ring-2 ring-blue-400/50" : ""
              }`}
              draggable
              onDragStart={() => setGalDragIdx(idx)}
              onDragOver={(e) => { e.preventDefault(); setGalDragOverIdx(idx); }}
              onDragLeave={() => setGalDragOverIdx(null)}
              onDrop={async () => {
                if (galDragIdx === null || galDragIdx === idx) return;
                const newItems = [...items];
                const [moved] = newItems.splice(galDragIdx, 1);
                newItems.splice(idx, 0, moved);
                setItems(newItems);
                setGalDragIdx(null);
                setGalDragOverIdx(null);
                const ids = newItems.map((i) => i.id!);
                await apiFetch("/api/site/gallery/reorder", { method: "PUT", body: JSON.stringify({ ids }) });
                onSaved();
              }}
              onDragEnd={() => { setGalDragIdx(null); setGalDragOverIdx(null); }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.url}
                alt={item.altText || ""}
                className="aspect-square w-full rounded-lg object-cover"
              />
              {/* Overlay controls */}
              <div className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
                {/* Move up */}
                <button
                  onClick={() => swapGalleryOrder(idx, "up")}
                  disabled={idx === 0}
                  className="rounded-full bg-white/20 p-1 text-white hover:bg-white/40 disabled:opacity-30 transition-colors"
                  title="앞으로"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                {/* Edit */}
                <button
                  onClick={() => startGalleryEdit(item)}
                  className="rounded-full bg-white/20 p-1 text-white hover:bg-blue-500/60 transition-colors"
                  title="수정"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                {/* Move down */}
                <button
                  onClick={() => swapGalleryOrder(idx, "down")}
                  disabled={idx === items.length - 1}
                  className="rounded-full bg-white/20 p-1 text-white hover:bg-white/40 disabled:opacity-30 transition-colors"
                  title="뒤로"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                {/* Delete */}
                <button
                  onClick={() => item.id && removeItem(item.id)}
                  className="rounded-full bg-red-500/60 p-1 text-white hover:bg-red-500/80 transition-colors"
                  title="삭제"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {/* Category badge */}
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white/80">
                {item.category}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Gallery edit form (inline) */}
      {editingGalleryId && (
        <div className="rounded-lg border border-blue-500/30 bg-zinc-800/80 p-3 space-y-2">
          <p className="text-xs font-medium text-blue-400">사진 정보 수정</p>
          <input
            className={inputClass}
            value={galleryEditForm.altText}
            onChange={(e) => setGalleryEditForm({ ...galleryEditForm, altText: e.target.value })}
            placeholder="사진 설명"
          />
          <select
            className={inputClass}
            value={galleryEditForm.category}
            onChange={(e) => setGalleryEditForm({ ...galleryEditForm, category: e.target.value })}
          >
            <option value="activity">활동</option>
            <option value="campaign">캠페인</option>
            <option value="event">행사</option>
            <option value="media">언론</option>
            <option value="blog">블로그</option>
          </select>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditingGalleryId(null)} className={btnSecondary}>
              취소
            </button>
            <button onClick={saveGalleryEdit} className={btnPrimary}>
              저장
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-white/10 bg-zinc-800/30 p-3 space-y-3">
        <p className="text-xs font-medium text-zinc-500">새 사진 추가</p>

        {/* 이미지 업로드 — 선택하면 바로 업로드+추가 */}
        <input
          ref={galleryFileRef}
          type="file"
          accept="image/*"
          multiple
          className="absolute w-0 h-0 opacity-0 overflow-hidden"
          disabled={galleryUploading}
          onChange={async (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            setGalleryUploading(true);
            onSaving();
            const newlyAdded: GalleryItem[] = [];
            for (const file of Array.from(files)) {
              const fd = new FormData();
              fd.append("file", file);
              const uploadRes = await fetch("/api/upload/image", { method: "POST", body: fd });
              const uploadJson = await uploadRes.json();
              if (uploadJson.success) {
                const addRes = await apiFetch<GalleryItem>("/api/site/gallery", {
                  method: "POST",
                  body: JSON.stringify({
                    url: uploadJson.data.url,
                    altText: file.name.replace(/\.[^.]+$/, ""),
                    category: newCat,
                  }),
                });
                if (addRes.success && addRes.data) {
                  newlyAdded.push(addRes.data!);
                }
              }
            }
            // New uploads at the top
            if (newlyAdded.length > 0) {
              const updated = [...newlyAdded, ...items];
              setItems(updated);
              const ids = updated.map((i) => i.id!);
              await apiFetch("/api/site/gallery/reorder", {
                method: "PUT",
                body: JSON.stringify({ ids }),
              });
            }
            setGalleryUploading(false);
            onSaved();
            e.target.value = "";
          }}
        />
        <div className="flex gap-2">
          <button
            type="button"
            className={`${btnPrimary} inline-flex items-center gap-2 flex-1 justify-center py-3`}
            disabled={galleryUploading}
            onClick={() => galleryFileRef.current?.click()}
          >
            {galleryUploading ? "업로드 중..." : "사진 업로드 (여러 장 가능)"}
          </button>
          <button
            type="button"
            className={`${btnSecondary} inline-flex items-center gap-1`}
            onClick={async () => {
              if (!showGalleryLibrary) {
                const res = await apiFetch<{ id: number; storedPath: string; originalName: string; fileType: string; createdAt: string }[]>("/api/upload");
                if (res.success && res.data) setGalleryLibraryFiles(res.data);
              }
              setShowGalleryLibrary(!showGalleryLibrary);
            }}
          >
            {showGalleryLibrary ? "닫기" : "📁 라이브러리"}
          </button>
        </div>
        {showGalleryLibrary && (
          <div className="rounded-lg border border-white/10 bg-zinc-800/50 p-2 max-h-48 overflow-y-auto">
            <p className="text-[10px] text-zinc-500 mb-1.5">이전에 업로드한 이미지를 선택하세요</p>
            {galleryLibraryFiles.length === 0 && (
              <p className="text-xs text-zinc-600 text-center py-4">업로드한 이미지가 없습니다</p>
            )}
            <div className="grid grid-cols-4 gap-1.5">
              {galleryLibraryFiles.map((f) => (
                <button
                  key={f.id}
                  onClick={async () => {
                    onSaving();
                    const addRes = await apiFetch<GalleryItem>("/api/site/gallery", {
                      method: "POST",
                      body: JSON.stringify({
                        url: f.storedPath,
                        altText: f.originalName?.replace(/\.[^.]+$/, "") || null,
                        category: newCat,
                      }),
                    });
                    if (addRes.success && addRes.data) {
                      const updated = [addRes.data!, ...items];
                      setItems(updated);
                      const ids = updated.map((i) => i.id!);
                      await apiFetch("/api/site/gallery/reorder", {
                        method: "PUT",
                        body: JSON.stringify({ ids }),
                      });
                    }
                    setShowGalleryLibrary(false);
                    onSaved();
                  }}
                  className="relative aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-white/20 transition-colors"
                  title={f.originalName || ""}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.storedPath} alt={f.originalName || ""} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 카테고리 선택 */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">카테고리:</span>
          <select
            className={`${inputClass} flex-1`}
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
          >
            <option value="activity">활동</option>
            <option value="campaign">캠페인</option>
            <option value="event">행사</option>
            <option value="media">언론</option>
            <option value="blog">블로그</option>
          </select>
        </div>

        {/* URL로도 추가 가능 */}
        <details className="text-xs">
          <summary className="text-zinc-500 cursor-pointer hover:text-zinc-300">URL로 추가하기</summary>
          <div className="mt-2 space-y-2">
            <input
              className={inputClass}
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="이미지 URL 또는 블로그 링크"
            />
            <div className="flex gap-2">
              <input
                className={`${inputClass} flex-1`}
                value={newAlt}
                onChange={(e) => setNewAlt(e.target.value)}
                placeholder="설명 (선택)"
              />
              <button onClick={addItem} className={btnPrimary}>
                추가
              </button>
            </div>
          </div>
        </details>
      </div>

      <EditorActions onSave={onCancel} onCancel={onCancel} />
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Schedule Editor
   ═══════════════════════════════════════════════ */
const SCHEDULE_COLORS = [
  { label: "기본", value: "" },
  { label: "빨강", value: "#ef4444" },
  { label: "주황", value: "#f97316" },
  { label: "노랑", value: "#eab308" },
  { label: "초록", value: "#22c55e" },
  { label: "파랑", value: "#3b82f6" },
  { label: "보라", value: "#8b5cf6" },
  { label: "분홍", value: "#ec4899" },
];

function ScheduleEditor({
  block,
  items: initialItems,
  onSaving,
  onSaved,
  onCancel,
}: EditorBaseProps & { items: ScheduleItem[] }) {
  const [items, setItems] = useState<ScheduleItem[]>(initialItems);
  const [form, setForm] = useState({
    title: "",
    date: "",
    time: "",
    location: "",
    color: "",
  });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ title: "", date: "", time: "", location: "" });
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  async function swapOrder(fromIdx: number, toIdx: number) {
    const reordered = [...items];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setItems(reordered);
    const ids = reordered.map((i) => i.id!).filter(Boolean);
    await apiFetch("/api/site/schedules/reorder", {
      method: "PUT",
      body: JSON.stringify({ ids }),
    });
    onSaved();
  }

  // Store schedule colors in block content: { colors: { [id]: "#hex" } }
  const blockContent = (block.content || {}) as Record<string, unknown>;
  const [scheduleColors, setScheduleColors] = useState<Record<string, string>>(
    (blockContent.colors as Record<string, string>) || {}
  );

  async function saveColorsToBlock(colors: Record<string, string>) {
    await apiFetch(`/api/site/blocks/${block.id}`, {
      method: "PUT",
      body: JSON.stringify({
        content: { ...blockContent, colors },
      }),
    });
  }

  async function addItem() {
    if (!form.title.trim() || !form.date) return;
    onSaving();
    const res = await apiFetch<ScheduleItem>("/api/site/schedules", {
      method: "POST",
      body: JSON.stringify({
        title: form.title,
        date: form.date,
        time: form.time || null,
        location: form.location || null,
      }),
    });
    if (res.success && res.data) {
      setItems((prev) => [res.data!, ...prev]);
      // Save color if selected
      if (form.color && res.data.id) {
        const newColors = { ...scheduleColors, [String(res.data.id)]: form.color };
        setScheduleColors(newColors);
        await saveColorsToBlock(newColors);
      }
      setForm({ title: "", date: "", time: "", location: "", color: "" });
    }
    onSaved();
  }

  async function removeItem(id: number) {
    onSaving();
    await apiFetch(`/api/site/schedules/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
    // Remove color entry
    const newColors = { ...scheduleColors };
    delete newColors[String(id)];
    setScheduleColors(newColors);
    await saveColorsToBlock(newColors);
    onSaved();
  }

  async function updateColor(id: number, color: string) {
    const newColors = { ...scheduleColors };
    if (color) {
      newColors[String(id)] = color;
    } else {
      delete newColors[String(id)];
    }
    setScheduleColors(newColors);
    await saveColorsToBlock(newColors);
    onSaved();
  }

  function startEdit(item: ScheduleItem) {
    setEditingId(item.id!);
    setEditForm({
      title: item.title,
      date: typeof item.date === "string" ? item.date.slice(0, 10) : "",
      time: item.time || "",
      location: item.location || "",
    });
  }

  async function saveEdit() {
    if (!editingId) return;
    onSaving();
    const res = await apiFetch<ScheduleItem>(`/api/site/schedules/${editingId}`, {
      method: "PUT",
      body: JSON.stringify({
        title: editForm.title,
        date: editForm.date,
        time: editForm.time || null,
        location: editForm.location || null,
      }),
    });
    if (res.success && res.data) {
      setItems((prev) => prev.map((i) => (i.id === editingId ? res.data! : i)));
    }
    setEditingId(null);
    onSaved();
  }

  return (
    <div className="space-y-3">
      {items.length > 0 && (
        <div className="space-y-1.5 max-h-60 overflow-y-auto">
          {items.map((item) => {
            const itemColor = scheduleColors[String(item.id)] || "";
            const isEditing = editingId === item.id;

            if (isEditing) {
              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-blue-500/30 bg-zinc-800/80 p-3 space-y-2"
                >
                  <p className="text-xs font-medium text-blue-400">일정 수정</p>
                  <input
                    className={inputClass}
                    value={editForm.title}
                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    placeholder="일정 제목"
                  />
                  <div className="flex gap-2">
                    <input
                      type="date"
                      className={`${inputClass} flex-1`}
                      value={editForm.date}
                      onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                    />
                    <input
                      className={`${inputClass} w-24`}
                      value={editForm.time}
                      onChange={(e) => setEditForm({ ...editForm, time: e.target.value })}
                      placeholder="시간"
                    />
                  </div>
                  <input
                    className={inputClass}
                    value={editForm.location}
                    onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                    placeholder="장소 (선택)"
                  />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditingId(null)} className={btnSecondary}>
                      취소
                    </button>
                    <button onClick={saveEdit} className={btnPrimary}>
                      저장
                    </button>
                  </div>
                </div>
              );
            }

            const idx = items.indexOf(item);
            return (
              <div
                key={item.id}
                draggable
                onDragStart={() => setDragIdx(idx)}
                onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
                onDrop={() => { if (dragIdx !== null && dragIdx !== idx) swapOrder(dragIdx, idx); setDragIdx(null); setDragOverIdx(null); }}
                onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-all ${
                  dragOverIdx === idx ? "border-blue-500/50 bg-blue-500/5" : "border-white/5 bg-zinc-800/50"
                } ${dragIdx === idx ? "opacity-40" : ""}`}
              >
                {/* Drag handle */}
                <span className="cursor-grab text-zinc-600 hover:text-zinc-400 active:cursor-grabbing text-sm">☰</span>
                {/* Up/Down buttons */}
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => idx > 0 && swapOrder(idx, idx - 1)} disabled={idx === 0} className="text-zinc-600 hover:text-white disabled:opacity-20 text-[10px]">▲</button>
                  <button onClick={() => idx < items.length - 1 && swapOrder(idx, idx + 1)} disabled={idx === items.length - 1} className="text-zinc-600 hover:text-white disabled:opacity-20 text-[10px]">▼</button>
                </div>
                {/* Color indicator */}
                <div
                  className="h-3 w-3 rounded-full flex-shrink-0 border border-white/10"
                  style={{ backgroundColor: itemColor || "#71717a" }}
                />
                <span className="text-xs text-zinc-500">{typeof item.date === "string" ? item.date.slice(0, 10) : item.date}</span>
                <span className="flex-1 text-sm text-zinc-200 truncate">
                  {item.title}
                </span>
                {item.location && (
                  <span className="text-xs text-zinc-500 truncate max-w-[80px]">
                    {item.location}
                  </span>
                )}
                {/* Color picker dropdown */}
                <select
                  className="bg-zinc-700 text-xs text-zinc-300 rounded px-1 py-0.5 border border-white/10 w-14"
                  value={itemColor}
                  onChange={(e) => item.id && updateColor(item.id, e.target.value)}
                >
                  {SCHEDULE_COLORS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                {/* Edit button */}
                <button
                  onClick={() => startEdit(item)}
                  className="text-zinc-600 hover:text-blue-400 transition-colors"
                  title="수정"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={() => item.id && removeItem(item.id)}
                  className="text-zinc-600 hover:text-red-400 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-lg border border-white/10 bg-zinc-800/30 p-3 space-y-2">
        <p className="text-xs font-medium text-zinc-500">새 일정 추가</p>
        <input
          className={inputClass}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="일정 제목"
        />
        <div className="flex gap-2">
          <input
            type="date"
            className={`${inputClass} flex-1`}
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
          <input
            className={`${inputClass} w-24`}
            value={form.time}
            onChange={(e) => setForm({ ...form, time: e.target.value })}
            placeholder="시간"
          />
        </div>
        <input
          className={inputClass}
          value={form.location}
          onChange={(e) => setForm({ ...form, location: e.target.value })}
          placeholder="장소 (선택)"
        />
        {/* Color selection */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">색상:</span>
          <div className="flex gap-1.5">
            {SCHEDULE_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setForm({ ...form, color: c.value })}
                className={`h-5 w-5 rounded-full border-2 transition-all ${
                  form.color === c.value ? "border-white scale-110" : "border-white/20"
                }`}
                style={{ backgroundColor: c.value || "#71717a" }}
                title={c.label}
              />
            ))}
          </div>
        </div>
        <div className="flex justify-end">
          <button onClick={addItem} className={btnPrimary}>
            추가
          </button>
        </div>
      </div>

      <EditorActions onSave={onCancel} onCancel={onCancel} />
    </div>
  );
}

/* ═══════════════════════════════════════════════
   News Editor
   ═══════════════════════════════════════════════ */
function NewsEditor({
  block,
  items: initialItems,
  onSaving,
  onSaved,
  onCancel,
}: EditorBaseProps & { items: NewsItem[] }) {
  const [items, setItems] = useState<NewsItem[]>(
    [...initialItems].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  );
  const blockContent = (block.content || {}) as Record<string, unknown>;
  const [showCount, setShowCount] = useState<number>((blockContent.showCount as number) || 3);
  const [form, setForm] = useState({
    title: "",
    source: "",
    url: "",
    publishedDate: "",
  });
  const [newsDragIdx, setNewsDragIdx] = useState<number | null>(null);
  const [newsDragOverIdx, setNewsDragOverIdx] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ title: "", source: "", url: "", publishedDate: "" });

  function startEdit(item: NewsItem) {
    setEditingId(item.id!);
    setEditForm({
      title: item.title,
      source: item.source || "",
      url: item.url || "",
      publishedDate: item.publishedDate ? String(item.publishedDate).slice(0, 10) : "",
    });
  }

  async function saveEdit() {
    if (!editingId) return;
    onSaving();
    const res = await apiFetch<NewsItem>(`/api/site/news/${editingId}`, {
      method: "PUT",
      body: JSON.stringify({
        title: editForm.title,
        source: editForm.source || null,
        url: editForm.url || null,
        publishedDate: editForm.publishedDate || null,
      }),
    });
    if (res.success && res.data) {
      setItems((prev) => prev.map((i) => (i.id === editingId ? res.data! : i)));
    }
    setEditingId(null);
    onSaved();
  }

  async function saveShowCount(val: number) {
    setShowCount(val);
    await apiFetch(`/api/site/blocks/${block.id}`, {
      method: "PUT",
      body: JSON.stringify({ content: { ...blockContent, showCount: val } }),
    });
    onSaved();
  }

  async function addItem() {
    if (!form.title.trim()) return;
    onSaving();
    // New items get sortOrder 0 (latest first), shift others up
    const shifted = items.map((it, i) => ({ ...it, sortOrder: i + 1 }));
    const res = await apiFetch<NewsItem>("/api/site/news", {
      method: "POST",
      body: JSON.stringify({
        title: form.title,
        source: form.source || null,
        url: form.url || null,
        publishedDate: form.publishedDate || null,
        sortOrder: 0,
      }),
    });
    if (res.success && res.data) {
      // Update sortOrders for existing items
      for (const it of shifted) {
        if (it.id) {
          await apiFetch(`/api/site/news/${it.id}`, {
            method: "PUT",
            body: JSON.stringify({ sortOrder: it.sortOrder }),
          });
        }
      }
      setItems([res.data!, ...shifted]);
      setForm({ title: "", source: "", url: "", publishedDate: "" });
    }
    onSaved();
  }

  async function removeItem(id: number) {
    onSaving();
    await apiFetch(`/api/site/news/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
    onSaved();
  }

  async function swapOrder(idx: number, direction: "up" | "down") {
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= items.length) return;
    onSaving();
    const newItems = [...items];
    [newItems[idx], newItems[targetIdx]] = [newItems[targetIdx], newItems[idx]];
    setItems(newItems);
    const ids = newItems.map((i) => i.id!);
    await apiFetch("/api/site/news/reorder", { method: "PUT", body: JSON.stringify({ ids }) });
    onSaved();
  }

  return (
    <div className="space-y-3">
      {/* Show count config */}
      <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-zinc-800/30 px-3 py-2">
        <label className={labelClass}>공개 사이트 노출 갯수</label>
        <input
          type="number"
          min={1}
          max={99}
          className={`${inputClass} w-20 text-center`}
          value={showCount}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v) && v > 0) saveShowCount(v);
          }}
        />
      </div>

      {items.length > 0 && (
        <div className="space-y-1.5 max-h-60 overflow-y-auto">
          {items.map((item, idx) => {
            const isEditing = editingId === item.id;

            if (isEditing) {
              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-blue-500/30 bg-zinc-800/80 p-3 space-y-2"
                >
                  <p className="text-xs font-medium text-blue-400">기사 수정</p>
                  <input
                    className={inputClass}
                    value={editForm.title}
                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    placeholder="기사 제목"
                  />
                  <div className="flex gap-2">
                    <input
                      className={`${inputClass} flex-1`}
                      value={editForm.source}
                      onChange={(e) => setEditForm({ ...editForm, source: e.target.value })}
                      placeholder="출처"
                    />
                    <input
                      type="date"
                      className={`${inputClass} w-40`}
                      value={editForm.publishedDate}
                      onChange={(e) => setEditForm({ ...editForm, publishedDate: e.target.value })}
                    />
                  </div>
                  <input
                    className={inputClass}
                    value={editForm.url}
                    onChange={(e) => setEditForm({ ...editForm, url: e.target.value })}
                    placeholder="기사 URL"
                  />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditingId(null)} className={btnSecondary}>
                      취소
                    </button>
                    <button onClick={saveEdit} className={btnPrimary}>
                      저장
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={item.id}
                draggable
                onDragStart={() => setNewsDragIdx(idx)}
                onDragOver={(e) => { e.preventDefault(); setNewsDragOverIdx(idx); }}
                onDragLeave={() => setNewsDragOverIdx(null)}
                onDrop={async () => {
                  if (newsDragIdx === null || newsDragIdx === idx) return;
                  const newItems = [...items];
                  const [moved] = newItems.splice(newsDragIdx, 1);
                  newItems.splice(idx, 0, moved);
                  setItems(newItems);
                  setNewsDragIdx(null);
                  setNewsDragOverIdx(null);
                  const ids = newItems.map((i) => i.id!);
                  await apiFetch("/api/site/news/reorder", { method: "PUT", body: JSON.stringify({ ids }) });
                  onSaved();
                }}
                onDragEnd={() => { setNewsDragIdx(null); setNewsDragOverIdx(null); }}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 cursor-grab transition-all ${
                  newsDragIdx === idx ? "opacity-40 border-blue-500/30 bg-zinc-800/30" :
                  newsDragOverIdx === idx ? "border-blue-400/50 bg-blue-900/20" :
                  "border-white/5 bg-zinc-800/50"
                }`}
              >
                {/* Reorder buttons */}
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => swapOrder(idx, "up")}
                    disabled={idx === 0}
                    className="text-zinc-600 hover:text-white disabled:opacity-30 transition-colors"
                    title="위로"
                  >
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => swapOrder(idx, "down")}
                    disabled={idx === items.length - 1}
                    className="text-zinc-600 hover:text-white disabled:opacity-30 transition-colors"
                    title="아래로"
                  >
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
                <span className="flex-1 text-sm text-zinc-200 truncate">
                  {item.title}
                </span>
                {item.source && (
                  <span className="text-xs text-zinc-500">{item.source}</span>
                )}
                {/* Edit button */}
                <button
                  onClick={() => startEdit(item)}
                  className="text-zinc-600 hover:text-blue-400 transition-colors"
                  title="수정"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={() => item.id && removeItem(item.id)}
                  className="text-zinc-600 hover:text-red-400 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-lg border border-white/10 bg-zinc-800/30 p-3 space-y-2">
        <p className="text-xs font-medium text-zinc-500">새 기사 추가</p>
        <input
          className={inputClass}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="기사 제목"
        />
        <div className="flex gap-2">
          <input
            className={`${inputClass} flex-1`}
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
            placeholder="출처"
          />
          <input
            type="date"
            className={`${inputClass} w-40`}
            value={form.publishedDate}
            onChange={(e) =>
              setForm({ ...form, publishedDate: e.target.value })
            }
          />
        </div>
        <input
          className={inputClass}
          value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
          placeholder="기사 URL"
        />
        <div className="flex justify-end">
          <button onClick={addItem} className={btnPrimary}>
            추가
          </button>
        </div>
      </div>

      <EditorActions onSave={onCancel} onCancel={onCancel} />
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Videos Editor
   ═══════════════════════════════════════════════ */
function VideosEditor({
  block,
  items: initialItems,
  onSaving,
  onSaved,
  onCancel,
}: EditorBaseProps & { items: VideoItem[] }) {
  const [items, setItems] = useState<VideoItem[]>(
    [...initialItems].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  );
  const vidBlockContent = (block.content || {}) as Record<string, unknown>;
  const [vidShowCount, setVidShowCount] = useState<number>((vidBlockContent.showCount as number) || 4);
  const [newVideoId, setNewVideoId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [vidDragIdx, setVidDragIdx] = useState<number | null>(null);
  const [vidDragOverIdx, setVidDragOverIdx] = useState<number | null>(null);

  async function saveVidShowCount(val: number) {
    setVidShowCount(val);
    await apiFetch(`/api/site/blocks/${block.id}`, {
      method: "PUT",
      body: JSON.stringify({ content: { ...vidBlockContent, showCount: val } }),
    });
    onSaved();
  }

  function extractVideoId(input: string): string {
    // Handle full YouTube URLs
    const patterns = [
      /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
      /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
      /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    ];
    for (const p of patterns) {
      const m = input.match(p);
      if (m) return m[1];
    }
    return input.trim();
  }

  async function addItem() {
    const videoId = extractVideoId(newVideoId);
    if (!videoId) return;
    onSaving();
    // New videos get sortOrder 0 (latest first), shift others up
    const shifted = items.map((it, i) => ({ ...it, sortOrder: i + 1 }));
    const res = await apiFetch<VideoItem>("/api/site/videos", {
      method: "POST",
      body: JSON.stringify({
        videoId,
        title: newTitle || null,
        sortOrder: 0,
      }),
    });
    if (res.success && res.data) {
      for (const it of shifted) {
        if (it.id) {
          await apiFetch(`/api/site/videos/${it.id}`, {
            method: "PUT",
            body: JSON.stringify({ sortOrder: it.sortOrder }),
          });
        }
      }
      setItems([res.data!, ...shifted]);
      setNewVideoId("");
      setNewTitle("");
    }
    onSaved();
  }

  async function removeItem(id: number) {
    onSaving();
    await apiFetch(`/api/site/videos/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
    onSaved();
  }

  async function swapOrder(idx: number, direction: "up" | "down") {
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= items.length) return;
    onSaving();
    const newItems = [...items];
    [newItems[idx], newItems[targetIdx]] = [newItems[targetIdx], newItems[idx]];
    setItems(newItems);
    const ids = newItems.map((i) => i.id!);
    await apiFetch("/api/site/videos/reorder", { method: "PUT", body: JSON.stringify({ ids }) });
    onSaved();
  }

  function startEdit(item: VideoItem) {
    setEditingId(item.id!);
    setEditTitle(item.title || "");
  }

  async function saveEdit() {
    if (!editingId) return;
    onSaving();
    const res = await apiFetch<VideoItem>(`/api/site/videos/${editingId}`, {
      method: "PUT",
      body: JSON.stringify({ title: editTitle || null }),
    });
    if (res.success && res.data) {
      setItems((prev) => prev.map((i) => (i.id === editingId ? { ...i, title: res.data!.title } : i)));
    }
    setEditingId(null);
    onSaved();
  }

  return (
    <div className="space-y-3">
      {/* Show count config */}
      <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-zinc-800/30 px-3 py-2">
        <label className={labelClass}>공개 사이트 노출 갯수</label>
        <input
          type="number"
          min={1}
          max={99}
          className={`${inputClass} w-20 text-center`}
          value={vidShowCount}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v) && v > 0) saveVidShowCount(v);
          }}
        />
      </div>

      {items.length > 0 && (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {items.map((item, idx) => (
            <div
              key={item.id}
              draggable
              onDragStart={() => setVidDragIdx(idx)}
              onDragOver={(e) => { e.preventDefault(); setVidDragOverIdx(idx); }}
              onDragLeave={() => setVidDragOverIdx(null)}
              onDrop={async () => {
                if (vidDragIdx === null || vidDragIdx === idx) return;
                const newItems = [...items];
                const [moved] = newItems.splice(vidDragIdx, 1);
                newItems.splice(idx, 0, moved);
                setItems(newItems);
                setVidDragIdx(null);
                setVidDragOverIdx(null);
                const ids = newItems.map((i) => i.id!);
                await apiFetch("/api/site/videos/reorder", { method: "PUT", body: JSON.stringify({ ids }) });
                onSaved();
              }}
              onDragEnd={() => { setVidDragIdx(null); setVidDragOverIdx(null); }}
              className={`flex items-center gap-2 rounded-lg border px-2 py-2 cursor-grab transition-all ${
                vidDragIdx === idx ? "opacity-40 border-blue-500/30 bg-zinc-800/30" :
                vidDragOverIdx === idx ? "border-blue-400/50 bg-blue-900/20" :
                "border-white/5 bg-zinc-800/50"
              }`}
            >
              {/* Reorder buttons */}
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => swapOrder(idx, "up")}
                  disabled={idx === 0}
                  className="text-zinc-600 hover:text-white disabled:opacity-30 transition-colors"
                  title="위로"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                  </svg>
                </button>
                <button
                  onClick={() => swapOrder(idx, "down")}
                  disabled={idx === items.length - 1}
                  className="text-zinc-600 hover:text-white disabled:opacity-30 transition-colors"
                  title="아래로"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
              {/* Thumbnail */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://img.youtube.com/vi/${item.videoId}/hqdefault.jpg`}
                alt={item.title || ""}
                className="h-12 w-20 rounded object-cover flex-shrink-0"
              />
              <span className="flex-1 text-xs text-zinc-300 truncate">
                {item.title || item.videoId}
              </span>
              {/* Edit button */}
              <button
                onClick={() => startEdit(item)}
                className="text-zinc-600 hover:text-blue-400 transition-colors"
                title="제목 수정"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              {/* Delete button */}
              <button
                onClick={() => item.id && removeItem(item.id)}
                className="text-zinc-600 hover:text-red-400 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Edit title form */}
      {editingId && (
        <div className="rounded-lg border border-blue-500/30 bg-zinc-800/80 p-3 space-y-2">
          <p className="text-xs font-medium text-blue-400">영상 제목 수정</p>
          <input
            className={inputClass}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="영상 제목"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditingId(null)} className={btnSecondary}>
              취소
            </button>
            <button onClick={saveEdit} className={btnPrimary}>
              저장
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-white/10 bg-zinc-800/30 p-3 space-y-2">
        <p className="text-xs font-medium text-zinc-500">새 영상 추가</p>
        <input
          className={inputClass}
          value={newVideoId}
          onChange={(e) => setNewVideoId(e.target.value)}
          placeholder="YouTube URL 또는 동영상 ID"
        />
        <input
          className={inputClass}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="영상 제목 (선택)"
        />
        <div className="flex justify-end">
          <button onClick={addItem} className={btnPrimary}>
            추가
          </button>
        </div>
      </div>

      <EditorActions onSave={onCancel} onCancel={onCancel} />
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Donation Editor
   ═══════════════════════════════════════════════ */
function DonationEditor({
  block,
  onSaving,
  onSaved,
  onCancel,
}: EditorBaseProps) {
  const content = block.content as { imageUrl?: string; description?: string } | null;
  const [form, setForm] = useState({
    imageUrl: content?.imageUrl || "",
    description: content?.description || "",
  });
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryFiles, setLibraryFiles] = useState<{ id: number; storedPath: string; originalName: string; fileType: string; createdAt: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function save() {
    onSaving();
    await apiFetch(`/api/site/blocks/${block.id}`, {
      method: "PUT",
      body: JSON.stringify({ content: form }),
    });
    onSaved();
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>후원 이미지 (계좌 등)</label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="absolute w-0 h-0 opacity-0 overflow-hidden"
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
            }
            e.target.value = "";
          }}
        />
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            className={btnSecondary}
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? "업로드 중..." : "📷 새 이미지"}
          </button>
          <button
            type="button"
            className={btnSecondary}
            onClick={async () => {
              if (!showLibrary) {
                const res = await apiFetch<typeof libraryFiles>("/api/upload");
                if (res.success && res.data) setLibraryFiles(res.data);
              }
              setShowLibrary(!showLibrary);
            }}
          >
            {showLibrary ? "닫기" : "📁 라이브러리"}
          </button>
          {form.imageUrl && (
            <button
              className="text-xs text-red-400 hover:text-red-300"
              onClick={() => { setForm({ ...form, imageUrl: "" }); setPreviewUrl(null); }}
            >
              삭제
            </button>
          )}
        </div>
        {(previewUrl || form.imageUrl) && (
          <div className="mt-2 rounded-lg overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl || form.imageUrl} alt="preview" className="w-full rounded-lg" />
          </div>
        )}
        {showLibrary && (
          <div className="mt-2 rounded-lg border border-white/10 bg-zinc-800/50 p-2 max-h-48 overflow-y-auto">
            <div className="grid grid-cols-4 gap-1.5">
              {libraryFiles.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    setForm({ ...form, imageUrl: f.storedPath });
                    setPreviewUrl(null);
                    setShowLibrary(false);
                  }}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 ${
                    form.imageUrl === f.storedPath ? "border-blue-500" : "border-transparent hover:border-white/20"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.storedPath} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div>
        <label className={labelClass}>안내 설명</label>
        <textarea
          className={`${inputClass} min-h-[80px] resize-y`}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="후원 안내 문구"
        />
      </div>
      <EditorActions onSave={save} onCancel={onCancel} />
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Contacts Editor
   ═══════════════════════════════════════════════ */
function ContactsEditor({
  block,
  items: initialItems,
  onSaving,
  onSaved,
  onCancel,
}: EditorBaseProps & { items: ContactItem[] }) {
  const [items, setItems] = useState<ContactItem[]>(
    [...initialItems].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  );
  const [form, setForm] = useState({
    type: "phone",
    label: "",
    value: "",
    url: "",
  });
  const [ctDragIdx, setCtDragIdx] = useState<number | null>(null);
  const [ctDragOverIdx, setCtDragOverIdx] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ type: "phone", label: "", value: "", url: "" });

  async function addItem() {
    if (!form.value.trim()) return;
    onSaving();
    const res = await apiFetch<ContactItem>("/api/site/contacts", {
      method: "POST",
      body: JSON.stringify({
        type: form.type,
        label: form.label || null,
        value: form.value,
        url: form.url || null,
      }),
    });
    if (res.success && res.data) {
      setItems((prev) => [res.data!, ...prev]);
      setForm({ type: "phone", label: "", value: "", url: "" });
    }
    onSaved();
  }

  async function removeItem(id: number) {
    onSaving();
    await apiFetch(`/api/site/contacts/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
    onSaved();
  }

  async function swapOrder(idx: number, direction: "up" | "down") {
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= items.length) return;
    onSaving();
    const newItems = [...items];
    [newItems[idx], newItems[targetIdx]] = [newItems[targetIdx], newItems[idx]];
    setItems(newItems);
    const ids = newItems.map((i) => i.id!);
    await apiFetch("/api/site/contacts/reorder", { method: "PUT", body: JSON.stringify({ ids }) });
    onSaved();
  }

  function startEdit(item: ContactItem) {
    setEditingId(item.id!);
    setEditForm({
      type: item.type,
      label: item.label || "",
      value: item.value,
      url: item.url || "",
    });
  }

  async function saveEdit() {
    if (!editingId) return;
    onSaving();
    const res = await apiFetch<ContactItem>(`/api/site/contacts/${editingId}`, {
      method: "PUT",
      body: JSON.stringify({
        type: editForm.type,
        label: editForm.label || null,
        value: editForm.value,
        url: editForm.url || null,
      }),
    });
    if (res.success && res.data) {
      setItems((prev) => prev.map((i) => (i.id === editingId ? res.data! : i)));
    }
    setEditingId(null);
    onSaved();
  }

  return (
    <div className="space-y-3">
      {items.length > 0 && (
        <div className="space-y-1.5 max-h-60 overflow-y-auto">
          {items.map((item, idx) => {
            const isEditing = editingId === item.id;

            if (isEditing) {
              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-blue-500/30 bg-zinc-800/80 p-3 space-y-2"
                >
                  <p className="text-xs font-medium text-blue-400">연락처 수정</p>
                  <div className="flex gap-2">
                    <select
                      className={`${inputClass} w-28`}
                      value={editForm.type}
                      onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                    >
                      <option value="phone">전화</option>
                      <option value="email">이메일</option>
                      <option value="blog">블로그</option>
                      <option value="youtube">유튜브</option>
                      <option value="instagram">인스타그램</option>
                      <option value="facebook">페이스북</option>
                      <option value="website">웹사이트</option>
                      <option value="threads">Threads</option>
                    </select>
                    <input
                      className={`${inputClass} flex-1`}
                      value={editForm.label}
                      onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                      placeholder="라벨 (선택)"
                    />
                  </div>
                  <input
                    className={inputClass}
                    value={editForm.value}
                    onChange={(e) => setEditForm({ ...editForm, value: e.target.value })}
                    placeholder="값 (전화번호, 이메일 등)"
                  />
                  <input
                    className={inputClass}
                    value={editForm.url}
                    onChange={(e) => setEditForm({ ...editForm, url: e.target.value })}
                    placeholder="URL (선택)"
                  />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditingId(null)} className={btnSecondary}>
                      취소
                    </button>
                    <button onClick={saveEdit} className={btnPrimary}>
                      저장
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={item.id}
                draggable
                onDragStart={() => setCtDragIdx(idx)}
                onDragOver={(e) => { e.preventDefault(); setCtDragOverIdx(idx); }}
                onDragLeave={() => setCtDragOverIdx(null)}
                onDrop={async () => {
                  if (ctDragIdx === null || ctDragIdx === idx) return;
                  const newItems = [...items];
                  const [moved] = newItems.splice(ctDragIdx, 1);
                  newItems.splice(idx, 0, moved);
                  setItems(newItems);
                  setCtDragIdx(null);
                  setCtDragOverIdx(null);
                  const ids = newItems.map((i) => i.id!);
                  await apiFetch("/api/site/contacts/reorder", { method: "PUT", body: JSON.stringify({ ids }) });
                  onSaved();
                }}
                onDragEnd={() => { setCtDragIdx(null); setCtDragOverIdx(null); }}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-grab transition-all ${
                  ctDragIdx === idx ? "opacity-40 border-blue-500/30 bg-zinc-800/30" :
                  ctDragOverIdx === idx ? "border-blue-400/50 bg-blue-900/20" :
                  "border-white/5 bg-zinc-800/50"
                }`}
              >
                {/* Reorder buttons */}
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => swapOrder(idx, "up")}
                    disabled={idx === 0}
                    className="text-zinc-600 hover:text-white disabled:opacity-30 transition-colors"
                    title="위로"
                  >
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => swapOrder(idx, "down")}
                    disabled={idx === items.length - 1}
                    className="text-zinc-600 hover:text-white disabled:opacity-30 transition-colors"
                    title="아래로"
                  >
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
                <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] font-bold text-zinc-300">
                  {item.type}
                </span>
                <span className="flex-1 text-sm text-zinc-200 truncate">
                  {item.value}
                </span>
                {/* Edit button */}
                <button
                  onClick={() => startEdit(item)}
                  className="text-zinc-600 hover:text-blue-400 transition-colors"
                  title="수정"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={() => item.id && removeItem(item.id)}
                  className="text-zinc-600 hover:text-red-400 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-lg border border-white/10 bg-zinc-800/30 p-3 space-y-2">
        <p className="text-xs font-medium text-zinc-500">새 연락처 추가</p>
        <div className="flex gap-2">
          <select
            className={`${inputClass} w-28`}
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            <option value="phone">전화</option>
            <option value="email">이메일</option>
            <option value="instagram">인스타그램</option>
            <option value="facebook">페이스북</option>
            <option value="youtube">유튜브</option>
            <option value="blog">블로그</option>
            <option value="threads">Threads</option>
          </select>
          <input
            className={`${inputClass} flex-1`}
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="라벨 (선택)"
          />
        </div>
        <input
          className={inputClass}
          value={form.value}
          onChange={(e) => setForm({ ...form, value: e.target.value })}
          placeholder="값 (전화번호, 이메일 등)"
        />
        <input
          className={inputClass}
          value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
          placeholder="URL (선택)"
        />
        <div className="flex justify-end">
          <button onClick={addItem} className={btnPrimary}>
            추가
          </button>
        </div>
      </div>

      <EditorActions onSave={onCancel} onCancel={onCancel} />
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Links Editor
   ═══════════════════════════════════════════════ */
function LinksEditor({
  block,
  onSaving,
  onSaved,
  onCancel,
}: EditorBaseProps) {
  const content = block.content as { links?: LinkItem[] } | null;
  const [links, setLinks] = useState<LinkItem[]>(content?.links || []);
  const [form, setForm] = useState({ title: "", url: "", description: "" });
  const [linkDragIdx, setLinkDragIdx] = useState<number | null>(null);
  const [linkDragOverIdx, setLinkDragOverIdx] = useState<number | null>(null);

  function addLink() {
    if (!form.title.trim() || !form.url.trim()) return;
    setLinks((prev) => [...prev, { ...form }]);
    setForm({ title: "", url: "", description: "" });
  }

  function removeLink(idx: number) {
    setLinks((prev) => prev.filter((_, i) => i !== idx));
  }

  function swapOrder(idx: number, direction: "up" | "down") {
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= links.length) return;
    const newLinks = [...links];
    [newLinks[idx], newLinks[targetIdx]] = [newLinks[targetIdx], newLinks[idx]];
    setLinks(newLinks);
  }

  async function save() {
    onSaving();
    await apiFetch(`/api/site/blocks/${block.id}`, {
      method: "PUT",
      body: JSON.stringify({ content: { links } }),
    });
    onSaved();
  }

  return (
    <div className="space-y-3">
      {links.length > 0 && (
        <div className="space-y-1.5 max-h-60 overflow-y-auto">
          {links.map((link, idx) => (
            <div
              key={idx}
              draggable
              onDragStart={() => setLinkDragIdx(idx)}
              onDragOver={(e) => { e.preventDefault(); setLinkDragOverIdx(idx); }}
              onDragLeave={() => setLinkDragOverIdx(null)}
              onDrop={() => {
                if (linkDragIdx === null || linkDragIdx === idx) return;
                const newLinks = [...links];
                const [moved] = newLinks.splice(linkDragIdx, 1);
                newLinks.splice(idx, 0, moved);
                setLinks(newLinks);
                setLinkDragIdx(null);
                setLinkDragOverIdx(null);
              }}
              onDragEnd={() => { setLinkDragIdx(null); setLinkDragOverIdx(null); }}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-grab transition-all ${
                linkDragIdx === idx ? "opacity-40 border-blue-500/30 bg-zinc-800/30" :
                linkDragOverIdx === idx ? "border-blue-400/50 bg-blue-900/20" :
                "border-white/5 bg-zinc-800/50"
              }`}
            >
              {/* Reorder buttons */}
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => swapOrder(idx, "up")}
                  disabled={idx === 0}
                  className="text-zinc-600 hover:text-zinc-300 disabled:opacity-20 transition-colors"
                  title="위로"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                  </svg>
                </button>
                <button
                  onClick={() => swapOrder(idx, "down")}
                  disabled={idx === links.length - 1}
                  className="text-zinc-600 hover:text-zinc-300 disabled:opacity-20 transition-colors"
                  title="아래로"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm text-zinc-200 truncate block">
                  {link.title}
                </span>
                <span className="text-xs text-zinc-500 truncate block">
                  {link.url}
                </span>
              </div>
              <button
                onClick={() => removeLink(idx)}
                className="text-zinc-600 hover:text-red-400 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-white/10 bg-zinc-800/30 p-3 space-y-2">
        <p className="text-xs font-medium text-zinc-500">새 링크 추가</p>
        <input
          className={inputClass}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="링크 제목"
        />
        <input
          className={inputClass}
          value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
          placeholder="URL"
        />
        <input
          className={inputClass}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="설명 (선택)"
        />
        <div className="flex justify-end">
          <button
            onClick={addLink}
            className={btnSecondary}
          >
            목록에 추가
          </button>
        </div>
      </div>

      <EditorActions onSave={save} onCancel={onCancel} />
    </div>
  );
}
