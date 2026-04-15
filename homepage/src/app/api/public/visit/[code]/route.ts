import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";

function detectDevice(ua: string): string {
  if (/tablet|ipad/i.test(ua)) return "tablet";
  if (/mobile|android|iphone/i.test(ua)) return "mobile";
  return "desktop";
}

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

    const userId = user.id;
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const ua = request.headers.get("user-agent") || "";
    const referrer = request.headers.get("referer") || null;
    const deviceType = detectDevice(ua);

    // Insert visit record
    await prisma.visit.create({
      data: {
        userId,
        visitorIp: ip,
        userAgent: ua,
        referrer,
        pagePath: `/${code}`,
        deviceType,
      },
    });

    // Upsert daily stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check if this IP already visited today
    const existingVisitToday = await prisma.visit.findFirst({
      where: {
        userId,
        visitorIp: ip,
        visitedAt: { gte: today },
      },
      // We just inserted one, so if count > 1 it's a repeat
      orderBy: { visitedAt: "asc" },
    });

    const isNewUniqueVisitor = existingVisitToday
      ? existingVisitToday.visitedAt >= today &&
        (await prisma.visit.count({
          where: {
            userId,
            visitorIp: ip,
            visitedAt: { gte: today },
          },
        })) === 1
      : true;

    await prisma.visitDailyStat.upsert({
      where: {
        userId_date: { userId, date: today },
      },
      create: {
        userId,
        date: today,
        totalVisits: 1,
        uniqueVisitors: 1,
        mobileVisits: deviceType === "mobile" ? 1 : 0,
        desktopVisits: deviceType === "desktop" ? 1 : 0,
      },
      update: {
        totalVisits: { increment: 1 },
        ...(isNewUniqueVisitor ? { uniqueVisitors: { increment: 1 } } : {}),
        ...(deviceType === "mobile" ? { mobileVisits: { increment: 1 } } : {}),
        ...(deviceType === "desktop" ? { desktopVisits: { increment: 1 } } : {}),
      },
    });

    return successResponse({ tracked: true });
  } catch {
    return errorResponse("방문 기록에 실패했습니다", 500);
  }
}
