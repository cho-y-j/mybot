import { prisma } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";

export async function GET() {
  try {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return auth.response;

    const [
      totalUsers,
      basicUsers,
      premiumUsers,
      activeUsers,
      recentUsers,
      todayVisits,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { plan: "basic" } }),
      prisma.user.count({ where: { plan: "premium" } }),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, code: true, name: true, plan: true, createdAt: true },
      }),
      prisma.visitDailyStat.aggregate({
        where: { date: new Date(new Date().toISOString().split("T")[0]) },
        _sum: { totalVisits: true },
      }),
    ]);

    return successResponse({
      stats: {
        totalUsers,
        basicUsers,
        premiumUsers,
        activeUsers,
        inactiveUsers: totalUsers - activeUsers,
        todayVisits: todayVisits._sum.totalVisits || 0,
      },
      recentUsers,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
