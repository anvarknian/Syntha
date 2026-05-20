import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Syntha Dashboard",
  description: "Syntha - Synthetic Internet replay and simulation control plane",
  icons: [{ rel: "icon", url: "/favicon.svg" }],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
