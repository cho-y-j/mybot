import { NextRequest } from "next/server";
import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const id = parseInt(params.id, 10);
    if (isNaN(id) || id <= 0) return errorResponse("유효하지 않은 ID입니다", 400);

    const existing = await prisma.profile.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return errorResponse("요청한 항목을 찾을 수 없습니다", 404);
    }

    const body = await request.json();
    const { type, title, isCurrent } = body;

    const profile = await prisma.profile.update({
      where: { id },
      data: {
        ...(type !== undefined && { type }),
        ...(title !== undefined && { title }),
        ...(isCurrent !== undefined && { isCurrent }),
      },
    });

    return successResponse(profile);
  } catch {
    return errorResponse("프로필 수정에 실패했습니다", 500);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const id = parseInt(params.id, 10);
    if (isNaN(id) || id <= 0) return errorResponse("유효하지 않은 ID입니다", 400);

    const existing = await prisma.profile.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return errorResponse("요청한 항목을 찾을 수 없습니다", 404);
    }

    await prisma.profile.delete({ where: { id } });

    return successResponse({ deleted: true });
  } catch {
    return errorResponse("프로필 삭제에 실패했습니다", 500);
  }
}
