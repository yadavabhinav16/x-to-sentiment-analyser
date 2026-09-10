import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tweet Voice Cloner",
  description: "Give an X handle → get drafts in that voice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-200 font-sans">
        {children}
      </body>
    </html>
  );
}
