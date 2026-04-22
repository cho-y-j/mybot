// /{code}/api/auth/login — NPM이 ai.on1.kr/api/* 를 mybot으로 라우팅하므로
// homepage admin 로그인은 /{code}/* 경로를 통해 호출되어야 한다.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession, applySessionCookies } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkLocked, recordFailedLogin, clearLoginLock, LOCK_MINUTES } from "@/lib/login-lock";

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
    // IP 제한은 느슨하게만 유지 — 같은 IP에서 5분에 100회 이상은 명백한 자동화 공격
    const ipLimit = checkRateLimit(`login:${ip}`, 100, 5 * 60 * 1000);
    if (!ipLimit.allowed) {
      return errorResponse("너무 많은 요청이 감지됐습니다. 잠시 후 다시 시도해주세요", 429);
    }
    const userAgent = request.headers.get("user-agent") || "";

    // URL 세그먼트는 slug(지정 주소) 또는 code(자동 주소) 어느 쪽이든 허용
    const user = await prisma.user.findFirst({
      where: { OR: [{ slug: code }, { code }] },
    });
    if (!user || !user.isActive) {
      return errorResponse("비밀번호가 올바르지 않습니다", 401);
    }

    // 계정별 잠금 — NAT 공유 IP 환경에서도 다른 사용자 영향 없이 동작
    const lock = checkLocked(user);
    if (lock.locked) {
      return errorResponse(`로그인 시도가 너무 많아 계정이 ${lock.remainingMinutes}분간 잠겼습니다. 잠시 후 다시 시도해주세요`, 423);
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      const fail = await recordFailedLogin(user.id);
      if (fail.justLocked) {
        return errorResponse(`연속 5회 실패 — 계정이 ${LOCK_MINUTES}분간 잠겼습니다. 잠시 후 다시 시도해주세요`, 423);
      }
      return errorResponse(`비밀번호가 올바르지 않습니다 (남은 시도: ${fail.remaining}회)`, 401);
    }

    // 성공 — 실패 카운터·잠금 해제
    await clearLoginLock(user.id);

    const remember = rememberMe ?? false;
    const sessionId = await createSession(user.id, "user", remember, ip, userAgent);

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        userType: "user",
        action: "login",
        ipAddress: ip,
      },
    });

    const res = NextResponse.json({
      success: true,
      data: {
        user: { id: user.id, name: user.name, code: user.code, userType: "user" },
      },
    });
    applySessionCookies(res, sessionId, "user", user.code, remember);
    return res;
  } catch (error) {
    console.error("Login error:", error);
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
