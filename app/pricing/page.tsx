import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Reveal } from "@/components/reveal";
import { currentLocale } from "@/lib/i18n/server";
import { getPricingDictionary } from "@/lib/i18n/pricing";
import { PRICING_PLANS, formatPlanAmount, formatPlanPrice } from "@/lib/pricing/plans";
import styles from "./pricing.module.css";

/**
 * Die oeffentliche Preisseite (2.135).
 *
 * Die Seite erfindet nichts. Betraege und Reihenfolge kommen aus
 * `lib/pricing/plans.ts`, die Worte aus `lib/i18n/pricing.ts`; in dieser Datei
 * steht kein Preis und keine Grenze als Zeichenkette. Der Grund ist derselbe
 * wie bei den Zahlen der Startseite (1.91): Was hier als Konstante stuende,
 * waere nach der ersten Preisaenderung falsch, und niemand wuerde es merken.
 *
 * Es gibt keinen Bestellweg. Billing hat heute keine Zahlungsanbindung, also
 * fuehrt jeder Knopf in die Registrierung, und Business fuehrt in ein Gespraech.
 * Eine Schaltflaeche, die eine Buchung vortaeuscht, waere eine Luege im
 * Interface.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = getPricingDictionary(await currentLocale());
  return { title: t.meta.title, description: t.meta.description };
}

export default async function PricingPage() {
  const t = getPricingDictionary(await currentLocale());
  return (
    <main className={styles.page}>
      <SiteHeader />

      <section className={styles.head}>
        <div className={styles.shell}>
          <span className={styles.eyebrow}>{t.hero.eyebrow}</span>
          <h1>{t.hero.title}</h1>
          <p>{t.hero.lead}</p>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.shell}>
          <Reveal className={styles.plans} stagger>
            {PRICING_PLANS.map((plan) => {
              const words = t.plans[plan.id];
              // Dieselbe Preiszeile zweimal: `price` als ein Stueck fuer
              // Vorlesesoftware, die Teile darunter fuer das Auge, das den
              // Betrag zuerst finden soll. Beide kommen aus demselben Modul,
              // koennen also nicht auseinanderlaufen.
              const price = formatPlanPrice(plan, { from: t.words.from, perMonth: t.words.perMonth });
              const amount = formatPlanAmount(plan.monthlyMicros);
              return (
                <article className={`${styles.plan} ${plan.mostPopular ? styles.planFeatured : ""}`} key={plan.id}>
                  {plan.mostPopular ? <span className={styles.badge}>{t.words.badge}</span> : null}
                  <h2>{words.name}</h2>
                  <p className={styles.price} aria-label={price}>
                    {plan.fromPrice ? <span className={styles.priceUnit}>{t.words.from} </span> : null}
                    {amount} <span className={styles.priceUnit}>{t.words.perMonth}</span>
                  </p>
                  <p className={styles.audience}>{words.audience}</p>
                  <div className={styles.planFoot}>
                    {plan.cta.kind === "register" ? (
                      <Link className={`button ${styles.planButton}`} href={plan.cta.href}>{t.cta[plan.id]}</Link>
                    ) : plan.cta.mailto ? (
                      <a className={`secondary-button ${styles.planButton}`} href={`mailto:${plan.cta.mailto}`}>{t.cta[plan.id]}</a>
                    ) : (
                      <>
                        <span className={styles.contactLabel}>{t.cta[plan.id]}</span>
                        <p className={styles.contactNote}>{t.notes.businessContact}</p>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </Reveal>

          <ul className={styles.notes}>
            <li><strong>{t.notes.origin}</strong></li>
            <li>{t.notes.metering}</li>
            <li>{t.notes.noOrderPath}</li>
          </ul>
          <p className={styles.draft}>{t.notes.draft}</p>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
