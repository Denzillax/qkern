"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Columns3, Plus, RefreshCw, ShieldCheck, Table2, X } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { OptionMenu } from "@/components/console/option-menu";
import { StableLabel } from "@/components/stable-label";
import {
  addColumnStatement,
  createTableStatement,
  MAX_NEW_TABLE_COLUMNS,
  renameTableStatement,
  TABLE_COLUMN_DEFAULTS,
  TABLE_COLUMN_TYPES,
  TABLE_SCHEMA,
  TableChangeSetError,
  type NewColumn,
  type TableColumnDefaultId,
  type TableColumnTypeId,
} from "@/lib/console/table-change-sets";

/**
 * Der Tabellen-Designer (2.49), wie bei Supabase unter Database → Tables, mit
 * einem Unterschied, der den ganzen Slice traegt: Diese Ansicht veraendert keine
 * Datenbank.
 *
 * Sie liest das Schema `public` ueber dieselbe Route wie der
 * Schema-Visualizer, laesst einen Entwurf zusammenstellen, zeigt die eine
 * daraus erzeugte SQL-Anweisung **vollstaendig** an und uebergibt sie danach
 * der bestehenden Route `POST /api/v1/changesets`. Was dann passiert,
 * entscheidet die Freigabezentrale; angewendet wird ausschliesslich vom
 * Migrationsprozess.
 *
 * Die Anweisung selbst entsteht in `lib/console/table-change-sets`, einem
 * reinen Modul mit festen Listen fuer Typ und Vorgabewert. In dieser Datei
 * steht kein SQL-Text; sie kann darum auch keinen erzeugen, der nicht durch
 * die Pruefung des Moduls gegangen ist.
 *
 * Drei Aenderungen, mehr nicht: anlegen, umbenennen, Spalte ergaenzen.
 * Loeschen und Typaenderungen fehlen absichtlich. Sie verlieren Daten, und ein
 * erster schreibender Slice ist der falsche Ort dafuer.
 */
type Environment = "development" | "staging" | "production";
type SchemaColumn = { name: string; dataType: string; nullable: boolean };
type SchemaTable = { name: string; kind: string; columns: SchemaColumn[] };
type State = "loading" | "ready" | "unavailable" | "error";
type Mode = "create" | "rename" | "addColumn";
type Payload = Record<string, unknown>;

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

const EMPTY_COLUMN: NewColumn = { name: "", type: "text", notNull: false, default: "none" };

const TYPE_IDS = Object.keys(TABLE_COLUMN_TYPES) as TableColumnTypeId[];

/** Welche Vorgaben zu diesem Typ passen; die Liste steht im reinen Modul. */
function defaultsFor(type: TableColumnTypeId): readonly TableColumnDefaultId[] {
  return TABLE_COLUMN_TYPES[type]?.defaults ?? ["none"];
}

/**
 * Die Eintraege der beiden Spaltenmenues (2.133).
 *
 * Die Erklaerzeile traegt den SQL-Text und nicht eine Wiederholung des Titels:
 * "Zeitpunkt mit Zeitzone" sagt, was gemeint ist, `timestamptz` sagt, was in
 * der Anweisung steht. Beides zusammen beantwortet die Frage, die man vor so
 * einem Feld wirklich hat.
 */
function typeOptions() {
  return TYPE_IDS.map((type) => ({
    id: type, label: t(TABLE_COLUMN_TYPES[type].label), hint: TABLE_COLUMN_TYPES[type].sql,
  }));
}

function defaultOptions(type: TableColumnTypeId) {
  return defaultsFor(type).map((fallback) => ({
    id: fallback,
    label: t(TABLE_COLUMN_DEFAULTS[fallback].label),
    // Prosa wird uebersetzt, SQL nicht: `now()` heisst in jeder Sprache `now()`.
    hint: TABLE_COLUMN_DEFAULTS[fallback].hint
      ? t(TABLE_COLUMN_DEFAULTS[fallback].hint)
      : TABLE_COLUMN_DEFAULTS[fallback].sql ?? undefined,
  }));
}

