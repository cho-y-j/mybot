import { NextRequest } from "next/server";
import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { getDateRange, getVisitorStats } from "@/lib/analytics";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const period = request.nextUrl.searchParams.get("period") || "week";
    const { start, end } = getDateRange(period);

    const stats = await getVisitorStats(auth.user.id, start, end);

    const totalVisits = stats.reduce((sum, s) => sum + s.totalVisits, 0);
    const uniqueVisitors = stats.reduce((sum, s) => sum + s.uniqueVisitors, 0);
    const mobileVisits = stats.reduce((sum, s) => sum + s.mobileVisits, 0);
    const desktopVisits = stats.reduce((sum, s) => sum + s.desktopVisits, 0);

    return successResponse({
      period,
      totalVisits,
      uniqueVisitors,
      deviceBreakdown: {
        mobile: mobileVisits,
        desktop: desktopVisits,
      },
    });
  } catch {
    return errorResponse("분석 데이터를 불러오는데 실패했습니다", 500);
  }
}
