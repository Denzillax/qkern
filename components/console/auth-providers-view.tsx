"use client";

import { useCallback, useEffect, useState } from "react";
import { Fingerprint, RefreshCw } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { formatNumber } from "@/components/console/console-display";
import {
  loadConsoleAuthProviders, loadConsoleAuthSamlProviders,
  type ConsoleAuthProviderResult, type ConsoleAuthSamlResult,
} from "@/components/console/auth-providers";

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
  const [saml, setSaml] = useState<ConsoleAuthSamlResult | null>(null);
  const load = useCallback(async () => {
    setResult(null); setSaml(null);
    const [oidc, federated] = await Promise.all([
      loadConsoleAuthProviders(projectId, environment),
      loadConsoleAuthSamlProviders(projectId, environment),
    ]);
    setResult(oidc); setSaml(federated);
  }, [projectId, environment]);
  useEffect(() => { void load(); }, [load]);

  const builtIn = [
    { name: t("E-Mail und Passwort"), note: t("Registrierung, Anmeldung, Bestätigung per Mail") },
    { name: t("Magic Link und Reset"), note: t("Einmal-Links per Mail, Token nur über die zugestellte Nachricht") },
    { name: t("TOTP und Recovery-Codes"), note: t("Zweiter Faktor mit Authenticator-App") },
    { name: t("OIDC mit PKCE"), note: t("Fremde Identitätsanbieter, siehe unten") },
    { name: t("SAML 2.0 mit signierter Assertion"), note: t("Web Browser SSO, SP-initiiert, Antwort über HTTP-POST") },
  ];
  const providers = result?.state === "ready" ? result.providers : [];
  const samlProviders = saml?.state === "ready" ? saml.providers : [];

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("VERFAHREN")}</span><strong>{builtIn.length}</strong><small>{t("zertifiziert gegen echte Dienste")}</small></div>
      <div><span>{t("OIDC-PROVIDER")}</span><strong>{result?.state === "ready" ? providers.length : "–"}</strong><small>{result?.state === "unavailable" ? t("Auth nicht aktiv") : result?.state === "error" ? t("nicht erreichbar") : t("konfiguriert")}</small></div>
      <div><span>{t("SAML-PROVIDER")}</span><strong>{saml?.state === "ready" ? formatNumber(samlProviders.length) : "–"}</strong><small>{saml?.state === "unavailable" ? t("Auth nicht aktiv") : saml?.state === "error" ? t("nicht erreichbar") : t("hinterlegt")}</small></div>
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
      <div className="card-head" style={{ marginTop: 16 }}><div><span>SAML</span><h3>{t("Hinterlegte SAML-Anbieter")}</h3></div></div>
      {saml === null && <p className="muted">{t("Provider werden geladen…")}</p>}
      {saml?.state === "unavailable" && <p className="muted">{t("Project Auth ist für diese Umgebung nicht aktiv.")}</p>}
      {saml?.state === "error" && <p className="muted">{t("Die SAML-Liste ist nicht erreichbar.")}</p>}
      {saml?.state === "ready" && samlProviders.length === 0 && <p className="muted">{t("Keine SAML-Anbieter konfiguriert. Ein Anbieter wird mit seinem Zertifikat in der Konfiguration des Auth-Dienstes hinterlegt, nicht hier.")}</p>}
      {samlProviders.map((provider) => <div className="bucket-row" key={provider.id}><span className="bucket-icon"><Fingerprint size={16}/></span><div><strong>{provider.id}</strong><small>{provider.entityId}</small></div><span className="secure">{provider.requiresVerifiedEmail ? t("verlangt email_verified") : t("nimmt Assertion ohne email_verified")}</span></div>)}
    </article>
  </div>;
}
