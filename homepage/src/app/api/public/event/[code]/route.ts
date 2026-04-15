import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";

const VALID_EVENT_TYPES = [
  "share_kakao",
  "share_copy",
  "video_play",
  "phone_click",
  "pledge_view",
] as const;

export async function POST(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  try {
    const { code } = params;

    const user = await prisma.user.findUnique({
      where: { code },
      select: { id: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return errorResponse("사이트를 찾을 수 없습니다", 404);
    }

    const body = await request.json();
    const { eventType, eventData } = body;

    if (!eventType || !VALID_EVENT_TYPES.includes(eventType)) {
      return errorResponse("유효하지 않은 이벤트 타입입니다", 400);
    }

    const userId = user.id;
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    // Insert event record
    await prisma.event.create({
      data: {
        userId,
        eventType,
        eventData: eventData ?? undefined,
        visitorIp: ip,
      },
    });

    // Upsert daily event stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.eventDailyStat.upsert({
      where: {
        userId_date_eventType: { userId, date: today, eventType },
      },
      create: {
        userId,
        date: today,
        eventType,
        count: 1,
      },
      update: {
        count: { increment: 1 },
      },
    });

    return successResponse({ tracked: true });
  } catch {
    return errorResponse("이벤트 기록에 실패했습니다", 500);
  }
}
