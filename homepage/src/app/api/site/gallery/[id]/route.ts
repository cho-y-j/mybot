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

    const existing = await prisma.gallery.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return errorResponse("요청한 항목을 찾을 수 없습니다", 404);
    }

    const body = await request.json();
    const { url, altText, category, sortOrder } = body;

    const item = await prisma.gallery.update({
      where: { id },
      data: {
        ...(url !== undefined && { url }),
        ...(altText !== undefined && { altText }),
        ...(category !== undefined && { category }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
    });

    return successResponse(item);
  } catch {
    return errorResponse("갤러리 항목 수정에 실패했습니다", 500);
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

    const existing = await prisma.gallery.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return errorResponse("요청한 항목을 찾을 수 없습니다", 404);
    }

    await prisma.gallery.delete({ where: { id } });

    return successResponse({ deleted: true });
  } catch {
    return errorResponse("갤러리 항목 삭제에 실패했습니다", 500);
  }
}
