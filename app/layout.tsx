import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mini Mux Pipeline",
  description: "A small self-hosted video transcoding proof of concept.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
