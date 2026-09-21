import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { INSTANCE_DEFAULTS } from "@/lib/settings/defaults";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Finance Finder",
  description: "Multi-market portfolio tracker",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang={INSTANCE_DEFAULTS.locale} className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
