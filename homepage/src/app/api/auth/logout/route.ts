import { cookies } from "next/headers";
import {
  getSessionFromCookies,
  deleteSession,
  clearSessionCookie,
} from "@/lib/auth";
import { successResponse, errorResponse } from "@/lib/api-response";

export async function POST() {
  try {
    const sessionId = getSessionFromCookies();
    if (sessionId) {
      await deleteSession(sessionId);
    }
    clearSessionCookie();
    const cookieStore = cookies();
    cookieStore.set("mh_user_type", "", { path: "/", maxAge: 0 });
    cookieStore.set("mh_code", "", { path: "/", maxAge: 0 });
    return successResponse({ message: "로그아웃되었습니다" });
  } catch (error) {
    console.error("Logout error:", error);
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
