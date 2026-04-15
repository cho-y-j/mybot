import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { getEventStats } from "@/lib/analytics";

export async function GET() {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const start = new Date();
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);

    const stats = await getEventStats(auth.user.id, start, end);

    // Aggregate by event type
    const byType: Record<string, number> = {};
    for (const stat of stats) {
      byType[stat.eventType] = (byType[stat.eventType] || 0) + stat.count;
    }

    return successResponse({
      byType,
      daily: stats,
    });
  } catch {
    return errorResponse("이벤트 통계를 불러오는데 실패했습니다", 500);
  }
}
