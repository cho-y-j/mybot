import { getSessionFromCookies, getSession } from "@/lib/auth";
import { successResponse, errorResponse } from "@/lib/api-response";

export async function GET() {
  try {
    const sessionId = getSessionFromCookies();
    if (!sessionId) {
      return errorResponse("인증이 필요합니다", 401);
    }

    const user = await getSession(sessionId);
    if (!user) {
      return errorResponse("세션이 만료되었습니다", 401);
    }

    return successResponse({ user });
  } catch (error) {
    console.error("Auth check error:", error);
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
