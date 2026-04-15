import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "mh_session";

// 시스템 경로 (동적 [code] 라우트와 충돌 방지)
const SYSTEM_PATHS = ["/super-admin", "/api", "/_next", "/favicon.ico"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  const userType = request.cookies.get("mh_user_type")?.value;
  const userCode = request.cookies.get("mh_code")?.value;

  // 슈퍼 관리자 라우트 보호
  if (pathname.startsWith("/super-admin") && !pathname.startsWith("/super-admin/login")) {
    if (!sessionCookie) {
      return NextResponse.redirect(new URL("/super-admin/login", request.url));
    }
    // super_admin만 접근 가능
    if (userType && userType !== "super_admin") {
      return NextResponse.redirect(new URL("/super-admin/login", request.url));
    }
  }

  // 고객 관리자 라우트 보호: /{code}/admin (시스템 경로 제외)
  if (!SYSTEM_PATHS.some((p) => pathname.startsWith(p))) {
    const adminMatch = pathname.match(/^\/([^/]+)\/admin(?!\/login)/);
    if (adminMatch) {
      const urlCode = adminMatch[1];

      if (!sessionCookie) {
        return NextResponse.redirect(
          new URL(`/${urlCode}/admin/login`, request.url)
        );
      }

      // 코드 일치 확인 (super_admin은 모든 사이트 접근 가능)
      if (userType !== "super_admin" && userCode && userCode !== urlCode) {
        return NextResponse.redirect(
          new URL(`/${urlCode}/admin/login`, request.url)
        );
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/super-admin/:path*", "/:code/admin/:path*"],
};
