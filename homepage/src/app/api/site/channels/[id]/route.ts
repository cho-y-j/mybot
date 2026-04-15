/**
 * ExternalChannel 개별 수정/삭제.
 */
import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/middleware";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const id = Number(params.id);
  const body = await req.json();

  const channel = await prisma.externalChannel.findUnique({ where: { id } });
  if (!channel || channel.userId !== auth.user.id) {
    return errorResponse("채널을 찾을 수 없습니다", 404);
  }

  const updated = await prisma.externalChannel.update({
    where: { id },
    data: {
      ...(body.channelId !== undefined ? { channelId: body.channelId || null } : {}),
      ...(body.channelUrl !== undefined ? { channelUrl: body.channelUrl || null } : {}),
      ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
    },
  });
  return successResponse({ item: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const id = Number(params.id);
  const channel = await prisma.externalChannel.findUnique({ where: { id } });
  if (!channel || channel.userId !== auth.user.id) {
    return errorResponse("채널을 찾을 수 없습니다", 404);
  }

  await prisma.externalChannel.delete({ where: { id } });
  return successResponse({ deleted: true });
}
