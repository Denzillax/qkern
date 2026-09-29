"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Network, RefreshCw } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";
import { buildSchemaDiagram, type DiagramRelation, type DiagramTable } from "@/lib/console/schema-diagram";

/**
 * Der Schema-Visualizer (2.41), wie bei Supabase unter Database → Schema
 * Visualizer, aber nur lesend: kein Verschieben, kein Anlegen, kein Loeschen.
 *
 * Zwei Routen liefern die Daten: `/schema` die Tabellen mit ihren Spalten,
 * `/schema/foreign-keys` die Beziehungen. Gezeichnet wird das Schema `public`,
 * wie in den anderen Katalogansichten der Console (`policies-view` fragt
 * genauso fest nach `public`).
 *
 * Das Bild entsteht aus `buildSchemaDiagram`, einer reinen Funktion ohne
 * Farben und ohne Sprache. Hier kommen nur `currentColor` und die CSS-Variablen
 * der Console dazu, damit das Diagramm hell und dunkel lesbar bleibt. Unter
 * dem Bild steht dieselbe Auskunft in Worten: ein Diagramm ist fuer eine
 * Vorleseausgabe nichts, und `aria-label` allein reicht dafuer nicht.
 */
type Environment = "development" | "staging" | "production";
type SchemaColumn = { name: string; dataType: string; nullable: boolean; identity: boolean; generated: boolean; sensitive: boolean };
type SchemaTable = { name: string; kind: string; rowSecurityEnabled: boolean; columns: SchemaColumn[]; truncated: boolean };
type ForeignKey = {
  name: string; table: string; columns: string[];
  referencedSchema: string; referencedTable: string; referencedColumns: string[];
  onDelete: string; onUpdate: string;
};
type State = "loading" | "ready" | "unavailable" | "error";
type Payload = Record<string, unknown>;

/** Wie in `policies-view`: die Console liest das Schema `public`. */
const SCHEMA = "public";

/** GET mit JSON-Antwort; ein Body, der kein Objekt ist, wird zu `{}`. */
async function readJson(url: string, signal: AbortSignal): Promise<{ status: number; payload: Payload }> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    const body: unknown = (await response.json().catch(() => ({}))) ?? {};
    return { status: response.status, payload: body !== null && typeof body === "object" && !Array.isArray(body) ? body as Payload : {} };
  } catch (cause) {
    return { status: 0, payload: { error: cause instanceof Error ? cause.message : "" } };
  }
}

/** Die Aktion beim Loeschen der Elternzeile in Worten; `no action` bleibt unerwaehnt. */
function onDeleteLabel(action: string): string | null {
  switch (action) {
    case "cascade": return t("löscht die Kindzeilen mit");
    case "restrict": return t("verbietet das Löschen");
    case "set_null": return t("setzt die Spalten auf NULL");
    case "set_default": return t("setzt die Spalten auf ihre Vorgabe");
    default: return null;
  }
}

