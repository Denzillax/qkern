"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Blocks, Container, FileClock, RefreshCw, Send, Terminal } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment, formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import { OptionMenu } from "@/components/console/option-menu";
import {
  CONTAINER_LOG_TEXTS,
  DEPLOYMENT_COLUMNS,
  MISSING_LOG_STATES,
  OUTPUT_COLUMNS,
  OUTPUT_INVOCATION_COLUMNS,
  OUTPUT_WORDS,
} from "@/lib/console/missing-log-texts";

/**
 * Functions → Function-Logs (2.98): die Inhaltslogs je Aufruf.
 *
 * Bis 2.97 war diese Seite die ehrliche Antwort auf einen Platzhalter: Die
 * Ausgabe des Containers gab es nicht, und die Seite sagte, warum. Seit 2.67.0
 * gibt es sie, aus Migration 0069, und die Seite zeigt sie:
 *
 * 1. Function waehlen (aus `compute/functions`).
 * 2. Aufruf waehlen (aus `compute/invocations?function=…`, neueste zuerst).
 * 3. Die Ausgabe des Aufrufs lesen (`compute/invocations/{id}/output`):
 *    Zeile fuer Zeile mit Zeitpunkt, Strom und Text; abgeschnitten, wenn
 *    eine Grenze gegriffen hat, und die Seite sagt das dann.
 *
 * Daneben bleibt die Einsatzhistorie aus 2.61, weil sie die andere Frage
 * beantwortet: nicht was der Container sagte, sondern welcher es war.
 *
 * Nur lesend: vier GETs, kein Schreibverb. Gestrichen wird aus den Zeilen
 * nichts; der Grund steht auf der Seite selbst (`CONTAINER_LOG_TEXTS.secrets`).
 */
type Environment = "development" | "staging" | "production";
type FunctionItem = { id: string; name: string };
type Deployment = { revision: number; image: string; deployedBy: string; deployedAt: string };
type InvocationRow = {
  invocationId: string; startedAt: string; durationMs: number;
  outcome: "completed" | "failed"; statusCode: number | null; errorCode: string | null;
};
type OutputLine = { at: string; stream: "stdout" | "stderr"; text: string; cut: boolean };
type OutputRecord = {
  lines: OutputLine[]; lineCount: number; stdoutLines: number; stderrLines: number;
  byteCount: number; truncated: boolean; droppedLines: number;
};
type State = "loading" | "ready" | "disabled" | "unavailable" | "error";
type Payload = Record<string, unknown>;

const COMPUTE_DISABLED_ERROR = "Compute definitions are disabled";
const INVOCATION_PAGE = 50;

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

