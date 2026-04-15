import { NextRequest } from "next/server";
import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const pledges = await prisma.pledge.findMany({
      where: { userId: user.id },
      orderBy: { sortOrder: "asc" },
    });

    return successResponse(pledges);
  } catch {
    return errorResponse("공약 목록을 불러오는데 실패했습니다", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const body = await request.json();
    const { icon, title, description, details } = body;

    if (!title) {
      return errorResponse("title은 필수입니다");
    }

    const maxOrder = await prisma.pledge.aggregate({
      where: { userId: user.id },
      _max: { sortOrder: true },
    });

    const pledge = await prisma.pledge.create({
      data: {
        userId: user.id,
        icon: icon ?? "fas fa-bullhorn",
        title,
        description,
        details: details ?? [],
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      },
    });

    return successResponse(pledge, 201);
  } catch {
    return errorResponse("공약 생성에 실패했습니다", 500);
  }
}
