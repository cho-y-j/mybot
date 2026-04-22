/**
 * URL 세그먼트(slug 또는 code)로 사용자 조회 헬퍼.
 *
 * slug(사용자 지정 주소) 우선, 없으면 code(자동 생성)로 fallback.
 * 두 주소가 같은 사용자로 라우팅되어 기존 code 링크 영구 유효.
 */
import { prisma } from "@/lib/db";

/** OR 조건으로 slug 또는 code 매칭. 호출부에서 select 지정 가능. */
export const whereCodeOrSlug = (segment: string) => ({
  OR: [{ slug: segment }, { code: segment }],
});
