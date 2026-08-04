import Link from "next/link";
import { Database, Network, ShieldCheck } from "lucide-react";
import { QKERNLogo, QKERNSymbol } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

export function AuthShell({ mode, children }: { mode: "login" | "register"; children: React.ReactNode }) {
  const isRegister = mode === "register";
  return <main className="auth-page">
    <aside className="auth-aside">
      <Link href="/"><QKERNLogo variant="white" size="md"/></Link>
      <div className="auth-aside-copy"><QKERNSymbol variant="white" size="lg"/><span>CONTROLLED BY DEFAULT</span><h1>{isRegister ? "Baue den Kern.\nBehalte die Kontrolle." : "Willkommen zurück\nim QKERN Core."}</h1><p>Database, Auth, Storage, APIs und sichere Agentenwerkzeuge in einer zusammenhängenden Plattform.</p></div>
      <div className="auth-boundaries"><div><Database size={17}/><span>Projektisolierte Daten</span></div><div><Network size={17}/><span>Scoped MCP tools</span></div><div><ShieldCheck size={17}/><span>Approval Gates</span></div></div>
    </aside>
    <section className="auth-panel">
      <div className="auth-panel-top"><Link href="/" className="auth-mobile-brand"><QKERNLogo size="sm"/></Link><ThemeToggle/></div>
      <div className="auth-card"><span className="eyebrow">QKERN ACCOUNT</span><h2>{isRegister ? "Starte dein erstes Projekt." : "Melde dich sicher an."}</h2><p>{isRegister ? "Dein persönlicher Workspace und ein isoliertes Development-Projekt werden vorbereitet." : "Öffne deine Organisationen, Projekte und ausstehenden Freigaben."}</p>{children}<div className="auth-switch">{isRegister ? <>Bereits registriert? <Link href="/login">Anmelden</Link></> : <>Noch kein Account? <Link href="/register">Jetzt starten</Link></>}</div></div>
      <footer>QKERN MVP · Rechtstexte vor Marktstart prüfen</footer>
    </section>
  </main>;
}
