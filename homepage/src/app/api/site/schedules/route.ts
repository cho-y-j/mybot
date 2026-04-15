import { NextRequest } from "next/server";
import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const schedules = await prisma.schedule.findMany({
      where: { userId: user.id },
      orderBy: { date: "asc" },
    });

    return successResponse(schedules);
  } catch {
    return errorResponse("일정 목록을 불러오는데 실패했습니다", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const body = await request.json();
    const { title, date, time, location } = body;

    if (!title || !date) {
      return errorResponse("title과 date는 필수입니다");
    }

    const schedule = await prisma.schedule.create({
      data: {
        userId: user.id,
        title,
        date: new Date(date),
        time,
        location,
      },
    });

    return successResponse(schedule, 201);
  } catch {
    return errorResponse("일정 생성에 실패했습니다", 500);
  }
}
