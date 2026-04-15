/**
 * homepage SSO 수신 — mybot에서 발급한 단기 JWT를 받아 homepage 세션 쿠키 발급.
 *
 * 경로가 /_sso 인 이유: NPM 라우팅에서 /api/*는 ep_backend로 가므로
 * /api/auth/sso 에 두면 homepage에 도달 못함. /_sso는 예약 경로로 ep_homepage로 라우팅됨.
 *
 * 호출: GET /_sso?token=JWT&redirect=/<code>/admin
 */
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { createSession, setSessionCookie } from "@/lib/auth";

const SSO_SECRET = process.env.SSO_SECRET || process.env.APP_SECRET_KEY || "";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const redirectPath = req.nextUrl.searchParams.get("redirect") || "/";
  if (!token) {
    return NextResponse.json({ success: false, error: "token 누락" }, { status: 400 });
  }
  if (!SSO_SECRET) {
    return NextResponse.json(
      { success: false, error: "SSO_SECRET 미설정" },
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
    return NextResponse.json({ success: false, error: "토큰 타입 불일치" }, { status: 401 });
  }

  const userId = Number(payload.sub);
  const code = String(payload.code || "");
  if (!userId || !code) {
    return NextResponse.json({ success: false, error: "토큰 payload 불완전" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive || user.code !== code) {
    return NextResponse.json({ success: false, error: "사용자 확인 실패" }, { status: 401 });
  }

  const ip = req.headers.get("x-forwarded-for") || req.ip || "";
  const ua = req.headers.get("user-agent") || "";
  const sessionId = await createSession(user.id, "user", false, ip, ua);
  setSessionCookie(sessionId, false);

  // mh_user_type / mh_code 쿠키도 세팅 (middleware에서 사용)
  const res = NextResponse.redirect(new URL(redirectPath, req.url));
  res.cookies.set("mh_user_type", "user", { path: "/", httpOnly: false });
  res.cookies.set("mh_code", code, { path: "/", httpOnly: false });
  return res;
}
