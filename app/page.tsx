import Link from "next/link";
import { ArrowRight, Braces, Check, Cloud, Code2, Database, Fingerprint, KeyRound, LockKeyhole, Network, ShieldCheck, Sparkles, SwissFranc, Terminal, Workflow } from "lucide-react";
import { ConsolePreview } from "@/components/console-preview";
import { QKERNLogo, QKERNSymbol } from "@/components/brand";
import { SiteHeader } from "@/components/site-header";

const coreProducts = [
  { icon: Database, label: "DATABASE", title: "PostgreSQL, ohne Umwege", text: "Tabellen, SQL, Policies, Migrationen und Backups in einem präzisen Workflow." },
  { icon: Fingerprint, label: "AUTH", title: "Identitäten unter Kontrolle", text: "Accounts, Sessions, Rollen und Row-Level Security mit sicheren Defaults." },
  { icon: Cloud, label: "STORAGE", title: "Dateien mit klaren Regeln", text: "Private Buckets, signierte URLs, Limits und Policies statt offener Dateisilos." },
  { icon: Braces, label: "API", title: "Vom Schema zur API", text: "Automatisch erzeugte REST-Endpunkte und aktuelle OpenAPI-Dokumentation." },
];

export default function HomePage() {
  return (
    <main>
      <SiteHeader />
      <section className="hero">
        <div className="grid-halo" />
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="signal"><span /> SWISS-BUILT · AI-NATIVE · OPEN STANDARDS</div>
            <h1>Der intelligente Kern <em>deiner Anwendung.</em></h1>
            <p className="lead">QKERN verbindet Datenbank, Authentifizierung, Storage, APIs und KI-Agenten in einer kontrollierten Backend-Plattform.</p>
            <div className="hero-actions">
              <Link className="button" href="/register">Projekt erstellen <ArrowRight size={17} /></Link>
              <Link className="secondary-button" href="/console">QKERN Console ansehen</Link>
            </div>
            <p className="code-claim"><Terminal size={15} /> Build your backend with Claude, Codex or code.</p>
          </div>
          <ConsolePreview />
        </div>
      </section>

      <section className="trust-strip">
        <div className="container trust-grid">
          <span>CONTROL BY DEFAULT</span>
          <div><LockKeyhole size={17} /> Approval Gates</div>
          <div><Workflow size={17} /> Traceable Change Sets</div>
          <div><KeyRound size={17} /> Scoped Agent Access</div>
          <div><ShieldCheck size={17} /> Default-deny Policies</div>
        </div>
      </section>

      <section className="section" id="product">
        <div className="container">
          <div className="section-intro"><span className="eyebrow">THE APPLICATION CORE</span><h2>Alles verbunden.<br/>Nichts unkontrolliert.</h2><p>Ein konsistentes System für Entwickler, Teams und die Agenten, mit denen sie bauen.</p></div>
          <div className="product-grid">
            {coreProducts.map((item, index) => {
              const Icon = item.icon;
              return <article className="product-card" key={item.label}><div className="index">0{index + 1}</div><Icon size={22}/><span>{item.label}</span><h3>{item.title}</h3><p>{item.text}</p><Link href="/console">In der Console öffnen <ArrowRight size={15}/></Link></article>;
            })}
          </div>
        </div>
      </section>

      <section className="section ai-section" id="ai">
        <div className="container ai-grid">
          <div>
            <span className="eyebrow light">QKERN AI BRIDGE</span>
            <h2>Dein Agent baut.<br/><em>QKERN schützt.</em></h2>
            <p>Claude Code und Codex arbeiten über kleine, klar begrenzte MCP-Tools. Jede Aktion ist projekt-, umgebungs- und berechtigungsgebunden.</p>
            <ul className="check-list">
              <li><Check size={16}/> Kurzlebige, widerrufbare Tokens</li>
              <li><Check size={16}/> Dry Runs vor jeder Änderung</li>
              <li><Check size={16}/> Manuell, abgesichert oder autonom</li>
              <li><Check size={16}/> Vollständiger AI Activity Log</li>
            </ul>
            <Link className="white-button" href="/console">AI Bridge öffnen <ArrowRight size={16}/></Link>
          </div>
          <div className="change-flow">
            <div className="flow-header"><Sparkles size={18}/><strong>Change Set / chg_8F2A</strong><span>READY FOR REVIEW</span></div>
            <div className="agent-request"><div className="agent-mark">C</div><p><strong>Codex</strong><br/>Create an order status history table, enable RLS and prepare a migration. Do not apply it.</p></div>
            <div className="flow-step done"><span>01</span><div><strong>Schema inspected</strong><small>6 tables · 4 relations · RLS enabled</small></div><Check size={16}/></div>
            <div className="flow-step done"><span>02</span><div><strong>Migration validated</strong><small>0 destructive operations · rollback available</small></div><Check size={16}/></div>
            <div className="flow-step current"><span>03</span><div><strong>Policy decision</strong><small>Manual · guarded · autonomous</small></div><ShieldCheck size={16}/></div>
            <div className="flow-footer"><span>Risk: Medium</span><span>Environment: Development</span></div>
          </div>
        </div>
      </section>

      <section className="section architecture" id="developers">
        <div className="container architecture-grid">
          <div className="arch-copy"><span className="eyebrow">THREE CLEAR INTERFACES</span><h2>Gebaut für Apps,<br/>Agenten und Teams.</h2><p>QKERN trennt Anwendungszugriff, Agentenwerkzeuge und Modellprovider konsequent. Ein Schlüssel kann nicht heimlich die Rolle eines anderen übernehmen.</p></div>
          <div className="layer-stack">
            <div><span>01</span><Code2/><p><strong>Application API</strong><small>REST · SDK · Public & service keys</small></p></div>
            <div><span>02</span><Network/><p><strong>MCP Agent Interface</strong><small>Scoped tools · Approvals · Audit</small></p></div>
            <div><span>03</span><Sparkles/><p><strong>Model Provider API</strong><small>Optional · BYO key · Context control</small></p></div>
          </div>
        </div>
      </section>

      <section className="section security" id="security">
        <div className="container">
          <div className="section-intro centered"><span className="eyebrow">SECURITY ARCHITECTURE</span><h2>Sicherheit ist kein Tarif-Extra.</h2><p>Die entscheidenden Grenzen sitzen serverseitig — nicht hinter versteckten Buttons.</p></div>
          <div className="security-grid">
            <article><span>01</span><LockKeyhole/><h3>Tenant Isolation</h3><p>Organisation, Projekt und Umgebung werden bei jeder Anfrage geprüft.</p></article>
            <article><span>02</span><ShieldCheck/><h3>Approval Center</h3><p>Riskante Änderungen erhalten Diff, Teststatus, Rollback-Plan und eine einstellbare Freigabepolicy.</p></article>
            <article><span>03</span><KeyRound/><h3>Secret Boundary</h3><p>Agenten sehen Referenzen wie „configured“, niemals rohe Secret-Werte.</p></article>
          </div>
          <p className="legal-note">Infrastruktur-, Datenresidenz- und Compliance-Aussagen werden vor Veröffentlichung technisch und rechtlich verifiziert.</p>
        </div>
      </section>

      <section className="section pricing-section" id="pricing">
        <div className="container">
          <div className="section-intro"><span className="eyebrow">PRICING IN CHF</span><h2>Starte klein.<br/>Behalte die Kontrolle.</h2><p>Preise sind Produktentwürfe und vor dem Marktstart zu validieren.</p></div>
          <div className="pricing-grid">
            <article><span>FREE</span><div className="price"><SwissFranc size={21}/><strong>0</strong><small>/ Monat</small></div><p>Für erste Prototypen.</p><ul><li>1 Development-Projekt</li><li>Read-only AI Bridge</li><li>Basis-Logs</li></ul><Link className="secondary-button" href="/console">Kostenlos starten</Link></article>
            <article className="featured"><div className="popular">FÜR BUILDERS</div><span>PRO</span><div className="price"><SwissFranc size={21}/><strong>29</strong><small>/ Monat</small></div><p>Für echte Produkte.</p><ul><li>Mehrere Projekte</li><li>Codex & Claude Code</li><li>Automatische Backups</li></ul><Link className="button" href="/console">Pro ausprobieren</Link></article>
            <article><span>BUSINESS</span><div className="price"><SwissFranc size={21}/><strong>99</strong><small>/ Monat</small></div><p>Für Teams mit Production.</p><ul><li>Approval Center</li><li>Teamrollen</li><li>Erweiterte Audit Logs</li></ul><Link className="secondary-button" href="/console">Kontakt aufnehmen</Link></article>
          </div>
        </div>
      </section>

      <section className="final-cta"><div className="container"><QKERNSymbol variant="white" size="lg"/><span className="eyebrow light">FROM PROMPT TO PRODUCTION — WITH CONTROL</span><h2>Baue den Kern.<br/>Nicht die Infrastruktur.</h2><Link className="white-button" href="/console">QKERN Console starten <ArrowRight size={16}/></Link></div></section>

      <footer className="footer"><div className="container footer-top"><div><QKERNLogo variant="white"/><p>Der intelligente Kern deiner Anwendung.</p></div><div><strong>Produkt</strong><Link href="#product">Database</Link><Link href="#ai">AI Bridge</Link><Link href="#security">Security</Link></div><div><strong>Entwickler</strong><Link href="/console">Console</Link><Link href="#developers">MCP</Link><Link href="#developers">API</Link></div><div><strong>Unternehmen</strong><span>Impressum · Vorlage</span><span>Datenschutz · Vorlage</span><span>Status</span></div></div><div className="container footer-bottom"><span>© 2026 QKERN. Product MVP.</span><span>Designed in Switzerland · Hosting claim pending verification</span></div></footer>
    </main>
  );
}
