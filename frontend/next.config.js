/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:8100/api/:path*',
      },
    ];
  },
  // AI 챗 응답이 오래 걸릴 수 있으므로 프록시 타임아웃 연장
  experimental: {
    proxyTimeout: 120000, // 2분
  },
};

module.exports = nextConfig;
