/**
 * 후보자 공개 홈페이지용 "우리에게 긍정적인 뉴스" 피드.
 *
 * mybot(분석 플랫폼)이 수집·검증한 뉴스 중 아래 조건만 노출:
 *   - is_relevant = true (동명이인/무관 걸러짐)
 *   - is_about_our_candidate = true
 *   - sentiment = 'positive'
 *   - sentiment_verified = true (Opus 재검증 완료)
 *
 * 같은 DB(schema=public)의 news_articles를 raw SQL로 조회.
 * tenant_id 없이 election_id로 얻음 — 같은 선거 모든 캠프가 공유하는 뉴스지만
 * "우리 후보 중심"은 election_id가 캠프마다 다르므로 충분히 캠프별로 걸러짐.
 */
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
      select: { id: true, isActive: true, electionId: true },
    });
    if (!user || !user.isActive) {
      return errorResponse("사이트를 찾을 수 없습니다", 404);
    }
    if (!user.electionId) {
      return successResponse({ items: [] });
    }

    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT title, url, source, summary,
              published_at, collected_at
       FROM public.news_articles
       WHERE election_id = $1::uuid
         AND is_relevant = true
         AND is_about_our_candidate = true
         AND sentiment = 'positive'
         AND sentiment_verified = true
       ORDER BY published_at DESC NULLS LAST, collected_at DESC
       LIMIT 30`,
      user.electionId
    );

    return successResponse({
      items: rows.map((r) => ({
        title: r.title,
        url: r.url,
        source: r.source,
        summary: r.summary,
        published_at: r.published_at,
      })),
    });
  } catch (e: any) {
    return errorResponse("서버 오류: " + (e?.message || ""), 500);
  }
}
