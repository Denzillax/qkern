"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeySquare, RefreshCw } from "lucide-react";
import { t } from "@/components/console/console-i18n";

/**
 * JWT-Schlüssel in der Console (2.22): die öffentlichen Schlüssel, mit denen
 * Project Auth seine Tokens signiert, gelesen aus dem JWKS-Endpunkt, den
 * auch jede App zum Prüfen liest. Nur lesend; eine Rotation über die
 * Console gibt es nicht, sie geschieht in der Konfiguration des Auth-Dienstes.
 */
type Environment = "development" | "staging" | "production";
type Jwk = { kid: string; kty: string; crv?: string; alg?: string; use?: string; x?: string };

export function JwtKeysView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const url = `/api/v1/projects/${projectId}/environments/${environment}/auth/.well-known/jwks.json`;
  const [keys, setKeys] = useState<Jwk[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch(url, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503) { setState("unavailable"); setMessage(payload.error ?? t("Project Auth ist für diese Umgebung nicht aktiv.")); return; }
      if (!response.ok || !Array.isArray(payload.keys)) throw new Error(payload.error ?? t("JWKS nicht erreichbar"));
      setKeys(payload.keys as Jwk[]); setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("JWKS nicht erreichbar")); }
  }, [url]);
  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Schlüssel werden geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><KeySquare size={26}/><h3>{state === "unavailable" ? t("Auth nicht aktiv") : t("JWKS nicht erreichbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const absolute = typeof window === "undefined" ? url : `${window.location.origin}${url}`;

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("SCHLÜSSEL")}</span><strong>{keys.length}</strong><small>{t("im JWKS veröffentlicht")}</small></div>
      <div><span>{t("VERFAHREN")}</span><strong>{keys.length > 0 ? (keys[0].alg ?? "EdDSA") : "–"}</strong><small>{keys.length > 0 ? `${keys[0].kty}${keys[0].crv ? ` · ${keys[0].crv}` : ""}` : t("keine Schlüssel")}</small></div>
      <div><span>{t("ROTATION")}</span><strong>–</strong><small>{t("nicht über die Console")}</small></div>
    </article>
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("PROJECT AUTH")} · {environment.toUpperCase()}</span><h3>{t("JWT-Schlüssel")}</h3></div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button></div>
      {keys.length === 0 && <p className="muted">{t("Das JWKS ist leer. Ohne Schlüssel kann Project Auth keine Tokens ausstellen.")}</p>}
      {keys.map((key) => <div className="bucket-row" key={key.kid}><span className="bucket-icon"><KeySquare size={16}/></span>
        <div><strong>{key.kid}</strong><small>{key.kty}{key.crv ? ` · ${key.crv}` : ""}{key.alg ? ` · ${key.alg}` : ""}{key.use ? ` · ${key.use}` : ""}{key.x ? ` · ${key.x.slice(0, 12)}…` : ""}</small></div>
        <span className="secure">{t("öffentlich")}</span>
      </div>)}
      <div className="card-head" style={{ marginTop: 16 }}><div><span>JWKS</span><h3>{t("Adresse für deine App")}</h3></div><button className="secondary-button" onClick={() => void navigator.clipboard.writeText(absolute)}><Copy size={14}/> {t("Kopieren")}</button></div>
      <p className="muted"><code>{absolute}</code></p>
      <p className="muted">{t("Welcher Schlüssel gerade signiert, steht im Token-Header (kid); das JWKS führt alle, die noch gültig sind.")}</p>
    </article>
  </div>;
}
