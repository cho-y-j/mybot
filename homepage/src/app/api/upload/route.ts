import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const files = await prisma.file.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        originalName: true,
        storedPath: true,
        fileType: true,
        mimeType: true,
        fileSize: true,
        createdAt: true,
      },
    });

    return successResponse(files);
  } catch {
    return errorResponse("파일 목록을 불러오는데 실패했습니다", 500);
  }
}
