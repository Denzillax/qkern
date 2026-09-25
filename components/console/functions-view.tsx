"use client";

import { useCallback, useEffect, useState } from "react";
import { FunctionSquare, RefreshCw } from "lucide-react";
import { t } from "@/components/console/console-i18n";

/**
 * Funktionen in der Console (2.18): Funktionen und Prozeduren des Schemas
 * public, gelesen über `/schema/functions`. Nur lesend und ohne Quelltext;
 * eine Funktion entsteht wie jede Schemaänderung über ein Change Set.
 */
type Environment = "development" | "staging" | "production";
type Fn = {
  name: string; kind: "function" | "procedure"; language: string; arguments: string; identityArguments: string;
  returnType: string | null; returnsSet: boolean; volatility: "immutable" | "stable" | "volatile"; securityDefiner: boolean;
};

export function FunctionsView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const [functions, setFunctions] = useState<Fn[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/environments/${environment}/schema/functions?schema=public`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503 || response.status === 409) { setState("unavailable"); setMessage(payload.error ?? t("Die Projektdatenbank ist noch nicht bereit.")); return; }
      if (!response.ok) throw new Error(payload.error ?? t("Funktionen nicht verfügbar"));
      setFunctions(payload.data.functions as Fn[]); setTruncated(Boolean(payload.data.truncated)); setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("Funktionen nicht verfügbar")); }
  }, [projectId, environment]);
  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Funktionen werden geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><FunctionSquare size={26}/><h3>{state === "unavailable" ? t("Datenbank nicht bereit") : t("Funktionen nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const shown = functions.filter((fn) => `${fn.name} ${fn.language} ${fn.returnType ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const volatilityLabel: Record<Fn["volatility"], string> = { immutable: t("unveränderlich"), stable: t("stabil"), volatile: t("veränderlich") };

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("FUNKTIONEN")}</span><strong>{functions.filter((fn) => fn.kind === "function").length}</strong><small>{t("im Schema public")}</small></div>
      <div><span>{t("PROZEDUREN")}</span><strong>{functions.filter((fn) => fn.kind === "procedure").length}</strong><small>{t("ohne Rückgabe")}</small></div>
      <div><span>{t("SECURITY DEFINER")}</span><strong>{functions.filter((fn) => fn.securityDefiner).length}</strong><small>{t("laufen mit den Rechten des Eigentümers")}</small></div>
    </article>
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("DATENBANK")} · {environment.toUpperCase()}</span><h3>{t("Funktionen im Schema public")}</h3></div><div><div className="toolbar-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Nach Name, Sprache oder Rückgabetyp filtern…")}/></div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button></div></div>
      {functions.length === 0 && <p className="muted">{t("Keine Funktionen im Schema public. Eine Funktion entsteht wie jede Schemaänderung über ein Change Set: SQL im SQL Editor, Vorschau, Freigabe.")}</p>}
      {truncated && <p className="muted">{t("Die Liste ist bei 200 Funktionen abgeschnitten.")}</p>}
      {shown.map((fn) => <div className="bucket-row" key={`${fn.name}(${fn.identityArguments})`}><span className="bucket-icon"><FunctionSquare size={16}/></span>
        <div><strong>{fn.name}({fn.arguments})</strong><small>{fn.kind === "procedure" ? t("Prozedur") : `→ ${fn.returnType ?? ""}`} · {fn.language} · {volatilityLabel[fn.volatility]}</small></div>
        <span className={fn.securityDefiner ? "risk medium" : "secure"}>{fn.securityDefiner ? "SECURITY DEFINER" : "SECURITY INVOKER"}</span>
      </div>)}
      {functions.length > 0 && shown.length === 0 && <p className="muted">{t("Keine Funktion passt zum Filter.")}</p>}
      <p className="muted">{t("Der Quelltext wird hier nicht gezeigt; er kann Geheimnisse enthalten.")}</p>
    </article>
  </div>;
}
