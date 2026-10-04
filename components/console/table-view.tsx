"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, Pencil, Plus, RefreshCw, Search, ShieldCheck, Table2, Trash2 } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { FormPanel } from "@/components/console/form-panel";
import { OptionMenu } from "@/components/console/option-menu";

/**
 * Der Table Editor, aus `console-app.tsx` ausgezogen.
 *
 * Er liest Schema und Zeilen ueber die Generated Data API und zeigt bis
 * dahin seinen Ladezustand.
 */
type Environment = "development" | "staging" | "production";
type LiveTableColumn = {
  name: string; dataType: string; nullable: boolean; sensitive: boolean;
  primaryKeyPosition: number | null; insertable: boolean; updateable: boolean; selectable: boolean;
};
type LiveTable = {
  schema: string; name: string; rowSecurityEnabled: boolean; primaryKey: string[]; columns: LiveTableColumn[];
};
type LiveRows = {
  table: LiveTable; rows: Array<Record<string, unknown>>; rowCount: number;
  hasMore: boolean; nextCursor: string | null;
};

/** Ein Zellenwert als Text; `null` bleibt sichtbar `null` und wird nicht leer. */
function formatCell(value:unknown){if(value===null)return "null";if(typeof value==="object")return JSON.stringify(value);return String(value)}

