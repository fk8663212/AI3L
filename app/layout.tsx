import type { Metadata } from "next";
import { Noto_Sans_TC, Nunito } from "next/font/google";
import "./globals.css";

// Self-hosted by next/font, so the strict CSP (font-src 'self') still holds.
const nunito = Nunito({
  subsets: ["latin"],
  weight: ["500", "700", "800", "900"],
  variable: "--font-latin",
  display: "swap",
});

const notoSansTc = Noto_Sans_TC({
  weight: ["400", "500", "700", "900"],
  variable: "--font-cjk",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "AI3L Speaking Lab",
  description: "AI 輔助視覺概念建構英語口說研究平台",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant" className={`${nunito.variable} ${notoSansTc.variable}`}>
      <body>{children}</body>
    </html>
  );
}
