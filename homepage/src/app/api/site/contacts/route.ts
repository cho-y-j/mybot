import { NextRequest } from "next/server";
import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const contacts = await prisma.contact.findMany({
      where: { userId: user.id },
      orderBy: { sortOrder: "asc" },
    });

    return successResponse(contacts);
  } catch {
    return errorResponse("연락처 목록을 불러오는데 실패했습니다", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const body = await request.json();
    const { type, label, value, url } = body;

    if (!type || !value) {
      return errorResponse("type과 value는 필수입니다");
    }

    const maxOrder = await prisma.contact.aggregate({
      where: { userId: user.id },
      _max: { sortOrder: true },
    });

    const contact = await prisma.contact.create({
      data: {
        userId: user.id,
        type,
        label,
        value,
        url,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      },
    });

    return successResponse(contact, 201);
  } catch {
    return errorResponse("연락처 생성에 실패했습니다", 500);
  }
}
