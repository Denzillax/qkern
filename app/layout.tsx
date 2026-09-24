import type { Metadata } from "next";
import "@fontsource-variable/manrope/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./globals.css";
import { currentLocale } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "QKERN, Backend-Bausteine, die ihre Zusagen belegen",
  description: "Datenbank, Auth, Storage, Realtime und Functions. Zu jeder Zusage gehoert ein archivierter Prueflauf gegen echte Dienste.",
  icons: { icon: "/brand/qkern-favicon.svg" },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Die Sprache der Website (2.2) steht am html-Element, damit Screenreader
  // und Silbentrennung sie kennen. Die Console bleibt deutsch.
  const locale = await currentLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
