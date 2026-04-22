/**
 * PUT /api/site/slug  — 로그인 사용자 본인의 슬러그를 지정/변경.
 *
 * body: { slug: "jinkyun" | null }
 *   - null 또는 빈 문자열 → 슬러그 제거 (code URL로 복귀)
 *   - 문자열 → 형식·예약어·중복 검사 후 저장
 *
 * 응답: { slug, slugChangedAt }
 */
import { NextRequest } from "next/server";
import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { validateSlug } from "@/lib/reserved-slugs";

const COOLDOWN_DAYS = 30;

export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const raw = typeof body.slug === "string" ? body.slug.trim() : "";

  // 제거 요청
  if (!raw) {
    const updated = await prisma.user.update({
      where: { id: auth.user.id },
      data: { slug: null, slugChangedAt: new Date() },
      select: { slug: true, slugChangedAt: true },
    });
    return successResponse(updated);
  }

  const v = validateSlug(raw);
  if (!v.ok) return errorResponse(v.reason, 400);

  // 쿨다운 체크 — 최근 30일 안에 바꿨으면 또 못 바꿈 (계정 매매·혼란 방지)
  const current = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: { slug: true, slugChangedAt: true },
  });
  if (current?.slugChangedAt && current.slug !== v.normalized) {
    const elapsed = Date.now() - current.slugChangedAt.getTime();
    const remainingMs = COOLDOWN_DAYS * 86400 * 1000 - elapsed;
    if (remainingMs > 0) {
      const days = Math.ceil(remainingMs / 86400000);
      return errorResponse(`주소 변경은 ${COOLDOWN_DAYS}일에 한 번만 가능해요. ${days}일 후에 다시 시도하세요`, 400);
    }
  }

  // 중복 검사 (본인 slug/code와 같으면 OK)
  if (v.normalized !== current?.slug) {
    const [slugHit, codeHit] = await Promise.all([
      prisma.user.findUnique({ where: { slug: v.normalized }, select: { id: true } }),
      prisma.user.findUnique({ where: { code: v.normalized }, select: { id: true } }),
    ]);
    if (slugHit && slugHit.id !== auth.user.id) {
      return errorResponse("이미 쓰는 주소예요", 409);
    }
    if (codeHit && codeHit.id !== auth.user.id) {
      return errorResponse("이미 쓰는 주소예요", 409);
    }
  }

  const updated = await prisma.user.update({
    where: { id: auth.user.id },
    data: { slug: v.normalized, slugChangedAt: new Date() },
    select: { slug: true, slugChangedAt: true },
  });
  return successResponse(updated);
}
