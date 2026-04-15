import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: { code: string } }
) {
  try {
    const { code } = params;

    const user = await prisma.user.findUnique({
      where: { code },
      select: { id: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return errorResponse("사이트를 찾을 수 없습니다", 404);
    }

    return successResponse({ exists: true });
  } catch {
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
