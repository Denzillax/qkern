"use client";

import { useCallback, useEffect, useState } from "react";
import { Cloud, HardDrive, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { formatDecimal } from "@/components/console/console-display";

/**
 * Storage (die Buckets des Projekts), aus `console-app.tsx` ausgezogen.
 */
type Environment = "development" | "staging" | "production";
type ProjectStorageBucketItem = {
  id: string; projectId: string; environment: Environment; name: string;
  readPolicy: "private" | "authenticated" | "owner" | "public" | "service";
  writePolicy: "private" | "authenticated" | "owner" | "service";
  allowedMimeTypes: string[]; maxObjectBytes: number; quotaBytes: number;
  usedBytes: number; reservedBytes: number; retentionDays: number | null;
  createdAt: string; updatedAt: string;
};

/**
 * Bytes mit Einheit, ueber `console-display` gerechnet wie ueberall sonst.
 * Bleibt eigen und nimmt nicht `formatBytes` aus `console-format`: Die
 * Buckets zeigen Kontingente dezimal gestuft (KB, MB, GB) und mit
 * Nachkommastellen, die Kennzahlen dort binaer und ganzzahlig.
 */
function formatBytes(value:number){if(value<1024)return `${value} B`;const units=["KB","MB","GB","TB","PB"];let amount=value/1024;let index=0;while(amount>=1024&&index<units.length-1){amount/=1024;index+=1;}return `${amount>=10?formatDecimal(amount,1):formatDecimal(amount,2)} ${units[index]}`;}

export function StorageView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading"|"ready"|"unavailable"|"error" }) {
  const [buckets,setBuckets]=useState<ProjectStorageBucketItem[]>([]);
  const [state, setState] = useState<"loading"|"ready"|"unavailable"|"error">(initialState ?? "loading");
  const [message,setMessage]=useState("");
  const endpoint=`/api/v1/projects/${projectId}/environments/${environment}/storage/buckets`;
  const load=useCallback(async()=>{setState("loading");setMessage("");try{const response=await fetch(endpoint,{cache:"no-store"});const payload=await response.json();if(response.status===503){setBuckets([]);setState("unavailable");setMessage(payload.error??t("Project Storage ist für diese Umgebung deaktiviert."));return;}if(!response.ok)throw new Error(payload.error??t("Storage nicht verfügbar"));setBuckets(payload.data as ProjectStorageBucketItem[]);setState("ready");}catch(cause){setState("error");setMessage(cause instanceof Error?cause.message:t("Storage nicht verfügbar"));}},[endpoint]);
  useEffect(()=>{void load();},[load]);
  async function create(){const raw=window.prompt(t("Bucket-Name (Kleinbuchstaben, Ziffern, Bindestriche)"),"project-assets");if(!raw)return;const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:raw.trim()})});const payload=await response.json();if(!response.ok){setMessage(payload.error??t("Bucket konnte nicht angelegt werden"));setState("error");return;}await load();}
  async function remove(bucket:ProjectStorageBucketItem){if(!window.confirm(`Leeren Bucket ${bucket.name} löschen?`))return;const response=await fetch(`${endpoint}/${bucket.id}`,{method:"DELETE"});if(response.ok)await load();else{const payload=await response.json();setMessage(payload.error??t("Nur leere Buckets lassen sich löschen"));setState("error");}}
  const used=buckets.reduce((sum,bucket)=>sum+bucket.usedBytes,0);
  const quota=buckets.reduce((sum,bucket)=>sum+bucket.quotaBytes,0);
  const percent=quota>0?Math.min(100,(used/quota)*100):0;
  return <div className="module-grid"><article className="console-card storage-total"><Cloud size={24}/><div><span>{t("BELEGT")}</span><strong>{formatBytes(used)}</strong><small>{quota?`von ${formatBytes(quota)}`:t("Keine Buckets")}</small></div><div className="progress"><i style={{width:`${percent}%`}}/></div></article><article className="console-card span-2"><div className="card-head"><div><span>BUCKETS · {environment.toUpperCase()}</span><h3>{t("Buckets des Projekts")}</h3></div><button className="button small" onClick={()=>void create()} disabled={state==="loading"||state==="unavailable"}><Plus size={14}/> {t("Neuer Bucket")}</button></div>{state==="loading"&&<p className="muted">{t("Storage wird geladen…")}</p>}{(state==="unavailable"||state==="error")&&<div className="live-module-state compact"><Cloud size={24}/><p>{message}</p><button className="secondary-button" onClick={()=>void load()}><RefreshCw size={13}/> {t("Noch einmal")}</button></div>}{state==="ready"&&buckets.length===0&&<p className="muted">{t("Noch keine Buckets. Neue Buckets sind privat und nehmen nur die sichere MIME-Liste an.")}</p>}{state==="ready"&&buckets.map(bucket=><div className="bucket-row" key={bucket.id}><span className="bucket-icon"><HardDrive size={16}/></span><div><strong>{bucket.name}</strong><small>Lesen {bucket.readPolicy} · Schreiben {bucket.writePolicy} · {bucket.retentionDays?`${bucket.retentionDays} Tage Aufbewahrung`:t("keine Aufbewahrungsregel")}</small></div><span>{formatBytes(bucket.usedBytes)} / {formatBytes(bucket.quotaBytes)}</span><button className="icon-button" onClick={()=>void remove(bucket)} aria-label={`${bucket.name} löschen`}><Trash2 size={14}/></button></div>)}</article><article className="console-card"><div className="card-head"><div><span>{t("REGELN")}</span><h3>{t("Privat, solange du nichts änderst")}</h3></div><ShieldCheck className="secure" size={21}/></div><p className="muted">{t("Uploads sind an Grösse, MIME-Typ und SHA-256-Prüfsumme gebunden. Objekte bleiben in Quarantäne, bis der Scanner sie freigibt; signierte Downloads laufen nach höchstens 15 Minuten ab.")}</p></article></div>;
}
