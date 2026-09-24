import Link from "next/link";
import {
  ArrowRight, Check, CircleDashed, Code2, Network, ShieldCheck, Sparkles,
} from "lucide-react";
import { QKERNSymbol, QKERNLogo } from "@/components/brand";
import { SiteHeader } from "@/components/site-header";
import { CountUp, Reveal } from "@/components/reveal";
import styles from "./page.module.css";
import { formatEvidenceDate, loadCertificationSummary } from "@/lib/server/evidence/certification-summary";

/**
 * Alle Zahlen auf dieser Seite stammen aus archivierten Läufen unter
 * `docs/evidence/` — seit 1.91 gelesen, nicht abgeschrieben: Die Seite trug
 * bis dahin Konstanten vom 6. August 2026, während der Stand längst weiter
 * war. Ein Vertrag verbietet hier jeden literalen Zählwert.
 */

const modules = [
  { name: "Datenbank und Migrationen", state: "zertifiziert", tone: "done", note: "Change Sets, Freigaben, Audit-Kette und Rollback gegen einen echten Server." },
  { name: "Generated Data API", state: "zertifiziert", tone: "done", note: "CRUD am Live-Schema, RLS und eine eigene Injection-Matrix." },
  { name: "Project Auth", state: "zertifiziert", tone: "done", note: "Passwort, Magic Link, TOTP und OIDC gegen echtes SMTP und echten Provider." },
  { name: "Object Storage", state: "zertifiziert", tone: "done", note: "Private Buckets, Quarantäne bis der Scanner urteilt, signierte Ablaufzeiten." },
  { name: "Realtime", state: "zertifiziert", tone: "done", note: "Dauerhafter Log, Fan-out über zwei Instanzen, Change Feed und Soak-Lauf." },
  { name: "Queues, Cron, Webhooks", state: "zertifiziert", tone: "done", note: "Atomare Claims, Leases, serverberechnetes Retry und Dead Letters." },
  { name: "Functions", state: "zertifiziert", tone: "done", note: "Container ohne Netz, harte Speichergrenze, vermittelte Ausgangsverbindungen." },
  { name: "Usage und Billing", state: "teilweise", tone: "part", note: "Alle sechs Metriken melden, Preisblatt, Rechnungslauf mit lückenlosem Nummernkreis. Keine Zahlungsanbindung." },
];

const plans = [
  {
    name: "Free", price: 0,
    summary: "Zum Ausprobieren der geprüften Bausteine in einem Development-Projekt.",
    features: ["Ein Projekt, eine Umgebung", "Data API, Auth und Storage", "Lesender Agentenzugriff", "Basisprotokoll", "Community-Support"],
  },
  {
    name: "Pro", price: 29,
    summary: "Für Teams, die Development, Staging und Production sauber trennen.",
    features: ["Mehrere Projekte und Umgebungen", "Claude Code und Codex über die AI Bridge", "Automatische Backups", "Freigabezentrale mit Rollback-Plan", "E-Mail-Support"],
  },
  {
    name: "Business", price: 99,
    summary: "Für Organisationen mit Rollen, Protokollpflicht und Production-Freigaben.",
    features: ["Teamrollen und Workspace-Verwaltung", "Erweiterte Protokolle und Audit-Export", "Production-Umgebungen mit Schutz", "Eigene Nutzungsgrenzen", "Priorisierter Support"],
  },
];

const gaps = [
  "Function-Images müssen ausserhalb gebaut und in eine Registry geschoben werden; Inhaltslogs bleiben im Container.",
  "Die Data API kennt keine eingebetteten Joins.",
  "Billing hat keine Zahlungsanbindung.",
  "Managed Operations sind Nachweisverträge, kein betriebener Dienst: kein PITR, kein Restore-Drill.",
  "SDK und CLI sind nur auf Linux belegt, Windows und macOS stehen aus.",
];

