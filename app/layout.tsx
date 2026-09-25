import type { Metadata } from "next";
import "@fontsource-variable/manrope/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./globals.css";
import { currentLocale } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "QKERN, dein Backend, getestet bevor du es anfasst",
  description: "Datenbank, Login, Dateien, Realtime und Functions. Alles laeuft gegen echte Dienste, und die Logs liegen im Repository.",
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
