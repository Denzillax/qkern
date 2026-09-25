"use client";

import { useCallback, useEffect, useState } from "react";
import { ListOrdered, RefreshCw } from "lucide-react";
import { t } from "@/components/console/console-i18n";

/**
 * Indizes in der Console (2.19): alle Indizes des Schemas public, gelesen
 * über `/schema/indexes`. Nur lesend; ein Index entsteht wie jede
 * Schemaänderung über ein Change Set.
 */
type Environment = "development" | "staging" | "production";
type Index = { name: string; table: string; accessMethod: string; unique: boolean; primary: boolean; valid: boolean; columns: string[]; definition: string; predicate: string | null };

export function IndexesView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const [indexes, setIndexes] = useState<Index[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/environments/${environment}/schema/indexes?schema=public`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503 || response.status === 409) { setState("unavailable"); setMessage(payload.error ?? t("Die Projektdatenbank ist noch nicht bereit.")); return; }
      if (!response.ok) throw new Error(payload.error ?? t("Indizes nicht verfügbar"));
      setIndexes(payload.data.indexes as Index[]); setTruncated(Boolean(payload.data.truncated)); setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("Indizes nicht verfügbar")); }
  }, [projectId, environment]);
  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Indizes werden geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><ListOrdered size={26}/><h3>{state === "unavailable" ? t("Datenbank nicht bereit") : t("Indizes nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const shown = indexes.filter((index) => `${index.name} ${index.table} ${index.columns.join(" ")}`.toLowerCase().includes(query.toLowerCase()));

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("INDIZES")}</span><strong>{indexes.length}</strong><small>{t("im Schema public")}</small></div>
      <div><span>{t("EINDEUTIG")}</span><strong>{indexes.filter((index) => index.unique).length}</strong><small>{t("davon Primärschlüssel")}: {indexes.filter((index) => index.primary).length}</small></div>
      <div><span>{t("UNGÜLTIG")}</span><strong>{indexes.filter((index) => !index.valid).length}</strong><small>{t("nach Abbruch oder im Aufbau")}</small></div>
    </article>
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("DATENBANK")} · {environment.toUpperCase()}</span><h3>{t("Indizes im Schema public")}</h3></div><div><div className="toolbar-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Nach Name, Tabelle oder Spalte filtern…")}/></div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button></div></div>
      {indexes.length === 0 && <p className="muted">{t("Keine Indizes im Schema public. Ein Index entsteht wie jede Schemaänderung über ein Change Set: SQL im SQL Editor, Vorschau, Freigabe.")}</p>}
      {truncated && <p className="muted">{t("Die Liste ist bei 200 Indizes abgeschnitten.")}</p>}
      {shown.map((index) => <div className="bucket-row" key={`${index.table}.${index.name}`}><span className="bucket-icon"><ListOrdered size={16}/></span>
        <div><strong>{index.name}</strong><small>{index.table} · {index.accessMethod} · {index.columns.length > 0 ? index.columns.join(", ") : t("Ausdruck")}{index.predicate ? ` · WHERE ${index.predicate}` : ""}</small></div>
        <span className={!index.valid ? "risk medium" : index.primary ? "secure" : "muted"}>{!index.valid ? t("ungültig") : index.primary ? t("Primärschlüssel") : index.unique ? t("eindeutig") : t("Index")}</span>
      </div>)}
      {indexes.length > 0 && shown.length === 0 && <p className="muted">{t("Kein Index passt zum Filter.")}</p>}
    </article>
  </div>;
}
