import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./global.css";

export const metadata: Metadata = {
  title: "Sentinel City",
  description: "Concept Sentinel · simulation. City 3D d'après le code open source Avalanche Builder Hub (BSD-3).",
};

/* light by default, for a jury in a bright room; the night city stays one click away (theme button) */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="h-full overflow-hidden font-sans antialiased">{children}</body>
    </html>
  );
}
