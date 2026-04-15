import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { getVisitorStats } from "@/lib/analytics";

export async function GET() {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const start = new Date();
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);

    const stats = await getVisitorStats(auth.user.id, start, end);

    return successResponse(stats);
  } catch {
    return errorResponse("방문자 통계를 불러오는데 실패했습니다", 500);
  }
}
