"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleGauge, RefreshCw, ShieldCheck } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { EmptyState, ErrorState } from "@/components/console/console-parts";
import { formatDecimal, formatNumber, formatPercent } from "@/components/console/console-display";
import { InvoicesCard } from "@/components/console/invoices-card";
import { billingMetricLabel, usageUnitLabel } from "@/components/console/billing-settings-view";
import { usageMeterRatio, usageMeterWidth } from "@/lib/console/billing";

/**
 * Monitoring (die Nutzung des Monatskontos), aus `console-app.tsx`
 * ausgezogen.
 *
 * ## Eine Lesung und keine Zahlenwand (2.140)
 *
 * Vorher stand je Metrik eine Zeile mit `used / limit · status`, und wo keine
 * Grenze gesetzt war, stand die Menge allein da. Zwei Dinge waren daran
 * schlecht: Die Einheit fehlte, und der Zustand "unbegrenzt" klang wie eine
 * Zusage, obwohl er bloss heisst, dass niemand eine Quota-Policy gesetzt hat.
 *
 * Jetzt zeigt jede Zeile Metrik, Menge und Einheit, und darunter genau eines
 * von zwei Dingen:
 *
 * - **Eine Grenze ist konfiguriert.** Dann steht ein Balken da, Menge zu
 *   Grenze, dazu der Anteil, die Grenze selbst und die Betriebsart.
 * - **Es ist keine konfiguriert.** Dann steht ein Satz da und kein Balken.
 *   Die Grenze kommt aus `limit` in der Antwort der Route; ist sie null, gibt
 *   es keine. Ein Balken gegen eine geratene Grenze waere ein Bild, das eine
 *   Zahl behauptet, die niemand gesetzt hat, und genau dieses Bild liest ein
 *   Entwickler als Zusage.
 *
 * Die Beschriftung der Metrik kommt aus `billingMetricLabel`, also uebersetzt,
 * und nicht aus `label` der Route, das immer englisch ist.
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
type UsageMetricRow = UsageProjection["metrics"][number];


export function UsageView({projectId,environment, initialState}:{projectId:string;environment:Environment; initialState?: "loading"|"ready"|"disabled"|"error" }) {
  const [projection,setProjection]=useState<UsageProjection|null>(null);
  const [state, setState] = useState<"loading"|"ready"|"disabled"|"error">(initialState ?? "loading");
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
  if(state==="error"||!projection)return <ErrorState message={t("Die Usage-Projektion konnte nicht geladen werden.")} retry={()=>void load()}/>;
  return <>
    <div className="product-preview-notice"><ShieldCheck size={16}/><div><strong>{t("Nutzung, nur lesend")}</strong><span>{projection.period} · {t("an den Tenant gebunden; Preise und Grenzen ändert die Console nicht")}</span></div></div>
    <div className="metric-grid monitoring-grid">
      {projection.metrics.slice(0,4).map(item=><article className="console-card metric-tile" key={item.metric}><div><span>{billingMetricLabel(item.metric).toUpperCase()}</span><CircleGauge size={17}/></div><strong>{quantityWithUnit(item)}</strong><small className={item.limit===null?"muted":undefined}>{item.limit===null?t("Keine Grenze gesetzt"):`${formatUsageAmount(item.remaining??"0",item.unit)} ${t("verbleibend")}`}</small></article>)}
    </div>
    <article className="console-card chart-card">
      <div className="card-head"><div><span>{t("MONATSKONTO")}</span><h3>{t("Verbrauch dieser Periode")}</h3></div><button className="secondary-button" onClick={()=>void load()}><RefreshCw size={14}/> {t("Aktualisieren")}</button></div>
      <p className="muted">{t("Je Metrik die Menge und ihre Einheit. Ein Balken steht nur dort, wo eine Quota-Policy wirklich eine Grenze setzt; die Grenze kommt aus der Antwort der Route und wird nicht geschätzt.")}</p>
      <div className="usage-reading">
        {projection.metrics.map(item=>{
          const ratio=usageMeterRatio(item.used,item.limit);
          return <div className="usage-reading-row" key={item.metric}>
            <div><span title={item.metric}>{billingMetricLabel(item.metric)}</span><strong>{quantityWithUnit(item)}</strong></div>
            {ratio===null
              ? <p className="muted">{t("Für diese Metrik ist keine Grenze gesetzt. Der Zähler läuft weiter und weist nichts ab, solange kein Operator eine Quota-Policy dafür anlegt.")}</p>
              : <>
                  <div className={`progress ${meterTone(item.status)}`}><i style={{width:`${usageMeterWidth(ratio)}%`}}/></div>
                  <small>{formatPercent(ratio)} {t("von")} {formatUsageAmount(item.limit??"0",item.unit)} · {usageStatusLabel(item.status)} · {usageModeLabel(item.mode)} · {t("Revision")} {item.revision===null?"–":formatNumber(item.revision)}</small>
                </>}
          </div>;
        })}
      </div>
    </article>
    <InvoicesCard projectId={projectId} environment={environment}/>
  </>;
}

/** Menge samt Einheit; bei Bytes traegt die Zahl ihre Einheit schon selbst. */
function quantityWithUnit(item:Pick<UsageMetricRow,"used"|"unit">){
  const value=formatUsageAmount(item.used,item.unit);
  return item.unit==="bytes"?value:`${value} ${usageUnitLabel(item.unit,item.used)}`;
}

/**
 * Die Farbe des Balkens, aus dem Zustand der Route.
 *
 * Nicht aus dem Anteil gerechnet: Wo die Warnschwelle liegt, entscheidet der
 * Dienst, und eine zweite Schwelle hier waere eine Grenze, die sich die
 * Console selbst gesetzt hat.
 */
function meterTone(status:UsageMetricRow["status"]){
  if(status==="exceeded"||status==="exhausted")return "is-over";
  return status==="warning"?"is-warning":"";
}

function formatUsageAmount(value:string,unit:"operations"|"rows"|"bytes"){
  const amount=BigInt(value);
  if(unit!=="bytes")return formatNumber(amount);
  const units=[["PB",1125899906842624n],["TB",1099511627776n],["GB",1073741824n],["MB",1048576n],["KB",1024n]] as const;
  for(const [label,size] of units){if(amount>=size){const tenths=amount*10n/size;return `${formatDecimal(Number(tenths)/10,1)} ${label}`;}}
  return `${amount} B`;
}
function usageStatusLabel(status:UsageMetricRow["status"]){return ({unlimited:t("ohne Grenze"),ok:t("im Rahmen"),warning:t("an der Warnschwelle"),exhausted:t("ausgeschöpft"),exceeded:t("überschritten")} as const)[status];}
/** Was die Betriebsart im Betrieb bedeutet, nicht ihr Name in der Datenbank. */
function usageModeLabel(mode:UsageMetricRow["mode"]){return ({unlimited:t("ohne Quota-Policy"),observe:t("nur beobachtend"),enforce:t("abweisend")} as const)[mode];}
