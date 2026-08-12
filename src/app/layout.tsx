import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Airport Investment Intelligence Agent",
  description:
    "Deterministic airport expansion scoring over FAA/BTS public data with LangChain tool-using explanations.",
  applicationName: "Airport Investment Intelligence",
  icons: {
    icon: [
      { url: "/brand/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/logo-mark.png", sizes: "512x512", type: "image/png" },
      { url: "/icon.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/brand/favicon-32.png"],
  },
  openGraph: {
    title: "Airport Investment Intelligence Agent",
    description:
      "Deterministic airport expansion scoring over FAA/BTS public data.",
    images: [
      { url: "/brand/logo-mark.png", width: 512, height: 512, alt: "Logo" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full overflow-hidden">
      <body
        className={`${sans.variable} ${mono.variable} h-full overflow-hidden font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
