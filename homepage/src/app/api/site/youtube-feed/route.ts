/**
 * 관리자 전용 YouTube 피드 — 숨긴 항목까지 전부 반환 (hidden 플래그 포함).
 *
 * 공개용 /api/public/youtube-feed/[code] 는 hidden=true 항목을 걸러내므로,
 * 관리자가 숨긴 영상을 다시 공개하려면 이 엔드포인트로 전체 목록을 봐야 함.
 */
import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { resolveYoutubeChannelId } from "@/lib/youtube-channel";

const API_KEY = process.env.YOUTUBE_API_KEY || "";
const PER_CHANNEL = 10;

async function fetchChannelUploads(channelId: string) {
  if (!API_KEY) return [];
  try {
    const ch = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${API_KEY}`,
      { cache: "no-store" },
    ).then((r) => (r.ok ? r.json() : null));
    const uploadsId = ch?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsId) return [];

    const items = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsId}&maxResults=${PER_CHANNEL}&key=${API_KEY}`,
      { cache: "no-store" },
    ).then((r) => (r.ok ? r.json() : null));
    return (items?.items || [])
      .map((v: { snippet?: { resourceId?: { videoId?: string }; title?: string; thumbnails?: { medium?: { url?: string }; default?: { url?: string } }; channelTitle?: string; publishedAt?: string } }) => ({
        video_id: v.snippet?.resourceId?.videoId,
        title: v.snippet?.title,
        thumbnail: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url,
        channel: v.snippet?.channelTitle,
        published_at: v.snippet?.publishedAt,
      }))
      .filter((v: { video_id?: string }) => v.video_id);
  } catch {
    return [];
  }
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const [rawChannels, overrides] = await Promise.all([
      prisma.externalChannel.findMany({
        where: { userId: auth.user.id, platform: "youtube", isActive: true },
        select: { id: true, channelId: true, channelUrl: true },
      }),
      prisma.feedOverride.findMany({
        where: { userId: auth.user.id, feedType: "youtube" },
        select: { sourceKey: true, hidden: true, pinOrder: true },
      }),
    ]);

    const channelIds: string[] = [];
    for (const c of rawChannels) {
      if (c.channelId) { channelIds.push(c.channelId); continue; }
      if (!c.channelUrl) continue;
      const resolved = await resolveYoutubeChannelId(c.channelUrl, API_KEY);
      if (resolved) {
        channelIds.push(resolved);
        await prisma.externalChannel.update({ where: { id: c.id }, data: { channelId: resolved } }).catch(() => {});
      }
    }

    if (channelIds.length === 0) return successResponse({ items: [] });

    const all = (await Promise.all(channelIds.map((id) => fetchChannelUploads(id)))).flat();
    const overMap = new Map(overrides.map((o) => [o.sourceKey, o]));

    const items = all
      .map((v) => {
        const o = overMap.get(v.video_id);
        return {
          ...v,
          hidden: Boolean(o?.hidden),
          pin_order: o?.pinOrder ?? null,
        };
      })
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
