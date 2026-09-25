"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { t } from "@/components/console/console-i18n";

/**
 * API-Keys in der Console (2.21): Public und Service Keys des Projekts, wie
 * bei Supabase unter Project Settings, gelesen und verwaltet über
 * `/api-keys`. Dieselben Aktionen wie unter API: anlegen und widerrufen.
 * Das Geheimnis wird nie gespeichert und nur einmal gezeigt.
 */
type Environment = "development" | "staging" | "production";
type ApiKey = { id: string; name: string; kind: "public" | "service"; prefix: string; expiresAt: string; revokedAt: string | null; createdAt: string };

export function ApiKeysView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/api-keys`;
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [secret, setSecret] = useState("");

  const load = useCallback(async () => {
    setMessage("");
    try {
      const response = await fetch(base, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? t("API-Keys nicht verfügbar"));
      setKeys(payload.data as ApiKey[]); setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("API-Keys nicht verfügbar")); }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  async function create(kind: "public" | "service") {
    const name = window.prompt(kind === "public" ? t("Name für den Public Key") : t("Name für den Service Key"), kind === "public" ? t("Public Key für den Browser") : t("Service Key für den Server")); if (!name) return;
    const expiresAt = new Date(Date.now() + (kind === "public" ? 90 : 30) * 24 * 60 * 60 * 1000).toISOString();
    const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, kind, expiresAt }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(payload.error ?? t("Key konnte nicht erstellt werden")); return; }
    setSecret(payload.data.secret); await load();
  }
  async function revoke(keyId: string) {
    if (!window.confirm(t("Diesen Key endgültig widerrufen?"))) return;
    const response = await fetch(`${base}/${keyId}`, { method: "DELETE" });
    if (response.ok) await load(); else setMessage(t("Key konnte nicht widerrufen werden."));
  }

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("API-Keys werden geladen…")}</h3></div>;
  if (state === "error") return <div className="console-card live-module-state"><KeyRound size={26}/><h3>{t("API-Keys nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const live = keys.filter((key) => !key.revokedAt);
  const format = (value: string) => new Intl.DateTimeFormat("de-CH").format(new Date(value));

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("PUBLIC KEYS")}</span><strong>{live.filter((key) => key.kind === "public").length}</strong><small>{t("für Browser und Apps")}</small></div>
      <div><span>{t("SERVICE KEYS")}</span><strong>{live.filter((key) => key.kind === "service").length}</strong><small>{t("nur für Server")}</small></div>
      <div><span>{t("WIDERRUFEN")}</span><strong>{keys.length - live.length}</strong><small>{t("gelten nicht mehr")}</small></div>
    </article>
    <article className="console-card span-2 api-key-manager">
      <div className="card-head"><div><span>{t("API-KEYS DES PROJEKTS")}</span><h3>{t("Zugriff für")} {environment}</h3></div><div><button className="secondary-button" onClick={() => void create("public")}><Plus size={13}/> {t("Public Key")}</button><button className="button small" onClick={() => void create("service")}><Plus size={13}/> {t("Service Key")}</button></div></div>
      {message && <p className="muted">{message}</p>}
      {secret && <div className="one-time-secret"><div><strong>{t("Jetzt kopieren, erscheint nur einmal")}</strong><code>{secret}</code></div><button onClick={() => void navigator.clipboard.writeText(secret)}><Copy size={14}/> {t("Kopieren")}</button><button onClick={() => setSecret("")} aria-label={t("Schliessen")}><X size={14}/></button></div>}
      <div className="api-key-list">
        {keys.map((key) => <div key={key.id}><span className={`key-kind ${key.kind}`}>{key.kind}</span><div><strong>{key.name}</strong><code>{key.prefix}…</code></div><span>{key.revokedAt ? t("widerrufen") : `${t("läuft ab")} ${format(key.expiresAt)}`}</span>{!key.revokedAt && <button onClick={() => void revoke(key.id)} aria-label={t("Key widerrufen")}><Trash2 size={14}/></button>}</div>)}
        {keys.length === 0 && <p className="muted">{t("Noch keine Keys. Das Geheimnis wird nie gespeichert und nur einmal gezeigt.")}</p>}
      </div>
    </article>
  </div>;
}
