/**
 * 후보 본인 블로그(들)의 최신 글 피드.
 *
 * - external_channels 중 platform='naver_blog' | 'tistory' | 'brunch' (isActive=true)
 * - 각 플랫폼 RSS 파싱
 * - FeedOverride(feedType=blog) 반영 (숨김/핀 순서)
 * - RSS 실패/없음 → items:[] (UI 빈 공간)
 */
import { NextRequest } from "next/server";
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

export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  try {
    const { code } = params;
    const user = await prisma.user.findUnique({
      where: { code },
      select: { id: true, isActive: true },
    });
    if (!user || !user.isActive) return errorResponse("사이트를 찾을 수 없습니다", 404);

    const [channels, overrides] = await Promise.all([
      prisma.externalChannel.findMany({
        where: {
          userId: user.id,
          isActive: true,
          platform: { in: ["naver_blog", "tistory", "brunch"] },
        },
      }),
      prisma.feedOverride.findMany({
        where: { userId: user.id, feedType: "blog" },
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
        })
      )
    ).flat();

    const overMap = new Map(overrides.map((o) => [o.sourceKey, o]));
    const filtered = all
      .filter((v) => !overMap.get(v.url)?.hidden)
      .map((v) => ({ ...v, pin_order: overMap.get(v.url)?.pinOrder ?? null }))
      .sort((a, b) => {
        if (a.pin_order != null && b.pin_order == null) return -1;
        if (a.pin_order == null && b.pin_order != null) return 1;
        if (a.pin_order != null && b.pin_order != null) return a.pin_order - b.pin_order;
        return (b.published_at || "").localeCompare(a.published_at || "");
      })
      .slice(0, 20);

    return successResponse({ items: filtered });
  } catch (e: any) {
    return errorResponse("서버 오류: " + (e?.message || ""), 500);
  }
}
