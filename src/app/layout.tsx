import { Suspense } from "react";
import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";

import { Shell } from "@/components/shell";

import "./globals.css";

const sans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "Harbor",
  description: "Entra sign-in for Cisco and Palo Alto gear that still speaks RADIUS.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${display.variable} dark h-full antialiased`}
    >
      <body className="min-h-full">
        <Suspense fallback={<div className="min-h-full" />}>
          <Shell>{children}</Shell>
        </Suspense>
      </body>
    </html>
  );
}
