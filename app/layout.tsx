import type { Metadata } from "next";
import "@fontsource-variable/manrope/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "QKERN, Backend-Bausteine, die ihre Zusagen belegen",
  description: "Datenbank, Auth, Storage, Realtime und Functions. Zu jeder Zusage gehoert ein archivierter Prueflauf gegen echte Dienste.",
  icons: { icon: "/brand/qkern-favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
