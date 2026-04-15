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

    const existing = await prisma.news.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return errorResponse("요청한 항목을 찾을 수 없습니다", 404);
    }

    const body = await request.json();
    const { title, source, url, imageUrl, publishedDate } = body;

    const item = await prisma.news.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(source !== undefined && { source }),
        ...(url !== undefined && { url }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(publishedDate !== undefined && {
          publishedDate: publishedDate ? new Date(publishedDate) : null,
        }),
      },
    });

    return successResponse(item);
  } catch {
    return errorResponse("뉴스 수정에 실패했습니다", 500);
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

    const existing = await prisma.news.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return errorResponse("요청한 항목을 찾을 수 없습니다", 404);
    }

    await prisma.news.delete({ where: { id } });

    return successResponse({ deleted: true });
  } catch {
    return errorResponse("뉴스 삭제에 실패했습니다", 500);
  }
}
