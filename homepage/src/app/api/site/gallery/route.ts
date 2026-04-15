import { NextRequest } from "next/server";
import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const gallery = await prisma.gallery.findMany({
      where: { userId: user.id },
      orderBy: { sortOrder: "asc" },
    });

    return successResponse(gallery);
  } catch {
    return errorResponse("갤러리 목록을 불러오는데 실패했습니다", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const body = await request.json();
    const { url, altText, category } = body;

    if (!url) {
      return errorResponse("url은 필수입니다");
    }

    const maxOrder = await prisma.gallery.aggregate({
      where: { userId: user.id },
      _max: { sortOrder: true },
    });

    const item = await prisma.gallery.create({
      data: {
        userId: user.id,
        url,
        altText,
        category: category ?? "activity",
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      },
    });

    return successResponse(item, 201);
  } catch {
    return errorResponse("갤러리 항목 생성에 실패했습니다", 500);
  }
}
