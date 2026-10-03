"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Braces, Columns3, KeyRound, RefreshCw, ShieldCheck, Table2, UserCog } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { OptionMenu } from "@/components/console/option-menu";
import { StableLabel } from "@/components/stable-label";
import { CopyButton } from "@/components/docs/copy-button";
import { TableView } from "@/components/console/table-view";
import { TableDesignerView } from "@/components/console/table-designer-view";
import { SchemaVisualizerView } from "@/components/console/schema-visualizer-view";
import { PoliciesView } from "@/components/console/policies-view";
import { ColumnPrivilegesView } from "@/components/console/column-privileges-view";
import { RolesView } from "@/components/console/roles-view";
import {
  tableCurlExample,
  tableRestExample,
  tableRowsQuery,
  tableSdkExample,
} from "@/lib/console/table-api-examples";

/**
 * Der Arbeitsplatz einer Tabelle (2.138).
 *
 * **Warum es ihn gibt.** Wer eine Tabelle offen hatte, musste fuer ihre
 * Spalten nach Datenbank → Tabellen, fuer ihre Beziehungen nach
 * Datenbank → Schema, fuer ihre Regeln nach Datenbank → Policies, fuer die
 * Rechte je Spalte nach Datenbank → Spaltenrechte und fuer ein Beispiel nach
 * API. Fuenf Hauptbereiche fuer eine Frage ueber ein Ding.
 *
 * **Was er ist.** Eine duenne Huelle. Jeder Reiter zeigt eine Ansicht, die es
 * schon gibt, und gibt ihr die gewaehlte Tabelle mit; keine dieser Ansichten
 * wurde kopiert, und jede funktioniert weiter ohne Tabelle, so wie sie heute
 * ueber das Menue aufgerufen wird. Was diese Datei selbst zeigt, ist genau
 * das, was keine der fuenf heute zeigt: die Spalten einer Tabelle mit ihrem
 * Primaerschluessel, die Begriffe der Sicherheit in einem Satz, und die drei
 * Beispiele, mit denen man diese Tabelle von aussen anspricht.
 *
 * **Zwei Lesungen, beide bestehend.** `/schema?schema=public` liefert
 * Tabellen, Spalten und den RLS-Stand; `/schema/indexes?schema=public`
 * liefert, welche Spalten den Primaerschluessel bilden. Der Primaerschluessel
 * steht **nicht** in der Schema-Route, und darum steht er hier nicht aus ihr.
 * Nachgelesen wird nichts, was eine Route nicht hergibt: Den Vorgabewert einer
 * bestehenden Spalte liefert keine der beiden, also behauptet der Reiter
 * "Struktur" ihn auch nicht.
 *
 * **Keine neue Route und kein neuer Pfad.** Die Console ist eine Seite mit
 * einem `view`-Zustand; dieser Arbeitsplatz ist eine Ansicht darin wie jede
 * andere.
 */
type Environment = "development" | "staging" | "production";
type State = "loading" | "ready" | "unavailable" | "error";
type Payload = Record<string, unknown>;
type Tab = "data" | "structure" | "relations" | "security" | "api";

type SchemaColumn = { name: string; dataType: string; nullable: boolean; identity: boolean; generated: boolean; sensitive: boolean };
type SchemaTable = { name: string; kind: string; rowSecurityEnabled: boolean; columns: SchemaColumn[]; truncated: boolean };
type SchemaIndex = { name: string; table: string; primary: boolean; unique: boolean; columns: string[] };

/** Wie in den anderen Katalogansichten der Console: gelesen wird `public`. */
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

/**
 * Die fuenf Reiter, in der Reihenfolge, in der man eine Tabelle kennenlernt:
 * erst was drinsteht, dann wie sie gebaut ist, dann woran sie haengt, dann wer
 * darf, dann wie man sie von aussen anspricht.
 */
const TABS: ReadonlyArray<Tab> = ["data", "structure", "relations", "security", "api"];

