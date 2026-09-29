"use client";

import { useCallback, useEffect, useState } from "react";
import { Puzzle, RefreshCw } from "lucide-react";
import { t } from "@/components/console/console-i18n";

/**
 * Erweiterungen in der Console (2.20): alle verfügbaren PostgreSQL-
 * Erweiterungen, installierte zuerst, gelesen über `/schema/extensions`.
 * Nur lesend; ob eine Erweiterung installiert werden darf, entscheidet die
 * Migration.
 */
type Environment = "development" | "staging" | "production";
type Extension = { name: string; defaultVersion: string; installedVersion: string | null; schema: string | null; comment: string | null };

export function ExtensionsView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading" | "ready" | "unavailable" | "error" }) {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">(initialState ?? "loading");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/environments/${environment}/schema/extensions`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503 || response.status === 409) { setState("unavailable"); setMessage(payload.error ?? t("Die Projektdatenbank ist noch nicht bereit.")); return; }
      if (!response.ok) throw new Error(payload.error ?? t("Erweiterungen nicht verfügbar"));
      setExtensions(payload.data.extensions as Extension[]); setTruncated(Boolean(payload.data.truncated)); setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("Erweiterungen nicht verfügbar")); }
  }, [projectId, environment]);
  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Erweiterungen werden geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><Puzzle size={26}/><h3>{state === "unavailable" ? t("Datenbank nicht bereit") : t("Erweiterungen nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const shown = extensions.filter((extension) => `${extension.name} ${extension.comment ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const installed = extensions.filter((extension) => extension.installedVersion !== null);

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("INSTALLIERT")}</span><strong>{installed.length}</strong><small>{t("in dieser Datenbank")}</small></div>
      <div><span>{t("VERFÜGBAR")}</span><strong>{extensions.length}</strong><small>{t("auf dem Server")}</small></div>
      <div><span>{t("VERALTET")}</span><strong>{installed.filter((extension) => extension.installedVersion !== extension.defaultVersion).length}</strong><small>{t("neuere Version verfügbar")}</small></div>
    </article>
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("DATENBANK")} · {environment.toUpperCase()}</span><h3>{t("Erweiterungen")}</h3></div><div><div className="toolbar-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Nach Name oder Beschreibung filtern…")}/></div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button></div></div>
      {truncated && <p className="muted">{t("Die Liste ist bei 400 Erweiterungen abgeschnitten.")}</p>}
      {shown.map((extension) => <div className="bucket-row" key={extension.name}><span className="bucket-icon"><Puzzle size={16}/></span>
        <div><strong>{extension.name}</strong><small>{extension.comment ?? ""}{extension.schema ? ` · ${t("Schema")} ${extension.schema}` : ""}</small></div>
        <span className={extension.installedVersion ? "secure" : "muted"}>{extension.installedVersion ? `${t("installiert")} ${extension.installedVersion}` : `${t("verfügbar")} ${extension.defaultVersion}`}</span>
      </div>)}
      {extensions.length > 0 && shown.length === 0 && <p className="muted">{t("Keine Erweiterung passt zum Filter.")}</p>}
      <p className="muted">{t("Installieren geht über ein Change Set mit CREATE EXTENSION; ob es erlaubt ist, entscheidet die Migration.")}</p>
    </article>
  </div>;
}
