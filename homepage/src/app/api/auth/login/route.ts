import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession, applySessionCookies } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { checkRateLimit } from "@/lib/rate-limit";

function buildLoginResponse(
  sessionId: string,
  userType: "super_admin" | "user",
  code: string,
  rememberMe: boolean,
  userPayload: Record<string, unknown>
) {
  const res = NextResponse.json({ success: true, data: { user: userPayload } });
  applySessionCookies(res, sessionId, userType, code, rememberMe);
  return res;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password, userType, rememberMe } = body;

    if (!username || !password || !userType) {
      return errorResponse("아이디, 비밀번호, 사용자 유형을 입력해주세요", 400);
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";

    const rateLimit = checkRateLimit(`login:${ip}`, 20, 15 * 60 * 1000);
    if (!rateLimit.allowed) {
      return errorResponse("로그인 시도 횟수를 초과했습니다. 15분 후 다시 시도해주세요", 429);
    }
    const userAgent = request.headers.get("user-agent") || "";
    const remember = rememberMe ?? false;

    if (userType === "super_admin") {
      const admin = await prisma.superAdmin.findUnique({ where: { username } });
      if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
        return errorResponse(`아이디 또는 비밀번호가 올바르지 않습니다 (남은 시도: ${rateLimit.remaining}회)`, 401);
      }

      const sessionId = await createSession(admin.id, "super_admin", remember, ip, userAgent);
      await prisma.activityLog.create({
        data: { userId: admin.id, userType: "super_admin", action: "login", ipAddress: ip },
      });
      return buildLoginResponse(sessionId, "super_admin", "", remember, {
        id: admin.id,
        name: admin.name || admin.username,
        userType: "super_admin",
      });
    }

    if (userType === "user") {
      const user = await prisma.user.findUnique({ where: { code: username } });
      if (!user || !user.isActive) {
        return errorResponse(`아이디 또는 비밀번호가 올바르지 않습니다 (남은 시도: ${rateLimit.remaining}회)`, 401);
      }
      if (!(await verifyPassword(password, user.passwordHash))) {
        return errorResponse(`아이디 또는 비밀번호가 올바르지 않습니다 (남은 시도: ${rateLimit.remaining}회)`, 401);
      }

      const sessionId = await createSession(user.id, "user", remember, ip, userAgent);
      await prisma.activityLog.create({
        data: { userId: user.id, userType: "user", action: "login", ipAddress: ip },
      });
      return buildLoginResponse(sessionId, "user", user.code, remember, {
        id: user.id,
        name: user.name,
        code: user.code,
        userType: "user",
      });
    }

    return errorResponse("유효하지 않은 사용자 유형입니다", 400);
  } catch (error) {
    console.error("Login error:", error);
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