export function TableView({ projectId, environment, table, initialState }: { projectId: string; environment: Environment; table?: string; initialState?: "loading"|"ready"|"unavailable"|"error" }) {
  const [tables,setTables]=useState<string[]>([]);
  const [selected,setSelected]=useState("");
  const [data,setData]=useState<LiveRows|null>(null);
  const [query,setQuery]=useState("");
  const [state, setState] = useState<"loading"|"ready"|"unavailable"|"error">(initialState ?? "loading");
  const [message,setMessage]=useState("");
  const [insertOpen,setInsertOpen]=useState(false);
  // Aendern und Loeschen klappen ueber der Tabelle auf (2.166), statt ueber
  // `window.prompt` und `window.confirm` zu fragen. Eine Ablehnung bleibt im
  // Bereich stehen; vorher kippte sie die ganze Tabelle in den Fehlerzustand.
  const [editing,setEditing]=useState<Record<string,unknown>|null>(null);
  const [deleting,setDeleting]=useState<Record<string,unknown>|null>(null);
  const [deleteError,setDeleteError]=useState("");
  const [insertDraft,setInsertDraft]=useState("{\n  \"id\": \"\"\n}");

  const loadRows=useCallback(async(table:string)=>{
    if(!table)return;
    setState("loading");setMessage("");
    try{
      const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/tables/${table}/rows?schema=public&limit=50`,{cache:"no-store"});
      const payload=await response.json();
      if(response.status===503||response.status===409){setData(null);setState("unavailable");setMessage(serverErrorText(payload.error)??t("Die Generated Data API ist für diese Umgebung nicht aktiviert."));return;}
      if(!response.ok)throw new Error(serverErrorText(payload.error)??t("Zeilen nicht verfügbar"));
      setData(payload.data as LiveRows);setState("ready");
    }catch(cause){setState("error");setMessage(cause instanceof Error?cause.message:t("Zeilen nicht verfügbar"));}
  },[projectId,environment]);

  // 2.138: Mit vorgegebener Tabelle entfaellt die Schemalesung. Die Zeilenroute
  // liefert Spalten, Primaerschluessel und RLS-Stand genau dieser Tabelle mit;
  // die Liste aller Tabellen waere hier eine Lesung ohne Leser, weil das
  // Tabellenmenue dann der Arbeitsplatz fuehrt und nicht diese Ansicht.
  useEffect(()=>{let active=true;setState("loading");setData(null);if(table){setTables([]);setSelected(table);void loadRows(table);return;}void fetch(`/api/v1/projects/${projectId}/environments/${environment}/schema?schema=public`,{cache:"no-store"}).then(async response=>({response,payload:await response.json()})).then(({response,payload})=>{if(!active)return;if(!response.ok){setTables([]);setSelected("");setState(response.status===503||response.status===409?"unavailable":"error");setMessage(serverErrorText(payload.error)??t("Schema nicht verfügbar"));return;}const names=(payload.data.tables as Array<{name:string;kind:string;rowSecurityEnabled:boolean}>).filter(table=>(table.kind==="table"||table.kind==="partitioned_table")&&table.rowSecurityEnabled).map(table=>table.name);setTables(names);const first=names[0]??"";setSelected(first);if(first)void loadRows(first);else{setState("unavailable");setMessage(t("Im Schema public gibt es keine Tabelle mit RLS."));}}).catch(()=>{if(active){setState("error");setMessage(t("Schema nicht verfügbar"));}});return()=>{active=false;};},[projectId,environment,loadRows,table]);

  async function insert(){try{const row=JSON.parse(insertDraft) as unknown;if(!row||typeof row!=="object"||Array.isArray(row))throw new Error();const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/tables/${selected}/rows`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({schema:"public",rows:[row]})});if(!response.ok)throw new Error(serverErrorText((await response.json()).error)??t("Einfügen fehlgeschlagen"));setInsertOpen(false);await loadRows(selected);}catch{setMessage(t("Einfügen erwartet ein JSON-Objekt mit erlaubten Spalten."));setState("error");}}
  function matchOf(row:Record<string,unknown>){return Object.fromEntries((data?.table.primaryKey??[]).map(key=>[key,row[key]]));}
  async function remove(row:Record<string,unknown>){if(!data?.table.primaryKey.length)return;const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/tables/${selected}/rows`,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({schema:"public",match:matchOf(row)})});if(response.ok){setDeleting(null);setDeleteError("");await loadRows(selected);}else setDeleteError(serverErrorText((await response.json().catch(()=>({}))).error)??t("Löschen fehlgeschlagen"));}
  /** Was sich an einer Zeile aendern laesst: alles ausser Primaerschluessel und nicht aenderbaren Spalten, mit den Werten, die gerade dastehen. */
  function editableOf(row:Record<string,unknown>){const columns=data?.table.columns??[];return Object.fromEntries(columns.filter(column=>column.updateable&&column.primaryKeyPosition===null&&!column.sensitive&&column.name in row).map(column=>[column.name,row[column.name]]));}
  async function edit(row:Record<string,unknown>,raw:string):Promise<string|null>{if(!data?.table.primaryKey.length)return t("Ändern fehlgeschlagen");let values:unknown;try{values=JSON.parse(raw);}catch{return t("Ändern erwartet ein JSON-Objekt.");}if(!values||typeof values!=="object"||Array.isArray(values))return t("Ändern erwartet ein JSON-Objekt.");const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/tables/${selected}/rows`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({schema:"public",match:matchOf(row),values})});if(!response.ok)return serverErrorText((await response.json().catch(()=>({}))).error)??t("Ändern fehlgeschlagen");setEditing(null);await loadRows(selected);return null;}

  const columns=data?.table.columns.filter(column=>column.selectable&&!column.sensitive).map(column=>column.name)??[];
  const rows=(data?.rows??[]).filter(row=>JSON.stringify(row).toLowerCase().includes(query.toLowerCase()));
  return <div className="console-card table-editor live-table-editor"><div className="table-toolbar">{/* 2.133: Ohne Erklaerzeile. Diese Ansicht haelt von den Tabellen nur die
    Namen (`tables` ist eine Liste von Zeichenketten); die Spalten kennt sie
    erst fuer die eine geladene Tabelle. Eine Zahl, die nur beim gewaehlten
    Eintrag stimmt, waere schlechter als keine. */}{table
    // 2.138: Im Arbeitsplatz waehlt ein Menue weiter oben die Tabelle. Ein
    // zweites Menue daneben mit derselben Aufgabe waere eine Falle: Welches
    // von beiden gilt, waere nicht zu sehen.
    ? <span className="toolbar-fixed-table"><Table2 size={14} aria-hidden="true"/> <code>public.{table}</code></span>
    : <OptionMenu value={selected} ariaLabel={t("Tabelle")} listLabel={t("Tabelle wählen")} align="left"
    icon={<Table2 size={14} aria-hidden="true"/>}
    onChange={next=>{setSelected(next);void loadRows(next);}}
    options={tables.map(name=>({id:name,label:`public.${name}`}))}/>}<div className="toolbar-search"><Search size={14}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={t("Geladene Zeilen durchsuchen…")}/></div><button className="secondary-button" onClick={()=>void loadRows(selected)} disabled={!selected}><RefreshCw size={14}/> {t("Zeilen neu laden")}</button><button className="button small" onClick={()=>setInsertOpen(!insertOpen)} disabled={!selected||state!=="ready"}><Plus size={14}/> {t("Zeile einfügen")}</button></div>{insertOpen&&<div className="inline-row-editor"><textarea value={insertDraft} onChange={event=>setInsertDraft(event.target.value)} aria-label={t("Neue Zeile als JSON")}/><div><button className="ghost-button" onClick={()=>setInsertOpen(false)}>{t("Abbrechen")}</button><button className="button small" onClick={()=>void insert()}>{t("Mit RLS einfügen")}</button></div></div>}{editing&&<FormPanel key={JSON.stringify(matchOf(editing))} title={`${t("Zeile bearbeiten")} · ${Object.values(matchOf(editing)).map(String).join(", ")}`} submitLabel={t("Speichern")} onCancel={()=>setEditing(null)} onSubmit={(values)=>edit(editing,values.json)} fields={[{name:"json",label:t("Geänderte Werte als JSON (Primärschlüssel bleiben)"),initial:JSON.stringify(editableOf(editing),null,2),multiline:true,required:true,mono:true}]}/>}{deleting&&<div className="danger-confirm" role="group" aria-label={t("Zeile löschen")}><p><strong>{t("Diese Zeile löschen?")}</strong> <code>{Object.values(matchOf(deleting)).map(String).join(", ")}</code></p>{deleteError&&<p className="form-panel-error" role="alert">{deleteError}</p>}<div className="danger-confirm-actions"><button type="button" className="danger-button" onClick={()=>void remove(deleting)}><Trash2 size={13}/> {t("Zeile löschen")}</button><button type="button" className="secondary-button" onClick={()=>{setDeleting(null);setDeleteError("");}}>{t("Abbrechen")}</button></div></div>}{state==="loading"&&<div className="live-module-state"><RefreshCw size={24}/><h3>{t("Schema und Zeilen werden geladen…")}</h3></div>}{(state==="unavailable"||state==="error")&&<div className="live-module-state"><Database size={26}/><h3>{state==="unavailable"?t("Generated Data API nicht bereit"):t("Zeilen konnten nicht geladen werden")}</h3><p>{message}</p></div>}{state==="ready"&&<div className="records-grid live-records"><table><thead><tr>{columns.map(column=><th key={column}>{column}</th>)}<th>{t("Aktionen")}</th></tr></thead><tbody>{rows.map((row,index)=><tr key={data?.table.primaryKey.map(key=>String(row[key])).join(":")||index}>{columns.map(column=><td key={column}><code>{formatCell(row[column])}</code></td>)}<td className="row-actions"><button onClick={()=>{setDeleting(null);setEditing(row);}} aria-label={t("Zeile bearbeiten")}><Pencil size={13}/></button><button onClick={()=>{setEditing(null);setDeleteError("");setDeleting(row);}} aria-label={t("Zeile löschen")}><Trash2 size={13}/></button></td></tr>)}{rows.length===0&&<tr><td colSpan={columns.length+1}>{t("Keine Zeilen, die RLS dir zeigt.")}</td></tr>}</tbody></table></div>}<div className="table-footer"><span>{rows.length} {t("Zeilen geladen")}{data?.hasMore?t(" · weitere per Cursor"):""}</span><span className="secure"><ShieldCheck size={12}/> {t("Live-Schema · RLS gilt · sensible Spalten ausgeblendet")}</span></div></div>;
}
