"use client";

import { useCallback, useEffect, useState } from "react";
import { Blocks, Plus, RefreshCw, ShieldCheck, Trash2, Webhook, Zap } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";

type Environment = "development" | "staging" | "production";
type FunctionDefinitionItem={id:string;name:string;image:string;entrypoint:string;timeoutMs:number;memoryMiB:number;egressOrigins:string[];secretRefs:string[];enabled:boolean};
type CronDefinitionItem={id:string;name:string;expression:string;queue:string;enabled:boolean;lastDispatchedAt:string|null};
type WebhookDefinitionItem={id:string;name:string;url:string;eventTypes:string[];signingSecretRef:string;timeoutMs:number;maxAttempts:number;enabled:boolean};
type WebhookDeliveryItem={id:string;eventType:string;status:"pending"|"in_flight"|"delivered"|"dead_lettered";attemptCount:number;lastFailureCode:string|null;settledAt:string|null};

/**
 * Cron-Jobs und Webhooks verwalten.
 *
 * Bis Release 1.20 entstanden beide ausschliesslich ueber direkten
 * Datenbankzugriff: Der Betrieb lief, aber niemand konnte ihm ohne `psql`
 * sagen, was er tun soll.
 *
 * Nur das Aktivierungsflag ist aenderbar. Ausdruck, Queue, Ziel-URL und
 * Signaturreferenz sind unveraenderlich; eine Aenderung ist ein Loeschen und
 * ein neues Anlegen. Diese Entscheidung liegt als Spaltenrecht in der
 * Datenbank, nicht in dieser Ansicht.
 */
