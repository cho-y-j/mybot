/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // 2026-04-18: 기존 코드 전반에 any/unused-vars 다수 — ESLint strict로 빌드 중단 방지.
  // 품질 검사는 별도 lint 명령으로 돌리고 프로덕션 빌드는 통과시킨다.
  eslint: { ignoreDuringBuilds: true },
  // 같은 도메인(ai.on1.kr) 위에서 mybot frontend와 homepage 두 Next.js 앱이 공존.
  // 둘 다 /_next/* 정적 자산 경로를 쓰므로 NPM 라우팅 충돌 → CSS/JS 404.
  // homepage 자산만 별도 prefix로 빼서 NPM에서 정확히 분리.
  // NPM에 `location ^~ /_mh_assets/` → ep_homepage:3000 (rewrite로 prefix 제거) 필요.
  assetPrefix: "/_mh_assets",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.pravatar.cc" },
      { protocol: "https", hostname: "picsum.photos" },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
        ],
      },
      // 관리자/로그인 페이지는 배포 즉시 반영되어야 함. Next.js App Router 기본
      // s-maxage=31536000이 브라우저로 전파되면 배포 후 옛 chunk 404로 UI 깨짐
      // (mybot CLAUDE.md 1.25 동일 룰 — 2026-04-22 homepage에도 적용)
      {
        source: '/:code/admin/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
      {
        source: '/:code/admin',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
      {
        source: '/super-admin/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
};

export default nextConfig;
