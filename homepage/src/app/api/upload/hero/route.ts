import { NextRequest } from "next/server";
import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { validateFile, saveFile } from "@/lib/upload";
import { processHeroImage, generateThumbnail } from "@/lib/image";

const PLAN_LIMITS: Record<string, { maxFiles: number; maxBytes: number }> = {
  basic: { maxFiles: 50, maxBytes: 100 * 1024 * 1024 },
  premium: { maxFiles: 500, maxBytes: 2 * 1024 * 1024 * 1024 },
};

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return errorResponse("파일이 필요합니다", 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const validation = validateFile(buffer, file.type, file.name);
    if (!validation.valid) {
      return errorResponse(validation.error!, 400);
    }

    const user = await prisma.user.findUnique({
      where: { id: auth.user.id },
      select: { code: true, plan: true },
    });

    if (!user) {
      return errorResponse("사용자를 찾을 수 없습니다", 404);
    }

    // Check plan limits
    const limits = PLAN_LIMITS[user.plan] ?? PLAN_LIMITS.basic;
    const [fileCount, sizeAgg] = await Promise.all([
      prisma.file.count({ where: { userId: auth.user.id } }),
      prisma.file.aggregate({
        where: { userId: auth.user.id },
        _sum: { fileSize: true },
      }),
    ]);

    if (fileCount >= limits.maxFiles) {
      return errorResponse(
        `파일 개수 제한을 초과했습니다 (최대 ${limits.maxFiles}개)`,
        400
      );
    }

    const totalSize = sizeAgg._sum.fileSize ?? 0;
    if (totalSize + buffer.length > limits.maxBytes) {
      return errorResponse("저장 용량 제한을 초과했습니다", 400);
    }

    // Process images
    const [processed, thumbnail] = await Promise.all([
      processHeroImage(buffer),
      generateThumbnail(buffer),
    ]);

    // Save files to disk
    const [url, thumbnailUrl] = await Promise.all([
      saveFile(processed, user.code, "hero"),
      saveFile(thumbnail, user.code, "hero-thumb"),
    ]);

    // Create DB record
    const fileRecord = await prisma.file.create({
      data: {
        userId: auth.user.id,
        originalName: file.name,
        storedPath: url,
        fileType: "hero",
        mimeType: "image/webp",
        fileSize: processed.length,
      },
    });

    return successResponse({
      url,
      thumbnailUrl,
      fileId: fileRecord.id,
    });
  } catch {
    return errorResponse("파일 업로드에 실패했습니다", 500);
  }
}
