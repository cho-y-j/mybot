import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "MyHome — 나만의 홍보 사이트를 3분 만에",
  description:
    "선거 후보, 개인 명함, 소상공인을 위한 원페이지 홍보 사이트 플랫폼. 쉬운 콘텐츠 관리와 방문자 분석을 한 곳에서.",
  openGraph: {
    title: "MyHome — 나만의 홍보 사이트를 3분 만에",
    description:
      "선거 후보, 개인 명함, 소상공인을 위한 원페이지 홍보 사이트 플랫폼.",
    locale: "ko_KR",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.min.css"
        />
      </head>
      <body className="bg-zinc-950 text-zinc-100 antialiased">
        {children}
        <Script
          src="https://code.iconify.design/iconify-icon/2.3.0/iconify-icon.min.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
