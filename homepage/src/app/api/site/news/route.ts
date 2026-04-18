import { NextRequest } from "next/server";
import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";

/**
 * 빌더용 뉴스 통합 목록 — 2026-04-18 재설계.
 *
 * 공개 페이지(/{code})와 같은 소스를 보여준다:
 *   1) AI 자동수집 (public.news_articles — mybot이 검증한 우리 후보 긍정 뉴스)
 *   2) 수동 입력 (homepage.news — 사용자 직접 등록)
 *   3) FeedOverride (AI 항목 숨김/고정)
 *
 * AI 항목은 hide 토글만 가능 (편집/삭제 불가, feedOverride로 제어).
 * 수동 항목은 기존대로 편집·삭제 가능.
 */
export async function GET() {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const userRow = await prisma.user.findUnique({
      where: { id: user.id },
      select: { electionId: true },
    });

    const [aiRows, manualRows, overrides] = await Promise.all([
      userRow?.electionId
        ? prisma.$queryRawUnsafe<any[]>(
            // 2026-04-18: 엄격 `= true` → `IS NOT FALSE`로 완화 (AI 분석 NULL도 포함).
            `SELECT title, url, source, ai_summary AS summary, published_at, collected_at
             FROM public.news_articles
             WHERE election_id = $1::uuid
               AND is_relevant IS NOT FALSE AND is_about_our_candidate IS NOT FALSE
               AND sentiment = 'positive' AND sentiment_verified IS NOT FALSE
             ORDER BY published_at DESC NULLS LAST, collected_at DESC
             LIMIT 60`,
            userRow.electionId
          )
        : Promise.resolve([]),
      prisma.news.findMany({
        where: { userId: user.id },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.feedOverride.findMany({
        where: { userId: user.id, feedType: "ai_news" },
        select: { sourceKey: true, hidden: true, pinOrder: true },
      }),
    ]);

    const overMap = new Map(overrides.map((o) => [o.sourceKey, o]));

    const aiItems = aiRows.map((r: any) => ({
      id: null,
      sourceType: "ai",
      sourceKey: r.url,
      title: r.title,
      source: r.source,
      url: r.url,
      imageUrl: null,
      summary: r.summary,
      publishedDate: r.published_at,
      hidden: Boolean(overMap.get(r.url)?.hidden),
      pinOrder: overMap.get(r.url)?.pinOrder ?? null,
    }));

    const manualItems = manualRows.map((r) => ({
      id: r.id,
      sourceType: "manual",
      sourceKey: null,
      title: r.title,
      source: r.source,
      url: r.url,
      imageUrl: r.imageUrl,
      summary: null,
      publishedDate: r.publishedDate,
      hidden: false,
      pinOrder: null,
      sortOrder: r.sortOrder,
    }));

    const combined = [
      ...aiItems.filter((i) => i.pinOrder != null).sort((a, b) => (a.pinOrder! - b.pinOrder!)),
      ...manualItems,
      ...aiItems.filter((i) => i.pinOrder == null && !i.hidden),
      ...aiItems.filter((i) => i.pinOrder == null && i.hidden),
    ];

    return successResponse(combined);
  } catch (e: any) {
    return errorResponse("뉴스 목록을 불러오는데 실패했습니다: " + (e?.message || ""), 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const body = await request.json();
    const { title, source, url, imageUrl, publishedDate, sortOrder } = body;

    if (!title) {
      return errorResponse("title은 필수입니다");
    }

    const maxOrder = await prisma.news.aggregate({
      where: { userId: user.id },
      _max: { sortOrder: true },
    });

    const item = await prisma.news.create({
      data: {
        userId: user.id,
        title,
        source,
        url,
        imageUrl,
        publishedDate: publishedDate ? new Date(publishedDate) : undefined,
        sortOrder: sortOrder ?? ((maxOrder._max.sortOrder ?? -1) + 1),
      },
    });

    return successResponse(
      {
        ...item,
        sourceType: "manual",
        sourceKey: null,
        hidden: false,
        pinOrder: null,
      },
      201
    );
  } catch {
    return errorResponse("뉴스 생성에 실패했습니다", 500);
  }
}
