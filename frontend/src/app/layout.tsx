import '@/styles/globals.css';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ElectionPulse - 선거 분석 플랫폼',
  description: '실시간 여론/미디어 분석 SaaS',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-gray-50 min-h-screen">{children}</body>
    </html>
  );
}