export function FunctionContainerLogView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: State }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/compute`;
  const [functions, setFunctions] = useState<FunctionItem[]>([]);
  const [selected, setSelected] = useState("");
  const [invocations, setInvocations] = useState<InvocationRow[]>([]);
  const [chosen, setChosen] = useState("");
  const [output, setOutput] = useState<OutputRecord | null | undefined>(undefined);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [state, setState] = useState<State>(initialState ?? "loading");
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null);

  /** Die Ausgabe eines Aufrufs; `null` heisst: nichts geschrieben. */
  const loadOutput = useCallback(async (invocationId: string, signal: AbortSignal) => {
    if (!invocationId) { setOutput(undefined); return; }
    const answer = await readJson(`${base}/invocations/${invocationId}/output`, signal);
    if (signal.aborted) return;
    const data = answer.status === 200 ? answer.payload.data as { output?: OutputRecord | null } | undefined : undefined;
    setOutput(data === undefined ? undefined : data.output ?? null);
  }, [base]);

  // Jede Ladung hat einen eigenen AbortController; eine abgebrochene setzt
  // keinen Zustand mehr.
  const load = useCallback(async (initial: boolean, functionId: string, invocationId: string) => {
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
      setInvocations([]);
      setDeployments([]);
      setOutput(undefined);
      setState(error === COMPUTE_DISABLED_ERROR ? "disabled" : "unavailable");
      setMessage(error);
      return;
    }
    if (list.status !== 200 || !Array.isArray(list.payload.data)) {
      setRefreshing(false);
      setFunctions([]);
      setInvocations([]);
      setDeployments([]);
      setOutput(undefined);
      setMessage(error || t("Functions nicht verfügbar"));
      setState("error");
      return;
    }
    const items = (list.payload.data as FunctionItem[]).map((entry) => ({ id: entry.id, name: entry.name }));
    setFunctions(items);

    const wanted = items.some((entry) => entry.id === functionId) ? functionId : items[0]?.id ?? "";
    setSelected(wanted);

    const [log, history] = await Promise.all([
      wanted ? readJson(`${base}/invocations?function=${wanted}&limit=${INVOCATION_PAGE}&offset=0`, controller.signal)
        : Promise.resolve({ status: 200, payload: { data: { rows: [] } } as Payload }),
      wanted ? readJson(`${base}/functions/${wanted}/deployments`, controller.signal)
        : Promise.resolve({ status: 200, payload: { data: [] } as Payload }),
    ]);
    if (controller.signal.aborted) return;

    const page = log.status === 200 ? log.payload.data as { rows?: InvocationRow[] } | undefined : undefined;
    const rows = Array.isArray(page?.rows) ? page.rows : [];
    setInvocations(rows);
    setDeployments(history.status === 200 && Array.isArray(history.payload.data)
      ? history.payload.data as Deployment[] : []);

    // Der gewaehlte Aufruf, sonst der neueste. Ohne Aufruf gibt es keine
    // Ausgabe, die man nachfragen koennte.
    const pick = rows.some((row) => row.invocationId === invocationId) ? invocationId : rows[0]?.invocationId ?? "";
    setChosen(pick);
    await loadOutput(pick, controller.signal);
    if (controller.signal.aborted) return;

    setRefreshing(false);
    setMessage("");
    setState("ready");
  }, [base, loadOutput]);

  useEffect(() => {
    void load(true, selected, chosen);
    return () => request.current?.abort();
    // `selected` und `chosen` bewusst nicht in der Liste: Ein Wechsel laedt
    // ueber die Handler neu, und hier wuerde er eine zweite Ladung anstossen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Function-Logs werden geladen…")}</h3></div>;
  }

  const changeFunction = (next: string) => {
    setSelected(next);
    void load(false, next, "");
  };
  const changeInvocation = (next: string) => {
    setChosen(next);
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setOutput(undefined);
    void loadOutput(next, controller.signal);
  };

  const current = invocations.find((row) => row.invocationId === chosen);

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t(CONTAINER_LOG_TEXTS.kicker)} · {environment.toUpperCase()}</span><h3>{t(CONTAINER_LOG_TEXTS.title)}</h3></div><div>
        <button className="secondary-button" onClick={() => void load(false, selected, chosen)} disabled={refreshing}>
          <RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/>
        </button>
      </div></div>
      <p className="muted">{t(CONTAINER_LOG_TEXTS.intro)}</p>
      <p className="muted">{t(CONTAINER_LOG_TEXTS.limits)}</p>
      <p className="muted">{t(CONTAINER_LOG_TEXTS.stdoutIsProtocol)}</p>
      <p className="risk medium">{t(CONTAINER_LOG_TEXTS.secrets)}</p>
      <p className="muted">{t(CONTAINER_LOG_TEXTS.neverInIt)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("AUFRUFE")}</span><h3>{t(CONTAINER_LOG_TEXTS.invocationsTitle)}</h3></div><div>
        {/* Dasselbe Bauteil wie das Umgebungsmenue in der Kopfzeile. Ohne
            Erklaerzeile: Diese Liste traegt Name und Id und sonst nichts, und
            eine Id neben dem Namen erklaert niemandem etwas. */}
        {functions.length > 0 && <OptionMenu value={selected}
          ariaLabel={t("Function")} listLabel={t("Function wählen")}
          icon={<Blocks size={14} aria-hidden="true"/>} onChange={changeFunction}
          options={functions.map((entry) => ({ id: entry.id, label: entry.name }))}/>}
        <FileClock size={18}/>
      </div></div>
      <p className="muted">{t(CONTAINER_LOG_TEXTS.invocationsMeaning)}</p>

      {state === "disabled" && <p className="muted">{t(MISSING_LOG_STATES.computeDisabled)}</p>}
      {state === "unavailable" && <p className="muted">{t(MISSING_LOG_STATES.unavailable)}</p>}
      {state === "error" && <p className="muted">{message || t("Functions nicht verfügbar")}</p>}

      {state === "ready" && functions.length === 0 && <p className="muted">{t(MISSING_LOG_STATES.noFunctions)}</p>}
      {state === "ready" && functions.length > 0 && invocations.length === 0 && <p className="muted">{t(OUTPUT_WORDS.noOutputYet)}</p>}

      {invocations.length > 0 && <>
        <div className="log-row log-header">
          <span>{t("Aufruf")}</span>
          {OUTPUT_INVOCATION_COLUMNS.map((column) => <span key={column.label}>{t(column.label)}</span>)}
        </div>
        {invocations.map((row) => <div className={`log-row${row.invocationId === chosen ? " selected" : ""}`} key={row.invocationId}>
          <span><input type="radio" name="invocation" aria-label={t("Aufruf")} checked={row.invocationId === chosen}
            onChange={() => changeInvocation(row.invocationId)}/></span>
          <time>{formatMoment(row.startedAt)}</time>
          <code>{row.outcome === "completed" ? `${row.outcome} · ${formatNumber(row.statusCode ?? 0)}` : `${row.outcome} · ${row.errorCode ?? ""}`}</code>
          <span>{formatNumber(row.durationMs)} ms</span>
        </div>)}
      </>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("AUSGABE")}</span><h3>{t(CONTAINER_LOG_TEXTS.outputTitle)}</h3></div><Terminal size={18}/></div>
      {current === undefined && state === "ready" && invocations.length > 0 && <p className="muted">{t("Kein Aufruf gewählt.")}</p>}
      {current !== undefined && output === undefined && <p className="muted">{t("Ausgabe wird geladen…")}</p>}
      {current !== undefined && output === null && <p className="muted">{t(CONTAINER_LOG_TEXTS.outputEmpty)}</p>}
      {current !== undefined && output !== undefined && output !== null && <>
        <div className="auth-overview">
          <div><span>{t(OUTPUT_WORDS.lines).toUpperCase()}</span><strong>{formatNumber(output.lineCount)}</strong>
            <small>stdout {formatNumber(output.stdoutLines)} · stderr {formatNumber(output.stderrLines)}</small></div>
          <div><span>{t(OUTPUT_WORDS.bytes).toUpperCase()}</span><strong>{formatNumber(output.byteCount)}</strong>
            <small>{output.truncated ? t(OUTPUT_WORDS.truncated) : t(OUTPUT_WORDS.complete)}</small></div>
          <div><span>{t(OUTPUT_WORDS.dropped).toUpperCase()}</span><strong>{formatNumber(output.droppedLines)}</strong>
            <small>{formatMoment(current.startedAt)}</small></div>
        </div>
        {output.truncated && <p className="risk medium">{t(CONTAINER_LOG_TEXTS.outputTruncated)}</p>}
        <div className="log-row log-header">
          {OUTPUT_COLUMNS.map((column) => <span key={column.label}>{t(column.label)}</span>)}
        </div>
        {output.lines.map((line, index) => <div className={`log-row stream-${line.stream}`} key={`${line.at}-${index}`}>
          <time>{formatMoment(line.at, "dateTime")}</time>
          <code>{line.stream}</code>
          <code className="log-line">{line.text}{line.cut ? ` … [${t(OUTPUT_WORDS.cut)}]` : ""}</code>
        </div>)}
        <div className="log-row log-header"><span>{t("Spalte")}</span><span>{t("Was sie sagt")}</span></div>
        {OUTPUT_COLUMNS.map((column) => <div className="log-row" key={column.label}>
          <span>{t(column.label)}</span>
          <span className="muted">{t(column.meaning)}</span>
        </div>)}
      </>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS ES GIBT")}</span><h3>{t(CONTAINER_LOG_TEXTS.deploymentsTitle)}</h3></div><Container size={18}/></div>
      <p className="muted">{t(CONTAINER_LOG_TEXTS.deploymentsMeaning)}</p>
      <p className="muted">{t(CONTAINER_LOG_TEXTS.deploymentsLimit)}</p>
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
      </>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("FÜR BETREIBER")}</span><h3>{t(CONTAINER_LOG_TEXTS.operatorTitle)}</h3></div><Send size={18}/></div>
      <p className="muted">{t(CONTAINER_LOG_TEXTS.operatorDrain)}</p>
    </article>
  </div>;
}
