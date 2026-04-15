import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import type { SiteData } from "@/types/site";
import ElectionTemplate from "@/components/templates/election/election-template";

interface PageProps {
  params: { code: string };
}

async function getSiteData(code: string): Promise<SiteData | null> {
  const user = await prisma.user.findUnique({
    where: { code, isActive: true },
    select: {
      id: true,
      name: true,
      templateType: true,
      plan: true,
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
    schedules: schedules.map((s) => ({
      id: s.id,
      title: s.title,
      date: s.date.toISOString().split("T")[0],
      time: s.time,
      location: s.location,
    })),
    contacts: contacts.map((c) => ({
      id: c.id,
      type: c.type,
      label: c.label,
      value: c.value,
      url: c.url,
      sortOrder: c.sortOrder,
    })),
    news: news.map((n) => ({
      id: n.id,
      title: n.title,
      source: n.source,
      url: n.url,
      imageUrl: n.imageUrl,
      publishedDate: n.publishedDate
        ? n.publishedDate.toISOString().split("T")[0]
        : null,
      sortOrder: n.sortOrder,
    })),
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
