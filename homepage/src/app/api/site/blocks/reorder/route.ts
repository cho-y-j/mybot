import { NextRequest } from "next/server";
import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const body = await request.json();
    const { ids } = body as { ids: number[] };

    if (!Array.isArray(ids) || ids.length === 0) {
      return errorResponse("ids 배열이 필요합니다");
    }

    const blocks = await prisma.block.findMany({
      where: { id: { in: ids }, userId: user.id },
      select: { id: true },
    });

    if (blocks.length !== ids.length) {
      return errorResponse("일부 블록이 존재하지 않거나 권한이 없습니다", 403);
    }

    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.block.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    );

    return successResponse({ reordered: true });
  } catch {
    return errorResponse("정렬 순서 변경에 실패했습니다", 500);
  }
}
