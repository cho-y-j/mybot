import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, createSession, setSessionCookie } from "@/lib/auth";
import { successResponse, errorResponse } from "@/lib/api-response";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    const rateLimit = checkRateLimit(`register:${ip}`, 3, 15 * 60 * 1000);
    if (!rateLimit.allowed) {
      return errorResponse("너무 많은 요청입니다. 잠시 후 다시 시도해주세요", 429);
    }

    const body = await request.json();
    const { code, name, phone, password, templateType, positionTitle, partyName } = body;

    // 필수 필드 검증
    if (!code || !name || !password) {
      return errorResponse("사이트 코드, 이름, 비밀번호는 필수입니다", 400);
    }

    // 코드 형식 검증 (영문 소문자 + 숫자, 3~20자)
    if (!/^[a-z0-9]{3,20}$/.test(code)) {
      return errorResponse("사이트 코드는 영문 소문자와 숫자 3~20자만 가능합니다", 400);
    }

    if (password.length < 8) {
      return errorResponse("비밀번호는 8자 이상이어야 합니다", 400);
    }

    // 코드 중복 검사
    const existing = await prisma.user.findUnique({ where: { code } });
    if (existing) {
      return errorResponse("이미 사용 중인 코드입니다. 다른 코드를 입력해주세요.", 409);
    }

    // 예약어 체크
    const reserved = ["admin", "super-admin", "api", "signup", "login", "demo", "_next", "favicon"];
    if (reserved.includes(code)) {
      return errorResponse("사용할 수 없는 코드입니다", 400);
    }

    // 사용자 + 사이트 설정 생성
    const user = await prisma.user.create({
      data: {
        code,
        name,
        phone: phone || null,
        passwordHash: await hashPassword(password),
        plan: "basic",
        templateType: templateType || "election",
        siteSettings: {
          create: {
            heroSlogan: `${name}`,
            positionTitle: positionTitle || "",
            partyName: partyName || "",
          },
        },
      },
    });

    // 자동 로그인
    const userAgent = request.headers.get("user-agent") || "";
    const sessionId = await createSession(user.id, "user", false, ip, userAgent);
    setSessionCookie(sessionId, false);

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        userType: "user",
        action: "register",
        ipAddress: ip,
      },
    });

    return successResponse({
      user: { id: user.id, code: user.code, name: user.name },
      redirectUrl: `/${code}/admin`,
    }, 201);
  } catch {
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
