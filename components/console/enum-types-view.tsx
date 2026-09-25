"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Tags } from "lucide-react";
import { t } from "@/components/console/console-i18n";

/**
 * Enum-Typen in der Console (2.19): die Aufzählungstypen des Schemas public
 * mit ihren Werten in Sortierreihenfolge, gelesen über `/schema/enum-types`.
 * Nur lesend; ein Typ entsteht wie jede Schemaänderung über ein Change Set.
 */
type Environment = "development" | "staging" | "production";
type EnumType = { name: string; labels: string[] };

export function EnumTypesView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const [types, setTypes] = useState<EnumType[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/environments/${environment}/schema/enum-types?schema=public`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503 || response.status === 409) { setState("unavailable"); setMessage(payload.error ?? t("Die Projektdatenbank ist noch nicht bereit.")); return; }
      if (!response.ok) throw new Error(payload.error ?? t("Enum-Typen nicht verfügbar"));
      setTypes(payload.data.types as EnumType[]); setTruncated(Boolean(payload.data.truncated)); setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("Enum-Typen nicht verfügbar")); }
  }, [projectId, environment]);
  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Enum-Typen werden geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><Tags size={26}/><h3>{state === "unavailable" ? t("Datenbank nicht bereit") : t("Enum-Typen nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const shown = types.filter((type) => `${type.name} ${type.labels.join(" ")}`.toLowerCase().includes(query.toLowerCase()));

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("ENUM-TYPEN")}</span><strong>{types.length}</strong><small>{t("im Schema public")}</small></div>
      <div><span>{t("WERTE")}</span><strong>{types.reduce((sum, type) => sum + type.labels.length, 0)}</strong><small>{t("über alle Typen")}</small></div>
      <div><span>{t("LEER")}</span><strong>{types.filter((type) => type.labels.length === 0).length}</strong><small>{t("Typen ohne Werte")}</small></div>
    </article>
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("DATENBANK")} · {environment.toUpperCase()}</span><h3>{t("Enum-Typen im Schema public")}</h3></div><div><div className="toolbar-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Nach Name oder Wert filtern…")}/></div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button></div></div>
      {types.length === 0 && <p className="muted">{t("Keine Enum-Typen im Schema public. Ein Typ entsteht wie jede Schemaänderung über ein Change Set: SQL im SQL Editor, Vorschau, Freigabe.")}</p>}
      {truncated && <p className="muted">{t("Die Liste ist bei 200 Typen abgeschnitten.")}</p>}
      {shown.map((type) => <div className="bucket-row" key={type.name}><span className="bucket-icon"><Tags size={16}/></span>
        <div><strong>{type.name}</strong><small>{type.labels.length > 0 ? type.labels.join(" · ") : t("keine Werte")}</small></div>
        <span className="muted">{type.labels.length} {t("Werte")}</span>
      </div>)}
      {types.length > 0 && shown.length === 0 && <p className="muted">{t("Kein Typ passt zum Filter.")}</p>}
    </article>
  </div>;
}
