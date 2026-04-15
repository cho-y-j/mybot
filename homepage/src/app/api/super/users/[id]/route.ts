import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return auth.response;

    const user = await prisma.user.findUnique({
      where: { id: parseInt(params.id) },
      include: {
        siteSettings: true,
        _count: {
          select: { files: true, visits: true, gallery: true, pledges: true },
        },
      },
    });

    if (!user) return errorResponse("사용자를 찾을 수 없습니다", 404);

    const totalFileSize = await prisma.file.aggregate({
      where: { userId: user.id },
      _sum: { fileSize: true },
    });

    return successResponse({
      ...user,
      usage: {
        fileCount: user._count.files,
        totalFileSize: totalFileSize._sum.fileSize || 0,
        visitCount: user._count.visits,
        galleryCount: user._count.gallery,
        pledgeCount: user._count.pledges,
      },
    });
  } catch (error) {
    console.error("Get user error:", error);
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const {
      name, email, phone, plan, planStartedAt, planExpiresAt,
      templateType, templateTheme, isActive, memo,
      gaMeasurementId, customDomain,
    } = body;

    const user = await prisma.user.update({
      where: { id: parseInt(params.id) },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(plan !== undefined && { plan }),
        ...(planStartedAt !== undefined && { planStartedAt: planStartedAt ? new Date(planStartedAt) : null }),
        ...(planExpiresAt !== undefined && { planExpiresAt: planExpiresAt ? new Date(planExpiresAt) : null }),
        ...(templateType !== undefined && { templateType }),
        ...(templateTheme !== undefined && { templateTheme }),
        ...(isActive !== undefined && { isActive }),
        ...(memo !== undefined && { memo }),
        ...(gaMeasurementId !== undefined && { gaMeasurementId }),
        ...(customDomain !== undefined && { customDomain }),
      },
      select: { id: true, code: true, name: true, plan: true, isActive: true },
    });

    await prisma.activityLog.create({
      data: {
        userId: auth.user.id,
        userType: "super_admin",
        action: "update",
        targetType: "user",
        targetId: user.id,
      },
    });

    return successResponse(user);
  } catch (error) {
    console.error("Update user error:", error);
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return auth.response;

    const user = await prisma.user.update({
      where: { id: parseInt(params.id) },
      data: { isActive: false },
      select: { id: true, code: true, name: true },
    });

    await prisma.activityLog.create({
      data: {
        userId: auth.user.id,
        userType: "super_admin",
        action: "delete",
        targetType: "user",
        targetId: user.id,
      },
    });

    return successResponse({ message: "사용자가 비활성화되었습니다" });
  } catch (error) {
    console.error("Delete user error:", error);
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
