import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Compass } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { currentLocale } from "@/lib/i18n/server";
import { getLandingDictionary } from "@/lib/i18n/landing";

/**
 * Die Seite, die ein Besucher sieht, wenn die Adresse nicht stimmt.
 *
 * Bis zum ersten Besuch im Browser gab es sie nicht, und Next.js zeigte seine
 * Vorgabe: „404 — This page could not be found.", ohne Kopf, ohne Navigation
 * und **ohne einen einzigen Link**. Wer sich vertippte, stand ohne Weg zurueck
 * da, las den Satz in jeder der vier Sprachen auf Englisch, und im Tab stand
 * der deutsche Titel der Startseite, waehrend `lang` auf `en` stand.
 *
 * Kein Test konnte das sehen: Eine fehlende Route hat keine Komponente, die
 * ein Vertrag rendern koennte, und die Vorgabe kommt aus dem Framework.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = getLandingDictionary(await currentLocale()).notFound;
  return { title: `${t.title} · QKERN` };
}

export default async function NotFound() {
  const locale = await currentLocale();
  const t = getLandingDictionary(locale).notFound;
  return (
    <>
      <SiteHeader />
      <main className="container not-found-page">
        <span className="eyebrow">404</span>
        <h1>{t.heading}</h1>
        <p className="muted">{t.lead}</p>
        <div className="not-found-actions">
          <Link className="button" href="/">{t.home} <ArrowRight size={16} /></Link>
          <Link className="secondary-button" href="/docs"><Compass size={15} /> {t.docs}</Link>
        </div>
      </main>
    </>
  );
}
