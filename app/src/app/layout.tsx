import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prime Fleet Cloud",
  description: "Licenses and WhatsApp gateway for Prime Fleet",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
