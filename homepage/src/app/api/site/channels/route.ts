/**
 * ExternalChannel CRUD — 후보 본인의 YouTube 채널 / 네이버 블로그 / 인스타그램 등을
 * 복수로 등록/비활성화.
 *
 * 예: youtube 채널 3개, naver_blog 2개 동시 등록 가능.
 */
import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/middleware";
import { resolveYoutubeChannelId } from "@/lib/youtube-channel";

const VALID_PLATFORMS = new Set(["youtube", "naver_blog", "instagram", "tistory", "brunch"]);

export async function GET(_req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const channels = await prisma.externalChannel.findMany({
    where: { userId: auth.user.id },
    orderBy: [{ platform: "asc" }, { createdAt: "asc" }],
  });
  return successResponse({ items: channels });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const platform = String(body.platform || "").trim();
  let channelId = String(body.channelId || "").trim() || null;
  const channelUrl = String(body.channelUrl || "").trim() || null;
  const isActive = body.isActive ?? true;

  if (!VALID_PLATFORMS.has(platform)) {
    return errorResponse(`platform은 ${Array.from(VALID_PLATFORMS).join(", ")} 중 하나여야 합니다`, 400);
  }
  if (!channelId && !channelUrl) {
    return errorResponse("channelId 또는 channelUrl 하나는 필수입니다", 400);
  }

  // YouTube는 URL(@handle, /channel/UCxxx, /c/..., /user/...)에서 channelId 자동 해결
  // NULL로 저장하면 /api/public/youtube-feed가 해당 행을 건너뛰어 영상이 안 나옴
  if (platform === "youtube" && !channelId && channelUrl) {
    const resolved = await resolveYoutubeChannelId(channelUrl, process.env.YOUTUBE_API_KEY || "");
    if (resolved) channelId = resolved;
  }

  const created = await prisma.externalChannel.create({
    data: { userId: auth.user.id, platform, channelId, channelUrl, isActive },
  });
  return successResponse({ item: created });
}