/** Die Beschriftung eines Reiters. Jede steht als eigener `t`-Aufruf da, damit der Uebersetzungsvertrag sie findet. */
function tabLabel(tab: Tab): string {
  if (tab === "data") return t("Daten");
  if (tab === "structure") return t("Struktur");
  if (tab === "relations") return t("Beziehungen");
  if (tab === "security") return t("Sicherheit");
  return t("API");
}

export function TableWorkspaceView({ projectId, environment, navigate, reload, initialState }: {
  projectId: string;
  environment: Environment;
  /** Der Reiter "Struktur" reicht sie an den Designer weiter, der in die Freigabezentrale verweist. */
  navigate: (view: "approvals") => void;
  /** Dasselbe: nach einem erstellten Change Set laedt die Schale neu. */
  reload: () => Promise<void>;
  initialState?: State;
}) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}`;
  const [state, setState] = useState<State>(initialState ?? "loading");
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [indexes, setIndexes] = useState<SchemaIndex[]>([]);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState("");
  const [tab, setTab] = useState<Tab>("data");
  // Die Adresse dieser Console kennt erst der Browser. Vor dem ersten Effekt
  // steht im Beispiel darum eine sichtbare Luecke und keine erfundene Adresse.
  const [origin, setOrigin] = useState("");
  const request = useRef<AbortController | null>(null);

  // Jede Ladung hat einen eigenen AbortController; eine abgebrochene setzt
  // keinen Zustand mehr.
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState("loading");
    setMessage("");
    const [schema, keys] = await Promise.all([
      readJson(`${base}/schema?schema=${SCHEMA}`, controller.signal),
      readJson(`${base}/schema/indexes?schema=${SCHEMA}`, controller.signal),
    ]);
    if (controller.signal.aborted) return;
    for (const result of [schema, keys]) {
      if (result.status === 503 || result.status === 409) {
        setMessage(typeof result.payload.error === "string" && result.payload.error ? (serverErrorText(result.payload.error) ?? "") : t("Die Projektdatenbank ist noch nicht bereit."));
        setState("unavailable");
        return;
      }
    }
    const schemaData = schema.payload.data as { tables?: unknown } | undefined;
    const indexData = keys.payload.data as { indexes?: unknown } | undefined;
    if (schema.status === 200 && keys.status === 200 && schemaData && indexData &&
        Array.isArray(schemaData.tables) && Array.isArray(indexData.indexes)) {
      const list = schemaData.tables as SchemaTable[];
      setTables(list);
      setIndexes(indexData.indexes as SchemaIndex[]);
      // Eine Wahl, die es noch gibt, bleibt stehen; sonst die erste Tabelle.
      setSelected((current) => (current && list.some((entry) => entry.name === current) ? current : list[0]?.name ?? ""));
      setState("ready");
      return;
    }
    const error = [schema, keys].map((result) => result.payload.error).find((value) => typeof value === "string" && value);
    setMessage(typeof error === "string" ? error : t("Die Tabelle konnte nicht gelesen werden."));
    setState("error");
  }, [base]);

  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
    return () => request.current?.abort();
  }, [load]);

  const current = useMemo(() => tables.find((entry) => entry.name === selected), [tables, selected]);
  const primaryKey = useMemo(() => {
    const index = indexes.find((entry) => entry.table === selected && entry.primary);
    return new Set(index?.columns ?? []);
  }, [indexes, selected]);

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Tabellen werden geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><Table2 size={26}/>
    <h3>{state === "unavailable" ? t("Datenbank nicht bereit") : t("Die Tabelle konnte nicht gelesen werden.")}</h3>
    <p>{message}</p>
    <button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button>
  </div>;

  const target = { baseUrl: origin, projectId, environment, table: selected, schema: SCHEMA };
  const copyLabels = { copy: t("Kopieren"), copied: t("Kopiert") };

  return <div className="module-grid">
    <article className="console-card span-2 table-workspace-head">
      <div className="card-head">
        <div><span>{t("TABELLE")} · {environment.toUpperCase()}</span><h3>{selected ? `${SCHEMA}.${selected}` : t("Keine Tabelle gewählt")}</h3></div>
        <div>
          <OptionMenu value={selected} ariaLabel={t("Tabelle")} listLabel={t("Tabelle wählen")} align="right"
            icon={<Table2 size={14} aria-hidden="true"/>}
            onChange={(next) => setSelected(next)}
            options={tables.map((entry) => ({
              id: entry.name,
              label: entry.name,
              // Die Erklaerzeile sagt, was vor der Wahl die Frage ist: wie breit
              // die Tabelle ist und ob die Daten-API sie ueberhaupt hergibt. Der
              // Reiter "Daten" liest ueber die generierte Daten-API, und die
              // verlangt Row Level Security; ohne sie steht dort gleich ein
              // Fehler, und das soll vorher zu sehen sein.
              hint: `${entry.columns.length === 1 ? t("1 Spalte") : `${entry.columns.length} ${t("Spalten")}`}${entry.rowSecurityEnabled ? "" : ` · ${t("ohne Row Level Security")}`}`,
            }))}/>
          <button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> <StableLabel current={t("Neu laden")} variants={tAll("Neu laden")}/></button>
        </div>
      </div>
      {/* Ein leerer Zustand sagt, was hier erscheinen wird, und nicht nur,
          dass nichts da ist. Der Weg dahin steht daneben: Angelegt werden
          Tabellen im Reiter Struktur, und der braucht keine Wahl. */}
      {tables.length === 0 && <p className="muted">{t("Im Schema public steht noch keine Tabelle. Sobald eine angelegt ist, steht sie in diesem Menü und ihre Datensätze, Spalten und Beziehungen stehen darunter.")}</p>}
      {/* Ehrlich vor dem ersten Klick: Der Reiter "Daten" liest ueber die
          generierte Daten-API, und die zeigt nur Tabellen mit Row Level
          Security. Die anderen vier Reiter lesen den Katalog und arbeiten
          auch ohne. */}
      {current?.rowSecurityEnabled === false && <p className="muted">{t("Diese Tabelle hat keine Row Level Security. Die Reiter Struktur, Beziehungen, Sicherheit und API lesen den Katalog und zeigen sie trotzdem; der Reiter Daten liest über die generierte Daten-API, und die gibt nur Tabellen mit Row Level Security her.")}</p>}
      {/* Die Reiter sind Knoepfe und keine Verweise: Die Console ist eine Seite
          mit einem Zustand, und ein Reiter wechselt diesen Zustand. */}
      <div className="table-workspace-tabs" role="tablist" aria-label={t("Bereiche dieser Tabelle")}>
        {TABS.map((entry) => <button key={entry} type="button" role="tab"
          aria-selected={tab === entry}
          className={tab === entry ? "active" : undefined}
          onClick={() => setTab(entry)}>{tabLabel(entry)}</button>)}
      </div>
    </article>

    <div className="table-workspace-panel span-2" role="tabpanel" aria-label={tabLabel(tab)}>
      {!selected && <article className="console-card"><p className="muted">{t("Wähle oben eine Tabelle. Danach stehen hier ihre Datensätze, ihre Spalten, ihre Beziehungen, ihre Sicherheit und die Beispiele für ihre API.")}</p></article>}

      {/* DATEN: der bestehende Table Editor, mit dieser Tabelle. */}
      {selected && tab === "data" && <TableView projectId={projectId} environment={environment} table={selected}/>}

      {/* STRUKTUR: die Spalten dieser Tabelle, dann der bestehende Designer. */}
      {selected && tab === "structure" && <div className="module-grid">
        <article className="console-card span-2">
          <div className="card-head"><div><span>{t("SPALTEN")}</span><h3>{t("Wie diese Tabelle gebaut ist")}</h3></div><Columns3 size={18}/></div>
          {current === undefined && <p className="muted">{t("Diese Tabelle steht nicht im gelesenen Schema public.")}</p>}
          {current?.columns.length === 0 && <p className="muted">{t("Diese Tabelle hat noch keine Spalte. Lege unten im Entwurf eine an; sie wird als Change Set vorbereitet und erst nach der Freigabe angewendet.")}</p>}
          {current?.columns.map((column) => <div className="bucket-row" key={column.name}>
            <span className="bucket-icon">{primaryKey.has(column.name) ? <KeyRound size={16}/> : <Columns3 size={16}/>}</span>
            <div className="row-text">
              <strong>{column.name}</strong>
              <small><code>{column.dataType}</code> · {column.nullable ? t("darf leer sein") : t("darf nicht leer sein (NOT NULL)")}
                {column.identity ? ` · ${t("Wert kommt von der Datenbank (IDENTITY)")}` : ""}
                {column.generated ? ` · ${t("gerechnet aus anderen Spalten (GENERATED)")}` : ""}
                {column.sensitive ? ` · ${t("gilt als sensibel und wird in den Daten ausgeblendet")}` : ""}</small>
            </div>
            {primaryKey.has(column.name)
              ? <span className="secure row-trailing">{t("Primärschlüssel")}</span>
              : <span className="muted row-trailing">{t("Spalte")}</span>}
          </div>)}
          {current !== undefined && current.truncated && <p className="muted">{t("Die Spaltenliste dieser Tabelle ist an der Grenze abgeschnitten.")}</p>}
          {current !== undefined && primaryKey.size === 0 && <p className="muted">{t("Diese Tabelle hat keinen Primärschlüssel. Ohne ihn kann die Daten-API einzelne Zeilen nicht ändern oder löschen, weil sie keine Zeile eindeutig ansprechen kann.")}</p>}
          <p className="muted">{t("Der Primärschlüssel kommt aus der Indexliste, denn die Schema-Lesung führt ihn nicht mit. Den Vorgabewert einer bestehenden Spalte führt keine der beiden Lesungen; er steht darum nicht hier. Für eine neue Spalte lässt er sich unten wählen.")}</p>
        </article>
        <div className="span-2">
          <TableDesignerView projectId={projectId} environment={environment} table={selected} navigate={navigate} reload={reload}/>
        </div>
      </div>}

      {/* BEZIEHUNGEN: dieselbe Lesung wie das Schemabild, auf diese Tabelle verengt. */}
      {selected && tab === "relations" && <SchemaVisualizerView projectId={projectId} environment={environment} table={selected}/>}

      {/* SICHERHEIT: der RLS-Stand dieser Tabelle, die Begriffe in einem Satz,
          dann die beiden bestehenden Katalogansichten und die Rollen. */}
      {selected && tab === "security" && <div className="module-grid">
        <article className="console-card span-2">
          <div className="card-head"><div><span>{t("SICHERHEIT")}</span><h3>{t("Wer welche Zeilen dieser Tabelle sieht")}</h3></div><ShieldCheck size={18}/></div>
          {current?.rowSecurityEnabled === true && <p className="secure">{t("Row Level Security ist für diese Tabelle eingeschaltet.")}</p>}
          {/* Ein Hinweis, kein Dauerwarnschild: Eine Tabelle ohne RLS ist nicht
              falsch, sie wird nur anders geschuetzt, und das soll dastehen. */}
          {current?.rowSecurityEnabled === false && <p className="muted">{t("Row Level Security ist für diese Tabelle aus. Dann entscheiden allein die Tabellen- und Spaltenrechte, wer Zeilen sieht; die Policies unten wirken erst, wenn sie eingeschaltet ist.")}</p>}
          <dl className="table-workspace-glossary">
            <dt>Row Level Security</dt>
            <dd>{t("steuert, welche Zeilen ein Nutzer lesen, anlegen, ändern oder löschen darf")}</dd>
            <dt>Policy</dt>
            <dd>{t("eine einzelne Regel von Row Level Security, mit einer Bedingung je Zeile")}</dd>
            <dt>USING</dt>
            <dd>{t("die Bedingung, die eine schon vorhandene Zeile erfüllen muss, damit sie sichtbar oder änderbar ist")}</dd>
            <dt>WITH CHECK</dt>
            <dd>{t("die Bedingung, die eine neue oder geänderte Zeile erfüllen muss, damit sie geschrieben werden darf")}</dd>
            <dt>{t("erlaubend und einschränkend")}</dt>
            <dd>{t("von den erlaubenden Regeln muss eine zutreffen, von den einschränkenden alle")}</dd>
            <dt>{t("Rolle")}</dt>
            <dd>{t("der Name, unter dem sich jemand mit der Datenbank verbindet; Rechte hängen an der Rolle und nicht an der Person")}</dd>
            <dt>{t("Spaltenrecht")}</dt>
            <dd>{t("erlaubt das Lesen oder Schreiben einer einzelnen Spalte, unabhängig davon, welche Zeilen Row Level Security durchlässt")}</dd>
            <dt>GRANT OPTION</dt>
            <dd>{t("wer ein Recht so bekommt, darf es weitergeben")}</dd>
            <dt>BYPASSRLS</dt>
            <dd>{t("diese Rolle umgeht Row Level Security; für sie gilt keine Policy")}</dd>
          </dl>
        </article>
        <div className="span-2"><PoliciesView projectId={projectId} environment={environment} table={selected}/></div>
        <div className="span-2"><ColumnPrivilegesView projectId={projectId} environment={environment} table={selected}/></div>
        <article className="console-card span-2">
          <div className="card-head"><div><span>{t("ROLLEN")}</span><h3>{t("Rollen gelten für die ganze Datenbank")}</h3></div><UserCog size={18}/></div>
          <p className="muted">{t("Eine Rolle gehört nicht zu einer Tabelle, und die Rollen-Lesung kennt keine Tabelle. Welche Rollen für diese Tabelle etwas bedeuten, steht oben in ihren Policies und Spaltenrechten; hier steht, was eine Rolle darf, wenn sie dort genannt ist.")}</p>
        </article>
        <div className="span-2"><RolesView projectId={projectId} environment={environment}/></div>
      </div>}

      {/* API: dieselbe Tabelle von aussen, in drei Formen, kopierbar. */}
      {selected && tab === "api" && <div className="module-grid">
        <article className="console-card span-2">
          <div className="card-head"><div><span>{t("REST")}</span><h3>{t("Zeilen dieser Tabelle über HTTP")}</h3></div><Braces size={18}/></div>
          <p className="muted">{t("Der Pfad ist der echte Pfad dieser Installation. QKERN hat kein /rest/v1; die Zeilen einer Tabelle liegen unter /api/v1/projects, und derselbe Pfad trägt auch POST, PATCH und DELETE.")}</p>
          <pre>{tableRestExample(target)}</pre>
          <CopyButton code={tableRestExample(target)} labels={copyLabels}/>
          <p className="muted">{t("Antwort: ein Objekt mit data, darin rows und nextCursor. Was durchkommt, entscheidet Row Level Security für die Rolle des Keys.")}</p>
        </article>
        <article className="console-card span-2">
          <div className="card-head"><div><span>{t("JAVASCRIPT UND TYPESCRIPT")}</span><h3>{t("Dieselbe Lesung mit dem SDK")}</h3></div><Braces size={18}/></div>
          <pre>{tableSdkExample(target)}</pre>
          <CopyButton code={tableSdkExample(target)} labels={copyLabels}/>
          <p className="muted">{t("Das Paket heisst @qkern/sdk und die Fabrik createQkernClient. Der Key steht nicht im Beispiel: Die Console kennt ihn nicht, sie zeigt ihn beim Anlegen genau einmal, und ein Key in einem kopierbaren Block landet im Versionsstand.")}</p>
        </article>
        <article className="console-card span-2">
          <div className="card-head"><div><span>curl</span><h3>{t("Dieselbe Lesung auf der Kommandozeile")}</h3></div><Braces size={18}/></div>
          <pre>{tableCurlExample(target)}</pre>
          <CopyButton code={tableCurlExample(target)} labels={copyLabels}/>
          {origin === "" && <p className="muted">{t("Die Adresse dieser Console steht erst da, wenn der Browser sie gelesen hat; bis dahin ist im Beispiel eine Lücke.")}</p>}
          <p className="muted">{t("Geprüfter Pfad:")} <code>{tableRowsQuery(target)}</code></p>
        </article>
      </div>}
    </div>
  </div>;
}
