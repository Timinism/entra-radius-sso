import { Suspense } from "react";
import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans, Instrument_Serif } from "next/font/google";

import { Shell } from "@/components/shell";

import "./globals.css";

const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
});

const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument-serif",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-mono",
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
      className={`${sans.variable} ${serif.variable} ${mono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full">
        <Suspense fallback={<div className="min-h-full" />}>
          <Shell>{children}</Shell>
        </Suspense>
      </body>
    </html>
  );
}
