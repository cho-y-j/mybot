/**
 * POST /api/site/contacts/auto-suggest
 *
 * 로그인한 후보자 본인의 이름·지역·직함으로 네이버 검색 → SNS URL 후보 추출.
 * 응답은 사용자에게 체크박스로 보여줘 본인 계정만 저장하도록 함.
 *
 * body(선택): { name, region, positionTitle } — 지정 시 덮어씀. 없으면 DB 값 사용.
 */
import { NextRequest } from "next/server";
import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { suggestContactsFromNaver } from "@/lib/naver-search";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const user = await prisma.user.findUnique({
      where: { id: auth.user.id },
      select: { name: true, siteSettings: { select: { positionTitle: true, subtitle: true } } },
    });
    if (!user) return errorResponse("사용자를 찾을 수 없습니다", 404);

    // 이름·직위·지역 조합으로 검색
    const name = String(body.name || user.name || "").trim();
    const positionTitle = String(body.positionTitle || user.siteSettings?.positionTitle || "").trim();
    const region = String(body.region || user.siteSettings?.subtitle || "").trim();

    if (!name) return errorResponse("후보자 이름이 필요합니다", 400);

    const suggestions = await suggestContactsFromNaver({ name, region, positionTitle });

    // 이미 등록된 URL은 제외 (중복 저장 방지)
    const existing = await prisma.contact.findMany({
      where: { userId: auth.user.id },
      select: { url: true, value: true, type: true },
    });
    const existingKeys = new Set(
      existing.map((c) => `${c.type}:${(c.url || c.value || "").toLowerCase()}`),
    );

    const filtered = suggestions.filter((s) => !existingKeys.has(`${s.type}:${s.url.toLowerCase()}`));

    return successResponse({ items: filtered, query: { name, region, positionTitle } });
  } catch (e: unknown) {
    return errorResponse("서버 오류: " + (e instanceof Error ? e.message : ""), 500);
  }
}
