import { prisma } from "./db";

export function getDateRange(period: string): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  switch (period) {
    case "today":
      // start is already today 00:00
      break;
    case "week":
      start.setDate(start.getDate() - 7);
      break;
    case "month":
      start.setDate(start.getDate() - 30);
      break;
    case "all":
      start.setFullYear(2020, 0, 1);
      break;
    default:
      start.setDate(start.getDate() - 7);
      break;
  }

  return { start, end };
}

export async function getVisitorStats(
  userId: number,
  start: Date,
  end: Date
) {
  const stats = await prisma.visitDailyStat.findMany({
    where: {
      userId,
      date: { gte: start, lte: end },
    },
    orderBy: { date: "asc" },
  });

  return stats;
}

export async function getEventStats(
  userId: number,
  start: Date,
  end: Date
) {
  const stats = await prisma.eventDailyStat.findMany({
    where: {
      userId,
      date: { gte: start, lte: end },
    },
    orderBy: { date: "asc" },
  });

  return stats;
}
