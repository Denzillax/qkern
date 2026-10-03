"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { t } from "@/components/console/console-i18n";

/**
 * Policies in der Console (2.19): die Row-Level-Security-Regeln des Schemas
 * public, gelesen über `/schema/policies`. Nur lesend; eine Regel entsteht
 * wie jede Schemaänderung über ein Change Set.
 */
type Environment = "development" | "staging" | "production";
type Policy = { name: string; table: string; permissive: boolean; command: "select" | "insert" | "update" | "delete" | "all"; roles: string[]; usingExpression: string | null; checkExpression: string | null };

/**
 * 2.138: Mit `table` zeigt dieselbe Lesung nur die Regeln dieser einen
 * Tabelle. Ohne `table` bleibt die Ansicht der Menuepunkt Datenbank ->
 * Policies mit dem ganzen Schema; gefiltert wird in der Ansicht und nicht in
 * der Route, damit die Zahlen oben weiter aus einer Lesung kommen.
 */
export function PoliciesView({ projectId, environment, table, initialState }: { projectId: string; environment: Environment; table?: string; initialState?: "loading" | "ready" | "unavailable" | "error" }) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">(initialState ?? "loading");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/environments/${environment}/schema/policies?schema=public`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503 || response.status === 409) { setState("unavailable"); setMessage(payload.error ?? t("Die Projektdatenbank ist noch nicht bereit.")); return; }
      if (!response.ok) throw new Error(payload.error ?? t("Policies nicht verfügbar"));
      setPolicies(payload.data.policies as Policy[]); setTruncated(Boolean(payload.data.truncated)); setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("Policies nicht verfügbar")); }
  }, [projectId, environment]);
  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Policies werden geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><ShieldCheck size={26}/><h3>{state === "unavailable" ? t("Datenbank nicht bereit") : t("Policies nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const scoped = table ? policies.filter((policy) => policy.table === table) : policies;
  const shown = scoped.filter((policy) => `${policy.name} ${policy.table} ${policy.roles.join(" ")}`.toLowerCase().includes(query.toLowerCase()));

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("POLICIES")}</span><strong>{scoped.length}</strong><small>{table ? t("für diese Tabelle") : t("im Schema public")}</small></div>
      <div><span>{t("EINSCHRÄNKEND")}</span><strong>{scoped.filter((policy) => !policy.permissive).length}</strong><small>{t("müssen alle zutreffen")}</small></div>
      {/* Ohne vorgegebene Tabelle bleibt die dritte Zahl, was sie war: wie
          viele Tabellen ueberhaupt Regeln haben. Mit vorgegebener Tabelle
          waere die Zahl immer 1 und damit keine Auskunft; dann steht dort,
          fuer welche Rollen die Regeln dieser Tabelle gelten. */}
      {table
        ? <div><span>{t("ROLLEN")}</span><strong>{new Set(scoped.flatMap((policy) => policy.roles)).size}</strong><small>{t("in diesen Policies genannt")}</small></div>
        : <div><span>{t("TABELLEN")}</span><strong>{new Set(policies.map((policy) => policy.table)).size}</strong><small>{t("mit Policies")}</small></div>}
    </article>
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("DATENBANK")} · {environment.toUpperCase()}</span><h3>{table ? t("Policies dieser Tabelle") : t("Policies im Schema public")}</h3></div><div><div className="toolbar-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Nach Name, Tabelle oder Rolle filtern…")}/></div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button></div></div>
      {scoped.length === 0 && table && <p className="muted">{t("Für diese Tabelle gibt es keine Policy. Ohne Policy lässt Row Level Security keine Zeile durch, sobald sie eingeschaltet ist.")}</p>}
      {policies.length === 0 && !table && <p className="muted">{t("Keine Policies im Schema public. Eine Regel entsteht wie jede Schemaänderung über ein Change Set: SQL im SQL Editor, Vorschau, Freigabe. Ob RLS auf einer Tabelle eingeschaltet ist, zeigt der Table Editor.")}</p>}
      {truncated && <p className="muted">{t("Die Liste ist bei 200 Policies abgeschnitten.")}</p>}
      {shown.map((policy) => <div className="bucket-row" key={`${policy.table}.${policy.name}`}><span className="bucket-icon"><ShieldCheck size={16}/></span>
        <div><strong>{policy.name}</strong><small>{policy.table} · {policy.command.toUpperCase()} · {t("für")} {policy.roles.join(", ")}{policy.usingExpression ? ` · USING ${policy.usingExpression}` : ""}{policy.checkExpression ? ` · WITH CHECK ${policy.checkExpression}` : ""}</small></div>
        <span className={policy.permissive ? "secure" : "risk medium"}>{policy.permissive ? t("erlaubend") : t("einschränkend")}</span>
      </div>)}
      {scoped.length > 0 && shown.length === 0 && <p className="muted">{t("Keine Policy passt zum Filter.")}</p>}
    </article>
  </div>;
}
