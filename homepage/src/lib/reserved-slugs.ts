/**
 * 공개 URL 슬러그(ai.on1.kr/[slug])로 쓸 수 없는 예약어 모음.
 *
 * 포함:
 *   - NPM 라우팅 경로 (admin, api, super-admin, signup, ... 등 실제 다른 서비스가 쓰는 prefix)
 *   - Next.js 내부 경로 (_next, _mh_assets, fonts)
 *   - 혼동 가능성 높은 일반어 (home, about, help, www, docs)
 *
 * 새 경로 추가 시 NPM server_proxy.conf 와 이 배열 둘 다 갱신해야 함.
 */
export const RESERVED_SLUGS = new Set<string>([
  // mybot 프론트엔드 라우팅 (NPM에서 ep_frontend로 감)
  "dashboard",
  "easy",
  "onboarding",
  "login",
  "signup",
  "admin",
  "chat",
  "elections",
  "reports",
  "debate",
  "content",
  "candidates",
  "surveys",
  "trends",
  "youtube",
  "schedules",
  "assistant",
  "history",
  "super-admin",
  "billing",
  "settings",

  // API prefix
  "api",

  // Next.js 내부
  "_next",
  "_mh_assets",
  "fonts",

  // 스크래퍼·보안 관련 (선점 방지)
  "robots.txt",
  "sitemap.xml",
  "favicon.ico",

  // 혼동 방지 일반어
  "home",
  "homepage",
  "about",
  "help",
  "support",
  "www",
  "docs",
  "blog",
  "news",
  "contact",
  "privacy",
  "terms",
  "static",
  "public",
  "assets",
  "404",
  "500",

  // snake 게임 등 기존 공개 페이지
  "snake",
]);

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

export type SlugValidation =
  | { ok: true; normalized: string }
  | { ok: false; reason: string };

/**
 * 슬러그 형식 + 예약어 검증.
 *
 * 규칙:
 *   - 영소문자 + 숫자 + 하이픈만 허용
 *   - 3~30자 (양 끝은 영숫자여야 함)
 *   - 예약어 아님
 *   - 대문자·공백·밑줄·한글 등 금지
 */
export function validateSlug(input: string): SlugValidation {
  const raw = (input || "").trim().toLowerCase();
  if (!raw) return { ok: false, reason: "비어 있습니다" };
  if (raw.length < 3) return { ok: false, reason: "3자 이상이어야 합니다" };
  if (raw.length > 30) return { ok: false, reason: "30자 이하여야 합니다" };
  if (!SLUG_PATTERN.test(raw)) {
    return { ok: false, reason: "영소문자·숫자·하이픈(-)만 쓸 수 있어요. 시작·끝은 영숫자" };
  }
  if (raw.includes("--")) return { ok: false, reason: "하이픈을 연속으로 쓸 수 없어요" };
  if (RESERVED_SLUGS.has(raw)) return { ok: false, reason: "예약어라 쓸 수 없어요" };
  return { ok: true, normalized: raw };
}