export function TableDesignerView({ projectId, environment, table, navigate, reload, initialState }: {
  projectId: string;
  environment: Environment;
  /**
   * Die Tabelle, um die es geht (2.138).
   *
   * Ohne diese Requisite bleibt die Ansicht, was sie war: der Menuepunkt
   * Datenbank → Tabellen mit allen drei Aenderungen und der Liste des ganzen
   * Schemas. Mit ihr ist sie der Reiter "Struktur" einer einzelnen Tabelle:
   * Die Tabelle steht fest, die Art der Aenderung ist "Spalte ergaenzen", und
   * was darueber hinausgeht, liegt hinter "Erweitert". Verloren geht dabei
   * nichts; es ist einen Klick weiter.
   */
  table?: string;
  navigate: (view: "approvals") => void;
  reload: () => Promise<void>; initialState?: State }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}`;
  const [state, setState] = useState<State>(initialState ?? "loading");
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null);

  // Mit vorgegebener Tabelle ist "anlegen" die falsche Vorgabe: Die Tabelle
  // gibt es ja schon, sonst waere man nicht in ihrem Reiter.
  const [mode, setMode] = useState<Mode>(table ? "addColumn" : "create");
  const [advanced, setAdvanced] = useState(false);
  const [newTable, setNewTable] = useState("");
  const [newColumns, setNewColumns] = useState<NewColumn[]>([{ ...EMPTY_COLUMN, name: "id", type: "uuid", notNull: true, default: "uuid" }]);
  const [sourceTable, setSourceTable] = useState("");
  const [renamed, setRenamed] = useState("");
  const [addedColumn, setAddedColumn] = useState<NewColumn>({ ...EMPTY_COLUMN });

  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");

  // Jede Ladung hat einen eigenen AbortController; eine abgebrochene setzt keinen Zustand mehr.
  const load = useCallback(async (initial: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (initial) setState("loading"); else setRefreshing(true);
    const schema = await readJson(`${base}/schema?schema=${TABLE_SCHEMA}`, controller.signal);
    if (controller.signal.aborted) return;
    setRefreshing(false);
    if (schema.status === 503 || schema.status === 409) {
      setMessage(typeof schema.payload.error === "string" && schema.payload.error ? (serverErrorText(schema.payload.error) ?? "") : t("Die Projektdatenbank ist noch nicht bereit."));
      setState("unavailable");
      return;
    }
    const data = schema.payload.data as { tables?: unknown } | undefined;
    if (schema.status === 200 && data && Array.isArray(data.tables)) {
      const list = data.tables as SchemaTable[];
      setTables(list);
      // Eine vorgegebene Tabelle gewinnt gegen jede Wahl aus der Liste; sonst
      // wuerde der Reiter einer Tabelle den Entwurf einer anderen zeigen.
      setSourceTable((current) => (table ? table : current && list.some((item) => item.name === current) ? current : list[0]?.name ?? ""));
      setState("ready");
      return;
    }
    setMessage(typeof schema.payload.error === "string" ? (serverErrorText(schema.payload.error) ?? "") : t("Tabellen nicht verfügbar"));
    setState("error");
  }, [base, table]);

  useEffect(() => {
    void load(true);
    return () => request.current?.abort();
  }, [load]);

  // Der Entwurf wird bei jeder Eingabe neu gerechnet. Was hier steht, ist
  // genau das, was spaeter im Change Set liegt; es gibt keinen zweiten Weg.
  const preview = useMemo<{ statement: string; reason: string }>(() => {
    try {
      if (mode === "create") return { statement: createTableStatement({ table: newTable, columns: newColumns }), reason: "" };
      if (mode === "rename") return { statement: renameTableStatement({ table: sourceTable, newName: renamed }), reason: "" };
      return { statement: addColumnStatement({ table: sourceTable, column: addedColumn }), reason: "" };
    } catch (error) {
      return { statement: "", reason: error instanceof TableChangeSetError ? t(error.reason) : t("Aus dieser Eingabe lässt sich keine Änderung bauen.") };
    }
  }, [mode, newTable, newColumns, sourceTable, renamed, addedColumn]);

  function title(): string {
    if (mode === "create") return `${t("Tabelle anlegen")}: ${newTable}`;
    if (mode === "rename") return `${t("Tabelle umbenennen")}: ${sourceTable}`;
    return `${t("Spalte ergänzen")}: ${sourceTable}`;
  }

  /** Der einzige schreibende Aufruf dieser Ansicht: die bestehende Change-Set-Route. */
  async function submit() {
    if (!preview.statement) return;
    setSubmitting(true);
    setSubmitMessage("");
    try {
      const response = await fetch("/api/v1/changesets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, environment, title: title(), statement: preview.statement }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const detail = body && typeof body === "object" && typeof (body as Payload).message === "string" ? String((body as Payload).message) : "";
        setSubmitMessage(detail || t("Das Change Set konnte nicht erstellt werden."));
        return;
      }
      setCreated(true);
      await reload();
    } finally {
      setSubmitting(false);
    }
  }

  function patchColumn(index: number, patch: Partial<NewColumn>) {
    setCreated(false);
    setNewColumns((columns) => columns.map((column, position) => {
      if (position !== index) return column;
      const merged = { ...column, ...patch };
      // Ein Typwechsel kann einen Vorgabewert ungueltig machen; dann faellt er zurueck.
      if (!defaultsFor(merged.type).includes(merged.default)) merged.default = "none";
      return merged;
    }));
  }

  function patchAdded(patch: Partial<NewColumn>) {
    setCreated(false);
    setAddedColumn((column) => {
      const merged = { ...column, ...patch };
      if (!defaultsFor(merged.type).includes(merged.default)) merged.default = "none";
      return merged;
    });
  }

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Tabellen werden geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><Table2 size={26}/>
    <h3>{state === "unavailable" ? t("Datenbank nicht bereit") : t("Tabellen nicht verfügbar")}</h3>
    <p>{message}</p>
    <button className="secondary-button" onClick={() => void load(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button>
  </div>;

  const current = tables.find((entry) => entry.name === sourceTable);
  // 2.138: Hinter "Erweitert" liegt alles, was ueber diese eine Tabelle
  // hinausgeht: die Zahlen des ganzen Schemas, die Liste aller Tabellen, der
  // Satz ueber den Weg einer Aenderung und die zwei anderen Aenderungsarten.
  // Ohne vorgegebene Tabelle steht weiter alles offen da; der Aufklapper ist
  // dann nicht nur zu, er gibt es nicht.
  const pinned = table !== undefined && table !== "";
  const wide = !pinned || advanced;

  return <div className="module-grid">
    {pinned && <article className="console-card span-2 table-structure-advanced">
      <button className="ghost-button" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
        {advanced ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
        <StableLabel current={advanced ? t("Erweitert schliessen") : t("Erweitert")} variants={tAll("Erweitert schliessen", "Erweitert")}/>
      </button>
      <p className="muted">{t("Dahinter liegen die Zahlen des ganzen Schemas, die Liste aller Tabellen und die beiden Änderungen, die nicht diese eine Tabelle betreffen: eine Tabelle anlegen und eine Tabelle umbenennen.")}</p>
    </article>}

    {wide && <article className="console-card auth-overview">
      <div><span>{t("TABELLEN")}</span><strong>{tables.length}</strong><small>{t("im Schema public")}</small></div>
      <div><span>{t("SPALTEN")}</span><strong>{tables.reduce((sum, table) => sum + table.columns.length, 0)}</strong><small>{t("über alle Tabellen")}</small></div>
      <div><span>{t("ANGEWENDET VON HIER")}</span><strong>0</strong><small>{t("diese Ansicht wendet nie an")}</small></div>
    </article>}

    {wide && <article className="console-card span-2">
      <div className="card-head"><div><span>{t("SCHREIBEND ÜBER FREIGABE")}</span><h3>{t("Was hier passiert und was nicht")}</h3></div><ShieldCheck size={18}/></div>
      <p className="muted">{t("Aus einem Entwurf wird eine einzelne SQL-Anweisung. Sie steht unten vollständig, bevor irgendetwas abgeschickt wird. Abgeschickt wird sie an die Freigabe, als Change Set.")}</p>
      <p className="muted">{t("Angewendet wird nichts, solange das Change Set nicht freigegeben ist. Die Freigabe geschieht in der Freigabezentrale, und erst danach wendet der Migrationsprozess die Anweisung in der Projektdatenbank an.")}</p>
      <p className="muted">{t("Drei Änderungen kann der Designer: eine Tabelle anlegen, eine Tabelle umbenennen, einer Tabelle eine Spalte geben. Tabellen oder Spalten entfernen kann er nicht, und den Typ einer bestehenden Spalte ändern auch nicht. Für diese Schritte gibt es in dieser Ansicht keinen Weg; sie verlieren Daten und gehören in einen eigenen, geprüften Ablauf.")}</p>
      <button className="secondary-button" onClick={() => navigate("approvals")}><ShieldCheck size={14}/> {t("Freigabezentrale öffnen")}</button>
    </article>}

    {wide && <article className="console-card span-2">
      <div className="card-head"><div><span>{t("SCHEMA")} · {environment.toUpperCase()}</span><h3>{t("Tabellen im Schema public")}</h3></div><div>
        <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
      </div></div>
      {tables.length === 0 && <p className="muted">{t("Dieses Schema hat noch keine Tabellen")}</p>}
      {tables.map((table) => <div className="bucket-row" key={table.name}>
        <span className="bucket-icon"><Table2 size={16}/></span>
        <div className="row-text">
          <strong>{table.name}</strong>
          <small>{table.columns.map((column) => `${column.name} ${column.dataType}${column.nullable ? "" : " *"}`).join(" · ") || t("keine Spalten")}</small>
        </div>
        {/* Die blanke Zahl stand ohne Wort da und sass in der dritten von vier
            Rasterspalten, also weder am Text noch am Rand. Gelesen wurde sie
            als Zeilenzahl; gemeint sind Spalten. */}
        <span className="muted row-trailing">{table.columns.length === 1
          ? t("1 Spalte")
          : `${table.columns.length} ${t("Spalten")}`}</span>
      </div>)}
    </article>}

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("ENTWURF")}</span><h3>{t("Eine Änderung vorbereiten")}</h3></div>
        {/* Dasselbe Bauteil wie das Umgebungsmenue oben in der Kopfzeile, nur
            ohne Zustandspunkt: ein `select` zeichnet das Betriebssystem, und
            auf Windows sieht das neben dieser Oberflaeche aus wie aus einem
            anderen Jahrzehnt. Die Erklaerzeile je Eintrag sagt, was die Wahl
            bedeutet, statt den Titel zu wiederholen. */}
        {wide && <OptionMenu value={mode} ariaLabel={t("Art der Änderung")} listLabel={t("Art der Änderung wählen")}
          icon={<Columns3 size={14} aria-hidden="true"/>}
          onChange={(next) => { setMode(next); setCreated(false); setSubmitMessage(""); }}
          options={[
            { id: "create" as Mode, label: t("Tabelle anlegen"), hint: t("Eine neue Tabelle mit ihren Spalten") },
            { id: "rename" as Mode, label: t("Tabelle umbenennen"), hint: t("Nur der Name, die Daten bleiben") },
            { id: "addColumn" as Mode, label: t("Spalte ergänzen"), hint: t("Eine Spalte an eine bestehende Tabelle") },
          ]}/>}
      </div>

      <div className="settings-form">
        {mode === "create" && <>
          <label>{t("Name der Tabelle")}
            <input value={newTable} onChange={(event) => { setNewTable(event.target.value); setCreated(false); }} spellCheck={false} placeholder="kunden"/>
          </label>
          {newColumns.map((column, index) => <div className="bucket-row column-draft" key={index}>
            <span className="bucket-icon"><Columns3 size={16}/></span>
            <div className="draft-fields">
              <input value={column.name} onChange={(event) => patchColumn(index, { name: event.target.value })} aria-label={t("Name der Spalte")} spellCheck={false} placeholder="name"/>
              {/* Dasselbe Menue wie oben, mit dem SQL-Text als Erklaerzeile:
                  "Zeitpunkt mit Zeitzone" sagt, was man meint, `timestamptz`
                  sagt, was in der Anweisung landet. */}
              <OptionMenu value={column.type} ariaLabel={t("Typ der Spalte")} listLabel={t("Typ der Spalte wählen")}
                align="left" onChange={(next) => patchColumn(index, { type: next })} options={typeOptions()}/>
              <OptionMenu value={column.default} ariaLabel={t("Vorgabewert der Spalte")} listLabel={t("Vorgabewert der Spalte wählen")}
                align="left" onChange={(next) => patchColumn(index, { default: next })} options={defaultOptions(column.type)}/>
              <label><input type="checkbox" checked={column.notNull} onChange={(event) => patchColumn(index, { notNull: event.target.checked })}/> {t("darf nicht leer sein (NOT NULL)")}</label>
            </div>
            <button className="plain-button row-trailing" onClick={() => { setCreated(false); setNewColumns((columns) => columns.filter((_item, position) => position !== index)); }} aria-label={t("Spalte aus dem Entwurf nehmen")} disabled={newColumns.length <= 1}><X size={14}/></button>
          </div>)}
          <button className="secondary-button" onClick={() => { setCreated(false); setNewColumns((columns) => [...columns, { ...EMPTY_COLUMN }]); }} disabled={newColumns.length >= MAX_NEW_TABLE_COLUMNS}><Plus size={14}/> {t("Spalte im Entwurf ergänzen")}</button>
        </>}

        {/* Das letzte `select` dieser Ansicht. Die Erklaerzeile ist die Zahl der
            Spalten: Sie steht in `tables` schon da, sie unterscheidet zwei
            gleich aussehende Namen, und vor "Spalte ergaenzen" ist sie genau
            die Frage. Dieselben Worte wie in der Liste darueber. */}
        {mode !== "create" && pinned && <p className="muted">{t("Bestehende Tabelle")}: <code>{sourceTable}</code></p>}
        {mode !== "create" && !pinned && <label>{t("Bestehende Tabelle")}
          <OptionMenu value={sourceTable} ariaLabel={t("Bestehende Tabelle")} listLabel={t("Bestehende Tabelle wählen")}
            align="left" onChange={(next) => { setSourceTable(next); setCreated(false); }}
            options={tables.map((table) => ({
              id: table.name,
              label: table.name,
              hint: table.columns.length === 1 ? t("1 Spalte") : `${table.columns.length} ${t("Spalten")}`,
            }))}/>
        </label>}

        {mode === "rename" && <label>{t("Neuer Name")}
          <input value={renamed} onChange={(event) => { setRenamed(event.target.value); setCreated(false); }} spellCheck={false} placeholder="kundschaft"/>
        </label>}

        {mode === "addColumn" && <>
          <label>{t("Name der Spalte")}
            <input value={addedColumn.name} onChange={(event) => patchAdded({ name: event.target.value })} spellCheck={false} placeholder="notiz"/>
          </label>
          <label>{t("Typ der Spalte")}
            <OptionMenu value={addedColumn.type} ariaLabel={t("Typ der Spalte")} listLabel={t("Typ der Spalte wählen")}
              align="left" onChange={(next) => patchAdded({ type: next })} options={typeOptions()}/>
          </label>
          <label>{t("Vorgabewert der Spalte")}
            <OptionMenu value={addedColumn.default} ariaLabel={t("Vorgabewert der Spalte")} listLabel={t("Vorgabewert der Spalte wählen")}
              align="left" onChange={(next) => patchAdded({ default: next })} options={defaultOptions(addedColumn.type)}/>
          </label>
          <label><input type="checkbox" checked={addedColumn.notNull} onChange={(event) => patchAdded({ notNull: event.target.checked })}/> {t("darf nicht leer sein (NOT NULL)")}</label>
          {current && <p className="muted">{t("Diese Tabelle hat schon")} {current.columns.length} {t("Spalten.")}</p>}
        </>}
      </div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("VORSCHAU")}</span><h3>{t("Genau diese Anweisung geht ins Change Set")}</h3></div><ShieldCheck size={18}/></div>
      {preview.statement
        ? <pre>{preview.statement}</pre>
        : <p className="muted">{preview.reason || t("Der Entwurf ist noch nicht vollständig.")}</p>}
      <p className="muted">{t("Eine Anweisung je Change Set. Der Titel, unter dem sie in der Freigabezentrale erscheint:")} {title()}</p>
      <button className="button" onClick={() => void submit()} disabled={!preview.statement || submitting}>
        <StableLabel current={submitting ? t("Wird eingereicht…") : t("Change Set erstellen")} variants={tAll("Wird eingereicht…", "Change Set erstellen")}/>
      </button>
      {submitMessage && <p className="risk high">{submitMessage}</p>}
      {created && <div className="inline-success"><ShieldCheck size={14}/> {t("Change Set erstellt. Angewendet ist nichts.")} <button onClick={() => navigate("approvals")}>{t("Freigabezentrale öffnen")}</button></div>}
    </article>
  </div>;
}
