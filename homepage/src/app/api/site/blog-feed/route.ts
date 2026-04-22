/**
 * 관리자 전용 블로그 피드 — 숨긴 글까지 전부 반환 (hidden 플래그 포함).
 *
 * 공개용 /api/public/blog-feed/[code] 는 hidden=true 항목을 걸러내므로,
 * 관리자가 숨긴 글을 다시 공개하려면 이 엔드포인트를 사용해야 함.
 */
import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";

function rssUrlFor(platform: string, channelId: string | null, channelUrl: string | null): string | null {
  if (platform === "naver_blog") {
    const blogId = channelId || (channelUrl?.match(/blog\.naver\.com\/([^\/?]+)/)?.[1] ?? null);
    return blogId ? `https://rss.blog.naver.com/${blogId}.xml` : null;
  }
  if (platform === "tistory") {
    if (!channelUrl) return null;
    return channelUrl.replace(/\/$/, "") + "/rss";
  }
  if (platform === "brunch") {
    const userId = channelId || (channelUrl?.match(/brunch\.co\.kr\/@([^\/?]+)/)?.[1] ?? null);
    return userId ? `https://brunch.co.kr/@${userId}/rss` : null;
  }
  return null;
}

function parseRss(xml: string): Array<{ url: string; title: string; published_at: string }> {
  const items: Array<{ url: string; title: string; published_at: string }> = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const pick = (block: string, tag: string) => {
    const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`);
    const m = block.match(re);
    return m ? m[1].trim() : "";
  };
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const b = m[1];
    const url = pick(b, "link");
    if (!url) continue;
    items.push({
      url,
      title: pick(b, "title"),
      published_at: pick(b, "pubDate"),
    });
    if (items.length >= 20) break;
  }
  return items;
}

async function fetchRss(url: string) {
  try {
    const res = await fetch(url, { cache: "no-store", headers: { "user-agent": "ElectionPulse/1.0" } });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRss(xml);
  } catch {
    return [];
  }
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const [channels, overrides] = await Promise.all([
      prisma.externalChannel.findMany({
        where: {
          userId: auth.user.id,
          isActive: true,
          platform: { in: ["naver_blog", "tistory", "brunch"] },
        },
      }),
      prisma.feedOverride.findMany({
        where: { userId: auth.user.id, feedType: "blog" },
        select: { sourceKey: true, hidden: true, pinOrder: true },
      }),
    ]);

    if (channels.length === 0) return successResponse({ items: [] });

    const all = (
      await Promise.all(
        channels.map(async (c) => {
          const url = rssUrlFor(c.platform, c.channelId, c.channelUrl);
          if (!url) return [];
          const items = await fetchRss(url);
          return items.map((i) => ({ ...i, platform: c.platform }));
        }),
      )
    ).flat();

    const overMap = new Map(overrides.map((o) => [o.sourceKey, o]));
    const items = all
      .map((v) => ({
        ...v,
        hidden: Boolean(overMap.get(v.url)?.hidden),
        pin_order: overMap.get(v.url)?.pinOrder ?? null,
      }))
      .sort((a, b) => {
        if (a.pin_order != null && b.pin_order == null) return -1;
        if (a.pin_order == null && b.pin_order != null) return 1;
        if (a.pin_order != null && b.pin_order != null) return a.pin_order - b.pin_order;
        return (b.published_at || "").localeCompare(a.published_at || "");
      })
      .slice(0, 20);

    return successResponse({ items });
  } catch (e: unknown) {
    return errorResponse("서버 오류: " + (e instanceof Error ? e.message : ""), 500);
  }
}
