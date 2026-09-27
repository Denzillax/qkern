"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Blocks, Container, FileClock, RefreshCw, Send } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment, formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import {
  CONTAINER_LOG_TEXTS,
  DEPLOYMENT_COLUMNS,
  MISSING_LOG_STATES,
} from "@/lib/console/missing-log-texts";

/**
 * Functions → Function-Logs (2.84) — die ehrliche Antwort auf einen
 * Platzhalter, der „Ausgaben aus dem Container" versprochen hat.
 *
 * Diese Ausgabe gibt es nicht, und sie fehlt nicht bloss noch. Nachgesehen im
 * Quelltext, und zwar an drei Stellen:
 *
 * 1. Migration 0045 haelt `stdout` und `stderr` ausdruecklich nicht und
 *    schreibt den Grund selbst hin: fremder Code, der alles gesehen haben
 *    koennte.
 * 2. In `function-sandbox-docker` ist `stdout` gar kein Ausgabekanal, sondern
 *    die JSON-Leitung zwischen Host und Container. Eine Zeile, die kein JSON
 *    ist, beendet den Aufruf. Eine Function kann darauf also nicht
 *    protokollieren.
 * 3. `stderr` wird nur gezaehlt und bei 8 KiB gekappt; die Bytes werden nie zu
 *    einer Zeichenkette und landen nirgends. Der Container laeuft mit `--rm`
 *    und wird danach hart entfernt, also gibt es auch kein spaeteres
 *    `docker logs`.
 *
 * Gezeigt wird deshalb, was es wirklich gibt, jedes Stueck mit seinem Namen:
 * die Einsatzhistorie je Function (Revision, Image mit Digest, wer, wann) aus
 * Migration 0042, und die Zahl der protokollierten Aufrufe mit dem Verweis auf
 * Logs → Functions. Welches Image lief, ist bekannt; was es sagte, nicht.
 *
 * Die Einsatzhistorie ist bis hier in keiner Ansicht der Console gelesen
 * worden. Sie ist die eine echte Lesung, die dieser Platzhalter hergibt.
 *
 * Nur lesend: drei GETs, kein Schreibverb.
 */
type Environment = "development" | "staging" | "production";
type FunctionItem = { id: string; name: string };
type Deployment = { revision: number; image: string; deployedBy: string; deployedAt: string };
type State = "loading" | "ready" | "disabled" | "unavailable" | "error";
type Payload = Record<string, unknown>;

const COMPUTE_DISABLED_ERROR = "Compute definitions are disabled";

/** GET mit JSON-Antwort; ein Body, der kein Objekt ist, wird zu `{}`. */
async function readJson(url: string, signal: AbortSignal): Promise<{ status: number; payload: Payload }> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    const body: unknown = (await response.json().catch(() => ({}))) ?? {};
    return { status: response.status, payload: body !== null && typeof body === "object" && !Array.isArray(body) ? body as Payload : {} };
  } catch (cause) {
    return { status: 0, payload: { error: cause instanceof Error ? cause.message : "" } };
  }
}

