"use client";

import { useCallback, useEffect, useState } from "react";
import { Fingerprint, RefreshCw } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { loadConsoleAuthProviders, type ConsoleAuthProviderResult } from "@/components/console/auth-providers";

/**
 * Anmeldeverfahren in der Console (2.21): was Project Auth kann und welche
 * OIDC-Provider konfiguriert sind, wie bei Supabase unter Sign In /
 * Providers. Die Provider kommen über die Admin-Route aus 1.83. Nur lesend:
 * ein Verfahren ein- oder auszuschalten geht weiterhin nicht über die
 * Console, sondern über die Konfiguration des Auth-Dienstes.
 */
type Environment = "development" | "staging" | "production";

export function AuthProvidersView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const [result, setResult] = useState<ConsoleAuthProviderResult | null>(null);
  const load = useCallback(async () => { setResult(null); setResult(await loadConsoleAuthProviders(projectId, environment)); }, [projectId, environment]);
  useEffect(() => { void load(); }, [load]);

  const builtIn = [
    { name: t("E-Mail und Passwort"), note: t("Registrierung, Anmeldung, Bestätigung per Mail") },
    { name: t("Magic Link und Reset"), note: t("Einmal-Links per Mail, Token nur über die zugestellte Nachricht") },
    { name: t("TOTP und Recovery-Codes"), note: t("Zweiter Faktor mit Authenticator-App") },
    { name: t("OIDC mit PKCE"), note: t("Fremde Identitätsanbieter, siehe unten") },
  ];
  const providers = result?.state === "ready" ? result.providers : [];

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("VERFAHREN")}</span><strong>{builtIn.length}</strong><small>{t("zertifiziert gegen echte Dienste")}</small></div>
      <div><span>{t("OIDC-PROVIDER")}</span><strong>{result?.state === "ready" ? providers.length : "–"}</strong><small>{result?.state === "unavailable" ? t("Auth nicht aktiv") : result?.state === "error" ? t("nicht erreichbar") : t("konfiguriert")}</small></div>
      <div><span>{t("SCHALTER")}</span><strong>0</strong><small>{t("Ein- und Ausschalten fehlt in der Console")}</small></div>
    </article>
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("PROJECT AUTH")} · {environment.toUpperCase()}</span><h3>{t("Anmeldeverfahren")}</h3></div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button></div>
      {builtIn.map((method) => <div className="bucket-row" key={method.name}><span className="bucket-icon"><Fingerprint size={16}/></span><div><strong>{method.name}</strong><small>{method.note}</small></div><span className="secure">{t("bereit")}</span></div>)}
      <div className="card-head" style={{ marginTop: 16 }}><div><span>OIDC</span><h3>{t("Konfigurierte Provider")}</h3></div></div>
      {result === null && <p className="muted">{t("Provider werden geladen…")}</p>}
      {result?.state === "unavailable" && <p className="muted">{t("Project Auth ist für diese Umgebung nicht aktiv.")}</p>}
      {result?.state === "error" && <p className="muted">{t("Die Provider-Liste ist nicht erreichbar.")}</p>}
      {result?.state === "ready" && providers.length === 0 && <p className="muted">{t("Keine OIDC-Provider konfiguriert. Ein Provider wird in der Konfiguration des Auth-Dienstes hinterlegt, nicht hier.")}</p>}
      {providers.map((provider) => <div className="bucket-row" key={provider.id}><span className="bucket-icon"><Fingerprint size={16}/></span><div><strong>{provider.id}</strong><small>{provider.issuer}</small></div><span className="secure">OIDC</span></div>)}
    </article>
  </div>;
}
