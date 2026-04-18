/**
 * homepage SSO 수신 — mybot에서 발급한 단기 JWT를 받아 homepage 세션 쿠키 발급.
 *
 * 경로 /sso 이유: /api/*는 NPM이 mybot으로 보내므로 homepage 경로는 /api 외여야 함.
 * Next.js는 _로 시작하는 폴더를 private 취급해 라우트 제외 → /_sso는 불가능, /sso 사용.
 *
 * 호출: GET /sso?token=JWT&redirect=/<code>/admin
 */
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { createSession, applySessionCookies } from "@/lib/auth";

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
    const msg = String(e?.message || "invalid");
    const human =
      msg.includes("exp") ? "토큰이 만료되었습니다 (5분 초과) — 다시 '홈페이지 편집' 버튼을 눌러주세요"
      : msg.includes("signature") ? "토큰 서명 불일치 — 관리자에게 문의하세요"
      : `토큰 검증 실패: ${msg}`;
    return NextResponse.json({ success: false, error: human }, { status: 401 });
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

  const res = NextResponse.redirect(new URL(redirectPath, req.url));
  applySessionCookies(res, sessionId, "user", code, false);
  return res;
}
