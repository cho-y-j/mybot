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

  if (!electionId) return manual;

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
      .map((r, i) => ({
        id: -1 - i, // manual과 구분
        title: r.title,
        source: r.source,
        url: r.url,
        imageUrl: null,
        publishedDate: r.published_at ? new Date(r.published_at).toISOString().split("T")[0] : null,
        sortOrder: overMap.get(r.url)?.pinOrder ?? 1000 + i,
      }));

    return [...manual, ...aiList].sort((a, b) => a.sortOrder - b.sortOrder).slice(0, 30);
  } catch {
    return manual;
  }
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


async function getSiteData(code: string): Promise<SiteData | null> {
  const user = await prisma.user.findUnique({
    where: { code, isActive: true },
    select: {
      id: true,
      name: true,
      templateType: true,
      plan: true,
      electionId: true,
    },
  });

  if (!user) return null;

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
      code,
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
      partyName: settings?.partyName ?? null,
      positionTitle: settings?.positionTitle ?? null,
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

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      ...(settings.ogImageUrl && {
        images: [{ url: settings.ogImageUrl.startsWith("http") ? settings.ogImageUrl : `https://k.on1.kr${settings.ogImageUrl}` }],
      }),
      locale: "ko_KR",
      type: "website",
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
