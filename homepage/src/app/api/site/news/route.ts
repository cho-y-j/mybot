import { NextRequest } from "next/server";
import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const news = await prisma.news.findMany({
      where: { userId: user.id },
      orderBy: { sortOrder: "asc" },
    });

    return successResponse(news);
  } catch {
    return errorResponse("뉴스 목록을 불러오는데 실패했습니다", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const body = await request.json();
    const { title, source, url, imageUrl, publishedDate } = body;

    if (!title) {
      return errorResponse("title은 필수입니다");
    }

    const maxOrder = await prisma.news.aggregate({
      where: { userId: user.id },
      _max: { sortOrder: true },
    });

    const item = await prisma.news.create({
      data: {
        userId: user.id,
        title,
        source,
        url,
        imageUrl,
        publishedDate: publishedDate ? new Date(publishedDate) : undefined,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      },
    });

    return successResponse(item, 201);
  } catch {
    return errorResponse("뉴스 생성에 실패했습니다", 500);
  }
}
