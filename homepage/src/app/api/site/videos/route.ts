import { NextRequest } from "next/server";
import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const videos = await prisma.video.findMany({
      where: { userId: user.id },
      orderBy: { sortOrder: "asc" },
    });

    return successResponse(videos);
  } catch {
    return errorResponse("영상 목록을 불러오는데 실패했습니다", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const body = await request.json();
    const { videoId, title, description } = body;

    if (!videoId) {
      return errorResponse("videoId는 필수입니다");
    }

    const maxOrder = await prisma.video.aggregate({
      where: { userId: user.id },
      _max: { sortOrder: true },
    });

    const video = await prisma.video.create({
      data: {
        userId: user.id,
        videoId,
        title,
        description,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      },
    });

    return successResponse(video, 201);
  } catch {
    return errorResponse("영상 생성에 실패했습니다", 500);
  }
}
