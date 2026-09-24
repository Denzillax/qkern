import Link from "next/link";
import { Database, Network, ShieldCheck } from "lucide-react";
import { QKERNLogo, QKERNSymbol } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { currentLocale } from "@/lib/i18n/server";
import { getAuthDictionary } from "@/lib/i18n/auth";
import { getLandingDictionary } from "@/lib/i18n/landing";

export async function AuthShell({ mode, children }: { mode: "login" | "register"; children: React.ReactNode }) {
  const locale = await currentLocale();
  const t = getAuthDictionary(locale);
  const isRegister = mode === "register";
  return <main className="auth-page">
    <aside className="auth-aside">
      <Link href="/"><QKERNLogo variant="white" size="md"/></Link>
      <div className="auth-aside-copy"><QKERNSymbol variant="white" size="lg"/><span>{t.asideKicker}</span><h1>{isRegister ? t.asideRegister : t.asideLogin}</h1><p>{t.asideLead}</p></div>
      <div className="auth-boundaries"><div><Database size={17}/><span>{t.boundaries[0]}</span></div><div><Network size={17}/><span>{t.boundaries[1]}</span></div><div><ShieldCheck size={17}/><span>{t.boundaries[2]}</span></div></div>
    </aside>
    <section className="auth-panel">
      <div className="auth-panel-top"><Link href="/" className="auth-mobile-brand"><QKERNLogo size="sm"/></Link><div className="auth-panel-tools"><LanguageSwitcher locale={locale} label={getLandingDictionary(locale).header.language}/><ThemeToggle/></div></div>
      <div className="auth-card"><span className="eyebrow">{t.eyebrow}</span><h2>{isRegister ? t.cardRegister : t.cardLogin}</h2><p>{isRegister ? t.leadRegister : t.leadLogin}</p>{children}<div className="auth-switch">{isRegister ? <>{t.switchRegister} <Link href="/login">{t.switchRegisterLink}</Link></> : <>{t.switchLogin} <Link href="/register">{t.switchLoginLink}</Link></>}</div></div>
      <footer>{t.footer}</footer>
    </section>
  </main>;
}
