"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Zap } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";

/**
 * Trigger in der Console (2.9): die erste Datenbank-Seite nach dem Vorbild
 * von Supabase Studio, gelesen über `/schema/triggers`. Nur lesend; ein
 * Trigger entsteht wie jede Schemaaenderung ueber ein Change Set.
 */
type Environment = "development" | "staging" | "production";
type Trigger = {
  name: string; table: string; timing: "before" | "after" | "instead_of"; events: Array<"insert" | "update" | "delete" | "truncate">;
  orientation: "row" | "statement"; enabled: "origin" | "always" | "replica" | "disabled"; functionSchema: string; functionName: string; condition: string | null;
};

export function TriggersView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading" | "ready" | "unavailable" | "error" }) {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">(initialState ?? "loading");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/environments/${environment}/schema/triggers?schema=public`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503 || response.status === 409) { setState("unavailable"); setMessage(serverErrorText(payload.error) ?? t("Die Projektdatenbank ist noch nicht bereit.")); return; }
      if (!response.ok) throw new Error(serverErrorText(payload.error) ?? t("Trigger nicht verfügbar"));
      setTriggers(payload.data.triggers as Trigger[]); setTruncated(Boolean(payload.data.truncated)); setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("Trigger nicht verfügbar")); }
  }, [projectId, environment]);
  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Trigger werden geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><Zap size={26}/><h3>{state === "unavailable" ? t("Datenbank nicht bereit") : t("Trigger nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const shown = triggers.filter((trigger) => `${trigger.name} ${trigger.table} ${trigger.functionName}`.toLowerCase().includes(query.toLowerCase()));
  const timingLabel = { before: "BEFORE", after: "AFTER", instead_of: "INSTEAD OF" };
  const enabledLabel: Record<Trigger["enabled"], string> = { origin: t("aktiv"), always: t("immer, auch bei Replikation"), replica: t("nur bei Replikation"), disabled: t("abgeschaltet") };

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("TRIGGER")}</span><strong>{triggers.length}</strong><small>{t("im Schema public")}</small></div>
      <div><span>{t("ABGESCHALTET")}</span><strong>{triggers.filter((trigger) => trigger.enabled === "disabled").length}</strong><small>{t("feuern nicht")}</small></div>
      <div><span>{t("TABELLEN")}</span><strong>{new Set(triggers.map((trigger) => trigger.table)).size}</strong><small>{t("mit Triggern")}</small></div>
    </article>
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("DATENBANK")} · {environment.toUpperCase()}</span><h3>{t("Trigger im Schema public")}</h3></div><div><div className="toolbar-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Nach Name, Tabelle oder Funktion filtern…")}/></div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button></div></div>
      {triggers.length === 0 && <p className="muted">{t("Keine Trigger im Schema public. Ein Trigger entsteht wie jede Schemaänderung über ein Change Set: SQL im SQL Editor, Vorschau, Freigabe.")}</p>}
      {truncated && <p className="muted">{t("Die Liste ist bei 200 Triggern abgeschnitten.")}</p>}
      {shown.map((trigger) => <div className="bucket-row" key={`${trigger.table}.${trigger.name}`}><span className="bucket-icon"><Zap size={16}/></span>
        <div><strong>{trigger.name}</strong><small>{trigger.table} · {timingLabel[trigger.timing]} {trigger.events.map((event) => event.toUpperCase()).join(" OR ")} · {trigger.orientation === "row" ? t("je Zeile") : t("je Anweisung")} · {trigger.functionSchema}.{trigger.functionName}(){trigger.condition ? ` · WHEN (${trigger.condition})` : ""}</small></div>
        <span className={trigger.enabled === "disabled" ? "risk medium" : "secure"}>{enabledLabel[trigger.enabled]}</span>
      </div>)}
      {triggers.length > 0 && shown.length === 0 && <p className="muted">{t("Kein Trigger passt zum Filter.")}</p>}
    </article>
  </div>;
}
