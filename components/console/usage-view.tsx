"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleGauge, Database, RefreshCw, ShieldCheck, X } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { formatDecimal, formatNumber } from "@/components/console/console-display";
import { InvoicesCard } from "@/components/console/invoices-card";

/**
 * Monitoring (die Nutzung des Monatskontos), aus `console-app.tsx`
 * ausgezogen.
 */
type Environment = "development" | "staging" | "production";
type UsageProjection = {
  projectId: string; environment: Environment; period: string;
  windowStart: string; windowEnd: string;
  metrics: Array<{
    metric: string; label: string; unit: "operations" | "rows" | "bytes";
    used: string; limit: string | null; remaining: string | null;
    mode: "unlimited" | "observe" | "enforce";
    status: "unlimited" | "ok" | "warning" | "exhausted" | "exceeded";
    revision: number | null;
  }>;
};

function EmptyState({icon:Icon,title,text}:{icon:typeof Database;title:string;text:string}){return <div className="empty-state"><Icon size={28}/><h3>{title}</h3><p>{text}</p></div>}
function ErrorState({message,retry}:{message:string;retry:()=>void}){return <div className="error-state"><X size={30}/><h3>{t("Console-Daten konnten nicht geladen werden")}</h3><p>{message}</p><button className="button small" onClick={retry}>{t("Noch einmal")}</button></div>}

export function UsageView({projectId,environment}:{projectId:string;environment:Environment}) {
  const [projection,setProjection]=useState<UsageProjection|null>(null);
  const [state,setState]=useState<"loading"|"ready"|"disabled"|"error">("loading");
  const load=useCallback(async()=>{
    setState("loading");
    try {
      const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/usage`,{cache:"no-store"});
      if(response.status===503){setProjection(null);setState("disabled");return;}
      if(!response.ok)throw new Error("Usage projection unavailable");
      setProjection(((await response.json()) as {data:UsageProjection}).data);
      setState("ready");
    } catch {setProjection(null);setState("error");}
  },[projectId,environment]);
  useEffect(()=>{void load();},[load]);
  if(state==="loading")return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Die Nutzung wird geladen…")}</h3></div>;
  if(state==="disabled")return <EmptyState icon={CircleGauge} title={t("Usage Metering ist deaktiviert")} text="Aktiviere QKERN_USAGE_METERING_ENABLED und die dauerhafte Runtime-Persistenz, um echte Monatswerte zu sehen."/>;
  if(state==="error"||!projection)return <ErrorState message="Die Usage-Projektion konnte nicht geladen werden." retry={()=>void load()}/>;
  return <>
    <div className="product-preview-notice"><ShieldCheck size={16}/><div><strong>{t("Nutzung, nur lesend")}</strong><span>{projection.period} · an den Tenant gebunden · Preise und Limits ändert die Console nicht</span></div></div>
    <div className="metric-grid monitoring-grid">
      {projection.metrics.slice(0,4).map(item=><article className="console-card metric-tile" key={item.metric}><div><span>{item.label.toUpperCase()}</span><CircleGauge size={17}/></div><strong>{formatUsageAmount(item.used,item.unit)}</strong><small>{item.limit===null?t("Kein Limit"):`${formatUsageAmount(item.remaining??"0",item.unit)} verbleibend`}</small></article>)}
    </div>
    <article className="console-card chart-card">
      <div className="card-head"><div><span>{t("MONATSKONTO")}</span><h3>{t("Nutzung und Limits")}</h3></div><button className="secondary-button" onClick={()=>void load()}><RefreshCw size={14}/> {t("Aktualisieren")}</button></div>
      <div className="detail-list">
        {projection.metrics.map(item=><div key={item.metric}><span>{item.label}<small>{item.mode} · Revision {item.revision??"–"}</small></span><strong className={item.status==="exceeded"||item.status==="exhausted"?"risk high":item.status==="warning"?"risk medium":"secure"}>{formatUsageAmount(item.used,item.unit)}{item.limit===null?"":` / ${formatUsageAmount(item.limit,item.unit)}`} · {usageStatusLabel(item.status)}</strong></div>)}
      </div>
    </article>
    <InvoicesCard projectId={projectId} environment={environment}/>
  </>;
}

function formatUsageAmount(value:string,unit:"operations"|"rows"|"bytes"){
  const amount=BigInt(value);
  if(unit!=="bytes")return formatNumber(amount);
  const units=[["PB",1125899906842624n],["TB",1099511627776n],["GB",1073741824n],["MB",1048576n],["KB",1024n]] as const;
  for(const [label,size] of units){if(amount>=size){const tenths=amount*10n/size;return `${formatDecimal(Number(tenths)/10,1)} ${label}`;}}
  return `${amount} B`;
}
function usageStatusLabel(status:UsageProjection["metrics"][number]["status"]){return ({unlimited:"unbegrenzt",ok:t("im Rahmen"),warning:"Warnschwelle",exhausted:t("ausgeschöpft"),exceeded:t("überschritten")} as const)[status];}
