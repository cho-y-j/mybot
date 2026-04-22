import { NextRequest } from "next/server";
import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { deleteFile } from "@/lib/upload";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const { fileId } = await params;
    const id = parseInt(fileId, 10);

    if (isNaN(id)) {
      return errorResponse("유효하지 않은 파일 ID입니다", 400);
    }

    const file = await prisma.file.findUnique({
      where: { id },
    });

    if (!file) {
      return errorResponse("파일을 찾을 수 없습니다", 404);
    }

    // Verify ownership
    if (file.userId !== auth.user.id) {
      return errorResponse("파일에 대한 권한이 없습니다", 403);
    }

    // Delete from disk
    await deleteFile(file.storedPath);

    // Also try to delete thumbnail (convention: type-thumb directory)
    const thumbPath = file.storedPath.replace(
      `/${file.fileType}/`,
      `/${file.fileType}-thumb/`
    );
    await deleteFile(thumbPath);

    // Delete DB record
    await prisma.file.delete({
      where: { id },
    });

    return successResponse({ deleted: true });
  } catch {
    return errorResponse("파일 삭제에 실패했습니다", 500);
  }
}
