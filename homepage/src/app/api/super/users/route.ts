import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { requireSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "20", 10), 1), 100);
    const search = searchParams.get("search") || "";
    const plan = searchParams.get("plan") || "";
    const templateType = searchParams.get("templateType") || "";
    const isActive = searchParams.get("isActive");

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
      ];
    }
    if (plan) where.plan = plan;
    if (templateType) where.templateType = templateType;
    if (isActive !== null && isActive !== "") where.isActive = isActive === "true";

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          code: true,
          name: true,
          email: true,
          phone: true,
          plan: true,
          templateType: true,
          isActive: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    return successResponse({
      users,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("List users error:", error);
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { code, name, email, phone, password, plan, templateType, memo } = body;

    if (!code || !name || !password) {
      return errorResponse("코드, 이름, 비밀번호는 필수입니다", 400);
    }

    const existing = await prisma.user.findUnique({ where: { code } });
    if (existing) {
      return errorResponse("이미 사용 중인 코드입니다", 409);
    }

    const user = await prisma.user.create({
      data: {
        code,
        name,
        email,
        phone,
        passwordHash: await hashPassword(password),
        plan: plan || "basic",
        templateType: templateType || "election",
        memo,
        siteSettings: { create: {} },
      },
      select: {
        id: true,
        code: true,
        name: true,
        plan: true,
        templateType: true,
        createdAt: true,
      },
    });

    await prisma.activityLog.create({
      data: {
        userId: auth.user.id,
        userType: "super_admin",
        action: "create",
        targetType: "user",
        targetId: user.id,
        details: { code, name },
      },
    });

    return successResponse(user, 201);
  } catch (error) {
    console.error("Create user error:", error);
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
