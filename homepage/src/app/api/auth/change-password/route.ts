import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { requireAuth } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword || !newPassword) {
      return errorResponse("현재 비밀번호와 새 비밀번호를 입력해주세요", 400);
    }

    if (newPassword.length < 8) {
      return errorResponse("비밀번호는 8자 이상이어야 합니다", 400);
    }

    if (user.userType === "super_admin") {
      const admin = await prisma.superAdmin.findUnique({
        where: { id: user.id },
      });
      if (!admin || !(await verifyPassword(currentPassword, admin.passwordHash))) {
        return errorResponse("현재 비밀번호가 올바르지 않습니다", 401);
      }
      await prisma.superAdmin.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(newPassword) },
      });
    } else {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
      });
      if (!dbUser || !(await verifyPassword(currentPassword, dbUser.passwordHash))) {
        return errorResponse("현재 비밀번호가 올바르지 않습니다", 401);
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(newPassword) },
      });
    }

    return successResponse({ message: "비밀번호가 변경되었습니다" });
  } catch (error) {
    console.error("Change password error:", error);
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
