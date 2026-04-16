/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
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
    ];
  },
};

export default nextConfig;
