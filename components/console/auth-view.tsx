"use client";

import { useCallback, useEffect, useState } from "react";
import { Fingerprint, RefreshCw } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment, formatPercent } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import { loadConsoleAuthProviders, type ConsoleAuthProviderResult } from "@/components/console/auth-providers";

/**
 * Auth (die Nutzer der Anwendung), aus `console-app.tsx` ausgezogen.
 */
type Environment = "development" | "staging" | "production";
type ProjectAuthUserItem={id:string;email:string;status:"active"|"disabled";emailVerifiedAt:string|null;createdAt:string;appMetadata:Record<string,unknown>};
export function AuthView({projectId,environment}:{projectId:string;environment:Environment}) {
  const [users,setUsers]=useState<ProjectAuthUserItem[]>([]);const [state,setState]=useState<"loading"|"ready"|"unavailable"|"error">("loading");const [message,setMessage]=useState("");const [jwks,setJwks]=useState(false);
  const load=useCallback(async()=>{setState("loading");setMessage("");try{const [usersResponse,jwksResponse]=await Promise.all([fetch(`/api/v1/projects/${projectId}/environments/${environment}/auth/admin/users?limit=100`,{cache:"no-store"}),fetch(`/api/v1/projects/${projectId}/environments/${environment}/auth/.well-known/jwks.json`,{cache:"no-store"})]);setJwks(jwksResponse.ok);if(usersResponse.status===503){setState("unavailable");setMessage(t("Project Auth ist für diese Umgebung deaktiviert."));return;}const payload=await usersResponse.json();if(!usersResponse.ok)throw new Error(payload.error??t("Nutzer nicht verfügbar"));setUsers(payload.data.users);setState("ready");}catch(cause){setState("error");setMessage(cause instanceof Error?cause.message:t("Nutzer nicht verfügbar"));}},[projectId,environment]);
  useEffect(()=>{void load();},[load]);
  async function toggle(user:ProjectAuthUserItem){const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/auth/admin/users/${user.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:user.status==="active"?"disabled":"active"})});if(response.ok)await load();else setMessage(t("Der Status konnte nicht geändert werden."));}
  const active=users.filter(user=>user.status==="active").length;const verified=users.filter(user=>Boolean(user.emailVerifiedAt)).length;
  if(state==="loading")return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Project Auth wird geladen…")}</h3></div>;
  if(state==="unavailable"||state==="error")return <div className="console-card live-module-state"><Fingerprint size={26}/><h3>{state==="unavailable"?t("Project Auth nicht aktiviert"):t("Project Auth nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={()=>void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;
  return <div className="module-grid"><article className="console-card auth-overview"><div><span>{t("APP-NUTZER")}</span><strong>{users.length}</strong><small>{t("Aus dieser Umgebung")}</small></div><div><span>{t("AKTIV")}</span><strong>{active}</strong><small>{users.length?`${formatPercent(active/users.length, 0)} der Nutzer`:t("Keine Nutzer")}</small></div><div><span>{t("E-MAIL BESTÄTIGT")}</span><strong>{verified}</strong><small>{jwks?t("JWKS online"):t("JWKS nicht erreichbar")}</small></div></article><article className="console-card span-2"><div className="card-head"><div><span>{t("PROJECT AUTH")}</span><h3>{t("Nutzer der Anwendung")}</h3></div><button className="secondary-button" onClick={()=>void load()}><RefreshCw size={14}/> {t("Neu laden")}</button></div>{users.map(user=><div className="auth-user" key={user.id}><span className="avatar">{user.email.slice(0,2).toUpperCase()}</span><div><strong>{user.email}</strong><small>{user.emailVerifiedAt?`Bestätigt am ${formatMoment(user.emailVerifiedAt, "date")}`:t("Bestätigung ausstehend")}</small></div><span>{Object.keys(user.appMetadata).length?t("Metadaten"):t("E-Mail")}</span><span className={user.status==="active"?"secure":"muted"}>{user.status}</span><button className="plain-button" onClick={()=>void toggle(user)}><StableLabel current={user.status==="active"?t("Deaktivieren"):t("Aktivieren")} variants={tAll("Deaktivieren", "Aktivieren")}/></button></div>)}{users.length===0&&<div className="live-module-state compact"><Fingerprint size={24}/><p>{t("Noch keine Nutzer. Sie kommen über Signup, Magic Link oder OIDC herein.")}</p></div>}</article><article className="console-card"><div className="card-head"><div><span>{t("AUTH-VERTRAG")}</span><h3>{t("Verfügbare Verfahren")}</h3></div></div><div className="detail-list"><div><span>{t("E-Mail und Passwort")}</span><strong className="secure">{t("Bereit")}</strong></div><div><span>{t("Magic Link / Reset")}</span><strong className="secure">{t("Bereit")}</strong></div><div><span>{t("TOTP + Recovery")}</span><strong className="secure">{t("Bereit")}</strong></div><div><span>{t("OIDC + PKCE")}</span><strong><OidcProviderSummary projectId={projectId} environment={environment}/></strong></div><div><span>{t("Ed25519 JWKS")}</span><strong className={jwks?"secure":""}>{jwks?t("Online"):t("Nicht erreichbar")}</strong></div></div></article></div>;
}

/**
 * Die konfigurierten OIDC-Provider — geladen ueber die Admin-Route aus 1.83.
 * Der Ladeweg steckt in `loadConsoleAuthProviders`; hier wird er eingehaengt.
 */
function OidcProviderSummary({projectId,environment}:{projectId:string;environment:Environment}) {
  const [result,setResult]=useState<ConsoleAuthProviderResult|null>(null);
  useEffect(()=>{let cancelled=false;void loadConsoleAuthProviders(projectId,environment).then(loaded=>{if(!cancelled)setResult(loaded);});return ()=>{cancelled=true;};},[projectId,environment]);
  if(result===null)return <>…</>;
  if(result.state!=="ready")return <>{t("Nicht verfügbar")}</>;
  if(result.providers.length===0)return <>{t("Keine Provider konfiguriert")}</>;
  return <>{result.providers.map(provider=>provider.id).join(", ")}</>;
}