export function SchemaVisualizerView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: State }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}`;
  const [state, setState] = useState<State>(initialState ?? "loading");
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [foreignKeys, setForeignKeys] = useState<ForeignKey[]>([]);
  const [tablesTruncated, setTablesTruncated] = useState(false);
  const [keysTruncated, setKeysTruncated] = useState(false);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null);

  // Jede Ladung hat einen eigenen AbortController; eine abgebrochene setzt keinen Zustand mehr.
  const load = useCallback(async (initial: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (initial) setState("loading"); else setRefreshing(true);
    const [schema, keys] = await Promise.all([
      readJson(`${base}/schema?schema=${SCHEMA}`, controller.signal),
      readJson(`${base}/schema/foreign-keys?schema=${SCHEMA}`, controller.signal),
    ]);
    if (controller.signal.aborted) return;
    setRefreshing(false);
    for (const result of [schema, keys]) {
      if (result.status === 503 || result.status === 409) {
        setMessage(typeof result.payload.error === "string" && result.payload.error ? result.payload.error : t("Die Projektdatenbank ist noch nicht bereit."));
        setState("unavailable");
        return;
      }
    }
    const schemaData = schema.payload.data as { tables?: unknown; truncated?: unknown } | undefined;
    const keyData = keys.payload.data as { foreignKeys?: unknown; truncated?: unknown } | undefined;
    if (schema.status === 200 && keys.status === 200 && schemaData && keyData &&
        Array.isArray(schemaData.tables) && Array.isArray(keyData.foreignKeys)) {
      setTables(schemaData.tables as SchemaTable[]);
      setForeignKeys(keyData.foreignKeys as ForeignKey[]);
      setTablesTruncated(Boolean(schemaData.truncated));
      setKeysTruncated(Boolean(keyData.truncated));
      setState("ready");
      return;
    }
    const error = [schema, keys].map((result) => result.payload.error).find((value) => typeof value === "string" && value);
    setMessage(typeof error === "string" ? error : t("Schema-Visualizer nicht verfügbar"));
    setState("error");
  }, [base]);

  useEffect(() => {
    void load(true);
    return () => request.current?.abort();
  }, [load]);

  const diagram = useMemo(() => buildSchemaDiagram({
    schema: SCHEMA,
    tables: tables.map((table): DiagramTable => ({
      name: table.name,
      columns: table.columns.map((column) => ({ name: column.name, dataType: column.dataType, notNull: !column.nullable })),
    })),
    relations: foreignKeys.map((key): DiagramRelation => ({
      name: key.name, table: key.table, columns: key.columns,
      referencedSchema: key.referencedSchema, referencedTable: key.referencedTable,
      referencedColumns: key.referencedColumns, onDelete: key.onDelete,
    })),
  }), [tables, foreignKeys]);

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Diagramm wird gezeichnet…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><Network size={26}/>
    <h3>{state === "unavailable" ? t("Datenbank nicht bereit") : t("Schema-Visualizer nicht verfügbar")}</h3>
    <p>{message}</p>
    <button className="secondary-button" onClick={() => void load(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button>
  </div>;

  const label = `${t("Diagramm des Schemas")} ${SCHEMA}: ${tables.length} ${t("Tabellen")}, ${foreignKeys.length} ${t("Fremdschlüssel")}`;

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("TABELLEN")}</span><strong>{tables.length}</strong><small>{t("im Schema public")}</small></div>
      <div><span>{t("FREMDSCHLÜSSEL")}</span><strong>{foreignKeys.length}</strong><small>{t("zwischen den Tabellen")}</small></div>
      <div><span>{t("MIT BEZIEHUNG")}</span><strong>{new Set(foreignKeys.map((key) => key.table)).size}</strong><small>{t("Tabellen verweisen")}</small></div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("DATENBANK")} · {environment.toUpperCase()}</span><h3>{t("Schema public als Bild")}</h3></div><div>
        <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
      </div></div>
      <p className="muted">{t("Gezeichnet wird, was der Katalog hergibt: Tabellen, Spalten und Fremdschlüssel. Vererbung, Partitionen, Sichten und Regeln fehlen im Bild.")}</p>
      {tables.length === 0 && <p className="muted">{t("Dieses Schema hat noch keine Tabellen")}</p>}
      {tablesTruncated && <p className="muted">{t("Die Tabellenliste ist an der Grenze abgeschnitten; das Bild zeigt nicht alle Tabellen und Spalten.")}</p>}
      {keysTruncated && <p className="muted">{t("Die Liste der Fremdschlüssel ist bei 400 abgeschnitten; das Bild zeigt nicht alle Linien.")}</p>}
      {tables.length > 0 && <div className="schema-diagram">
        <svg role="img" aria-label={label} viewBox={`0 0 ${diagram.width} ${diagram.height}`} width={diagram.width} height={diagram.height}>
          {diagram.edges.map((edge) => <g key={edge.id} className="schema-diagram-edge">
            <path d={edge.path} fill="none" stroke="currentColor" strokeWidth={1.2} strokeDasharray={edge.external ? "4 3" : undefined}/>
            <path d={edge.arrow} fill="none" stroke="currentColor" strokeWidth={1.4}/>
            {onDeleteLabel(edge.onDelete) && <text x={edge.labelX} y={edge.labelY} textAnchor={edge.labelAnchor} className="schema-diagram-edge-label">{onDeleteLabel(edge.onDelete)}</text>}
          </g>)}
          {diagram.boxes.map((box) => <g key={box.id} className={`schema-diagram-box${box.external ? " external" : ""}`}>
            <rect x={box.x} y={box.y} width={box.width} height={box.height} rx={10}
                  fill="var(--qkern-surface)" stroke="currentColor" strokeWidth={1}
                  strokeDasharray={box.external ? "5 4" : undefined}/>
            <line x1={box.x} y1={box.dividerY} x2={box.x + box.width} y2={box.dividerY} stroke="currentColor" strokeWidth={1}/>
            <text x={box.x + 12} y={box.titleY} className="schema-diagram-title">{box.title}</text>
            {box.rows.map((row) => <text key={row.column} x={box.x + 12} y={row.y} className="schema-diagram-column">
              {row.foreignKey ? "→ " : ""}{row.column}
              <tspan className="schema-diagram-type" x={box.x + box.width - 12} textAnchor="end">{row.dataType}{row.notNull ? " *" : ""}</tspan>
            </text>)}
            {box.hiddenColumns > 0 && <text x={box.x + 12} y={box.hiddenY} className="schema-diagram-column">+{box.hiddenColumns}</text>}
          </g>)}
        </svg>
      </div>}
      <p className="muted">{t("Ein Stern hinter dem Typ heisst NOT NULL, ein Pfeil vor der Spalte heisst: sie gehört zu einem Fremdschlüssel. Gestrichelte Kästen liegen in einem anderen Schema. Primärschlüssel zeichnet das Bild nicht, weil die Schema-Route sie nicht mitliefert.")}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NUR LESEND")}</span><h3>{t("Beziehungen in Worten")}</h3></div><Network size={18}/></div>
      <p className="muted">{t("Dieselbe Auskunft wie das Bild, für Vorleseausgaben und zum Nachlesen.")}</p>
      {foreignKeys.length === 0 && <p className="muted">{t("Keine Fremdschlüssel in diesem Schema. Eine Beziehung entsteht wie jede Schemaänderung über ein Change Set.")}</p>}
      {foreignKeys.map((key) => <div className="bucket-row" key={`${key.table}.${key.name}`}>
        <span className="bucket-icon"><Network size={16}/></span>
        <div>
          <strong>{key.name}</strong>
          <small>
            {key.table} ({key.columns.join(", ")}) {t("verweist auf")} {key.referencedSchema === SCHEMA ? key.referencedTable : `${key.referencedSchema}.${key.referencedTable}`} ({key.referencedColumns.join(", ")})
            {onDeleteLabel(key.onDelete) ? ` · ${t("beim Löschen")}: ${onDeleteLabel(key.onDelete)}` : ""}
          </small>
        </div>
        {key.referencedSchema === SCHEMA
          ? <span className="secure">{t("gleiches Schema")}</span>
          : <span className="risk medium">{key.referencedSchema}</span>}
      </div>)}
    </article>
  </div>;
}
