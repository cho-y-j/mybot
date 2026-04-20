import '@/styles/globals.css';
import { Metadata } from 'next';
import { ThemeProvider } from '@/components/ThemeProvider';

// 배포 즉시 사용자 화면에 반영되도록 SSG/ISR 캐시 비활성. 인증 페이지들이 어차피
// 사용자별이라 정적 캐시 이득이 없고, 캐시로 인한 "안 바뀌어 보임" 문제가 반복됨.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'ElectionPulse - 선거 분석 플랫폼',
  description: '실시간 여론/미디어 분석 SaaS',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
