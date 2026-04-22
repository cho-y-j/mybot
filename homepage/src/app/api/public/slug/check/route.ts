/**
 * GET /api/public/slug/check?value=xxx
 * 가입/설정 단계에서 실시간 중복·예약어·형식 검사. 공개 엔드포인트.
 *
 * 응답:
 *   { available: true, normalized: "jinkyun" }
 *   { available: false, reason: "예약어라 쓸 수 없어요" }
 */
import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { validateSlug } from "@/lib/reserved-slugs";

export async function GET(req: NextRequest) {
  const value = req.nextUrl.searchParams.get("value") || "";
  const res = validateSlug(value);
  if (!res.ok) {
    return successResponse({ available: false, reason: res.reason });
  }

  // code와도 충돌하면 안 됨 — 기존 사용자가 해당 code로 접속 중일 수 있음
  const [slugHit, codeHit] = await Promise.all([
    prisma.user.findUnique({ where: { slug: res.normalized }, select: { id: true } }),
    prisma.user.findUnique({ where: { code: res.normalized }, select: { id: true } }),
  ]);

  if (slugHit || codeHit) {
    return successResponse({ available: false, reason: "이미 쓰는 주소예요" });
  }

  return successResponse({ available: true, normalized: res.normalized });
}
