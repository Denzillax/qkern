"use client";

import { useCallback, useEffect, useState } from "react";
import { Braces, ExternalLink, Eye, RefreshCw, Table2 } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";
import { DATA_API_LIMITS, SENSITIVE_COLUMN_WORDS } from "@/lib/data-api-limits";
import { dataApiReadiness, exposedTablesFromOpenApi, type DataApiReadiness } from "@/lib/console/data-api-exposure";

/**
 * Data-API-Einstellungen in der Console, wie bei Supabase unter
 * Project Settings → Data API, aber nur lesend.
 *
 * Status: `generated-openapi?schema=public` (200 bereit, 409 nicht bereit,
 * 503 abgeschaltet). Tabellen: `schema?schema=public`. Freigegeben heisst:
 * der Pfad `.../tables/{name}/rows` steht im OpenAPI-Dokument; ist das
 * Dokument nicht da, steht "unbekannt" statt "nein".
 *
 * Views und materialisierte Views stehen in einer eigenen Liste statt
 * weggelassen zu werden: Ein View mit security_invoker ist ueber die Data API
 * lesbar, ein materialisierter View nie. Auch dafuer zaehlt nur das Dokument.
 *
 * Alle Zahlen kommen aus DATA_API_LIMITS, keine steht im JSX.
 */
type Environment = "development" | "staging" | "production";
type SchemaTable = { name: string; kind: "table" | "partitioned_table" | "view" | "materialized_view"; rowSecurityEnabled: boolean };
type SchemaState = { state: "loading" | "ready" | "not-ready" | "unavailable" | "error"; tables: SchemaTable[]; truncated: boolean; message: string };

const { schema, rowsMin, rowsMax, maxFilters, operators, keyClaims } = DATA_API_LIMITS;

