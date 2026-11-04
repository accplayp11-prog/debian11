import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Debian Web Terminal",
  description: "Browser-based Debian 11 Linux terminal",
  robots: "noindex, nofollow",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
