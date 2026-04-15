import { NextRequest } from "next/server";
import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const blocks = await prisma.block.findMany({
      where: { userId: user.id },
      orderBy: { sortOrder: "asc" },
    });

    return successResponse(blocks);
  } catch {
    return errorResponse("블록 목록을 불러오는데 실패했습니다", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const body = await request.json();
    const { type, title, content, visible, sortOrder } = body;

    if (!type) {
      return errorResponse("type은 필수입니다");
    }

    let finalSortOrder = sortOrder;
    if (finalSortOrder === undefined || finalSortOrder === null) {
      const maxOrder = await prisma.block.aggregate({
        where: { userId: user.id },
        _max: { sortOrder: true },
      });
      finalSortOrder = (maxOrder._max.sortOrder ?? -1) + 1;
    } else {
      // Shift existing blocks at or after this position
      await prisma.block.updateMany({
        where: {
          userId: user.id,
          sortOrder: { gte: finalSortOrder },
        },
        data: { sortOrder: { increment: 1 } },
      });
    }

    const block = await prisma.block.create({
      data: {
        userId: user.id,
        type,
        title: title ?? null,
        content: content ?? null,
        visible: visible ?? true,
        sortOrder: finalSortOrder,
      },
    });

    return successResponse(block, 201);
  } catch {
    return errorResponse("블록 생성에 실패했습니다", 500);
  }
}
