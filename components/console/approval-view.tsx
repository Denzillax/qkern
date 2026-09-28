"use client";

import { useEffect, useState } from "react";
import { Database, ShieldCheck } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import type {
  Approval, AutomationMode, ChangeSet, Environment, ProjectAutomationPolicy, Risk,
} from "@/lib/types";

/**
 * Die Freigabezentrale, aus `console-app.tsx` ausgezogen. Die Freigaben und
 * die Change Sets stehen in den Requisiten; die Regel der Automatik holt
 * diese Seite beim Oeffnen selbst.
 */
function formatTime(value: string) { return formatMoment(value, "hourMinute"); }
function EmptyState({icon:Icon,title,text}:{icon:typeof Database;title:string;text:string}){return <div className="empty-state"><Icon size={28}/><h3>{title}</h3><p>{text}</p></div>}
function CheckIcon(){return <span className="check-icon">✓</span>}

export function ApprovalView({ projectId, environment, approvals, changes, reload }: { projectId: string; environment: Environment; approvals: Approval[]; changes: ChangeSet[]; reload: () => Promise<void> }) {
  const [busy,setBusy]=useState("");
  async function decide(id:string,decision:"approved"|"rejected"){setBusy(id);await fetch(`/api/v1/approvals/${id}/decision`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({decision})});setBusy("");await reload();}
  const scopedApprovals = approvals.filter((approval) => approval.projectId === projectId && approval.environment === environment);
  return <div className="approval-list">
    <AutomationPolicyPanel projectId={projectId} environment={environment}/>
    {scopedApprovals.length===0&&<EmptyState icon={ShieldCheck} title={t("Keine offenen Freigaben")} text={t("Riskante Änderungen von Agenten und aus der Console landen hier.")}/>}
    {scopedApprovals.map(approval=>{const change=changes.find(item=>item.id===approval.changeSetId);return <article className="console-card approval-card" key={approval.id}><div className="approval-top"><span className={`risk ${approval.risk}`}>Risiko {approval.risk}</span><span>{approval.environment}</span><time>{formatTime(approval.createdAt)}</time></div><h2>{approval.action}</h2><p>Angefragt von {approval.requestedBy}. Nichts wurde angewendet.</p>{change&&<><div className="approval-detail-grid"><div><span>{t("BETROFFENE RESSOURCE")}</span><strong>{change.projectId}</strong></div><div><span>{t("CHANGE SET")}</span><strong>{change.id}</strong></div><div><span>{t("STATUS")}</span><strong>{approval.status}</strong></div></div><div className="approval-diff">{change.diff.map(line=><code key={line}>{line}</code>)}</div><div className="test-chips">{change.tests.map(test=><span key={test}><CheckIcon/>{test}</span>)}</div></>}{approval.status==="pending"?<div className="approval-actions"><button className="ghost-button" disabled={busy===approval.id} onClick={()=>decide(approval.id,"rejected")}>{t("Ablehnen")}</button><button className="button" disabled={busy===approval.id} onClick={()=>decide(approval.id,"approved")}>{t("Einmal freigeben")}</button></div>:<div className={`decision-banner ${approval.status}`}>Entscheidung: {approval.status}</div>}</article>})}
  </div>;
}

