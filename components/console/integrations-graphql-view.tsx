"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Braces, Play, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import { DATA_API_GRAPHQL_LIMITS } from "@/lib/data-api-graphql-limits";
import {
  GRAPHQL_ACCEPTED_TEXTS,
  GRAPHQL_ARGUMENT_TEXTS,
  GRAPHQL_CONSOLE_ROLE,
  GRAPHQL_LIMIT_DEPTH,
  GRAPHQL_LIMIT_FIELDS,
  GRAPHQL_LIMIT_ROWS,
  GRAPHQL_NO_COST_ESTIMATE,
  GRAPHQL_NO_HISTORY,
  GRAPHQL_NO_INTROSPECTION,
  GRAPHQL_NO_MUTATIONS,
  GRAPHQL_OWN_PARSER,
  GRAPHQL_PAGE_READ_ONLY,
  GRAPHQL_REFUSED_TEXTS,
  GRAPHQL_REJECTIONS,
  GRAPHQL_SAME_PATH,
  GRAPHQL_SCHEMA_FROM_CATALOG,
  GRAPHQL_SCHEMA_NOT_PER_CALLER,
  GRAPHQL_SCHEMA_OMISSIONS,
  GRAPHQL_SEQUENTIAL,
  GRAPHQL_WHAT,
  GRAPHQL_WHY_LIMITS,
} from "@/lib/console/integrations-graphql-texts";

/**
 * Integrationen → GraphQL (2.83), an der Stelle, an der bis hierher der
 * Platzhalter stand.
 *
 * Der Platzhalter sagte: „GraphQL-Schnittstelle über dem Schema. Die Data API
 * ist REST.“ Gebaut ist ein lesender Ausschnitt davon, und die Seite sagt in
 * derselben Höhe, was er kann und was ihm fehlt: keine Mutationen, keine
 * Fragmente, keine Variablen, keine Direktiven, keine Introspektion, keine
 * Beziehungen.
 *
 * Die Seite behauptet nichts aus eigenem Wissen. Das Schema, die Grenzen und
 * der Ausschnitt der Sprache kommen aus der Antwort der Route; die Ansicht
 * zeigt sie. Eine zweite Liste hier würde irgendwann etwas anderes behaupten
 * als der Parser.
 */
type Environment = "development" | "staging" | "production";

type SchemaField = {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  dataType: string;
};

type SchemaType = { name: string; fields: SchemaField[] };

type GraphqlSchema = {
  schema: string;
  types: SchemaType[];
  sdl: string;
  limits: typeof DATA_API_GRAPHQL_LIMITS;
  grammar: { accepted: readonly string[]; refused: readonly string[] };
};

type GraphqlFieldResult = {
  responseKey: string;
  table: string;
  rowCount: number;
  hasMore: boolean;
  nextCursor: string | null;
};

type GraphqlResult = {
  data: Record<string, Array<Record<string, unknown>>>;
  fields: GraphqlFieldResult[];
  fieldCount: number;
  rowBudget: number;
  operationName: string | null;
};

/** Eine erste Abfrage, aus dem geladenen Schema gebaut und nicht erfunden. */
function firstQuery(types: SchemaType[]): string {
  const first = types[0];
  if (!first) return "";
  const columns = first.fields.slice(0, 4).map((field) => field.name).join("\n    ");
  return `{\n  ${first.name}(limit: 5) {\n    ${columns}\n  }\n}\n`;
}

