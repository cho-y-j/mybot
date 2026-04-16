// /{code}/api/auth/login — NPM이 ai.on1.kr/api/* 를 mybot으로 라우팅하므로
// homepage admin 로그인은 /{code}/* 경로를 통해 호출되어야 한다.
// 기존 /api/auth/login 라우트와 동일 로직, user 타입만 처리.
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import { verifyPassword, createSession, setSessionCookie } from "@/lib/auth";
import { successResponse, errorResponse } from "@/lib/api-response";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  try {
    const body = await request.json();
    const { password, rememberMe } = body;
    const code = params.code;

    if (!code || !password) {
      return errorResponse("비밀번호를 입력해주세요", 400);
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rateLimit = checkRateLimit(`login:${ip}`, 20, 15 * 60 * 1000);
    if (!rateLimit.allowed) {
      return errorResponse(
        "로그인 시도 횟수를 초과했습니다. 15분 후 다시 시도해주세요",
        429
      );
    }
    const userAgent = request.headers.get("user-agent") || "";

    const user = await prisma.user.findUnique({ where: { code } });
    if (!user || !user.isActive) {
      return errorResponse(
        `비밀번호가 올바르지 않습니다 (남은 시도: ${rateLimit.remaining}회)`,
        401
      );
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      return errorResponse(
        `비밀번호가 올바르지 않습니다 (남은 시도: ${rateLimit.remaining}회)`,
        401
      );
    }

    const sessionId = await createSession(
      user.id,
      "user",
      rememberMe ?? false,
      ip,
      userAgent
    );
    setSessionCookie(sessionId, rememberMe ?? false);
    const c = cookies();
    c.set("mh_user_type", "user", {
      path: "/",
      httpOnly: false,
      maxAge: 30 * 24 * 60 * 60,
    });
    c.set("mh_code", user.code, {
      path: "/",
      httpOnly: false,
      maxAge: 30 * 24 * 60 * 60,
    });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        userType: "user",
        action: "login",
        ipAddress: ip,
      },
    });

    return successResponse({
      user: { id: user.id, name: user.name, code: user.code, userType: "user" },
    });
  } catch (error) {
    console.error("Login error:", error);
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
