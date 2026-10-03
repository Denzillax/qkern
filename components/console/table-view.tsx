"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, Pencil, Plus, RefreshCw, Search, ShieldCheck, Table2, Trash2 } from "lucide-react";
import { t } from "@/components/console/console-i18n";
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

export function TableView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading"|"ready"|"unavailable"|"error" }) {
  const [tables,setTables]=useState<string[]>([]);
  const [selected,setSelected]=useState("");
  const [data,setData]=useState<LiveRows|null>(null);
  const [query,setQuery]=useState("");
  const [state, setState] = useState<"loading"|"ready"|"unavailable"|"error">(initialState ?? "loading");
  const [message,setMessage]=useState("");
  const [insertOpen,setInsertOpen]=useState(false);
  const [insertDraft,setInsertDraft]=useState("{\n  \"id\": \"\"\n}");

  const loadRows=useCallback(async(table:string)=>{
    if(!table)return;
    setState("loading");setMessage("");
    try{
      const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/tables/${table}/rows?schema=public&limit=50`,{cache:"no-store"});
      const payload=await response.json();
      if(response.status===503||response.status===409){setData(null);setState("unavailable");setMessage(payload.error??t("Die Generated Data API ist für diese Umgebung nicht aktiviert."));return;}
      if(!response.ok)throw new Error(payload.error??t("Zeilen nicht verfügbar"));
      setData(payload.data as LiveRows);setState("ready");
    }catch(cause){setState("error");setMessage(cause instanceof Error?cause.message:t("Zeilen nicht verfügbar"));}
  },[projectId,environment]);

  useEffect(()=>{let active=true;setState("loading");setData(null);void fetch(`/api/v1/projects/${projectId}/environments/${environment}/schema?schema=public`,{cache:"no-store"}).then(async response=>({response,payload:await response.json()})).then(({response,payload})=>{if(!active)return;if(!response.ok){setTables([]);setSelected("");setState(response.status===503||response.status===409?"unavailable":"error");setMessage(payload.error??t("Schema nicht verfügbar"));return;}const names=(payload.data.tables as Array<{name:string;kind:string;rowSecurityEnabled:boolean}>).filter(table=>(table.kind==="table"||table.kind==="partitioned_table")&&table.rowSecurityEnabled).map(table=>table.name);setTables(names);const first=names[0]??"";setSelected(first);if(first)void loadRows(first);else{setState("unavailable");setMessage(t("Im Schema public gibt es keine Tabelle mit RLS."));}}).catch(()=>{if(active){setState("error");setMessage(t("Schema nicht verfügbar"));}});return()=>{active=false;};},[projectId,environment,loadRows]);

  async function insert(){try{const row=JSON.parse(insertDraft) as unknown;if(!row||typeof row!=="object"||Array.isArray(row))throw new Error();const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/tables/${selected}/rows`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({schema:"public",rows:[row]})});if(!response.ok)throw new Error((await response.json()).error??t("Einfügen fehlgeschlagen"));setInsertOpen(false);await loadRows(selected);}catch{setMessage(t("Einfügen erwartet ein JSON-Objekt mit erlaubten Spalten."));setState("error");}}
  async function remove(row:Record<string,unknown>){if(!data?.table.primaryKey.length||!window.confirm(t("Diese Zeile löschen?")))return;const match=Object.fromEntries(data.table.primaryKey.map(key=>[key,row[key]]));const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/tables/${selected}/rows`,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({schema:"public",match})});if(response.ok)await loadRows(selected);else{setState("error");setMessage((await response.json()).error??t("Löschen fehlgeschlagen"));}}
  async function edit(row:Record<string,unknown>){if(!data?.table.primaryKey.length)return;const raw=window.prompt(t("Geänderte Werte als JSON (Primärschlüssel bleiben)"),"{}");if(!raw)return;try{const values=JSON.parse(raw) as unknown;if(!values||typeof values!=="object"||Array.isArray(values))throw new Error();const match=Object.fromEntries(data.table.primaryKey.map(key=>[key,row[key]]));const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/tables/${selected}/rows`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({schema:"public",match,values})});if(!response.ok)throw new Error((await response.json()).error??t("Ändern fehlgeschlagen"));await loadRows(selected);}catch(cause){setState("error");setMessage(cause instanceof Error?cause.message:t("Ändern erwartet ein JSON-Objekt."));}}

  const columns=data?.table.columns.filter(column=>column.selectable&&!column.sensitive).map(column=>column.name)??[];
  const rows=(data?.rows??[]).filter(row=>JSON.stringify(row).toLowerCase().includes(query.toLowerCase()));
  return <div className="console-card table-editor live-table-editor"><div className="table-toolbar">{/* 2.133: Ohne Erklaerzeile. Diese Ansicht haelt von den Tabellen nur die
    Namen (`tables` ist eine Liste von Zeichenketten); die Spalten kennt sie
    erst fuer die eine geladene Tabelle. Eine Zahl, die nur beim gewaehlten
    Eintrag stimmt, waere schlechter als keine. */}<OptionMenu value={selected} ariaLabel={t("Tabelle")} listLabel={t("Tabelle wählen")} align="left"
    icon={<Table2 size={14} aria-hidden="true"/>}
    onChange={next=>{setSelected(next);void loadRows(next);}}
    options={tables.map(table=>({id:table,label:`public.${table}`}))}/><div className="toolbar-search"><Search size={14}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={t("Geladene Zeilen durchsuchen…")}/></div><button className="secondary-button" onClick={()=>void loadRows(selected)} disabled={!selected}><RefreshCw size={14}/> {t("Neu laden")}</button><button className="button small" onClick={()=>setInsertOpen(!insertOpen)} disabled={!selected||state!=="ready"}><Plus size={14}/> {t("Zeile einfügen")}</button></div>{insertOpen&&<div className="inline-row-editor"><textarea value={insertDraft} onChange={event=>setInsertDraft(event.target.value)} aria-label={t("Neue Zeile als JSON")}/><div><button className="ghost-button" onClick={()=>setInsertOpen(false)}>{t("Abbrechen")}</button><button className="button small" onClick={()=>void insert()}>{t("Mit RLS einfügen")}</button></div></div>}{state==="loading"&&<div className="live-module-state"><RefreshCw size={24}/><h3>{t("Schema und Zeilen werden geladen…")}</h3></div>}{(state==="unavailable"||state==="error")&&<div className="live-module-state"><Database size={26}/><h3>{state==="unavailable"?t("Generated Data API nicht bereit"):t("Zeilen konnten nicht geladen werden")}</h3><p>{message}</p></div>}{state==="ready"&&<div className="records-grid live-records"><table><thead><tr>{columns.map(column=><th key={column}>{column}</th>)}<th>{t("Aktionen")}</th></tr></thead><tbody>{rows.map((row,index)=><tr key={data?.table.primaryKey.map(key=>String(row[key])).join(":")||index}>{columns.map(column=><td key={column}><code>{formatCell(row[column])}</code></td>)}<td className="row-actions"><button onClick={()=>void edit(row)} aria-label={t("Zeile bearbeiten")}><Pencil size={13}/></button><button onClick={()=>void remove(row)} aria-label={t("Zeile löschen")}><Trash2 size={13}/></button></td></tr>)}{rows.length===0&&<tr><td colSpan={columns.length+1}>{t("Keine Zeilen, die RLS dir zeigt.")}</td></tr>}</tbody></table></div>}<div className="table-footer"><span>{rows.length} Zeilen geladen{data?.hasMore?t(" · weitere per Cursor"):""}</span><span className="secure"><ShieldCheck size={12}/> {t("Live-Schema · RLS gilt · sensible Spalten ausgeblendet")}</span></div></div>;
}
