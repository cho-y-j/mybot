import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import type { SiteData } from "@/types/site";
import ElectionTemplate from "@/components/templates/election/election-template";

interface PageProps {
  params: { code: string };
}

/**
 * 수동 뉴스(homepage.news) + mybot DB의 "긍정 + 검증된 우리 관련 뉴스" 병합.
 * FeedOverride(feed_type='ai_news')의 hidden/pin 적용.
 */
async function mergeAiNews(
  userId: number,
  electionId: string | null,
  manualNews: any[],
): Promise<any[]> {
  const manual = manualNews.map((n) => ({
    id: n.id,
    title: n.title,
    source: n.source,
    url: n.url,
    imageUrl: n.imageUrl,
    publishedDate: n.publishedDate ? n.publishedDate.toISOString().split("T")[0] : null,
    sortOrder: n.sortOrder,
  }));

  if (!electionId) {
    // 수동 뉴스만 있어도 "핀(음수 sortOrder) → 날짜 DESC" 규칙은 동일 적용
    return sortByPinThenDate(manual).slice(0, 30);
  }

  try {
    const [aiRows, overrides] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(
        `SELECT title, url, source, summary, published_at, collected_at
         FROM public.news_articles
         WHERE election_id = $1::uuid
           AND is_relevant = true AND is_about_our_candidate = true
           AND sentiment = 'positive' AND sentiment_verified = true
         ORDER BY published_at DESC NULLS LAST, collected_at DESC
         LIMIT 60`,
        electionId
      ),
      prisma.feedOverride.findMany({
        where: { userId, feedType: "ai_news" },
        select: { sourceKey: true, hidden: true, pinOrder: true },
      }),
    ]);

    const overMap = new Map(overrides.map((o) => [o.sourceKey, o]));
    const aiList = aiRows
      .filter((r) => !overMap.get(r.url)?.hidden)
      .map((r, i) => {
        const pin = overMap.get(r.url)?.pinOrder ?? null;
        return {
          id: -1 - i,
          title: r.title,
          source: r.source,
          url: r.url,
          imageUrl: null,
          publishedDate: r.published_at ? new Date(r.published_at).toISOString().split("T")[0] : null,
          // 음수 sortOrder = 핀 상단 (최근 핀이 더 음수), 양수 = 일반 (날짜 정렬 사용)
          sortOrder: pin != null ? pin : 0,
          _pinned: pin != null,
        };
      });

    // 수동은 _pinned=false, sortOrder는 그대로 (드래그 순서 유지)
    const manualWithFlag = manual.map((m) => ({ ...m, _pinned: false }));
    return sortByPinThenDate([...manualWithFlag, ...aiList]).slice(0, 30);
  } catch {
    return sortByPinThenDate(manual).slice(0, 30);
  }
}

/**
 * 공용 정렬: 1) 핀된 것 먼저 (sortOrder ASC — 최근 핀이 더 음수라 위로)
 *          2) 그 다음 publishedDate DESC (최신 먼저)
 *          3) publishedDate 없으면 뒤로
 */
function sortByPinThenDate<T extends { _pinned?: boolean; sortOrder?: number; publishedDate?: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a._pinned && !b._pinned) return -1;
    if (!a._pinned && b._pinned) return 1;
    if (a._pinned && b._pinned) return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    // 둘 다 미핀: 날짜 내림차순
    return (b.publishedDate || "").localeCompare(a.publishedDate || "");
  });
}


/**
 * 수동 홈페이지 일정(homepage.schedules) + mybot 공개 일정(candidate_schedules visibility='public')
 * 을 병합해서 반환. electionId 있으면 mybot 공개 일정 우선, 없으면 homepage 수동만.
 * Phase 2 (2026-04-21): 일정 관리 일원화 진행 중 — 편집은 mybot 캘린더에서만.
 */
