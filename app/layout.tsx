import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Keep builds independent of Google Fonts URLs and preserve the family names
// used by the Cytoscape canvas. Font sources and licenses are in ./fonts/.
const nunito = localFont({
  src: "./fonts/nunito-variable.woff2",
  weight: "200 1000",
  variable: "--font-latin",
  display: "swap",
  declarations: [{ prop: "font-family", value: "Nunito" }],
});

const notoSansTc = localFont({
  src: "./fonts/noto-sans-tc-variable.woff2",
  weight: "100 900",
  variable: "--font-cjk",
  display: "swap",
  preload: false,
  declarations: [{ prop: "font-family", value: '"Noto Sans TC"' }],
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