export function DataApiSettingsView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}`;
  const openApiUrl = `${base}/generated-openapi?schema=${schema}`;
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ readiness: DataApiReadiness | "loading"; exposed: string[]; message: string }>({ readiness: "loading", exposed: [], message: "" });
  const [tables, setTables] = useState<SchemaState>({ state: "loading", tables: [], truncated: false, message: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const [openApi, schemaResult] = await Promise.all([
      fetch(openApiUrl, { cache: "no-store" }).then(async (response) => ({ status: response.status, payload: await response.json().catch(() => ({})) }), (cause: unknown) => ({ status: 0, payload: { error: cause instanceof Error ? cause.message : "" } })),
      fetch(`${base}/schema?schema=${schema}`, { cache: "no-store" }).then(async (response) => ({ status: response.status, payload: await response.json().catch(() => ({})) }), (cause: unknown) => ({ status: 0, payload: { error: cause instanceof Error ? cause.message : "" } })),
    ]);

    const readiness = dataApiReadiness(openApi.status, typeof openApi.payload.code === "string" ? openApi.payload.code : undefined);
    const paths = readiness === "ready" && openApi.payload.paths && typeof openApi.payload.paths === "object" ? openApi.payload.paths as Record<string, unknown> : {};
    setStatus({ readiness, exposed: exposedTablesFromOpenApi(paths), message: [openApi.payload.error, openApi.payload.code].filter((part) => typeof part === "string" && part).join(" · ") || t("Data API nicht verfügbar") });

    if (schemaResult.status === 200 && Array.isArray(schemaResult.payload.data?.tables)) {
      setTables({ state: "ready", tables: schemaResult.payload.data.tables as SchemaTable[], truncated: schemaResult.payload.data.truncated === true, message: "" });
    } else {
      const state = schemaResult.status === 409 ? "not-ready" : schemaResult.status === 503 ? "unavailable" : "error";
      setTables({ state, tables: [], truncated: false, message: typeof schemaResult.payload.error === "string" && schemaResult.payload.error ? schemaResult.payload.error : t("Tabellen nicht verfügbar") });
    }
    setLoading(false);
  }, [base, openApiUrl]);
  useEffect(() => { void load(); }, [load]);

  const known = status.readiness === "ready";
  const exposed = new Set(status.exposed);
  const exposedLabel = (name: string) => !known ? t("unbekannt") : exposed.has(name) ? t("ja") : t("nein");
  const regular = tables.tables.filter((table) => table.kind === "table" || table.kind === "partitioned_table");
  const views = tables.tables.filter((table) => table.kind === "view" || table.kind === "materialized_view");

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>DATA API · {environment.toUpperCase()}</span><h3>{t("Status der Data API")}</h3></div><button className="secondary-button" disabled={loading} onClick={() => void load()}><RefreshCw size={14}/> <StableLabel current={loading ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button></div>
      {status.readiness === "loading" && <p className="muted">{t("Status wird geladen…")}</p>}
      {status.readiness === "ready" && <>
        <p><strong>{t("Bereit")}</strong> · {status.exposed.length} {t("Tabellen und Views sind über die Data API erreichbar.")}</p>
        <p><a href={openApiUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={13}/> {t("OpenAPI-Dokument öffnen")}</a></p>
      </>}
      {status.readiness === "not-ready" && <p><strong>{t("Nicht bereit")}</strong> · {t("Diese Umgebung hat noch keine gebundene Datenbank. Im Schnellstart bindet `npm run dev:bind-project-database` eine.")}</p>}
      {status.readiness === "disabled" && <p><strong>{t("Abgeschaltet")}</strong> · {t("Die Data API ist für diese Umgebung abgeschaltet. Eingeschaltet wird sie über QKERN_GENERATED_DATA_API_ENABLED.")}</p>}
      {status.readiness === "error" && <p><strong>{t("Data API nicht verfügbar")}</strong> · {status.message}</p>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("SCHEMA")} {schema}</span><h3>{t("Freigegebene Tabellen")}</h3></div></div>
      {tables.state === "loading" && <p className="muted">{t("Tabellen werden geladen…")}</p>}
      {tables.state === "not-ready" && <p className="muted">{t("Ohne gebundene Datenbank gibt es keine Tabellen zu zeigen.")}</p>}
      {tables.state === "unavailable" && <p className="muted">{t("Die Datenbank des Projekts ist gerade nicht erreichbar.")} {tables.message}</p>}
      {tables.state === "error" && <p className="muted">{tables.message}</p>}
      {tables.state === "ready" && <>
        {regular.length === 0 && <p className="muted">{t("Im Schema public gibt es keine Tabellen.")}</p>}
        {regular.map((table) => <div className="bucket-row" key={table.name}><span className="bucket-icon"><Table2 size={16}/></span>
          <div><strong>{table.name}</strong><small>{table.kind === "partitioned_table" ? t("Partitionierte Tabelle") : t("Tabelle")}</small></div>
          <span className={table.rowSecurityEnabled ? "secure" : "muted"}>RLS {table.rowSecurityEnabled ? t("an") : t("aus")}</span>
          <span className="muted">{t("Freigegeben")}: {exposedLabel(table.name)}</span>
        </div>)}
        {views.length > 0 && <>
          <p className="muted">{t("Views und materialisierte Views")}</p>
          {views.map((view) => <div className="bucket-row" key={view.name}><span className="bucket-icon"><Eye size={16}/></span>
            <div><strong>{view.name}</strong><small>{view.kind === "view" ? t("View") : t("Materialisierte View")}</small></div>
            <span className="muted">{t("nur lesen")}</span>
            <span className="muted">{t("Freigegeben")}: {exposedLabel(view.name)}</span>
          </div>)}
        </>}
        {tables.truncated && <p className="muted">{t("Die Liste ist gekürzt; der Server liefert nicht alle Tabellen.")}</p>}
        <p className="muted">{t("Freigegeben heisst: RLS an, Primärschlüssel vorhanden, für die Rolle lesbar und mindestens eine nicht sensible Spalte. Views nur mit security_invoker und nur lesend. Massgeblich ist das OpenAPI-Dokument des Servers.")}</p>
      </>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NUR LESEND")}</span><h3>{t("Regeln und Grenzen")}</h3></div><Braces size={18}/></div>
      <div className="detail-list">
        <div><span>{t("Standardschema")}</span><code>{schema}</code></div>
        <div><span>{t("Zeilen je Anfrage")}</span><strong>{rowsMin} {t("bis")} {rowsMax}</strong></div>
        <div><span>{t("Filter je Anfrage höchstens")}</span><strong>{maxFilters}</strong></div>
        <div><span>{t("Operatoren")}</span><code>{operators.join(", ")}</code></div>
        <div><span>{t("Public Key setzt die Rolle")}</span><code>{keyClaims.public}</code></div>
        <div><span>{t("Service Key setzt die Rolle")}</span><code>{keyClaims.service}</code></div>
      </div>
      <p className="muted">{t("Row Level Security gilt für beide Schlüssel: Die Datenbankrolle der Data API umgeht RLS nie, die Rolle steht nur in den Claims.")}</p>
      <p className="muted">{t("Sensible Spalten werden nie zurückgegeben, gefiltert, sortiert oder geschrieben. Erkannt am Namen:")} {SENSITIVE_COLUMN_WORDS.join(", ")}.</p>
      <p className="muted">{t("Diese Ansicht zeigt nur das Standardschema. Die Data API nimmt über ?schema= auch andere an, Systemschemata nie.")}</p>
      <p className="muted">{t("Weitere Schemata und eine eigene Zeilengrenze sind noch nicht verbunden.")}</p>
    </article>
  </div>;
}
