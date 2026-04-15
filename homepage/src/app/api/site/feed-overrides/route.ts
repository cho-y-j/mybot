/**
 * FeedOverride — 자동 피드(ai_news / youtube / blog) 개별 숨김·순서 조정.
 *
 * 사용 예:
 *   POST { feedType:"ai_news", sourceKey:"https://naver.com/...", hidden: true }
 *   POST { feedType:"youtube", sourceKey:"abc123", pinOrder: 1 }
 *
 * upsert 동작 — 같은 (userId, feedType, sourceKey) 있으면 업데이트.
 */
import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/middleware";

const VALID_TYPES = new Set(["ai_news", "youtube", "blog"]);

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const feedType = new URL(req.url).searchParams.get("feedType") || undefined;
  const rows = await prisma.feedOverride.findMany({
    where: { userId: auth.user.id, ...(feedType ? { feedType } : {}) },
    orderBy: [{ feedType: "asc" }, { pinOrder: "asc" }],
  });
  return successResponse({ items: rows });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const feedType = String(body.feedType || "");
  const sourceKey = String(body.sourceKey || "");
  if (!VALID_TYPES.has(feedType) || !sourceKey) {
    return errorResponse("feedType(ai_news|youtube|blog) + sourceKey 필수", 400);
  }

  const row = await prisma.feedOverride.upsert({
    where: { uq_feed_override: { userId: auth.user.id, feedType, sourceKey } },
    create: {
      userId: auth.user.id,
      feedType,
      sourceKey,
      hidden: Boolean(body.hidden),
      pinOrder: body.pinOrder != null ? Number(body.pinOrder) : null,
    },
    update: {
      ...(body.hidden !== undefined ? { hidden: Boolean(body.hidden) } : {}),
      ...(body.pinOrder !== undefined
        ? { pinOrder: body.pinOrder == null ? null : Number(body.pinOrder) }
        : {}),
    },
  });
  return successResponse({ item: row });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const feedType = String(body.feedType || "");
  const sourceKey = String(body.sourceKey || "");
  if (!VALID_TYPES.has(feedType) || !sourceKey) {
    return errorResponse("feedType + sourceKey 필수", 400);
  }
  await prisma.feedOverride
    .delete({ where: { uq_feed_override: { userId: auth.user.id, feedType, sourceKey } } })
    .catch(() => {});
  return successResponse({ deleted: true });
}
