/**
 * 후보자 공개 홈페이지용 "우리에게 긍정적인 뉴스" 피드.
 *
 * 노출 조건:
 *   - mybot 수집/검증 뉴스 중 is_relevant + is_about_our_candidate + sentiment=positive + sentiment_verified
 *   - feed_overrides에 hidden=true인 항목은 제외
 *   - pin_order 있는 항목은 위로
 *
 * 채널이 없거나 뉴스 0건이면 items:[] 반환 (UI에서 빈 공간 유지).
 */
import { whereCodeOrSlug } from "@/lib/find-user";
import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: { code: string } }
) {
  try {
    const { code } = params;
    const user = await prisma.user.findFirst({
      where: whereCodeOrSlug(code),
      select: { id: true, isActive: true, electionId: true },
    });
    if (!user || !user.isActive) return errorResponse("사이트를 찾을 수 없습니다", 404);
    if (!user.electionId) return successResponse({ items: [] });

    const [rows, overrides] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(
        // AI 분석 엔진이 이미 엄격 검증(is_relevant/is_about_our_candidate/sentiment/verified)한 결과를
        // 그대로 신뢰. 홍보 사이트라 긍정+중립만 노출, 부정·검증 미완은 제외.
        // 2026-04-22: is_about_our_candidate 가 04-15 이후 NULL 저장되는 버그 완화 —
        // IS DISTINCT FROM false 로 NULL/true 통과, 명시적 false 만 제외.
        `SELECT title, url, source, summary, published_at, collected_at
         FROM public.news_articles
         WHERE election_id = $1::uuid
           AND is_relevant = true
           AND is_about_our_candidate IS DISTINCT FROM false
           AND sentiment IN ('positive', 'neutral')
           AND sentiment_verified = true
         ORDER BY published_at DESC NULLS LAST, collected_at DESC
         LIMIT 60`,
        user.electionId
      ),
      prisma.feedOverride.findMany({
        where: { userId: user.id, feedType: "ai_news" },
        select: { sourceKey: true, hidden: true, pinOrder: true },
      }),
    ]);

    const overMap = new Map(overrides.map((o) => [o.sourceKey, o]));
    const filtered = rows
      .filter((r) => !overMap.get(r.url)?.hidden)
      .map((r) => ({
        url: r.url,
        title: r.title,
        source: r.source,
        summary: r.summary,
        published_at: r.published_at,
        pin_order: overMap.get(r.url)?.pinOrder ?? null,
      }))
      .sort((a, b) => {
        if (a.pin_order != null && b.pin_order == null) return -1;
        if (a.pin_order == null && b.pin_order != null) return 1;
        if (a.pin_order != null && b.pin_order != null) return a.pin_order - b.pin_order;
        return 0;
      })
      .slice(0, 30);

    return successResponse({ items: filtered });
  } catch (e: any) {
    return errorResponse("서버 오류: " + (e?.message || ""), 500);
  }
}
