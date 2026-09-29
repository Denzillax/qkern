"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, RefreshCw } from "lucide-react";
import { t } from "@/components/console/console-i18n";

/**
 * Spaltenrechte in der Console (2.20): die je Spalte gesetzten Rechte des
 * Schemas public, gelesen über `/schema/column-privileges`. Nur lesend.
 * Tabellenrechte überlagern Spaltenrechte und stehen nicht hier.
 */
type Environment = "development" | "staging" | "production";
type Privilege = { table: string; column: string; grantee: string; privileges: Array<{ type: "select" | "insert" | "update" | "references"; grantable: boolean }> };

export function ColumnPrivilegesView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading" | "ready" | "unavailable" | "error" }) {
  const [privileges, setPrivileges] = useState<Privilege[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">(initialState ?? "loading");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/environments/${environment}/schema/column-privileges?schema=public`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503 || response.status === 409) { setState("unavailable"); setMessage(payload.error ?? t("Die Projektdatenbank ist noch nicht bereit.")); return; }
      if (!response.ok) throw new Error(payload.error ?? t("Spaltenrechte nicht verfügbar"));
      setPrivileges(payload.data.privileges as Privilege[]); setTruncated(Boolean(payload.data.truncated)); setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("Spaltenrechte nicht verfügbar")); }
  }, [projectId, environment]);
  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Spaltenrechte werden geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><KeyRound size={26}/><h3>{state === "unavailable" ? t("Datenbank nicht bereit") : t("Spaltenrechte nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const shown = privileges.filter((entry) => `${entry.table} ${entry.column} ${entry.grantee}`.toLowerCase().includes(query.toLowerCase()));

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("SPALTENRECHTE")}</span><strong>{privileges.length}</strong><small>{t("im Schema public")}</small></div>
      <div><span>{t("FÜR ALLE")}</span><strong>{privileges.filter((entry) => entry.grantee === "public").length}</strong><small>{t("an PUBLIC vergeben")}</small></div>
      <div><span>{t("WEITERGEBBAR")}</span><strong>{privileges.filter((entry) => entry.privileges.some((privilege) => privilege.grantable)).length}</strong><small>{t("mit GRANT OPTION")}</small></div>
    </article>
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("DATENBANK")} · {environment.toUpperCase()}</span><h3>{t("Spaltenrechte im Schema public")}</h3></div><div><div className="toolbar-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Nach Tabelle, Spalte oder Rolle filtern…")}/></div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button></div></div>
      {privileges.length === 0 && <p className="muted">{t("Keine Spaltenrechte im Schema public. Rechte je Spalte entstehen wie jede Schemaänderung über ein Change Set: GRANT im SQL Editor, Vorschau, Freigabe. Tabellenrechte stehen nicht hier.")}</p>}
      {truncated && <p className="muted">{t("Die Liste ist bei 500 Einträgen abgeschnitten.")}</p>}
      {shown.map((entry) => <div className="bucket-row" key={`${entry.table}.${entry.column}.${entry.grantee}`}><span className="bucket-icon"><KeyRound size={16}/></span>
        <div><strong>{entry.table}.{entry.column}</strong><small>{t("für")} {entry.grantee} · {entry.privileges.map((privilege) => privilege.type.toUpperCase() + (privilege.grantable ? "*" : "")).join(", ")}</small></div>
        <span className={entry.grantee === "public" ? "risk medium" : "secure"}>{entry.grantee === "public" ? t("alle Rollen") : entry.grantee}</span>
      </div>)}
      {privileges.length > 0 && shown.length === 0 && <p className="muted">{t("Kein Eintrag passt zum Filter.")}</p>}
      <p className="muted">{t("* mit GRANT OPTION, darf weitergegeben werden.")}</p>
    </article>
  </div>;
}
