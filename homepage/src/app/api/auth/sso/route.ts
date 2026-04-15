/**
 * ElectionPulse ↔ MyHome SSO 브릿지 (수신 측).
 *
 * mybot이 발급한 단기 JWT(?token=...)를 받아서 검증하고
 * myhome 자체 session 쿠키를 구워준다. 그 후 /[code]/admin 으로 redirect.
 *
 * 보안: HS256 + SSO_SECRET 환경변수 공유 (mybot의 APP_SECRET_KEY와 동일값)
 * 토큰 exp=60초 — 재사용/유출 리스크 최소화.
 */
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { createSession, setSessionCookie } from "@/lib/auth";

const SSO_SECRET = process.env.SSO_SECRET || process.env.APP_SECRET_KEY || "";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json(
      { success: false, error: "token 파라미터 누락" },
      { status: 400 }
    );
  }
  if (!SSO_SECRET) {
    return NextResponse.json(
      { success: false, error: "SSO_SECRET 환경변수 미설정" },
      { status: 500 }
    );
  }

  let payload: any;
  try {
    const secret = new TextEncoder().encode(SSO_SECRET);
    const result = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    payload = result.payload;
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: "토큰 검증 실패: " + (e?.message || "invalid") },
      { status: 401 }
    );
  }

  if (payload.type !== "homepage_sso") {
    return NextResponse.json(
      { success: false, error: "토큰 타입 불일치" },
      { status: 401 }
    );
  }

  const userId = Number(payload.sub);
  const code = String(payload.code || "");
  if (!userId || !code) {
    return NextResponse.json(
      { success: false, error: "토큰 payload 불완전" },
      { status: 401 }
    );
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive || user.code !== code) {
    return NextResponse.json(
      { success: false, error: "사용자 확인 실패" },
      { status: 401 }
    );
  }

  const ip = req.headers.get("x-forwarded-for") || req.ip || "";
  const ua = req.headers.get("user-agent") || "";
  const sessionId = await createSession(user.id, "user", false, ip, ua);
  setSessionCookie(sessionId, false);

  return NextResponse.redirect(new URL(`/${code}/admin`, req.url));
}
