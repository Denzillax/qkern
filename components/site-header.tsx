import Link from "next/link";
import { QKERNLogo } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { SiteMenu } from "@/components/site-menu";
import { LanguageSwitcher } from "@/components/language-switcher";
import { currentLocale } from "@/lib/i18n/server";
import { getLandingDictionary } from "@/lib/i18n/landing";

// "Lösungen" zeigte auf #solutions, einen Anker, den es auf der Seite nicht
// gibt. Ein Navigationspunkt, der nirgends hinfuehrt, ist kein Label, sondern
// ein Fehler; er ist deshalb entfernt statt umbenannt.
export async function SiteHeader() {
  const locale = await currentLocale();
  const t = getLandingDictionary(locale).header;
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" aria-label={t.home}><QKERNLogo size="md" /></Link>
        <nav className="desktop-nav" aria-label="Hauptnavigation">
          {t.nav.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
        </nav>
        <div className="header-actions">
          <LanguageSwitcher locale={locale} label={t.language} />
          <ThemeToggle />
          <Link className="text-link desktop-only" href="/login">{t.login}</Link>
          {/* Gleiche Beschriftung wie auf der Seite. Zwei Woerter fuer dieselbe
              Handlung zwingen den Leser, sie fuer zwei zu halten. */}
          <Link className="button small desktop-only" href="/register">{t.createProject}</Link>
          <SiteMenu links={t.nav} labels={{ open: t.menuOpen, close: t.menuClose, login: t.login, createProject: t.createProject }} />
        </div>
      </div>
    </header>
  );
}
