import Link from "next/link";
import { QKERNLogo } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

// "Lösungen" zeigte auf #solutions, einen Anker, den es auf der Seite nicht
// gibt. Ein Navigationspunkt, der nirgends hinfuehrt, ist kein Label, sondern
// ein Fehler; er ist deshalb entfernt statt umbenannt.
const links = [
  ["Produkt", "#product"],
  ["Prüfverfahren", "#verification"],
  ["Entwickler", "#developers"],
  ["KI", "#ai"],
  ["Offene Punkte", "#security"],
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
          {/* Gleiche Beschriftung wie auf der Seite. Zwei Woerter fuer dieselbe
              Handlung zwingen den Leser, sie fuer zwei zu halten. */}
          <Link className="button small" href="/register">Projekt erstellen</Link>
        </div>
      </div>
    </header>
  );
}
