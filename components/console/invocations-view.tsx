"use client";

import { useCallback, useEffect, useState } from "react";
import { Blocks, RefreshCw } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { formatMoment } from "@/components/console/console-display";
import { OptionMenu } from "@/components/console/option-menu";

/**
 * Function-Aufrufe in der Console (2.7). Die Route gibt es seit 1.89:
 * Beginn, Dauer, Ausgang, Statuscode oder fester Fehlercode je Aufruf,
 * neueste zuerst, ohne stdout/stderr (die stehen seit 2.67.0 unter
 * Function-Logs) — was der Container gesehen hat,
 * bleibt im Container.
 */
type Environment = "development" | "staging" | "production";
type FunctionItem = { id: string; name: string; entrypoint: string; timeoutMs: number; memoryMiB: number; enabled: boolean };
type Invocation = { invocationId: string; invokedBy: string; startedAt: string; durationMs: number; outcome: "completed" | "failed"; statusCode: number | null; errorCode: string | null };

export function InvocationsView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading" | "ready" | "unavailable" | "error" }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/compute`;
  const [functions, setFunctions] = useState<FunctionItem[]>([]);
  const [selected, setSelected] = useState("");
  const [invocations, setInvocations] = useState<Invocation[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">(initialState ?? "loading");
  const [message, setMessage] = useState("");

  const loadInvocations = useCallback(async (id: string) => {
    if (!id) { setInvocations([]); return; }
    const response = await fetch(`${base}/functions/${id}/invocations?limit=100`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(payload.error ?? t("Aufrufe nicht verfügbar")); setInvocations([]); return; }
    setMessage(""); setInvocations(payload.data as Invocation[]);
  }, [base]);

  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch(`${base}/functions`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503) { setState("unavailable"); setMessage(payload.error ?? t("Compute ist für diese Umgebung deaktiviert.")); return; }
      if (!response.ok) throw new Error(payload.error ?? t("Function-Definitionen nicht verfügbar"));
      const list = payload.data as FunctionItem[];
      setFunctions(list);
      const first = list[0]?.id ?? "";
      setSelected(first);
      await loadInvocations(first);
      setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("Function-Definitionen nicht verfügbar")); }
  }, [base, loadInvocations]);
  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Functions werden geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><Blocks size={26}/><h3>{state === "unavailable" ? t("Compute nicht aktiviert") : t("Compute nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const failed = invocations.filter((item) => item.outcome === "failed").length;
  const average = invocations.length ? Math.round(invocations.reduce((sum, item) => sum + item.durationMs, 0) / invocations.length) : 0;
  const current = functions.find((fn) => fn.id === selected);

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("AUFRUFE")}</span><strong>{invocations.length}</strong><small>{t("zuletzt geladen, neueste zuerst")}</small></div>
      <div><span>{t("FEHLGESCHLAGEN")}</span><strong>{failed}</strong><small>{invocations.length ? `${Math.round(failed / invocations.length * 100)}%` : "–"}</small></div>
      <div><span>{t("DAUER")}</span><strong>{average} ms</strong><small>{t("im Mittel")}</small></div>
    </article>
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("FUNCTIONS")} · {environment.toUpperCase()}</span><h3>{t("Aufrufprotokoll")}</h3></div><div>
        {/* Dasselbe Bauteil wie das Umgebungsmenue in der Kopfzeile. Die
            Erklaerzeile traegt den Einstiegspunkt: Zwei Functions heissen
            verschieden, aber welche Datei und welche Funktion laufen, steht
            nur hier -- und `index.handler` bleibt in jeder Sprache
            `index.handler`. Eine pausierte Function bekommt keinen neuen
            Aufruf, und das erklaert ein leeres Protokoll darunter. */}
        <OptionMenu value={selected} ariaLabel={t("Function")} listLabel={t("Function wählen")}
          icon={<Blocks size={14} aria-hidden="true"/>}
          onChange={(next) => { setSelected(next); void loadInvocations(next); }}
          options={functions.map((fn) => ({
            id: fn.id, label: fn.name,
            hint: fn.enabled ? fn.entrypoint : `${fn.entrypoint} · ${t("pausiert")}`,
          }))}/>
        <button className="secondary-button" onClick={() => void loadInvocations(selected)} disabled={!selected}><RefreshCw size={14}/> {t("Neu laden")}</button></div></div>
      {functions.length === 0 && <p className="muted">{t("Noch keine Functions. Lege eine unter Functions & Jobs an; jeder Aufruf erscheint dann hier.")}</p>}
      {message && <p className="muted">{message}</p>}
      {current && <p className="muted">{current.entrypoint} · {current.memoryMiB} MiB · {current.timeoutMs} ms · {current.enabled ? t("aktiv") : t("pausiert")}</p>}
      {current && invocations.length === 0 && !message && <p className="muted">{t("Noch kein Aufruf protokolliert. Ein Testlauf unter Functions & Jobs erzeugt den ersten.")}</p>}
      {invocations.length > 0 && <div className="log-row log-header"><span>{t("Zeit")}</span><span>{t("Ausgelöst von")}</span><span>{t("Dauer")}</span><span>{t("Ausgang")}</span><span>{t("Status")}</span></div>}
      {invocations.map((item) => <div className="log-row" key={item.invocationId}>
        <time>{formatMoment(item.startedAt, "dateTimeSeconds")}</time>
        <span>{item.invokedBy}</span>
        <code>{item.durationMs} ms</code>
        <span className={item.outcome === "completed" ? "secure" : "risk high"}>{item.outcome === "completed" ? t("erfolgreich") : t("fehlgeschlagen")}</span>
        <span className={`log-status ${item.outcome}`}>{item.statusCode ?? item.errorCode ?? "–"}</span>
      </div>)}
    </article>
  </div>;
}
