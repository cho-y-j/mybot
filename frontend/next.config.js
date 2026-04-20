/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8100';
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
  // AI 챗 응답이 오래 걸릴 수 있으므로 프록시 타임아웃 연장
  experimental: {
    proxyTimeout: 120000, // 2분
  },
  // 인증 페이지 응답에 no-cache 강제. Next.js 기본 s-maxage=31536000이
  // 브라우저에 1년 캐시돼 "배포해도 안 바뀌어 보임" 문제가 반복됨.
  // 정적 assets(/_next/static/*)은 해시 URL이므로 영향 없음.
  async headers() {
    return [
      {
        source: '/:path((dashboard|easy|admin|onboarding)(/.*)?)',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
