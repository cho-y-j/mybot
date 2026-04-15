import { NextRequest } from "next/server";
import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const profiles = await prisma.profile.findMany({
      where: { userId: user.id },
      orderBy: { sortOrder: "asc" },
    });

    return successResponse(profiles);
  } catch {
    return errorResponse("프로필 목록을 불러오는데 실패했습니다", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const body = await request.json();
    const { type, title, isCurrent } = body;

    if (!type || !title) {
      return errorResponse("type과 title은 필수입니다");
    }

    const maxOrder = await prisma.profile.aggregate({
      where: { userId: user.id },
      _max: { sortOrder: true },
    });

    const profile = await prisma.profile.create({
      data: {
        userId: user.id,
        type,
        title,
        isCurrent: isCurrent ?? false,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      },
    });

    return successResponse(profile, 201);
  } catch {
    return errorResponse("프로필 생성에 실패했습니다", 500);
  }
}