export function IntegrationsGraphqlView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading" | "ready" | "unavailable" | "error" }) {
  const route = `/api/v1/projects/${projectId}/environments/${environment}/graphql`;
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">(initialState ?? "loading");
  const [schema, setSchema] = useState<GraphqlSchema | null>(null);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<GraphqlResult | null>(null);
  const [refusal, setRefusal] = useState("");
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async (initial: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (initial) setState("loading"); else setRefreshing(true);
    try {
      const response = await fetch(route, { cache: "no-store", signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      setRefreshing(false);
      if (response.status === 503 || response.status === 409) {
        setSchema(null); setState("unavailable");
        setMessage(payload.error ?? t("Die Data API ist für diese Umgebung nicht bereit."));
        return;
      }
      if (!response.ok || !payload.data) {
        setSchema(null); setState("error");
        setMessage(payload.error ?? t("Die Route hat nicht geantwortet."));
        return;
      }
      const loaded = payload.data as GraphqlSchema;
      setSchema(loaded);
      setQuery((current) => current === "" ? firstQuery(loaded.types) : current);
      setMessage(""); setState("ready");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setRefreshing(false); setSchema(null); setState("error");
      setMessage(cause instanceof Error ? cause.message : t("Die Route hat nicht geantwortet."));
    }
  }, [route]);

  useEffect(() => {
    void load(true);
    return () => request.current?.abort();
  }, [load]);

  /** Der Grund einer Ablehnung im Klartext; die Kennung kommt vom Dienst. */
  function explain(payload: { reason?: string; at?: string; error?: string }): string {
    const reason = payload.reason;
    const text = reason && reason in GRAPHQL_REJECTIONS
      ? t(GRAPHQL_REJECTIONS[reason]!)
      : payload.error ?? t("Die Abfrage wurde abgewiesen.");
    return payload.at ? `${text} (${payload.at})` : text;
  }

  async function run() {
    setRunning(true);
    setRefusal("");
    try {
      const response = await fetch(route, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.data) {
        setResult(null);
        setRefusal(explain(payload));
        return;
      }
      setResult(payload.data as GraphqlResult);
    } catch {
      setResult(null);
      setRefusal(t("Die Route hat nicht geantwortet."));
    } finally { setRunning(false); }
  }

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/>
      <h3>{t("Das GraphQL-Schema wird geladen…")}</h3></div>;
  }
  if (state === "unavailable" || state === "error" || !schema) {
    return <div className="console-card live-module-state"><ShieldOff size={26}/>
      <h3>{state === "unavailable" ? t("Generated Data API nicht bereit") : t("GraphQL nicht verfügbar")}</h3>
      <p>{message}</p>
      <button className="secondary-button" onClick={() => void load(true)}>
        <RefreshCw size={14}/> {t("Noch einmal")}
      </button>
    </div>;
  }

  const limits = schema.limits;

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div>
        <span>{t("TABELLEN IM SCHEMA")}</span>
        <strong>{formatNumber(schema.types.length)}</strong>
        <small>{t("aus dem Katalog von")} {schema.schema}</small>
      </div>
      <div>
        <span>{t("TIEFE")}</span>
        <strong>{formatNumber(limits.maxDepth)}</strong>
        <small>{t("Tabelle und Spalten")}</small>
      </div>
      <div>
        <span>{t("FELDER JE ABFRAGE")}</span>
        <strong>{formatNumber(limits.maxFields)}</strong>
        <small>{t("Aliasse zählen mit")}</small>
      </div>
    </article>

    <article className="console-card span-2">
      <div className="card-head">
        <div><span>{t("INTEGRATIONEN")} · {environment.toUpperCase()}</span>
          <h3>{t("GraphQL über dem Projektschema, lesend")}</h3></div>
        <div>
          <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing || running}>
            <RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")}
              variants={tAll("Lädt…", "Neu laden")}/>
          </button>
        </div>
      </div>
      <p className="muted">{t(GRAPHQL_WHAT)}</p>
      <p className="muted">{t(GRAPHQL_NO_MUTATIONS)}</p>
      <p className="muted">{t(GRAPHQL_SAME_PATH)}</p>
      <p className="muted">{t(GRAPHQL_OWN_PARSER)}</p>
      <div className="log-row">
        <span className="secure"><ShieldCheck size={15}/> {t("Jede Abfrage läuft unter der Zeilensicherheit des Aufrufers.")}</span>
        <small>{t(GRAPHQL_CONSOLE_ROLE)}</small>
      </div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("ABFRAGE")}</span>
        <h3>{t("Eine Abfrage, hier ausgeführt")}</h3></div><Braces size={18}/></div>
      <textarea value={query} spellCheck={false} maxLength={limits.maxQueryBytes}
        aria-label={t("GraphQL-Abfrage")}
        onChange={(event) => { setQuery(event.target.value); setRefusal(""); }}/>
      <div className="card-head">
        <div><span className="muted">{t(GRAPHQL_NO_HISTORY)}</span></div>
        <div>
          <button className="button small" type="button" onClick={() => void run()}
            disabled={running || query.trim() === ""}>
            <Play size={13}/> <StableLabel current={running ? t("Läuft…") : t("Abfrage ausführen")}
              variants={tAll("Läuft…", "Abfrage ausführen")}/>
          </button>
        </div>
      </div>
      {refusal && <p className="risk medium">{refusal}</p>}
    </article>

    {result !== null && <article className="console-card span-2">
      <div className="card-head"><div><span>{t("ERGEBNIS")}</span>
        <h3>{result.operationName ?? t("Ohne Namen")}</h3></div></div>
      <div className="detail-list">
        <div><span>{t("Gezählte Felder")}</span><strong>{formatNumber(result.fieldCount)}</strong></div>
        <div><span>{t("Zugesagte Zeilen")}</span><strong>{formatNumber(result.rowBudget)}</strong></div>
        <div><span>{t("Lesungen")}</span><strong>{formatNumber(result.fields.length)}</strong></div>
      </div>
      <div className="log-row log-header">
        <span>{t("Feld")}</span><span>{t("Tabelle")}</span><span>{t("Zeilen")}</span><span>{t("Weitere")}</span>
      </div>
      {result.fields.map((field) => <div className="log-row" key={field.responseKey}>
        <code>{field.responseKey}</code>
        <code>{field.table}</code>
        <span>{formatNumber(field.rowCount)}</span>
        <span className="muted">{field.hasMore ? t("ja, weiter mit after") : t("nein")}</span>
      </div>)}
      <pre>{JSON.stringify(result.data, null, 2)}</pre>
    </article>}

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("SCHEMA")}</span>
        <h3>{t("Aus dem Katalog, bei jeder Anfrage neu")}</h3></div></div>
      <p className="muted">{t(GRAPHQL_SCHEMA_FROM_CATALOG)}</p>
      <p className="muted">{t(GRAPHQL_SCHEMA_OMISSIONS)}</p>
      <p className="muted">{t(GRAPHQL_SCHEMA_NOT_PER_CALLER)}</p>
      {schema.types.length === 0 && <p className="risk medium">
        {t("Keine Tabelle dieses Schemas erfüllt die Bedingungen. Ohne Zeilensicherheit und ohne Primärschlüssel gibt es hier nichts zu lesen.")}
      </p>}
      <pre>{schema.sdl}</pre>
    </article>

    {schema.types.length > 0 && <article className="console-card span-2">
      <div className="card-head"><div><span>{t("SPALTEN")}</span>
        <h3>{t("Welcher Skalar aus welchem Typ wird")}</h3></div></div>
      <div className="log-row log-header">
        <span>{t("Tabelle")}</span><span>{t("Spalte")}</span><span>{t("GraphQL")}</span><span>{t("PostgreSQL")}</span>
      </div>
      {schema.types.flatMap((type) => type.fields.map((field) => <div className="log-row" key={`${type.name}.${field.name}`}>
        <code>{type.name}</code>
        <code>{field.name}{field.primaryKey ? " ·" : ""}</code>
        <span>{field.type}{field.nullable ? "" : "!"}</span>
        <small className="muted">{field.dataType}</small>
      </div>))}
      <small className="muted">
        {t("bigint und numeric werden String: Eine Zahl in JSON verliert oberhalb von 2^53 die Genauigkeit, und ein Int im Schema wäre dann eine Zusage, die die Antwort nicht hält.")}
      </small>
    </article>}

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("GRENZEN")}</span>
        <h3>{t("Was eine einzelne Abfrage höchstens darf")}</h3></div><ShieldCheck className="secure" size={18}/></div>
      <p className="muted">{t(GRAPHQL_WHY_LIMITS)}</p>
      <div className="detail-list">
        <div><span>{t("Tiefe")}</span><strong>{formatNumber(limits.maxDepth)}</strong></div>
        <div><span>{t("Felder je Abfrage")}</span><strong>{formatNumber(limits.maxFields)}</strong></div>
        <div><span>{t("Tabellen je Abfrage")}</span><strong>{formatNumber(limits.maxTables)}</strong></div>
        <div><span>{t("Zeilen je Feld")}</span><strong>{formatNumber(limits.maxRowsPerField)}</strong></div>
        <div><span>{t("Zeilen je Abfrage")}</span><strong>{formatNumber(limits.maxRowsPerQuery)}</strong></div>
        <div><span>{t("Zeilen ohne Angabe")}</span><strong>{formatNumber(limits.defaultRowsPerField)}</strong></div>
        <div><span>{t("Filter je Feld")}</span><strong>{formatNumber(limits.maxFiltersPerField)}</strong></div>
        <div><span>{t("Zeichen der Abfrage")}</span><strong>{formatNumber(limits.maxQueryBytes)}</strong></div>
      </div>
      <p className="muted">{t(GRAPHQL_LIMIT_DEPTH)}</p>
      <p className="muted">{t(GRAPHQL_LIMIT_FIELDS)}</p>
      <p className="muted">{t(GRAPHQL_LIMIT_ROWS)}</p>
      <p className="muted">{t(GRAPHQL_SEQUENTIAL)}</p>
      <p className="muted">{t(GRAPHQL_NO_INTROSPECTION)}</p>
      <p className="muted">{t(GRAPHQL_NO_COST_ESTIMATE)}</p>
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("KENNT")}</span>
        <h3>{t("Der Ausschnitt der Sprache")}</h3></div></div>
      {schema.grammar.accepted.map((entry) => <div className="log-row" key={entry}>
        <span className="secure">{entry}</span>
        <small>{t(GRAPHQL_ACCEPTED_TEXTS[entry as keyof typeof GRAPHQL_ACCEPTED_TEXTS] ?? entry)}</small>
      </div>)}
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("KENNT NICHT")}</span>
        <h3>{t("Was bewusst fehlt")}</h3></div></div>
      {schema.grammar.refused.map((entry) => <div className="log-row" key={entry}>
        <span className="muted">{entry}</span>
        <small>{t(GRAPHQL_REFUSED_TEXTS[entry as keyof typeof GRAPHQL_REFUSED_TEXTS] ?? entry)}</small>
      </div>)}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("ARGUMENTE")}</span>
        <h3>{t("Was an einem Tabellenfeld steht")}</h3></div></div>
      {limits.arguments.map((name) => <div className="log-row" key={name}>
        <code>{name}</code>
        <small>{t(GRAPHQL_ARGUMENT_TEXTS[name] ?? name)}</small>
      </div>)}
      <p className="muted">{t(GRAPHQL_PAGE_READ_ONLY)}</p>
    </article>
  </div>;
}