export default async function HomePage() {
  const certification = await loadCertificationSummary();
  const runs = certification.rows;
  return (
    <main className={styles.page}>
      <SiteHeader />

      <section className={styles.hero}>
        <div className={styles.shell}>
          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <span className={styles.badge}>
                <i aria-hidden />
                {certification.archivedRuns} archivierte Prüfläufe
              </span>
              <h1>Backend-Bausteine, die ihre Zusagen belegen.</h1>
              <p>
                Datenbank, Auth, Storage, Realtime und Functions. Zu jeder Zusage auf dieser
                Seite gehört ein archivierter Prüflauf.
              </p>
              <div className={styles.heroActions}>
                <Link className="button" href="/register">Projekt erstellen <ArrowRight size={17} /></Link>
                <Link className="secondary-button" href="/console">Console ansehen</Link>
              </div>
            </div>

            <div className={styles.record}>
              <div className={styles.recordHead}>
                <span>Prüflauf</span>
                <strong>{certification.latestDate ? formatEvidenceDate(certification.latestDate) : "kein Lauf archiviert"}</strong>
              </div>
              {runs.map((run, index) => (
                <div className={styles.row} key={run.name} style={{ "--index": index + 1 } as React.CSSProperties}>
                  <span className={styles.rowName}>
                    {run.name}
                    <small>{run.stack}</small>
                  </span>
                  <span className={styles.count}>{run.passed} von {run.passed}</span>
                </div>
              ))}
              <div className={`${styles.row} ${styles.rowCounter}`} style={{ "--index": runs.length + 1 } as React.CSSProperties}>
                <span className={styles.rowName}>
                  Gegenprobe
                  <small>Garantien abgeschaltet, absichtlich fehlgeschlagen</small>
                </span>
                <span className={styles.count}>{certification.mutationRuns} Läufe</span>
              </div>
            </div>
          </div>

          <div className={styles.stats}>
            {runs.slice(0, 4).map((run) => (
              <div className={styles.stat} key={run.name}>
                <strong><CountUp value={run.passed} /><em>+</em></strong>
                <span>{run.name} gegen {run.stack}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section} id="product">
        <div className={styles.shell}>
          <Reveal className={styles.sectionHead}>
            <h2>Was heute läuft, und wie weit es belegt ist.</h2>
            <p>
              Gemessen wird zweiachsig: ausführbar vorhanden, und gegen echte Dienste
              ausgeführt mit archiviertem Lauf. Nur die zweite Achse zählt als zertifiziert.
            </p>
          </Reveal>
          <Reveal className={styles.ledger} stagger>
            {modules.map((module) => (
              <article className={styles.entry} key={module.name}>
                <h3>{module.name}</h3>
                <span className={`${styles.state} ${module.tone === "done" ? styles.stateDone : styles.statePart}`}>
                  {module.state}
                </span>
                <p>{module.note}</p>
              </article>
            ))}
            <article className={styles.entry}>
              <h3>Managed Operations</h3>
              <span className={`${styles.state} ${styles.stateOpen}`}>offen</span>
              <p>Provider-Onboarding, Hochverfügbarkeit und Restore sind beschrieben, aber nicht betrieben.</p>
            </article>
          </Reveal>
        </div>
      </section>

      <section className={styles.section} id="verification">
        <div className={styles.shell}>
          <Reveal className={styles.sectionHead}>
            <span className={styles.eyebrow}>So prüfen wir</span>
            <h2>Ein grüner Testlauf ist keine Zertifizierung.</h2>
          </Reveal>
          <Reveal className={styles.method} stagger>
            <div className={styles.step}>
              <h3>Ausführen</h3>
              <p className={styles.stepLead}>
                Jeder dauerhafte Adapter läuft gegen echtes PostgreSQL, echtes MinIO, echtes
                ClamAV, echtes SMTP, einen echten OIDC-Provider und einen echten Vault.
                Memory-Adapter kennen weder Rechtemodell noch Row-Level Security noch
                Transaktionsgrenze. Neun Produktfehler kamen genau so ans Licht.
              </p>
            </div>
            <div className={styles.step}>
              <h3>Wiederholen</h3>
              <p>
                Jeder Lauf zweimal, bevor ein Release entsteht. Rohlog und Manifest mit Commit,
                Exit-Code, Testzahlen und Migrationszahl liegen im Repository.
              </p>
            </div>
            <div className={styles.step}>
              <h3>Brechen</h3>
              <p>
                Danach schalten wir die geprüfte Garantie ab und lassen erneut laufen. Fällt
                kein Fall um, prüft der Test nichts.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      <section className={styles.bridge} id="ai">
        <div className={styles.shell}>
          <Reveal className={styles.bridgeGrid}>
            <div>
              <span className={`${styles.eyebrow} ${styles.bridgeEyebrow}`}>QKERN AI Bridge</span>
              <h2>Dein Agent baut. QKERN hält die Grenze.</h2>
              <p>
                Claude Code und Codex arbeiten über eng geschnittene MCP-Werkzeuge. Jede Aktion
                ist an Projekt, Umgebung und Berechtigung gebunden.
              </p>
              <ul className={styles.bridgeList}>
                <li><Check size={16} /> Kurzlebige, widerrufbare Tokens</li>
                <li><Check size={16} /> Vorschau vor jeder Änderung</li>
                <li><Check size={16} /> Manuell, abgesichert oder autonom je Umgebung</li>
                <li><Check size={16} /> Vollständiges Protokoll jeder Agentenaktion</li>
              </ul>
              <Link className="white-button" href="/console">Console ansehen <ArrowRight size={16} /></Link>
            </div>

            <div className={styles.changeSet}>
              <div className={styles.changeHead}>
                <Sparkles size={16} />
                <strong>chg_8F2A</strong>
                <span>Wartet auf Freigabe</span>
              </div>
              <div className={styles.prompt}>
                <strong>Codex</strong>
                Lege eine Tabelle für den Bestellverlauf an, aktiviere Row-Level Security und
                bereite eine Migration vor. Wende sie nicht an.
              </div>
              <div className={styles.changeStep}>
                <div>
                  Schema gelesen
                  <small>6 Tabellen, 4 Beziehungen, RLS aktiv</small>
                </div>
                <Check size={16} />
              </div>
              <div className={styles.changeStep}>
                <div>
                  Migration geprüft
                  <small>0 zerstörende Operationen, Rollback vorhanden</small>
                </div>
                <Check size={16} />
              </div>
              <div className={styles.changeStep}>
                <div>
                  Freigabe offen
                  <small>Risiko mittel, Umgebung Development</small>
                </div>
                <ShieldCheck size={16} />
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className={styles.section} id="developers">
        <div className={styles.shell}>
          <Reveal className={styles.sectionHead}>
            <h2>Drei Zugänge, die sich nicht gegenseitig übernehmen können.</h2>
            <p>
              Anwendungszugriff, Agentenwerkzeuge und Modellprovider sind getrennte Wege mit
              eigenen Schlüsseln. Ein Schlüssel kann die Rolle eines anderen nicht annehmen.
            </p>
          </Reveal>
          <Reveal className={styles.interfaces} stagger>
            <article className={styles.interfaceRow}>
              <h3>Application API</h3>
              <p>REST und SDK für deine Anwendung, gebunden an Public oder Service Key.</p>
              <code><Code2 size={13} /> /v1/projects</code>
            </article>
            <article className={styles.interfaceRow}>
              <h3>MCP Agent Interface</h3>
              <p>Kleine Werkzeuge mit Freigabepflicht. Worker-Leases bleiben ausgeschlossen.</p>
              <code><Network size={13} /> stdio und http</code>
            </article>
            <article className={styles.interfaceRow}>
              <h3>Model Provider API</h3>
              <p>Optional und mit eigenem Schlüssel. Der Kontext bleibt unter deiner Kontrolle.</p>
              <code><Sparkles size={13} /> bring your own key</code>
            </article>
          </Reveal>
        </div>
      </section>

      <section className={styles.section} id="security">
        <div className={styles.shell}>
          <Reveal className={styles.sectionHead}>
            <span className={styles.eyebrow}>Was noch fehlt</span>
            <h2>Diese Punkte sind offen, und sie stehen hier.</h2>
            <p>
              Jede Release-Notiz endet mit derselben Liste. Sie hier wegzulassen wäre die
              erste unbelegte Zusage der Seite.
            </p>
          </Reveal>
          <Reveal className={styles.gaps} stagger>
            {gaps.map((gap) => (
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
            <span className={styles.eyebrow}>Preise</span>
            <h2>Preise, die mit dir wachsen.</h2>
            <p>In Schweizer Franken, klein beginnend. Jeder Plan enthält dieselben geprüften Bausteine.</p>
          </Reveal>
          <Reveal className={styles.plans} stagger>
            {plans.map((plan) => (
              <article className={styles.plan} key={plan.name}>
                <h3>{plan.name}</h3>
                <div className={styles.price}>
                  <strong>CHF {plan.price}</strong>
                  <span>/pro Monat</span>
                </div>
                <p>{plan.summary}</p>
                <Link className={`button ${styles.planButton}`} href="/register">Loslegen</Link>
                <hr />
                <ul>
                  {plan.features.map((feature) => <li key={feature}><Check size={16} /> {feature}</li>)}
                </ul>
              </article>
            ))}
          </Reveal>
          <p className={styles.draftNote}>
            Diese Preise sind Entwürfe und vor dem Marktstart zu validieren. Aussagen zu
            Infrastruktur, Datenresidenz und Compliance werden vor Veröffentlichung technisch
            und rechtlich geprüft.
          </p>
        </div>
      </section>

      <section className={styles.close}>
        <div className={styles.shell}>
          <QKERNSymbol variant="white" size="lg" />
          <h2>Baue den Kern. Nicht die Infrastruktur.</h2>
          <p>
            Starte mit einem Development-Projekt. Die Belege für alles, was hier steht, liegen
            im Repository unter docs/evidence.
          </p>
          <Link className="white-button" href="/register">Projekt erstellen <ArrowRight size={16} /></Link>
        </div>
      </section>

      <footer className="footer">
        <div className="container footer-top">
          <div>
            <QKERNLogo variant="white" />
            <p>Backend-Bausteine, die ihre Zusagen belegen.</p>
          </div>
          <div>
            <strong>Produkt</strong>
            <Link href="#product">Module</Link>
            <Link href="#verification">Prüfverfahren</Link>
            <Link href="#ai">AI Bridge</Link>
          </div>
          <div>
            <strong>Entwickler</strong>
            <Link href="/console">Console</Link>
            <Link href="#developers">Schnittstellen</Link>
            <Link href="#security">Offene Punkte</Link>
          </div>
          <div>
            <strong>Unternehmen</strong>
            <span>Impressum, Vorlage</span>
            <span>Datenschutz, Vorlage</span>
            <span>Status</span>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>© 2026 QKERN. Product MVP.</span>
          <span>Entwickelt in der Schweiz. Hosting-Aussage noch nicht verifiziert.</span>
        </div>
      </footer>
    </main>
  );
}
