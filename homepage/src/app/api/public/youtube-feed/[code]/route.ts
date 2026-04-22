/**
 * 후보 본인 YouTube 채널(들)의 최신 영상 피드.
 *
 * - external_channels의 platform='youtube' + isActive=true 채널 전부 조회
 * - YOUTUBE_API_KEY로 각 채널 최신 영상 10개씩 합쳐서 최신순 정렬
 * - FeedOverride(feedType=youtube, hidden) 제외 + pinOrder 반영
 * - 채널 없거나 API 실패 → items:[] (UI는 빈 공간 유지)
 */
import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { resolveYoutubeChannelId } from "@/lib/youtube-channel";

const API_KEY = process.env.YOUTUBE_API_KEY || "";
const PER_CHANNEL = 10;

async function fetchChannelUploads(channelId: string) {
  if (!API_KEY) return [];
  try {
    // Step 1: uploads playlist id
    const ch = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${API_KEY}`,
      { cache: "no-store" }
    ).then((r) => (r.ok ? r.json() : null));
    const uploadsId = ch?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsId) return [];

    // Step 2: playlist items
    const items = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsId}&maxResults=${PER_CHANNEL}&key=${API_KEY}`,
      { cache: "no-store" }
    ).then((r) => (r.ok ? r.json() : null));
    return (items?.items || []).map((v: any) => ({
      video_id: v.snippet?.resourceId?.videoId,
      title: v.snippet?.title,
      thumbnail: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url,
      channel: v.snippet?.channelTitle,
      published_at: v.snippet?.publishedAt,
    })).filter((v: any) => v.video_id);
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

    const [rawChannels, overrides] = await Promise.all([
      // channelId NULL이어도 channelUrl 있으면 아래에서 자동 해결하므로 포함
      prisma.externalChannel.findMany({
        where: { userId: user.id, platform: "youtube", isActive: true },
        select: { id: true, channelId: true, channelUrl: true },
      }),
      prisma.feedOverride.findMany({
        where: { userId: user.id, feedType: "youtube" },
        select: { sourceKey: true, hidden: true, pinOrder: true },
      }),
    ]);

    // channelId NULL인 행은 URL로 자동 해결 → DB에 back-fill (self-healing)
    const channelIds: string[] = [];
    for (const c of rawChannels) {
      if (c.channelId) { channelIds.push(c.channelId); continue; }
      if (!c.channelUrl) continue;
      const resolved = await resolveYoutubeChannelId(c.channelUrl, API_KEY);
      if (resolved) {
        channelIds.push(resolved);
        await prisma.externalChannel.update({
          where: { id: c.id },
          data: { channelId: resolved },
        }).catch(() => {});
      }
    }

    if (channelIds.length === 0) return successResponse({ items: [] });

    const all = (
      await Promise.all(channelIds.map((id) => fetchChannelUploads(id)))
    ).flat();

    const overMap = new Map(overrides.map((o) => [o.sourceKey, o]));
    const filtered = all
      .filter((v) => !overMap.get(v.video_id)?.hidden)
      .map((v) => ({ ...v, pin_order: overMap.get(v.video_id)?.pinOrder ?? null }))
      .sort((a, b) => {
        if (a.pin_order != null && b.pin_order == null) return -1;
        if (a.pin_order == null && b.pin_order != null) return 1;
        if (a.pin_order != null && b.pin_order != null) return a.pin_order - b.pin_order;
        // 기본: 최신 먼저
        return (b.published_at || "").localeCompare(a.published_at || "");
      })
      .slice(0, 20);

    return successResponse({ items: filtered });
  } catch (e: any) {
    return errorResponse("서버 오류: " + (e?.message || ""), 500);
  }
}
