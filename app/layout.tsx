import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://yi-wellbeing.calem-cab.chatgpt.site"),
  title: "Yi — practice, cycle & wellbeing",
  description: "A quiet home for Yi's cycle, practice, reflections and wellbeing.",
  openGraph: {
    title: "Yi — practice, cycle & wellbeing",
    description: "A quiet home for your whole rhythm.",
    images: [{ url: "/og.png", width: 1740, height: 909, alt: "Yi wellbeing dashboard" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Yi — practice, cycle & wellbeing",
    description: "A quiet home for your whole rhythm.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
