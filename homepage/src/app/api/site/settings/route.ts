import { NextRequest } from "next/server";
import { requireUser } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const settings = await prisma.siteSetting.findUnique({
      where: { userId: user.id },
    });

    return successResponse(settings);
  } catch {
    return errorResponse("설정을 불러오는데 실패했습니다", 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const body = await request.json();

    const {
      ogTitle,
      ogDescription,
      ogImageUrl,
      heroImageUrl,
      heroSlogan,
      heroSubSlogan,
      partyName,
      positionTitle,
      subtitle,
      introText,
      primaryColor,
      accentColor,
      electionDate,
      electionName,
      kakaoAppKey,
    } = body;

    const hexColorRegex = /^#[0-9A-Fa-f]{6}$/;
    if (primaryColor && !hexColorRegex.test(primaryColor)) {
      return errorResponse("유효하지 않은 색상 코드입니다", 400);
    }
    if (accentColor && !hexColorRegex.test(accentColor)) {
      return errorResponse("유효하지 않은 색상 코드입니다", 400);
    }

    const { profileImageUrl } = body;

    // undefined 필드는 제외하여 기존 값 보존
    const updateData: Record<string, unknown> = {};
    if (ogTitle !== undefined) updateData.ogTitle = ogTitle;
    if (ogDescription !== undefined) updateData.ogDescription = ogDescription;
    if (ogImageUrl !== undefined) updateData.ogImageUrl = ogImageUrl;
    if (heroImageUrl !== undefined) updateData.heroImageUrl = heroImageUrl;
    if (profileImageUrl !== undefined) updateData.profileImageUrl = profileImageUrl;
    if (heroSlogan !== undefined) updateData.heroSlogan = heroSlogan;
    if (heroSubSlogan !== undefined) updateData.heroSubSlogan = heroSubSlogan;
    if (partyName !== undefined) updateData.partyName = partyName;
    if (positionTitle !== undefined) updateData.positionTitle = positionTitle;
    if (subtitle !== undefined) updateData.subtitle = subtitle;
    if (introText !== undefined) updateData.introText = introText;
    if (primaryColor !== undefined) updateData.primaryColor = primaryColor;
    if (accentColor !== undefined) updateData.accentColor = accentColor;
    if (electionDate !== undefined) updateData.electionDate = electionDate ? new Date(electionDate) : null;
    if (electionName !== undefined) updateData.electionName = electionName;
    if (kakaoAppKey !== undefined) updateData.kakaoAppKey = kakaoAppKey;

    const settings = await prisma.siteSetting.upsert({
      where: { userId: user.id },
      update: updateData,
      create: {
        userId: user.id,
        ogTitle,
        ogDescription,
        ogImageUrl,
        heroImageUrl,
        profileImageUrl,
        heroSlogan,
        heroSubSlogan,
        partyName,
        positionTitle,
        subtitle,
        introText,
        primaryColor: primaryColor ?? "#C9151E",
        accentColor: accentColor ?? "#1A56DB",
        electionDate: electionDate ? new Date(electionDate) : undefined,
        electionName,
        kakaoAppKey,
      },
    });

    return successResponse(settings);
  } catch {
    return errorResponse("설정 저장에 실패했습니다", 500);
  }
}
