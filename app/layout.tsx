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

/**
 * Das gewaehlte Thema, gesetzt bevor der Browser zeichnet.
 *
 * Der Umschalter speichert die Wahl in `localStorage`, aber gesetzt hat sie
 * bisher erst ein Effekt nach der Hydration. Wer Hell waehlt und ein dunkles
 * System hat, sah darum auf **jeder** Seite zuerst Dunkel und dann den
 * Umsprung. Gefunden beim ersten Besuch im Browser; kein Test konnte das
 * sehen, weil keiner die Seite zeichnet.
 *
 * Das Skript laeuft ohne `defer` im Kopf, also vor dem ersten Zeichnen. Es
 * faellt still auf die Systemeinstellung zurueck, wenn `localStorage` wirft
 * (privates Fenster, gesperrte Website-Daten).
 */
const THEME_BEFORE_PAINT = `(function(){try{var t=localStorage.getItem("qkern-theme");` +
  `if(!t){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}` +
  `document.documentElement.dataset.theme=t}catch(e){}})()`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Die Sprache der Website (2.2) steht am html-Element, damit Screenreader
  // und Silbentrennung sie kennen. Die Console bleibt deutsch.
  const locale = await currentLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BEFORE_PAINT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
