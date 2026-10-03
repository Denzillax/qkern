import Link from "next/link";
import { QKERNLogo } from "@/components/brand";
import { currentLocale } from "@/lib/i18n/server";
import { getLandingDictionary } from "@/lib/i18n/landing";

/**
 * Der Fuss der oeffentlichen Seiten.
 *
 * Herausgeloest aus `app/page.tsx` (2.135), weil die Preisseite denselben Fuss
 * braucht. Zweimal dasselbe Markup haette bedeutet, jeden neuen Link zweimal
 * einzutragen, und der zweite Eintrag waere irgendwann vergessen worden. Die
 * Links und die Reihenfolge sind unveraendert uebernommen; dazu kam nur der
 * Verweis auf die Preisseite.
 */
export async function SiteFooter() {
  const t = getLandingDictionary(await currentLocale()).footer;
  return (
    <footer className="footer">
      <div className="container footer-top">
        <div>
          <QKERNLogo variant="white" />
          <p>{t.tagline}</p>
        </div>
        <div>
          <strong>{t.product}</strong>
          <Link href="/#product">{t.modules}</Link>
          <Link href="/#verification">{t.verification}</Link>
          <Link href="/#ai">{t.bridge}</Link>
          <Link href="/pricing">{t.pricing}</Link>
        </div>
        <div>
          <strong>{t.developers}</strong>
          <Link href="/docs">{t.docs}</Link>
          <Link href="/console">{t.console}</Link>
          <Link href="/#developers">{t.interfaces}</Link>
          <Link href="/#security">{t.gaps}</Link>
        </div>
        <div>
          <strong>{t.company}</strong>
          <span>{t.imprint}</span>
          <span>{t.privacy}</span>
          <span>{t.status}</span>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>{t.copyright}</span>
        <span>{t.madeIn}</span>
      </div>
    </footer>
  );
}
