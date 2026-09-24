import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Check, CircleDashed, Code2, Network, ShieldCheck, Sparkles } from "lucide-react";
import { QKERNSymbol, QKERNLogo } from "@/components/brand";
import { SiteHeader } from "@/components/site-header";
import { CountUp, Reveal } from "@/components/reveal";
import styles from "./page.module.css";
import { loadCertificationSummary } from "@/lib/server/evidence/certification-summary";
import { currentLocale } from "@/lib/i18n/server";
import { formatDate, getLandingDictionary } from "@/lib/i18n/landing";
import { fill } from "@/lib/i18n/locales";

/**
 * Alle Zahlen auf dieser Seite stammen aus archivierten Läufen unter
 * `docs/evidence/` — seit 1.91 gelesen, nicht abgeschrieben: Die Seite trug
 * bis dahin Konstanten vom 6. August 2026, während der Stand längst weiter
 * war. Ein Vertrag verbietet hier jeden literalen Zählwert.
 *
 * Seit 2.2 kommen alle Wörter aus `lib/i18n/landing.ts`, in vier Sprachen.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = getLandingDictionary(await currentLocale());
  return { title: t.meta.title, description: t.meta.description };
}

export default async function HomePage() {
  const locale = await currentLocale();
  const t = getLandingDictionary(locale);
  const certification = await loadCertificationSummary();
  const runs = certification.rows;
  const name = (value: string) => t.names[value] ?? value;
  const moduleTones = ["done", "done", "done", "done", "done", "done", "done", "part"] as const;
  return (
    <main className={styles.page}>
      <SiteHeader />

      <section className={styles.hero}>
        <div className={styles.shell}>
          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <span className={styles.badge}>
                <i aria-hidden />
                {fill(t.hero.badge, { n: certification.archivedRuns })}
              </span>
              <h1>{t.hero.title}</h1>
              <p>{t.hero.lead}</p>
              <div className={styles.heroActions}>
                <Link className="button" href="/register">{t.hero.primary} <ArrowRight size={17} /></Link>
                <Link className="secondary-button" href="/console">{t.hero.secondary}</Link>
              </div>
            </div>

            <div className={styles.record}>
              <div className={styles.recordHead}>
                <span>{t.record.kicker}</span>
                <strong>{certification.latestDate ? formatDate(certification.latestDate, locale) : t.record.none}</strong>
              </div>
              {runs.map((run, index) => (
                <div className={styles.row} key={run.name} style={{ "--index": index + 1 } as React.CSSProperties}>
                  <span className={styles.rowName}>
                    {name(run.name)}
                    <small>{name(run.stack)}</small>
                  </span>
                  <span className={styles.count}>{fill(t.record.count, { n: run.passed })}</span>
                </div>
              ))}
              <div className={`${styles.row} ${styles.rowCounter}`} style={{ "--index": runs.length + 1 } as React.CSSProperties}>
                <span className={styles.rowName}>
                  {t.record.counterTitle}
                  <small>{t.record.counterSmall}</small>
                </span>
                <span className={styles.count}>{fill(t.record.runs, { n: certification.mutationRuns })}</span>
              </div>
            </div>
          </div>

          <div className={styles.stats}>
            {runs.slice(0, 4).map((run) => (
              <div className={styles.stat} key={run.name}>
                <strong><CountUp value={run.passed} /><em>+</em></strong>
                <span>{fill(t.record.stat, { name: name(run.name), stack: name(run.stack) })}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section} id="product">
        <div className={styles.shell}>
          <Reveal className={styles.sectionHead}>
            <h2>{t.product.title}</h2>
            <p>{t.product.lead}</p>
          </Reveal>
          <Reveal className={styles.ledger} stagger>
            {t.product.modules.map((module, index) => {
              const tone = moduleTones[index] ?? "done";
              return (
                <article className={styles.entry} key={module.name}>
                  <h3>{module.name}</h3>
                  <span className={`${styles.state} ${tone === "done" ? styles.stateDone : styles.statePart}`}>
                    {tone === "done" ? t.product.states.done : t.product.states.part}
                  </span>
                  <p>{module.note}</p>
                </article>
              );
            })}
            <article className={styles.entry}>
              <h3>{t.product.managed.name}</h3>
              <span className={`${styles.state} ${styles.stateOpen}`}>{t.product.states.open}</span>
              <p>{t.product.managed.note}</p>
            </article>
          </Reveal>
        </div>
      </section>

      <section className={styles.section} id="verification">
        <div className={styles.shell}>
          <Reveal className={styles.sectionHead}>
            <span className={styles.eyebrow}>{t.verification.eyebrow}</span>
            <h2>{t.verification.title}</h2>
          </Reveal>
          <Reveal className={styles.method} stagger>
            {t.verification.steps.map((step, index) => (
              <div className={styles.step} key={step.title}>
                <h3>{step.title}</h3>
                <p className={index === 0 ? styles.stepLead : undefined}>{step.text}</p>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className={styles.bridge} id="ai">
        <div className={styles.shell}>
          <Reveal className={styles.bridgeGrid}>
            <div>
              <span className={`${styles.eyebrow} ${styles.bridgeEyebrow}`}>{t.bridge.eyebrow}</span>
              <h2>{t.bridge.title}</h2>
              <p>{t.bridge.lead}</p>
              <ul className={styles.bridgeList}>
                {t.bridge.items.map((item) => <li key={item}><Check size={16} /> {item}</li>)}
              </ul>
              <Link className="white-button" href="/console">{t.bridge.cta} <ArrowRight size={16} /></Link>
            </div>

            <div className={styles.changeSet}>
              <div className={styles.changeHead}>
                <Sparkles size={16} />
                <strong>chg_8F2A</strong>
                <span>{t.bridge.status}</span>
              </div>
              <div className={styles.prompt}>
                <strong>Codex</strong>
                {t.bridge.prompt}
              </div>
              {t.bridge.steps.map((step, index) => (
                <div className={styles.changeStep} key={step.title}>
                  <div>
                    {step.title}
                    <small>{step.small}</small>
                  </div>
                  {index === t.bridge.steps.length - 1 ? <ShieldCheck size={16} /> : <Check size={16} />}
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className={styles.section} id="developers">
        <div className={styles.shell}>
          <Reveal className={styles.sectionHead}>
            <h2>{t.developers.title}</h2>
            <p>{t.developers.lead}</p>
          </Reveal>
          <Reveal className={styles.interfaces} stagger>
            <article className={styles.interfaceRow}>
              <h3>{t.developers.rows[0].title}</h3>
              <p>{t.developers.rows[0].text}</p>
              <code><Code2 size={13} /> /v1/projects</code>
            </article>
            <article className={styles.interfaceRow}>
              <h3>{t.developers.rows[1].title}</h3>
              <p>{t.developers.rows[1].text}</p>
              <code><Network size={13} /> stdio und http</code>
            </article>
            <article className={styles.interfaceRow}>
              <h3>{t.developers.rows[2].title}</h3>
              <p>{t.developers.rows[2].text}</p>
              <code><Sparkles size={13} /> bring your own key</code>
            </article>
          </Reveal>
        </div>
      </section>

      <section className={styles.section} id="security">
        <div className={styles.shell}>
          <Reveal className={styles.sectionHead}>
            <span className={styles.eyebrow}>{t.gaps.eyebrow}</span>
            <h2>{t.gaps.title}</h2>
            <p>{t.gaps.lead}</p>
          </Reveal>
          <Reveal className={styles.gaps} stagger>
            {t.gaps.items.map((gap) => (
              <p className={styles.gap} key={gap}>
                <CircleDashed size={15} />
                <span>{gap}</span>
              </p>
            ))}
          </Reveal>
        </div>
      </section>

      <section className={styles.section} id="pricing">
        <div className={styles.shell}>
          <Reveal className={styles.sectionHead}>
            <span className={styles.eyebrow}>{t.pricing.eyebrow}</span>
            <h2>{t.pricing.title}</h2>
            <p>{t.pricing.lead}</p>
          </Reveal>
          <Reveal className={styles.plans} stagger>
            {t.pricing.plans.map((plan, index) => (
              <article className={styles.plan} key={plan.name}>
                <h3>{plan.name}</h3>
                <div className={styles.price}>
                  <strong>CHF {[0, 29, 99][index]}</strong>
                  <span>{t.pricing.perMonth}</span>
                </div>
                <p>{plan.summary}</p>
                <Link className={`button ${styles.planButton}`} href="/register">{t.pricing.cta}</Link>
                <hr />
                <ul>
                  {plan.features.map((feature) => <li key={feature}><Check size={16} /> {feature}</li>)}
                </ul>
              </article>
            ))}
          </Reveal>
          <p className={styles.draftNote}>{t.pricing.note}</p>
        </div>
      </section>

      <section className={styles.close}>
        <div className={styles.shell}>
          <QKERNSymbol variant="white" size="lg" />
          <h2>{t.close.title}</h2>
          <p>{t.close.lead}</p>
          <Link className="white-button" href="/register">{t.close.cta} <ArrowRight size={16} /></Link>
        </div>
      </section>

      <footer className="footer">
        <div className="container footer-top">
          <div>
            <QKERNLogo variant="white" />
            <p>{t.footer.tagline}</p>
          </div>
          <div>
            <strong>{t.footer.product}</strong>
            <Link href="#product">{t.footer.modules}</Link>
            <Link href="#verification">{t.footer.verification}</Link>
            <Link href="#ai">{t.footer.bridge}</Link>
          </div>
          <div>
            <strong>{t.footer.developers}</strong>
            <Link href="/console">{t.footer.console}</Link>
            <Link href="#developers">{t.footer.interfaces}</Link>
            <Link href="#security">{t.footer.gaps}</Link>
          </div>
          <div>
            <strong>{t.footer.company}</strong>
            <span>{t.footer.imprint}</span>
            <span>{t.footer.privacy}</span>
            <span>{t.footer.status}</span>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>{t.footer.copyright}</span>
          <span>{t.footer.madeIn}</span>
        </div>
      </footer>
    </main>
  );
}
