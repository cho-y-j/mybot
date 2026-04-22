import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, createSession, applySessionCookies } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { checkRateLimit } from "@/lib/rate-limit";
import { validateSlug } from "@/lib/reserved-slugs";

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

    if (password.length < 8) {
      return errorResponse("비밀번호는 8자 이상이어야 합니다", 400);
    }

    // slug 규칙과 동일하게 검증 (영소문자+숫자+하이픈, 3~30자, 예약어 차단)
    const sv = validateSlug(code);
    if (!sv.ok) {
      return errorResponse(`사이트 주소: ${sv.reason}`, 400);
    }
    const normalized = sv.normalized;

    // code + slug 양쪽 모두 중복 금지 — 동일 URL로 접근되기 때문
    const existing = await prisma.user.findFirst({
      where: { OR: [{ code: normalized }, { slug: normalized }] },
    });
    if (existing) {
      return errorResponse("이미 사용 중인 주소입니다. 다른 값을 입력해주세요.", 409);
    }

    // 사용자 + 사이트 설정 생성. code를 slug로도 저장해서 URL 일관성 유지
    const user = await prisma.user.create({
      data: {
        code: normalized,
        slug: normalized,
        slugChangedAt: new Date(),
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

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        userType: "user",
        action: "register",
        ipAddress: ip,
      },
    });

    const res = NextResponse.json({
      success: true,
      data: {
        user: { id: user.id, code: user.code, name: user.name },
        redirectUrl: `/${code}/admin`,
      },
    }, { status: 201 });
    applySessionCookies(res, sessionId, "user", user.code, false);
    return res;
  } catch {
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