function AutomationPolicyPanel({ projectId, environment }: { projectId: string; environment: Environment }) {
  const [policy,setPolicy]=useState<ProjectAutomationPolicy|null>(null);
  const [mode,setMode]=useState<AutomationMode>("manual");
  const [maxAutoRisk,setMaxAutoRisk]=useState<Risk>("low");
  const [autoQueue,setAutoQueue]=useState(false);
  const [emergencyStop,setEmergencyStop]=useState(false);
  const [state,setState]=useState<"loading"|"idle"|"saving"|"saved"|"error">("loading");

  useEffect(()=>{let active=true;setState("loading");void fetch(`/api/v1/projects/${projectId}/environments/${environment}/automation-policy`,{cache:"no-store"}).then(async response=>{if(!response.ok)throw new Error("policy unavailable");return (await response.json()).data as ProjectAutomationPolicy;}).then(next=>{if(!active)return;setPolicy(next);setMode(next.mode);setMaxAutoRisk(next.maxAutoRisk);setAutoQueue(next.autoQueue);setEmergencyStop(next.emergencyStop);setState("idle");}).catch(()=>{if(active)setState("error");});return()=>{active=false;};},[projectId,environment]);

  async function save(){setState("saving");const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/automation-policy`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,maxAutoRisk,autoQueue:environment==="production"?false:autoQueue,emergencyStop})});if(!response.ok){setState("error");return;}const next=(await response.json()).data as ProjectAutomationPolicy;setPolicy(next);setState("saved");}
  const description = mode === "manual" ? t("Jede riskante Änderung wartet auf eine menschliche Entscheidung.") : mode === "guarded" ? t("Nur klar begrenzte, nicht-produktive Änderungen bis zur Risikogrenze werden automatisch freigegeben.") : t("Agenten dürfen Änderungen bis zur Risikogrenze ohne Freigabe pro Änderung genehmigen.");
  return <article className={`console-card automation-policy ${emergencyStop?"stopped":""}`}>
    <div className="card-head"><div><span>AUTOMATIK · {environment.toUpperCase()}</span><h3>{t("Freigabemodus")}</h3></div><span className={`automation-status ${emergencyStop?"stopped":mode}`}>{emergencyStop?"NOT-AUS":({manual:t("Manuell"),guarded:t("Abgesichert"),autonomous:t("Autonom")})[mode]}</span></div>
    <p>{description} Jede automatische Entscheidung bleibt im Audit-Log nachvollziehbar.</p>
    <div className="automation-fields">
      <label>{t("Modus")}<select value={mode} onChange={event=>setMode(event.target.value as AutomationMode)}><option value="manual">{t("Manuell")}</option><option value="guarded">{t("Abgesichert")}</option><option value="autonomous">{t("Autonom")}</option></select></label>
      <label>{t("Maximales Auto-Risiko")}<select value={maxAutoRisk} onChange={event=>setMaxAutoRisk(event.target.value as Risk)} disabled={mode==="manual"}><option value="low">{t("Niedrig")}</option><option value="medium">{t("Mittel")}</option><option value="high">{t("Hoch")}</option><option value="critical">{t("Kritisch")}</option></select></label>
      <label className="automation-check"><input type="checkbox" checked={autoQueue&&environment!=="production"} disabled={mode==="manual"||environment==="production"} onChange={event=>setAutoQueue(event.target.checked)}/><span>{t("Nach Auto-Freigabe direkt einreihen")}<small>{environment==="production"?t("Production braucht zusätzlich eine maschinell signierte Release-Autorisierung."):t("Der Worker führt weiterhin alle Datenbank- und Ledger-Prüfungen aus.")}</small></span></label>
      <label className="automation-check danger"><input type="checkbox" checked={emergencyStop} onChange={event=>setEmergencyStop(event.target.checked)}/><span>{t("Not-Aus aktivieren")}<small>{t("Stoppt sofort jede automatische Freigabe und Queue-Einreihung.")}</small></span></label>
    </div>
    {(mode==="autonomous"&&(maxAutoRisk==="high"||maxAutoRisk==="critical"))&&<div className="automation-warning"><ShieldCheck size={15}/><span>{t("Das ist eine weitreichende stehende Autorisierung. Setze sie pro Projekt und Umgebung bewusst.")}</span></div>}
    <div className="automation-footer"><span>{policy?`Revision ${policy.revision}`:t("Regel wird geladen…")}</span>{state==="error"&&<strong>{t("Die Regel konnte nicht geladen oder gespeichert werden.")}</strong>}{state==="saved"&&<strong className="secure">{t("Gespeichert")}</strong>}<button className="button small" onClick={save} disabled={state==="loading"||state==="saving"}><StableLabel current={state==="saving"?t("Speichern…"):t("Regel speichern")} variants={tAll("Speichern…", "Regel speichern")}/></button></div>
  </article>;
}
