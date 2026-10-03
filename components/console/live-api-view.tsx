"use client";

import { useCallback, useEffect, useState } from "react";
import { Braces, ChevronRight, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { CopyValue } from "@/components/console/copy-value";
import { formatMoment } from "@/components/console/console-display";
import { OptionMenu } from "@/components/console/option-menu";

/**
 * Die generierte REST-API und die API-Keys des Projekts, aus
 * `console-app.tsx` ausgezogen.
 *
 * 2.133: Die Sprache des Beispiels waehlt dasselbe Menue wie die Kopfzeile und
 * nicht mehr ein `select` des Betriebssystems. Die Namen der beiden Sprachen
 * sind Bezeichner und werden nicht uebersetzt; die Erklaerzeile sagt, wo das
 * Beispiel laeuft, denn das ist der Unterschied zwischen den zwei Blocks.
 */
type Environment = "development" | "staging" | "production";
type ProjectApiKeyItem = {
  id: string; name: string; kind: "public" | "service"; prefix: string;
  expiresAt: string; revokedAt: string | null; createdAt: string;
};

export function LiveApiView({projectId,environment}:{projectId:string;environment:Environment}) {
  const [language,setLanguage]=useState("typescript");
  const [paths,setPaths]=useState<string[]>([]);
  const [keys,setKeys]=useState<ProjectApiKeyItem[]>([]);
  const [secret,setSecret]=useState("");
  const [message,setMessage]=useState("");
  const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{setMessage("");setLoading(true);const [openapiResponse,keysResponse]=await Promise.all([fetch(`/api/v1/projects/${projectId}/environments/${environment}/generated-openapi?schema=public`,{cache:"no-store"}),fetch(`/api/v1/projects/${projectId}/environments/${environment}/api-keys`,{cache:"no-store"})]);if(openapiResponse.ok){const document=await openapiResponse.json();setPaths(Object.keys(document.paths??{}));}else{setPaths([]);setMessage(t("Die generierte OpenAPI gibt es erst, wenn die Projekt-API-Rolle eingerichtet ist."));}if(keysResponse.ok){setKeys((await keysResponse.json()).data as ProjectApiKeyItem[]);}setLoading(false);},[projectId,environment]);
  useEffect(()=>{void load();},[load]);
  async function createKey(kind:"public"|"service"){const name=window.prompt(`Name für den ${kind==="public"?"Public":"Service"} Key`,kind==="public"?t("Public Key für den Browser"):t("Service Key für den Server"));if(!name)return;const expiresAt=new Date(Date.now()+(kind==="public"?90:30)*24*60*60*1000).toISOString();const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/api-keys`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,kind,expiresAt})});if(!response.ok){setMessage((await response.json()).error??t("Key konnte nicht erstellt werden"));return;}const payload=await response.json();setSecret(payload.data.secret);await load();}
  async function revoke(keyId:string){if(!window.confirm(t("Diesen Key endgültig widerrufen?")))return;const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/api-keys/${keyId}`,{method:"DELETE"});if(response.ok)await load();else setMessage(t("Key konnte nicht widerrufen werden."));}
  const endpoint=paths[0]??`/v1/projects/${projectId}/environments/${environment}/tables/{table}/rows`;
  const typeScriptExample=`const response = await fetch(\n  \"/api${endpoint}?limit=20\",\n  { headers: {\n      Authorization: \"Bearer \" + QKERN_PUBLIC_KEY\n  } }\n);\nconst { data } = await response.json();`;
  const curlExample=`curl '/api${endpoint}?limit=20' -H \"Authorization: Bearer $QKERN_PUBLIC_KEY\"`;
  return <div className="api-console-grid"><article className="console-card endpoint-list"><div className="card-head"><div><span>{t("GENERIERTE REST-API")}</span><h3>{t("Endpunkte aus dem Live-Schema")}</h3></div><span className={!loading&&paths.length?"secure":"muted"}>{loading?t("Lädt…"):paths.length?t("OpenAPI aktuell"):t("Nicht eingerichtet")}</span></div>{paths.map(path=><button key={path}><span className="method get">CRUD</span><code>{path}</code><ChevronRight size={14}/></button>)}{paths.length===0&&<div className="live-module-state compact"><Braces size={24}/><p>{loading?t("Endpunkte und Keys werden geladen…"):message||t("Keine Tabelle mit RLS und Primärschlüssel freigegeben.")}</p></div>}</article><article className="console-card code-sample"><div className="code-head"><span>GET {endpoint}</span><OptionMenu value={language} ariaLabel={t("Sprache des Beispiels")} listLabel={t("Sprache des Beispiels wählen")}
      icon={<Braces size={14} aria-hidden="true"/>}
      onChange={next=>setLanguage(next)}
      options={[
        {id:"typescript",label:"TypeScript",hint:t("Beispiel mit fetch im Browser")},
        {id:"curl",label:"cURL",hint:t("Beispiel für die Kommandozeile")},
      ]}/></div><pre>{language==="typescript"?typeScriptExample:curlExample}</pre><div className="code-note"><ShieldCheck size={14}/> {t("Filter sind parametrisiert; die Zeilen begrenzt die Projektrolle mit RLS.")}</div></article><article className="console-card span-2 api-key-manager"><div className="card-head"><div><span>{t("API-KEYS DES PROJEKTS")}</span><h3>{t("Zugriff für die Umgebung")} {environment}</h3></div><div><button className="secondary-button" onClick={()=>void createKey("public")}><Plus size={13}/> {t("Public Key")}</button><button className="button small" onClick={()=>void createKey("service")}><Plus size={13}/> {t("Service Key")}</button></div></div>{secret&&<div className="one-time-secret"><div><strong>{t("Jetzt kopieren, erscheint nur einmal")}</strong><code>{secret}</code></div><CopyValue value={secret} labels={{copy:t("Kopieren"),copied:t("Kopiert"),failed:t("Kopieren hat nicht geklappt")}}/><button onClick={()=>setSecret("")}><X size={14}/></button></div>}<div className="api-key-list">{keys.map(key=><div key={key.id}><span className={`key-kind ${key.kind}`}>{key.kind}</span><div><strong>{key.name}</strong><code>{key.prefix}…</code></div><span>{key.revokedAt?"widerrufen":`läuft ab ${formatMoment(key.expiresAt, "date")}`}</span>{!key.revokedAt&&<button onClick={()=>void revoke(key.id)} aria-label={t("Key widerrufen")}><Trash2 size={14}/></button>}</div>)}{keys.length===0&&<p className="muted">{t("Noch keine Keys. Das Geheimnis wird nie gespeichert und nur einmal gezeigt.")}</p>}</div></article></div>;
}