export function FunctionContainerLogView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/compute`;
  const [functions, setFunctions] = useState<FunctionItem[]>([]);
  const [selected, setSelected] = useState("");
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [invocations, setInvocations] = useState<number | null>(null);
  const [state, setState] = useState<State>("loading");
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null);

  // Jede Ladung hat einen eigenen AbortController; eine abgebrochene setzt
  // keinen Zustand mehr.
  const load = useCallback(async (initial: boolean, functionId: string) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (initial) setState("loading"); else setRefreshing(true);

    const list = await readJson(`${base}/functions`, controller.signal);
    if (controller.signal.aborted) return;

    const error = typeof list.payload.error === "string" ? list.payload.error : "";
    if (list.status === 503) {
      setRefreshing(false);
      setFunctions([]);
      setDeployments([]);
      setState(error === COMPUTE_DISABLED_ERROR ? "disabled" : "unavailable");
      setMessage(error);
      return;
    }
    if (list.status !== 200 || !Array.isArray(list.payload.data)) {
      setRefreshing(false);
      setFunctions([]);
      setDeployments([]);
      setMessage(error || t("Functions nicht verfügbar"));
      setState("error");
      return;
    }
    const items = (list.payload.data as FunctionItem[]).map((entry) => ({ id: entry.id, name: entry.name }));
    setFunctions(items);

    // Ohne Function gibt es keinen Einsatz, den man nachfragen koennte.
    const wanted = items.some((entry) => entry.id === functionId) ? functionId : items[0]?.id ?? "";
    setSelected(wanted);

    // Die Zahl der Aufrufe kommt aus derselben Quelle wie Logs → Functions.
    // Ein Fehlschlag hier laesst die Zahl weg, statt eine zu erfinden.
    const [history, log] = await Promise.all([
      wanted ? readJson(`${base}/functions/${wanted}/deployments`, controller.signal)
        : Promise.resolve({ status: 200, payload: { data: [] } as Payload }),
      readJson(`${base}/invocations?limit=1&offset=0`, controller.signal),
    ]);
    if (controller.signal.aborted) return;
    setRefreshing(false);

    setDeployments(history.status === 200 && Array.isArray(history.payload.data)
      ? history.payload.data as Deployment[] : []);
    const counts = (log.payload.data as { counts?: { completed: number; failed: number } } | undefined)?.counts;
    setInvocations(log.status === 200 && counts ? counts.completed + counts.failed : null);
    setMessage("");
    setState("ready");
  }, [base]);

  useEffect(() => {
    void load(true, selected);
    return () => request.current?.abort();
    // `selected` bewusst nicht in der Liste: Ein Wechsel laedt ueber
    // `changeFunction` neu, und hier wuerde er eine zweite Ladung anstossen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Function-Logs werden geladen…")}</h3></div>;
  }

  const changeFunction = (next: string) => {
    setSelected(next);
    void load(false, next);
  };

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t(CONTAINER_LOG_TEXTS.kicker)} · {environment.toUpperCase()}</span><h3>{t(CONTAINER_LOG_TEXTS.title)}</h3></div><div>
        <button className="secondary-button" onClick={() => void load(false, selected)} disabled={refreshing}>
          <RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/>
        </button>
      </div></div>
      <p className="risk medium">{t(CONTAINER_LOG_TEXTS.noOutput)}</p>
      <p className="muted">{t(CONTAINER_LOG_TEXTS.stdoutIsProtocol)}</p>
      <p className="muted">{t(CONTAINER_LOG_TEXTS.stderrIsCounted)}</p>
      <p className="muted">{t(CONTAINER_LOG_TEXTS.containerIsGone)}</p>
      <p className="muted">{t(CONTAINER_LOG_TEXTS.neverInIt)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS ES GIBT")}</span><h3>{t(CONTAINER_LOG_TEXTS.deploymentsTitle)}</h3></div><div>
        {functions.length > 0 && <label className="table-select"><Blocks size={15}/>
          <select value={selected} onChange={(event) => changeFunction(event.target.value)} aria-label={t("Function")}>
            {functions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>}
        <Container size={18}/>
      </div></div>
      <p className="muted">{t(CONTAINER_LOG_TEXTS.deploymentsMeaning)}</p>
      <p className="muted">{t(CONTAINER_LOG_TEXTS.deploymentsLimit)}</p>

      {state === "disabled" && <p className="muted">{t(MISSING_LOG_STATES.computeDisabled)}</p>}
      {state === "unavailable" && <p className="muted">{t(MISSING_LOG_STATES.unavailable)}</p>}
      {state === "error" && <p className="muted">{message || t("Functions nicht verfügbar")}</p>}

      {state === "ready" && functions.length === 0 && <p className="muted">{t(MISSING_LOG_STATES.noFunctions)}</p>}
      {state === "ready" && functions.length > 0 && deployments.length === 0 && <p className="muted">{t(MISSING_LOG_STATES.noDeployments)}</p>}

      {deployments.length > 0 && <>
        <div className="log-row log-header">
          {DEPLOYMENT_COLUMNS.map((column) => <span key={column.label}>{t(column.label)}</span>)}
        </div>
        {deployments.map((entry) => <div className="log-row" key={entry.revision}>
          <code>{formatNumber(entry.revision)}</code>
          <code>{entry.image}</code>
          <span>{entry.deployedBy}</span>
          <time>{formatMoment(entry.deployedAt)}</time>
        </div>)}
        {/* Die Spaltenkunde steht bei der Tabelle, die sie erklaert. */}
        <div className="log-row log-header"><span>{t("Spalte")}</span><span>{t("Was sie sagt")}</span></div>
        {DEPLOYMENT_COLUMNS.map((column) => <div className="log-row" key={column.label}>
          <span>{t(column.label)}</span>
          <span className="muted">{t(column.meaning)}</span>
        </div>)}
      </>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS ES GIBT")}</span><h3>{t(CONTAINER_LOG_TEXTS.invocationsTitle)}</h3></div><FileClock size={18}/></div>
      {invocations !== null && <div className="auth-overview">
        <div><span>{t("PROTOKOLLIERTE AUFRUFE")}</span><strong>{formatNumber(invocations)}</strong><small>{t("in dieser Umgebung, über alle Functions")}</small></div>
      </div>}
      <p className="muted">{t(CONTAINER_LOG_TEXTS.invocationsMeaning)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("FÜR BETREIBER")}</span><h3>{t(CONTAINER_LOG_TEXTS.operatorTitle)}</h3></div><Send size={18}/></div>
      <p className="muted">{t(CONTAINER_LOG_TEXTS.operatorSteps)}</p>
      <p className="muted">{t(CONTAINER_LOG_TEXTS.operatorDrain)}</p>
    </article>
  </div>;
}
