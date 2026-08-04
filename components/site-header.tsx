import Link from "next/link";
import { QKERNLogo } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

const links = [
  ["Produkt", "#product"],
  ["Lösungen", "#solutions"],
  ["Entwickler", "#developers"],
  ["KI", "#ai"],
  ["Sicherheit", "#security"],
  ["Preise", "#pricing"],
];

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" aria-label="QKERN Startseite"><QKERNLogo size="md" /></Link>
        <nav className="desktop-nav" aria-label="Hauptnavigation">
          {links.map(([label, href]) => <Link key={label} href={href}>{label}</Link>)}
        </nav>
        <div className="header-actions">
          <ThemeToggle />
          <Link className="text-link desktop-only" href="/login">Anmelden</Link>
          <Link className="button small" href="/register">Jetzt starten</Link>
        </div>
      </div>
    </header>
  );
}
