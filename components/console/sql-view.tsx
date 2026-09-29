"use client";

import { useMemo, useState } from "react";
import { BookOpen, Play, Plus, ShieldCheck, Terminal, X } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { EmptyState } from "@/components/console/console-parts";
import { StableLabel } from "@/components/stable-label";
import type { ViewId } from "@/components/console/navigation";
import { classifySqlRisk, isReadOnlySql } from "@/lib/security";
// Die Vorlagen des SQL-Editors (2.61): reines Modul, kein Schreibweg.
import {
  SQL_TEMPLATES, SQL_TEMPLATE_DEFAULT_SCHEMA, SqlTemplateError, sqlTemplateStatement,
} from "@/lib/console/sql-templates";

/**
 * Der SQL-Editor, aus `console-app.tsx` ausgezogen.
 *
 * Beim Oeffnen laeuft nichts: Im Editorfeld steht eine Abfrage, und den Knopf
 * drueckt ein Mensch.
 */
type Environment = "development" | "staging" | "production";

export function SqlView({ projectId, environment, reload, navigate, templatesOpen }: { projectId: string; environment: Environment; reload: () => Promise<void>; navigate: (view: ViewId) => void; templatesOpen: boolean }) {
  const [sql, setSql] = useState("SELECT table_name, table_type\nFROM information_schema.tables\nWHERE table_schema = 'public'\nORDER BY table_name\nLIMIT 20");
  const [result, setResult] = useState<"idle"|"rows"|"approval"|"error">("idle");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [message, setMessage] = useState("");
  const [running, setRunning] = useState(false);
  const risk = useMemo(() => classifySqlRisk(sql, environment), [sql, environment]);
  const readOnly = isReadOnlySql(sql.replace(/\n/g, " "));
  // Die Vorlagen (2.61): eine feste Liste aus `lib/console/sql-templates.ts`.
  // Diese Ansicht setzt keinen Namen selbst in SQL zusammen; sie gibt Schema
  // und Tabelle an das Modul und schreibt zurueck, was es erzeugt. Lehnt das
  // Modul ab, steht hier der Grund und im Editorfeld bleibt alles, wie es war.
  const [showTemplates, setShowTemplates] = useState(templatesOpen);
  const [templateSchema, setTemplateSchema] = useState(SQL_TEMPLATE_DEFAULT_SCHEMA);
  const [templateTable, setTemplateTable] = useState("");
  const [templateReason, setTemplateReason] = useState("");
  const [insertedTemplate, setInsertedTemplate] = useState("");
  function insertTemplate(id: string, needsTarget: boolean) {
    try {
      const statement = sqlTemplateStatement(id, needsTarget
        ? { schema: templateSchema, table: templateTable }
        : {});
      // Nur einfuegen. Kein fetch, kein run(): den Knopf drueckt der Mensch.
      setSql(statement);
      setResult("idle");
      setRows([]);
      setColumns([]);
      setTruncated(false);
      setMessage("");
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
    setMessage("");
    try {
      if (readOnly) {
        const response = await fetch(`/api/v1/projects/${projectId}/environments/${environment}/query`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ statement: sql, limit: 50 }),
        });
        const payload = await response.json();
        if (!response.ok) {
          setResult("error");
          setMessage(payload.code ? `${payload.error} (${payload.code})` : payload.error ?? t("Abfrage fehlgeschlagen"));
          return;
        }
        setColumns(payload.data.columns as string[]);
        setRows(payload.data.rows as Array<Record<string, unknown>>);
        setTruncated(Boolean(payload.data.truncated));
        setResult("rows");
        return;
      }
      const response = await fetch("/api/v1/changesets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, environment, title: t("SQL-Änderung aus der Console"), statement: sql }),
      });
      if (!response.ok) { setResult("error"); setMessage(t("Das Change Set konnte nicht erstellt werden.")); return; }
      setResult("approval");
      await reload();
    } finally {
      setRunning(false);
    }
  }
  return <div className="sql-layout"><article className="console-card sql-editor"><div className="editor-tabs"><span className="active">{t("Abfrage 1")} <X size={12}/></span><button><Plus size={13}/></button><div className={`risk ${risk}`}>Risiko {risk}</div></div><div className="editor-body"><div className="line-numbers">1<br/>2<br/>3<br/>4<br/>5</div><textarea value={sql} onChange={(event)=>setSql(event.target.value)} aria-label={t("SQL-Abfrage")} spellCheck={false}/></div><div className="editor-footer"><span>{t("Lesende SQL läuft gegen die Projektdatenbank, begrenzt und redigiert. Aus schreibender SQL wird ein Change Set zur Freigabe.")}</span><button className="button small" onClick={()=>void run()} disabled={running}><Play size={13}/> <StableLabel current={running ? t("Läuft…") : readOnly ? t("Abfrage ausführen") : t("Vorschau erstellen")} variants={tAll("Läuft…", "Abfrage ausführen", "Vorschau erstellen")}/></button></div></article><article className="console-card result-panel"><div className="card-head"><div><span>{t("ERGEBNIS")}</span><h3>{result === "rows" ? `${rows.length} Zeilen${truncated ? t(" · gekürzt") : ""}` : result === "approval" ? t("Change Set erstellt") : result === "error" ? t("Abfrage fehlgeschlagen") : t("Bereit")}</h3></div></div>{result === "idle" && <EmptyState icon={Terminal} title={t("Abfrage ausführen")} text={t("SELECT läuft lesend gegen die Projektdatenbank.")}/>}{result === "rows" && rows.length === 0 && <EmptyState icon={Terminal} title={t("Keine Zeilen")} text="Die Abfrage lief und lieferte nichts zurück."/>}{result === "rows" && rows.length > 0 && <div className="query-result">{rows.slice(0, 50).map((row, index) => <code key={index}>{columns.map((column) => String(row[column] ?? "∅")).join(" · ")}</code>)}</div>}{result === "approval" && <div className="success-state"><ShieldCheck size={34}/><h3>{t("Vorschau bereit")}</h3><p>{t("Nichts wurde angewendet. Diff und Risiko stehen in der Freigabezentrale.")}</p><button className="button small" onClick={()=>navigate("approvals")}>{t("Freigabezentrale öffnen")}</button></div>}{result === "error" && <EmptyState icon={X} title={t("Nicht ausgeführt")} text={message || t("Prüfe das Statement und versuch es noch einmal.")}/>}</article><article className="console-card sql-template-card"><div className="card-head"><div><span>{t("VORLAGEN")}</span><h3>{t("Fertige Abfragen zum Einfügen")}</h3></div><button className="secondary-button" type="button" onClick={()=>setShowTemplates(!showTemplates)}><BookOpen size={14}/> <StableLabel current={showTemplates ? t("Liste verbergen") : t("Liste zeigen")} variants={tAll("Liste verbergen", "Liste zeigen")}/></button></div><p className="sql-template-note">{t("Eine Vorlage ist ein Anfang, keine Antwort. Sie landet im Editorfeld, und nichts läuft: QKERN führt von sich aus keine Abfrage aus, den Knopf drückst du.")}</p>{showTemplates && <><div className="sql-template-target"><label>{t("Schema")}<input value={templateSchema} onChange={(event)=>{setTemplateSchema(event.target.value);setTemplateReason("");}} spellCheck={false} aria-label={t("Schema für eine Vorlage mit Tabelle")}/></label><label>{t("Tabelle")}<input value={templateTable} onChange={(event)=>{setTemplateTable(event.target.value);setTemplateReason("");}} spellCheck={false} aria-label={t("Tabelle für eine Vorlage mit Tabelle")}/></label></div>{templateReason && <p className="sql-template-reason">{templateReason}</p>}<ul className="sql-template-list">{SQL_TEMPLATES.map((template) => <li key={template.id} className={insertedTemplate === template.id ? "inserted" : ""}><div><strong>{t(template.title)}</strong><span>{t(template.question)}</span>{template.requiresExtension !== null && <em>{t("Braucht eine Erweiterung:")} {template.requiresExtension}. {t("Fehlt sie, antwortet die Datenbank mit einem Fehler statt mit Zeilen. Die Vorlage darüber sagt dir, ob sie da ist.")}</em>}{template.parameters.length > 0 && <em>{t("Braucht Schema und Tabelle aus den Feldern oben.")}</em>}</div><button className="secondary-button" type="button" onClick={()=>insertTemplate(template.id, template.parameters.length > 0)}><StableLabel current={insertedTemplate === template.id ? t("Eingefügt") : t("Einfügen")} variants={tAll("Eingefügt", "Einfügen")}/></button></li>)}</ul></>}</article></div>;
}
