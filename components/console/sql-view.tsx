"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpen, History, Play, ShieldCheck, Table2, Terminal, X } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { changeSetRiskLabel, changeSetStatusLabel } from "@/lib/console/change-set-labels";
import { EmptyState } from "@/components/console/console-parts";
import { formatMoment, formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import type { ViewId } from "@/components/console/navigation";
import type { ChangeSet } from "@/lib/types";
// Die Vorlagen des SQL-Editors (2.61): reines Modul, kein Schreibweg.
import {
  SQL_TEMPLATES, SQL_TEMPLATE_DEFAULT_SCHEMA, SqlTemplateError, sqlTemplateStatement,
} from "@/lib/console/sql-templates";
// Risiko und Fehlercode (2.143): dasselbe reine Modul, das die vorhandene
// Risikoerkennung aus `lib/security.ts` ruft. Hier steht keine zweite Liste
// von Schluesselwoertern.
import {
  changeSetFailureCode, readSqlRun, sqlRunFailureCode, type SqlRunFailureCode,
} from "@/lib/console/sql-run-report";

/**
 * Der SQL-Editor, in drei Bereiche geteilt (2.143).
 *
 * Beim Oeffnen laeuft nichts: Im Editorfeld steht eine Abfrage, und den Knopf
 * drueckt ein Mensch.
 *
 * **Warum drei Reiter.** Vorher standen Editorfeld, Ergebnis und Vorlagen als
 * drei Karten nebeneinander, und das Ergebnis war eine Liste von Zeilen, in
 * denen die Werte mit einem Punkt verbunden waren: ohne Spaltennamen, ohne
 * Zeilenzahl ausser der gezaehlten, ohne jede Angabe, wie lange es gedauert
 * hat. Jetzt gibt es drei Bereiche mit derselben Reiterleiste wie der
 * Arbeitsplatz einer Tabelle (`.table-workspace-tabs`, 2.138), damit die
 * Console nicht zwei Sorten Reiter fuehrt.
 *
 * **Was der Verlauf wirklich ist, und was nicht.** QKERN protokolliert keine
 * gestellte Abfrage. Der Weg einer lesenden Abfrage endet in `queryReadOnly`
 * (`lib/server/data-plane/service.ts`): gelesen, redigiert, zurueckgegeben,
 * und nichts davon wird geschrieben, auch nicht in die Audit-Kette. Die
 * Audit-Kette fuehrt Freigaben, Migrationen und `project_auth.*`-Ereignisse,
 * und `listAuditEvents` filtert in SQL auf `project_auth.`; eine Abfrage kommt
 * dort nicht vor. Es gibt auch keine Tabelle, die SQL-Text aufbewahrt: der
 * Migrationsledger im Projekt haelt `change_set_id`, `statement_sha256` und
 * `applied_at`, und die Leistungsseite zeigt aus `pg_stat_statements`
 * ausdruecklich die Kennung und die Zaehler, nie die Spalte `query`, weil in
 * einem Statement ein Geheimnis als Literal stehen kann.
 *
 * Also zeigt der Reiter Verlauf, was es gibt: die Change Sets dieses Projekts
 * und dieser Umgebung aus `GET /api/v1/console`. Sie entstehen aus
 * schreibender SQL, hier und im Tabellen-Designer, und sie sind die einzige
 * Spur, die bleibt. Auch bei ihnen steht das Statement nicht da:
 * `changeSetFromRecord` setzt `statement: "[REDACTED]"`, der Text liegt
 * verschluesselt und wird nur auf dem Freigabe- und Anwendungsweg
 * entschluesselt. Der Reiter sagt beides, statt einen Verlauf zu behaupten.
 *
 * Ein Verlauf im Browser waere die naheliegende Luecke gewesen: zwanzig Zeilen
 * `localStorage`, wie sie der Log-Explorer fuer gespeicherte Suchen schon
 * fuehrt. Er haette ausgesehen wie ein Protokoll und waere keines: weg beim
 * Wechsel des Rechners, weg im privaten Fenster, nie dasselbe fuer zwei
 * Personen im selben Projekt. Darum steht er hier nicht.
 *
 * **Warum keine PostgreSQL-Fehlermeldung.** Der Auftrag wollte sie, und sie
 * ist nicht zu haben. `ProjectDataPlaneError` ist ohne `cause` gebaut, und
 * `run()` faengt jeden Datenbankfehler ab und wirft `DATA_PLANE_UNAVAILABLE`.
 * Ein Syntaxfehler, eine fehlende Tabelle und eine abgelaufene
 * `statement_timeout` kommen in der Console als dieselbe Antwort an. Erklaert
 * werden darum die Codes, die die Route wirklich herausgibt, und der Reiter
 * Ergebnis sagt in einem Satz, warum nicht mehr kommt.
 */
type Environment = "development" | "staging" | "production";

/** Die drei Bereiche, in der Reihenfolge, in der man sie braucht. */
type Area = "editor" | "result" | "history";

const AREAS: ReadonlyArray<Area> = ["editor", "result", "history"];

/** Die Beschriftung eines Reiters, je als eigener `t`-Aufruf fuer den Uebersetzungsvertrag. */
function areaLabel(area: Area): string {
  if (area === "editor") return t("Editor");
  if (area === "result") return t("Ergebnis");
  return t("Verlauf");
}

/**
 * Was ein Fehlercode bedeutet, in einem Satz.
 *
 * Jeder Satz ist aus der Route und dem Dienst abgeleitet und nicht geraten.
 * `UNKNOWN` bekommt keine Erklaerung, sondern das Eingestaendnis, dass die
 * Antwort hier nicht vorgesehen ist; alles andere waere die erfundene
 * Erklaerung zu einem Code, den niemand kennt.
 */
function failureMeaning(code: SqlRunFailureCode): string {
  if (code === "READ_ONLY_QUERY_REQUIRED") {
    return t("Der Wächter vor der Datenbank hat das Statement nicht als lesend erkannt. Erlaubt ist genau ein SELECT, auch mit WITH oder UNION darüber, ohne INTO und ohne Funktion mit Nebenwirkung.");
  }
  if (code === "DATA_PLANE_INVALID_INPUT") {
    return t("Die Anfrage selbst war ungültig: Projekt, Umgebung oder Länge des Statements lagen ausserhalb der Grenzen, die die Route annimmt.");
  }
  if (code === "DATA_PLANE_NOT_READY") {
    return t("Diese Umgebung hat noch keine bereitgestellte Datenbank. Es gibt nichts, wogegen die Abfrage laufen könnte.");
  }
  if (code === "DATA_PLANE_DISABLED") {
    return t("Der Zugang zur Projektdatenbank ist in dieser Installation abgeschaltet. Das ist eine Einstellung des Betriebs und kein Fehler deiner Abfrage.");
  }
  if (code === "DATA_PLANE_BOUNDARY_REJECTED") {
    return t("Die Verbindung stand, aber die Rolle oder die Datenbank dahinter war nicht die erwartete. QKERN bricht dann ab, statt auf einer fremden Verbindung zu lesen.");
  }
  if (code === "DATA_PLANE_UNAVAILABLE") {
    return t("Die Datenbank hat die Abfrage abgelehnt oder war nicht erreichbar. Welcher der beiden Fälle es war, sagt diese Antwort nicht: QKERN gibt die Meldung von PostgreSQL bewusst nicht heraus, weil in ihr der Text des Statements und damit ein Geheimnis stehen kann.");
  }
  if (code === "INVALID_REQUEST") {
    return t("Die Route hat die Anfrage als ungültig abgewiesen, bevor sie die Datenbank gefragt hat.");
  }
  if (code === "AUTHENTICATION_REQUIRED") {
    return t("Die Sitzung ist abgelaufen. Melde dich neu an, dann steht die Abfrage noch im Feld.");
  }
  if (code === "NOT_FOUND") {
    return t("Dieses Projekt oder diese Umgebung gehört nicht zu deiner Mitgliedschaft. QKERN antwortet darauf mit nicht gefunden statt mit verboten.");
  }
  if (code === "CHANGE_SET_REJECTED") {
    return t("Das Statement kam nicht durch die Prüfung für ein Change Set: entweder lässt es sich nicht als eine einzelne Anweisung lesen, oder es trägt etwas, das in einer verwalteten Migration nicht erlaubt ist.");
  }
  return t("Diese Antwort ist hier nicht vorgesehen. QKERN erfindet dazu keine Erklärung; im Serverlog steht, was wirklich geschehen ist.");
}

export function SqlView({ projectId, environment, reload, navigate, templatesOpen }: { projectId: string; environment: Environment; reload: () => Promise<void>; navigate: (view: ViewId) => void; templatesOpen: boolean }) {
  const [sql, setSql] = useState("SELECT table_name, table_type\nFROM information_schema.tables\nWHERE table_schema = 'public'\nORDER BY table_name\nLIMIT 20");
  const [area, setArea] = useState<Area>("editor");
  const [result, setResult] = useState<"idle"|"rows"|"approval"|"error">("idle");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [rowCount, setRowCount] = useState(0);
  // Die Zeit bis zur Antwort, im Browser gemessen. Die Route liefert keine
  // Laufzeit, und eine erfundene waere schlimmer als keine; darum steht neben
  // der Zahl der Satz, was sie ist.
  const [elapsed, setElapsed] = useState(0);
  const [failure, setFailure] = useState<SqlRunFailureCode>("UNKNOWN");
  const [running, setRunning] = useState(false);
  const reading = useMemo(() => readSqlRun(sql, environment), [sql, environment]);
  // Die Vorlagen (2.61): eine feste Liste aus `lib/console/sql-templates.ts`.
  // Diese Ansicht setzt keinen Namen selbst in SQL zusammen; sie gibt Schema
  // und Tabelle an das Modul und schreibt zurueck, was es erzeugt. Lehnt das
  // Modul ab, steht hier der Grund und im Editorfeld bleibt alles, wie es war.
  const [showTemplates, setShowTemplates] = useState(templatesOpen);
  const [templateSchema, setTemplateSchema] = useState(SQL_TEMPLATE_DEFAULT_SCHEMA);
  const [templateTable, setTemplateTable] = useState("");
  const [templateReason, setTemplateReason] = useState("");
  const [insertedTemplate, setInsertedTemplate] = useState("");
  // Der Verlauf holt erst, wenn jemand den Reiter oeffnet. Beim Oeffnen der
  // Seite laeuft weiter nichts, und das ist dieselbe Zusage wie vorher.
  const [history, setHistory] = useState<"idle"|"loading"|"ready"|"error">("idle");
  const [changeSets, setChangeSets] = useState<ChangeSet[]>([]);

  function clearResult() {
    setResult("idle");
    setRows([]);
    setColumns([]);
    setTruncated(false);
    setRowCount(0);
    setElapsed(0);
  }

  function insertTemplate(id: string, needsTarget: boolean) {
    try {
      const statement = sqlTemplateStatement(id, needsTarget
        ? { schema: templateSchema, table: templateTable }
        : {});
      // Nur einfuegen. Kein fetch, kein run(): den Knopf drueckt der Mensch.
      setSql(statement);
      clearResult();
      setTemplateReason("");
      setInsertedTemplate(id);
    } catch (cause) {
      setInsertedTemplate("");
      setTemplateReason(cause instanceof SqlTemplateError
        ? t(cause.reason)
        : t("Diese Vorlage ließ sich nicht einfügen."));
    }
  }

  // Bis Release 1.75 zeigte diese Ansicht vorbereitete Beispielzeilen und rief
  // die Query-Route nie — die Flaeche sah vorhanden aus, ohne es zu sein.
  // Jetzt laeuft ein Read-only-Statement wirklich: durch den Parser-Waechter,
  // in einer READ-ONLY-Transaktion, mit Zeilenlimit und Redaktion.
  async function run() {
    setRunning(true);
    // Der Reiter wechselt vor dem Lauf, damit niemand auf ein Ergebnis wartet,
    // das in einem anderen Bereich erscheint.
    setArea("result");
    const started = Date.now();
    try {
      if (reading.readOnly) {
        const response = await fetch(`/api/v1/projects/${projectId}/environments/${environment}/query`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ statement: sql, limit: 50 }),
        });
        const payload = await response.json().catch(() => ({})) as { data?: { columns?: unknown; rows?: unknown; rowCount?: unknown; truncated?: unknown }; code?: unknown };
        setElapsed(Date.now() - started);
        if (!response.ok || !payload.data) {
          setResult("error");
          setFailure(sqlRunFailureCode(response.status, payload.code));
          return;
        }
        setColumns(Array.isArray(payload.data.columns) ? payload.data.columns as string[] : []);
        const read = Array.isArray(payload.data.rows) ? payload.data.rows as Array<Record<string, unknown>> : [];
        setRows(read);
        setRowCount(typeof payload.data.rowCount === "number" ? payload.data.rowCount : read.length);
        setTruncated(Boolean(payload.data.truncated));
        setResult("rows");
        return;
      }
      const response = await fetch("/api/v1/changesets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, environment, title: t("SQL-Änderung aus der Console"), statement: sql }),
      });
      setElapsed(Date.now() - started);
      if (!response.ok) {
        setResult("error");
        setFailure(changeSetFailureCode(response.status));
        return;
      }
      setResult("approval");
      // Ein neues Change Set gehoert in den Verlauf, also wird der verworfen
      // und beim naechsten Oeffnen des Reiters neu geholt.
      setHistory("idle");
      await reload();
    } finally {
      setRunning(false);
    }
  }

  const loadHistory = useCallback(async () => {
    setHistory("loading");
    try {
      const response = await fetch("/api/v1/console", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as { changeSets?: unknown };
      if (!response.ok || !Array.isArray(payload.changeSets)) { setHistory("error"); return; }
      setChangeSets((payload.changeSets as ChangeSet[])
        .filter((entry) => entry.projectId === projectId && entry.environment === environment));
      setHistory("ready");
    } catch {
      setHistory("error");
    }
  }, [projectId, environment]);

  useEffect(() => {
    if (area === "history" && history === "idle") void loadHistory();
  }, [area, history, loadHistory]);

  return <div className="sql-areas">
    <article className="console-card">
      <div className="card-head">
        <div><span>{t("SQL-EDITOR")} · {environment.toUpperCase()}</span><h3>{t("Abfrage, Ergebnis und was davon bleibt")}</h3></div>
        <Terminal size={18}/>
      </div>
      <p className="muted">{t("Lesende SQL läuft gegen die Projektdatenbank, begrenzt und redigiert. Aus schreibender SQL wird ein Change Set zur Freigabe.")}</p>
      {/* Die Reiter sind Knoepfe und keine Verweise: Die Console ist eine Seite
          mit einem Zustand, und ein Reiter wechselt diesen Zustand. Dieselbe
          Bauart und dieselben Klassen wie der Arbeitsplatz der Tabelle. */}
      <div className="table-workspace-tabs" role="tablist" aria-label={t("Bereiche des SQL-Editors")}>
        {AREAS.map((entry) => <button key={entry} type="button" role="tab"
          aria-selected={area === entry}
          className={area === entry ? "active" : undefined}
          onClick={() => setArea(entry)}>{areaLabel(entry)}</button>)}
      </div>
    </article>

    <div className="table-workspace-panel" role="tabpanel" aria-label={areaLabel(area)}>

      {/* EDITOR: das Feld, der Knopf, die Kennzeichnung und die Vorlagen. */}
      {area === "editor" && <>
        <article className="console-card sql-editor">
          <div className="editor-tabs">
            <span className="active">{t("Abfrage")}</span>
            <div className={`risk ${reading.level}`}>{t("Risiko")} {reading.level}</div>
          </div>
          <div className="editor-body">
            {/* Die Zeilennummern kommen aus dem Text und nicht aus einer
                festen Liste von fuenf. Vorher standen dort immer die Ziffern
                eins bis fuenf, also zeigte eine sechszeilige Abfrage daneben
                nichts und eine zweizeilige drei Nummern zu viel. Mindestens
                fuenf bleiben stehen, damit das Feld nicht springt, waehrend
                jemand tippt. */}
            <div className="line-numbers" aria-hidden="true">
              {Array.from({ length: Math.max(5, sql.split(/\n/).length) }, (_, index) => index + 1)
                .map((line) => <span key={line}>{line}</span>)}
            </div>
            <textarea value={sql} onChange={(event)=>{setSql(event.target.value);setInsertedTemplate("");}} aria-label={t("SQL-Abfrage")} spellCheck={false}/>
          </div>
          {/* Die Kennzeichnung einer gefaehrlichen Abfrage, vor dem Knopf und
              nicht danach. Das Urteil kommt aus `classifySqlRisk`, derselben
              Funktion, an der `requiresApproval` und das Risiko eines Change
              Sets haengen. */}
          {reading.dangerous && <p className="sql-danger" role="status">
            <AlertTriangle size={15} aria-hidden="true"/>
            <span>{t("Diese Abfrage gilt als zerstörend. Dieselbe Prüfung, die in der Freigabezentrale das Risiko eines Change Sets setzt, hat hier DROP, TRUNCATE, ALTER TABLE oder ein DELETE beziehungsweise UPDATE ohne WHERE erkannt. Sie läuft nicht direkt: QKERN legt ein Change Set an, und angewendet wird es erst nach einer Freigabe.")}</span>
          </p>}
          <div className="editor-footer">
            <span>{reading.readOnly
              ? t("Lesend: läuft direkt, in einer READ-ONLY-Transaktion, höchstens 50 Zeilen.")
              : t("Schreibend: wird als Change Set vorbereitet und läuft hier nicht.")}</span>
            <button className="button small" onClick={()=>void run()} disabled={running}><Play size={13}/> <StableLabel current={running ? t("Läuft…") : reading.readOnly ? t("Abfrage ausführen") : t("Vorschau erstellen")} variants={tAll("Läuft…", "Abfrage ausführen", "Vorschau erstellen")}/></button>
          </div>
        </article>

        <article className="console-card sql-template-card">
          <div className="card-head"><div><span>{t("VORLAGEN")}</span><h3>{t("Fertige Abfragen zum Einfügen")}</h3></div><button className="secondary-button" type="button" onClick={()=>setShowTemplates(!showTemplates)}><BookOpen size={14}/> <StableLabel current={showTemplates ? t("Liste verbergen") : t("Liste zeigen")} variants={tAll("Liste verbergen", "Liste zeigen")}/></button></div>
          <p className="sql-template-note">{t("Eine Vorlage ist ein Anfang, keine Antwort. Sie landet im Editorfeld, und nichts läuft: QKERN führt von sich aus keine Abfrage aus, den Knopf drückst du.")}</p>
          {showTemplates && <><div className="sql-template-target"><label>{t("Schema")}<input value={templateSchema} onChange={(event)=>{setTemplateSchema(event.target.value);setTemplateReason("");}} spellCheck={false} aria-label={t("Schema für eine Vorlage mit Tabelle")}/></label><label>{t("Tabelle")}<input value={templateTable} onChange={(event)=>{setTemplateTable(event.target.value);setTemplateReason("");}} spellCheck={false} aria-label={t("Tabelle für eine Vorlage mit Tabelle")}/></label></div>{templateReason && <p className="sql-template-reason">{templateReason}</p>}<ul className="sql-template-list">{SQL_TEMPLATES.map((template) => <li key={template.id} className={insertedTemplate === template.id ? "inserted" : ""}><div><strong>{t(template.title)}</strong><span>{t(template.question)}</span>{template.requiresExtension !== null && <em>{t("Braucht eine Erweiterung:")} {template.requiresExtension}. {t("Fehlt sie, antwortet die Datenbank mit einem Fehler statt mit Zeilen. Die Vorlage darüber sagt dir, ob sie da ist.")}</em>}{template.parameters.length > 0 && <em>{t("Braucht Schema und Tabelle aus den Feldern oben.")}</em>}</div><button className="secondary-button" type="button" onClick={()=>insertTemplate(template.id, template.parameters.length > 0)}><StableLabel current={insertedTemplate === template.id ? t("Eingefügt") : t("Einfügen")} variants={tAll("Eingefügt", "Einfügen")}/></button></li>)}</ul></>}
        </article>
      </>}

      {/* ERGEBNIS: Spaltennamen, Zeilenzahl, gemessene Zeit, und im Fehlerfall
          der Code samt einem Satz, was er bedeutet. */}
      {area === "result" && <article className="console-card result-panel">
        <div className="card-head">
          <div><span>{t("ERGEBNIS")}</span><h3>{running ? t("Die Abfrage läuft…") : result === "rows" ? t("Zeilen gelesen") : result === "approval" ? t("Change Set erstellt") : result === "error" ? t("Nicht ausgeführt") : t("Bereit")}</h3></div>
          <Table2 size={18}/>
        </div>

        {result !== "idle" && !running && <div className="sql-result-meta">
          <div><span>{t("Zeilen")}</span><strong>{result === "rows" ? formatNumber(rowCount) : "–"}</strong></div>
          <div><span>{t("Spalten")}</span><strong>{result === "rows" ? formatNumber(columns.length) : "–"}</strong></div>
          <div><span>{t("Antwortzeit")}</span><strong>{formatNumber(elapsed)} {t("ms")}</strong></div>
        </div>}
        {result !== "idle" && !running && <p className="muted">{t("Die Antwortzeit ist im Browser gemessen: vom Absenden bis zur Antwort, mitsamt Netz und Anmeldeprüfung. Die Laufzeit in der Datenbank liefert die Route nicht, und QKERN schätzt sie nicht.")}</p>}

        {result === "idle" && !running && <EmptyState icon={Terminal} title={t("Noch keine Abfrage gelaufen")} text={t("Hier erscheinen die Spalten und Zeilen, sobald du im Reiter Editor auf Abfrage ausführen drückst. QKERN führt von sich aus nichts aus.")}/>}
        {result === "rows" && rows.length === 0 && <EmptyState icon={Terminal} title={t("Keine Zeilen")} text={t("Die Abfrage lief und lieferte nichts zurück. Das ist ein Ergebnis und kein Fehler: Die Bedingungen trafen auf keine Zeile zu, oder RLS zeigt dieser Rolle keine.")}/>}
        {result === "rows" && rows.length > 0 && <div className="sql-result-scroll"><table className="sql-result-table">
          <thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
          <tbody>{rows.slice(0, 50).map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{String(row[column] ?? "∅")}</td>)}</tr>)}</tbody>
        </table></div>}
        {result === "rows" && truncated && <p className="muted">{t("Die Antwort ist an der Grenze abgeschnitten: entweder am Zeilenlimit von 50 oder an der Grenze für die Grösse der Antwort. Grenze die Abfrage selbst ein, dann siehst du, was du suchst.")}</p>}

        {result === "approval" && <div className="success-state"><ShieldCheck size={34}/><h3>{t("Vorschau bereit")}</h3><p>{t("Nichts wurde angewendet. Diff und Risiko stehen in der Freigabezentrale.")}</p><button className="button small" onClick={()=>navigate("approvals")}>{t("Freigabezentrale öffnen")}</button></div>}

        {result === "error" && <div className="sql-failure">
          <h4><X size={16} aria-hidden="true"/> <code>{failure}</code></h4>
          <p>{failureMeaning(failure)}</p>
        </div>}
      </article>}

      {/* VERLAUF: was es wirklich gibt, und der Satz darüber, was es nicht gibt. */}
      {area === "history" && <article className="console-card">
        <div className="card-head"><div><span>{t("VERLAUF")}</span><h3>{t("Was von einer Abfrage bleibt")}</h3></div><History size={18}/></div>
        <p className="muted">{t("QKERN protokolliert gestellte Abfragen nicht. Eine lesende Abfrage läuft, wird redigiert angezeigt und danach verworfen: keine Tabelle hält ihren Text, und die Audit-Kette führt Freigaben, Migrationen und Auth-Ereignisse, keine Abfragen. Das ist eine Entscheidung und kein Versäumnis, denn im Text eines Statements kann ein Geheimnis als Literal stehen.")}</p>
        <p className="muted">{t("Was bleibt, sind die Change Sets für schreibende Änderungen. Sie stehen unten, und auch bei ihnen gibt die Console das Statement nicht her: der Text liegt verschlüsselt und wird erst auf dem Freigabeweg gelesen.")}</p>
        {history === "loading" && <p className="muted">{t("Die Change Sets werden geladen…")}</p>}
        {history === "error" && <p className="muted">{t("Die Change Sets liessen sich nicht laden. Die Übersicht der Console holt dieselbe Antwort; dort steht, ob es an der Sitzung liegt.")}</p>}
        {history === "ready" && changeSets.length === 0 && <EmptyState icon={History} title={t("Noch kein Change Set")} text={t("In dieser Umgebung wurde noch keine schreibende Änderung vorbereitet. Sobald eine entsteht, steht sie hier mit Titel, Risiko und Zeitpunkt.")}/>}
        {history === "ready" && changeSets.length > 0 && <div className="sql-history-list">
          {changeSets.map((entry) => <div className="bucket-row" key={entry.id}>
            <span className="bucket-icon"><History size={16}/></span>
            <div className="row-text">
              <strong>{entry.title}</strong>
              <small>{formatMoment(entry.createdAt)} · {t(changeSetStatusLabel(entry.status))}</small>
            </div>
            <span className={`risk ${entry.risk} row-trailing`}>{t("Risiko")} {t(changeSetRiskLabel(entry.risk))}</span>
          </div>)}
          <button className="button small" type="button" onClick={()=>navigate("approvals")}>{t("Freigabezentrale öffnen")}</button>
        </div>}
      </article>}
    </div>
  </div>;
}
