import { NextResponse } from "next/server";
import { getSession, getSessionFromCookies } from "./auth";
import type { SessionUser } from "@/types/user";

type AuthResult =
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse };

export async function requireAuth(): Promise<AuthResult> {
  const sessionId = getSessionFromCookies();
  if (!sessionId) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "인증이 필요합니다" },
        { status: 401 }
      ),
    };
  }
  const user = await getSession(sessionId);
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "세션이 만료되었습니다" },
        { status: 401 }
      ),
    };
  }
  return { ok: true, user };
}

export async function requireSuperAdmin(): Promise<AuthResult> {
  const result = await requireAuth();
  if (!result.ok) return result;
  if (result.user.userType !== "super_admin") {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "관리자 권한이 필요합니다" },
        { status: 403 }
      ),
    };
  }
  return result;
}

export async function requireUser(): Promise<AuthResult> {
  const result = await requireAuth();
  if (!result.ok) return result;
  if (result.user.userType !== "user") {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "사용자 권한이 필요합니다" },
        { status: 403 }
      ),
    };
  }
  return result;
}
