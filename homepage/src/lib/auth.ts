import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { prisma } from "./db";
import type { SessionUser } from "@/types/user";

const SALT_ROUNDS = 12;
const COOKIE_NAME = "mh_session";
const SESSION_EXPIRY_HOURS = 2; // 관리자 세션: 2시간
const REMEMBER_ME_DAYS = 7; // 자동 로그인: 7일

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function createSession(
  userId: number,
  userType: "super_admin" | "user",
  rememberMe: boolean,
  ip: string,
  userAgent: string
): Promise<string> {
  const sessionId = randomBytes(32).toString("hex");
  const expiresAt = rememberMe
    ? new Date(Date.now() + REMEMBER_ME_DAYS * 24 * 60 * 60 * 1000)
    : new Date(Date.now() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      id: sessionId,
      userId,
      userType,
      ipAddress: ip,
      userAgent,
      expiresAt,
    },
  });

  return sessionId;
}

export async function getSession(
  sessionId: string
): Promise<SessionUser | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.expiresAt < new Date()) {
    if (session) {
      await prisma.session.delete({ where: { id: sessionId } });
    }
    return null;
  }

  if (session.userType === "super_admin") {
    const admin = await prisma.superAdmin.findUnique({
      where: { id: session.userId },
    });
    if (!admin) return null;
    return {
      id: admin.id,
      userType: "super_admin",
      name: admin.name || admin.username,
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
  });
  if (!user || !user.isActive) return null;
  return {
    id: user.id,
    userType: "user",
    code: user.code,
    slug: user.slug,
    name: user.name,
  };
}

export async function deleteSession(sessionId: string): Promise<void> {
  await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
}

export function setSessionCookie(sessionId: string, rememberMe: boolean) {
  const maxAge = rememberMe
    ? REMEMBER_ME_DAYS * 24 * 60 * 60
    : SESSION_EXPIRY_HOURS * 60 * 60;
  const cookieStore = cookies();
  cookieStore.set(COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

/**
 * Route Handler 응답에 세션 쿠키 3종을 직접 부착.
 * Next.js App Router에서 `cookies().set()`은 `NextResponse`를 새로 생성해 반환할 때
 * 응답 헤더에 누락될 수 있음 — 이 헬퍼는 `response.cookies.set()`로 확실히 부착.
 *
 * Why: /sso, /api/auth/{login,register,register(gate)} 등 NextResponse를 직접 반환하는
 *      route에서 과거 `cookies().set()`만 쓸 때 재로그인 버그 발생 (2026-04-18).
 */
export function applySessionCookies(
  res: NextResponse,
  sessionId: string,
  userType: "super_admin" | "user",
  code: string,
  rememberMe: boolean
) {
  const secure = process.env.NODE_ENV === "production";
  const sessionMaxAge = rememberMe
    ? REMEMBER_ME_DAYS * 24 * 60 * 60
    : SESSION_EXPIRY_HOURS * 60 * 60;
  const longMaxAge = 30 * 24 * 60 * 60;

  res.cookies.set(COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: sessionMaxAge,
  });
  res.cookies.set("mh_user_type", userType, {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: longMaxAge,
  });
  res.cookies.set("mh_code", code, {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: longMaxAge,
  });
}

export function getSessionFromCookies(): string | null {
  const cookieStore = cookies();
  return cookieStore.get(COOKIE_NAME)?.value ?? null;
}

export function clearSessionCookie() {
  const cookieStore = cookies();
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