async function mergeCandidateSchedules(
  electionId: string | null,
  manualSchedules: any[],
): Promise<any[]> {
  const manual = manualSchedules.map((s) => ({
    id: String(s.id),
    title: s.title,
    date: s.date.toISOString().split("T")[0],
    time: s.time,
    location: s.location,
  }));

  if (!electionId) return manual;

  try {
    const aiRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT cs.id::text AS id, cs.title, cs.starts_at, cs.ends_at, cs.all_day,
              cs.location, cs.category, cs.admin_sigungu, cs.admin_dong
         FROM public.candidate_schedules cs
         WHERE cs.election_id = $1::uuid
           AND cs.visibility = 'public'
           AND cs.status != 'canceled'
           AND cs.ends_at >= NOW()
         ORDER BY cs.starts_at ASC
         LIMIT 10`,
      electionId,
    );

    const pad = (n: number) => String(n).padStart(2, "0");
    const aiList = aiRows.map((r: any) => {
      const starts = new Date(r.starts_at);
      const ends = new Date(r.ends_at);
      const timeStr = r.all_day
        ? "종일"
        : `${pad(starts.getHours())}:${pad(starts.getMinutes())}~${pad(ends.getHours())}:${pad(ends.getMinutes())}`;
      const locDetail =
        r.admin_sigungu && r.admin_dong ? ` (${r.admin_sigungu} ${r.admin_dong})` : "";
      return {
        id: `cs-${r.id}`, // manual과 구분
        title: r.title,
        date: starts.toISOString().split("T")[0],
        time: timeStr,
        location: r.location ? `${r.location}${locDetail}` : null,
      };
    });

    // electionId 있으면 mybot 공개 일정 우선 — 수동은 Phase 2-D 마이그레이션 후 제거 예정
    return aiList.length > 0 ? aiList : manual;
  } catch {
    return manual;
  }
}


async function getSiteData(codeOrSlug: string): Promise<SiteData | null> {
  // URL 세그먼트는 slug(사용자 지정) 우선 조회 → 없으면 code(자동 생성)로 fallback.
  // 두 주소가 영구 공존 — 기존 5403b830 링크 보호 + 새 짧은 slug 지원.
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ slug: codeOrSlug }, { code: codeOrSlug }],
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      templateType: true,
      plan: true,
      electionId: true,
    },
  });

  if (!user) return null;

  // mybot 후보자 데이터 (public.candidates) — 홈페이지 site_settings보다 우선.
  // mybot에서 후보자 관리로 party/role 바꾸면 홈페이지 즉시 반영 (이중 저장·수동 동기화 불필요).
  const ourCandidate = user.electionId
    ? await prisma.$queryRawUnsafe<Array<{ party: string | null; party_alignment: string | null; role: string | null }>>(
        `SELECT party, party_alignment, role FROM public.candidates
          WHERE election_id = $1::uuid AND is_our_candidate = true
          LIMIT 1`,
        user.electionId,
      ).catch(() => [])
    : [];
  const candidateParty = ourCandidate[0]?.party || null;
  const candidateRole = ourCandidate[0]?.role || null;

  const [settings, profiles, pledges, gallery, schedules, contacts, news, videos, blocks] =
    await Promise.all([
      prisma.siteSetting.findUnique({ where: { userId: user.id } }),
      prisma.profile.findMany({
        where: { userId: user.id },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.pledge.findMany({
        where: { userId: user.id },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.gallery.findMany({
        where: { userId: user.id },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.schedule.findMany({
        where: { userId: user.id },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.contact.findMany({
        where: { userId: user.id },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.news.findMany({
        where: { userId: user.id },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.video.findMany({
        where: { userId: user.id },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.block.findMany({
        where: { userId: user.id, visible: true },
        orderBy: { sortOrder: "asc" },
      }),
    ]);

  return {
    user: {
      name: user.name,
      code: codeOrSlug,
      templateType: user.templateType,
      plan: user.plan,
    },
    settings: {
      ogTitle: settings?.ogTitle ?? null,
      ogDescription: settings?.ogDescription ?? null,
      ogImageUrl: settings?.ogImageUrl ?? null,
      heroImageUrl: settings?.heroImageUrl ?? null,
      profileImageUrl: settings?.profileImageUrl ?? null,
      heroSlogan: settings?.heroSlogan ?? null,
      heroSubSlogan: settings?.heroSubSlogan ?? null,
      // mybot 후보자 데이터를 우선. mybot에 값 있으면 그걸 쓰고, 없으면 홈페이지 설정값으로 fallback.
      partyName: candidateParty ?? settings?.partyName ?? null,
      positionTitle: candidateRole ?? settings?.positionTitle ?? null,
      subtitle: settings?.subtitle ?? null,
      introText: settings?.introText ?? null,
      primaryColor: settings?.primaryColor ?? "#C9151E",
      accentColor: settings?.accentColor ?? "#1A56DB",
      electionDate: settings?.electionDate
        ? settings.electionDate.toISOString().split("T")[0]
        : null,
      electionName: settings?.electionName ?? null,
      kakaoAppKey: settings?.kakaoAppKey ?? null,
    },
    profiles: profiles.map((p) => ({
      id: p.id,
      type: p.type,
      title: p.title,
      isCurrent: p.isCurrent,
      sortOrder: p.sortOrder,
    })),
    pledges: pledges.map((p) => ({
      id: p.id,
      icon: p.icon,
      title: p.title,
      description: p.description,
      details: (p.details as string[] | { items: string[]; imageUrl?: string }) ?? [],
      sortOrder: p.sortOrder,
    })),
    gallery: gallery.map((g) => ({
      id: g.id,
      url: g.url,
      altText: g.altText,
      category: g.category,
      sortOrder: g.sortOrder,
    })),
    schedules: await mergeCandidateSchedules(user.electionId, schedules),
    contacts: contacts.map((c) => ({
      id: c.id,
      type: c.type,
      label: c.label,
      value: c.value,
      url: c.url,
      sortOrder: c.sortOrder,
    })),
    news: await mergeAiNews(user.id, user.electionId, news),
    videos: videos.map((v) => ({
      id: v.id,
      videoId: v.videoId,
      title: v.title,
      sortOrder: v.sortOrder,
    })),
    blocks: blocks.map((b) => ({
      id: b.id,
      type: b.type,
      title: b.title,
      content: b.content as Record<string, unknown> | null,
      sortOrder: b.sortOrder,
    })),
  };
}

const SITE_ORIGIN = "https://ai.on1.kr";

/** 상대 경로(/api/site/uploads/...)를 절대 URL로. 카카오·페북 봇이 읽으려면 절대 URL 필수. */
function toAbsoluteUrl(url: string): string {
  return url.startsWith("http") ? url : `${SITE_ORIGIN}${url}`;
}

/**
 * 공유 썸네일(og:image) 자동 선택.
 * 우선순위: 사용자가 지정한 OG 이미지 → hero 배경 → 후보 프로필 사진
 * 셋 다 없으면 og:image 생략 → 봇이 HTML에서 아무 이미지(=유튜브 썸네일 등)를 골라가지만,
 * 그건 사용자가 hero 최소 한 장이라도 올리면 즉시 해결됨.
 */
function pickOgImage(settings: { ogImageUrl: string | null; heroImageUrl: string | null; profileImageUrl: string | null }): { url: string; source: "og" | "hero" | "profile" } | null {
  if (settings.ogImageUrl) return { url: toAbsoluteUrl(settings.ogImageUrl), source: "og" };
  if (settings.heroImageUrl) return { url: toAbsoluteUrl(settings.heroImageUrl), source: "hero" };
  if (settings.profileImageUrl) return { url: toAbsoluteUrl(settings.profileImageUrl), source: "profile" };
  return null;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const data = await getSiteData(params.code);
  if (!data) return {};

  const { settings, user } = data;
  const title = settings.ogTitle ?? `${user.name} - 선거 홍보 사이트`;
  const description =
    settings.ogDescription ??
    `${user.name}${settings.positionTitle ? ` ${settings.positionTitle}` : ""} 후보의 공식 홍보 사이트`;

  const ogImage = pickOgImage(settings);

  return {
    title,
    description,
    metadataBase: new URL(SITE_ORIGIN),
    openGraph: {
      title,
      description,
      url: `${SITE_ORIGIN}/${params.code}`,
      ...(ogImage && { images: [{ url: ogImage.url, width: 1200, height: 630 }] }),
      locale: "ko_KR",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(ogImage && { images: [ogImage.url] }),
    },
  };
}

export default async function SitePage({ params }: PageProps) {
  const data = await getSiteData(params.code);

  if (!data) {
    notFound();
  }

  return <ElectionTemplate data={data} />;
}