export function ComputeView({projectId,environment}:{projectId:string;environment:Environment}) {
  const [cron,setCron]=useState<CronDefinitionItem[]>([]);
  const [webhooks,setWebhooks]=useState<WebhookDefinitionItem[]>([]);
  const [functions,setFunctions]=useState<FunctionDefinitionItem[]>([]);
  const [deliveries,setDeliveries]=useState<WebhookDeliveryItem[]>([]);
  const [selected,setSelected]=useState<string|null>(null);
  const [state,setState]=useState<"loading"|"ready"|"unavailable"|"error">("loading");
  const [message,setMessage]=useState("");
  const base=`/api/v1/projects/${projectId}/environments/${environment}/compute`;

  const load=useCallback(async()=>{setState("loading");setMessage("");try{
    const [cronResponse,webhookResponse,functionResponse]=await Promise.all([
      fetch(`${base}/cron`,{cache:"no-store"}),fetch(`${base}/webhooks`,{cache:"no-store"}),
      fetch(`${base}/functions`,{cache:"no-store"})]);
    const cronPayload=await cronResponse.json();const webhookPayload=await webhookResponse.json();
    const functionPayload=await functionResponse.json();
    if(cronResponse.status===503||webhookResponse.status===503){setCron([]);setWebhooks([]);setFunctions([]);setState("unavailable");
      setMessage(cronPayload.error??webhookPayload.error??t("Compute ist für diese Umgebung deaktiviert."));return;}
    if(!cronResponse.ok)throw new Error(cronPayload.error??t("Cron-Definitionen nicht verfügbar"));
    if(!webhookResponse.ok)throw new Error(webhookPayload.error??t("Webhook-Definitionen nicht verfügbar"));
    if(!functionResponse.ok)throw new Error(functionPayload.error??t("Function-Definitionen nicht verfügbar"));
    setCron(cronPayload.data as CronDefinitionItem[]);setWebhooks(webhookPayload.data as WebhookDefinitionItem[]);
    setFunctions(functionPayload.data as FunctionDefinitionItem[]);setState("ready");
  }catch(cause){setState("error");setMessage(cause instanceof Error?cause.message:t("Compute nicht verfügbar"));}},[base]);
  useEffect(()=>{void load();},[load]);

  async function mutate(path:string,init:RequestInit){const response=await fetch(`${base}${path}`,init);
    if(response.ok){await load();return true;}
    const payload=await response.json().catch(()=>({}));setMessage(payload.error??t("Die Änderung wurde abgelehnt."));return false;}

  async function createCron(){const name=window.prompt(t("Name des Cron-Jobs (Kleinbuchstaben, Ziffern, Bindestrich)"),"nightly-report");if(!name)return;
    const expression=window.prompt(t("Ausdruck in UTC: */N * * * * oder M H * * *"),"*/15 * * * *");if(!expression)return;
    const queue=window.prompt(t("Bestehende Projekt-Queue"),"email_jobs");if(!queue)return;
    await mutate("/cron",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim(),expression:expression.trim(),queue:queue.trim()})});}

  async function createWebhook(){const name=window.prompt(t("Name des Webhooks (Kleinbuchstaben, Ziffern, Bindestrich)"),"order-events");if(!name)return;
    const url=window.prompt(t("Exaktes öffentliches HTTPS-Ziel, ohne Query und Fragment"),"https://receiver.example.com/hooks");if(!url)return;
    const events=window.prompt(t("Ereignistypen, kommagetrennt"),"order.created");if(!events)return;
    // Nur die Referenz. Das Geheimnis selbst liegt im Vault und darf diese
    // Flaeche nie beruehren.
    const signingSecretRef=window.prompt(t("Vault-Referenz des Signaturschlüssels, nie das Geheimnis selbst"),"vault:webhook/orders");if(!signingSecretRef)return;
    await mutate("/webhooks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim(),url:url.trim(),eventTypes:events.split(",").map(entry=>entry.trim()).filter(Boolean),signingSecretRef:signingSecretRef.trim()})});}

  async function createFunction(){const name=window.prompt(t("Name der Function (Kleinbuchstaben, Ziffern, Bindestrich)"),"resize-image");if(!name)return;
    // Digest statt Tag: Ein Tag koennte morgen einen anderen Inhalt bezeichnen.
    const image=window.prompt(t("Image per Digest, zum Beispiel registry.example.com/app/fn@sha256:…"),"");if(!image)return;
    const entrypoint=window.prompt(t("Entrypoint im Image"),"handler.mjs");if(!entrypoint)return;
    await mutate("/functions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim(),image:image.trim(),entrypoint:entrypoint.trim()})});}

  async function testInvoke(fn:FunctionDefinitionItem){
    setMessage(`${fn.name} läuft…`);
    const response=await fetch(`${base}/invoke/${fn.name}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({source:"console"})});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok){setMessage(payload.error??t("Die Function konnte nicht ausgeführt werden"));return;}
    setMessage(`${fn.name} antwortete mit Status ${payload.data?.statusCode ?? "?"}.`);}

  async function showDeliveries(webhook:WebhookDefinitionItem){
    if(selected===webhook.id){setSelected(null);setDeliveries([]);return;}
    const response=await fetch(`${base}/webhooks/${webhook.id}/deliveries?limit=20`,{cache:"no-store"});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok){setMessage(payload.error??t("Zustellstatus nicht verfügbar"));return;}
    setSelected(webhook.id);setDeliveries(payload.data as WebhookDeliveryItem[]);}

  if(state==="loading")return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Functions, Cron und Webhooks werden geladen…")}</h3></div>;
  if(state==="unavailable")return <div className="console-card live-module-state"><Webhook size={26}/><h3>{t("Compute nicht aktiviert")}</h3><p>{message}</p><button className="secondary-button" onClick={()=>void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  return <div className="module-grid">
    <article className="console-card span-2"><div className="card-head"><div><span>FUNCTIONS · {environment.toUpperCase()}</span><h3>{t("Ausführung in der Sandbox")}</h3></div><button className="button small" onClick={()=>void createFunction()}><Plus size={14}/> {t("Neue Function")}</button></div>
      {functions.length===0&&<p className="muted">Noch keine Functions. Das Image muss per Digest festgelegt sein; die Sandbox startet es ohne Netz, nur lesend, ohne Root und mit harter Speichergrenze.</p>}
      {functions.map(fn=><div className="bucket-row" key={fn.id}><span className="bucket-icon"><Blocks size={16}/></span>
        <div><strong>{fn.name}</strong><small>{fn.entrypoint} · {fn.memoryMiB} MiB · {fn.timeoutMs} ms · {fn.egressOrigins.length?`${fn.egressOrigins.length} Ausgangsziele (noch nicht ausführbar)`:t("kein Ausgang")}{fn.secretRefs.length?` · ${fn.secretRefs.length} Secret-Referenzen`:""}</small></div>
        <span className={fn.enabled?"secure":"muted"}>{fn.enabled?t("aktiv"):t("pausiert")}</span>
        <button className="plain-button" onClick={()=>void testInvoke(fn)} disabled={!fn.enabled}>{t("Testlauf")}</button>
        <button className="plain-button" onClick={()=>void mutate(`/functions/${fn.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!fn.enabled})})}><StableLabel current={fn.enabled?t("Pausieren"):t("Aktivieren")} variants={tAll("Pausieren", "Aktivieren")}/></button>
        <button className="icon-button" onClick={()=>{if(window.confirm(`Function ${fn.name} löschen? Image und Grenzen lassen sich nicht ändern; eine Änderung ist Löschen und neu Anlegen.`))void mutate(`/functions/${fn.id}`,{method:"DELETE"});}} aria-label={`${fn.name} löschen`}><Trash2 size={14}/></button></div>)}
    </article>
    <article className="console-card span-2"><div className="card-head"><div><span>CRON · {environment.toUpperCase()}</span><h3>{t("Geplante Einreihung")}</h3></div><button className="button small" onClick={()=>void createCron()}><Plus size={14}/> {t("Neuer Cron-Job")}</button></div>
      {message&&<p className="muted">{message}</p>}
      {cron.length===0&&<p className="muted">{t("Noch keine Cron-Jobs. Jeder Termin landet mit festem Dedupe-Schlüssel in einer bestehenden Projekt-Queue, damit zwei Scheduler genau eine Nachricht erzeugen.")}</p>}
      {cron.map(job=><div className="bucket-row" key={job.id}><span className="bucket-icon"><Zap size={16}/></span>
        <div><strong>{job.name}</strong><small>{job.expression} UTC → {job.queue} · {job.lastDispatchedAt?`zuletzt ${formatMoment(job.lastDispatchedAt)}`:t("noch nie eingereiht")}</small></div>
        <span className={job.enabled?"secure":"muted"}>{job.enabled?t("aktiv"):t("pausiert")}</span>
        <button className="plain-button" onClick={()=>void mutate(`/cron/${job.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!job.enabled})})}><StableLabel current={job.enabled?t("Pausieren"):t("Aktivieren")} variants={tAll("Pausieren", "Aktivieren")}/></button>
        <button className="icon-button" onClick={()=>{if(window.confirm(`Cron-Job ${job.name} löschen? Ausdruck und Queue lassen sich nicht ändern; eine Änderung ist Löschen und neu Anlegen.`))void mutate(`/cron/${job.id}`,{method:"DELETE"});}} aria-label={`${job.name} löschen`}><Trash2 size={14}/></button></div>)}
    </article>
    <article className="console-card"><div className="card-head"><div><span>{t("ZUSTELLVERTRAG")}</span><h3>{t("Signiert und bestätigt")}</h3></div><ShieldCheck className="secure" size={21}/></div>
      <p className="muted">{t("Jede Zustellung ist mit HMAC-SHA256 über Zeitstempel und Body signiert. Der Empfänger muss 2xx antworten")} <em>{t("und")}</em> {t("den Header")} <code>{"x-qkern-delivery-id"}</code> {t("zurückgeben, sonst zählt der Versuch als fehlgeschlagen und der Server entscheidet über die Wiederholung. Payloads erscheinen hier nie.")}</p></article>
    <article className="console-card span-2"><div className="card-head"><div><span>WEBHOOKS · {environment.toUpperCase()}</span><h3>{t("Ziele für ausgehende Zustellungen")}</h3></div><button className="button small" onClick={()=>void createWebhook()}><Plus size={14}/> {t("Neuer Webhook")}</button></div>
      {webhooks.length===0&&<p className="muted">{t("Noch keine Webhooks. Ziele müssen exakte öffentliche HTTPS-URLs auf Port 443 sein, ohne Query und Fragment. Dieselbe Regel prüft der Zusteller, also wird ein hier angenommenes Ziel später nicht abgelehnt.")}</p>}
      {webhooks.map(hook=><div key={hook.id}>
        <div className="bucket-row"><span className="bucket-icon"><Webhook size={16}/></span>
          <div><strong>{hook.name}</strong><small>{hook.url} · {hook.eventTypes.join(", ")} · {hook.maxAttempts} Versuche · Schlüssel {hook.signingSecretRef}</small></div>
          <span className={hook.enabled?"secure":"muted"}>{hook.enabled?t("aktiv"):t("pausiert")}</span>
          <button className="plain-button" onClick={()=>void showDeliveries(hook)}><StableLabel current={selected===hook.id?t("Status ausblenden"):t("Zustellstatus")} variants={tAll("Status ausblenden", "Zustellstatus")}/></button>
          <button className="plain-button" onClick={()=>void mutate(`/webhooks/${hook.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!hook.enabled})})}><StableLabel current={hook.enabled?t("Pausieren"):t("Aktivieren")} variants={tAll("Pausieren", "Aktivieren")}/></button>
          <button className="icon-button" onClick={()=>{if(!hook.enabled&&window.confirm(`Webhook ${hook.name} löschen? Offene Zustellungen verschwinden mit ihm.`))void mutate(`/webhooks/${hook.id}`,{method:"DELETE"});else if(hook.enabled)setMessage(t("Pausiere den Webhook vor dem Löschen; mit ihm verschwinden auch die offenen Zustellungen."));}} aria-label={`${hook.name} löschen`}><Trash2 size={14}/></button></div>
        {selected===hook.id&&<div className="detail-list">{deliveries.length===0?<div><span>{t("Keine Zustellungen")}</span><strong className="muted">–</strong></div>:deliveries.map(delivery=><div key={delivery.id}><span>{delivery.eventType}<small>Versuch {delivery.attemptCount}{delivery.lastFailureCode?` · ${delivery.lastFailureCode}`:""}</small></span><strong className={delivery.status==="delivered"?"secure":delivery.status==="dead_lettered"?"risk high":""}>{delivery.status}</strong></div>)}</div>}
      </div>)}
    </article>
  </div>;
}
