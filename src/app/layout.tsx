import type { Metadata } from "next";
import "./globals.css";
import { AppHeader } from "@/components/app-header";

export const metadata: Metadata = {
  title: "새한프라텍 EMS 비가동 분석",
  description: "설비 전류 기반 비가동 분석 · 원인 분류 · 추세 · 알림",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="antialiased">
        <AppHeader />
        <main className="mx-auto max-w-[1400px] px-4 py-5">{children}</main>
      </body>
    </html>
  );
}
