import type { Metadata } from "next";
import "@fontsource-variable/manrope/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "QKERN — Der intelligente Kern deiner Anwendung",
  description: "QKERN verbindet Datenbank, Authentifizierung, Storage, APIs und KI-Agenten in einer kontrollierten Backend-Plattform.",
  icons: { icon: "/brand/qkern-favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
