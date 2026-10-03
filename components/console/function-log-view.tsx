"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Blocks, FileClock, RefreshCw } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import { OptionMenu } from "@/components/console/option-menu";
import {
  FUNCTION_LOG_COLUMNS,
  FUNCTION_LOG_CONTAINER_OUTPUT,
  FUNCTION_LOG_HONESTY,
  FUNCTION_LOG_NO_EGRESS,
  FUNCTION_LOG_OUTCOMES,
  LOG_VIEW_STATES,
  type FunctionLogOutcomeId,
} from "@/lib/console/log-view-texts";

/**
 * Logs → Functions (2.51). Die Seite war bis hierher ein Platzhalter mit dem
 * Versprechen „Start, Ende und Fehler je Function-Aufruf, mit Dauer und
 * Ausgangsverbindungen".
 *
 * Eingelöst wird davon, was in Migration 0045 wirklich steht: Beginn, Dauer,
 * Ausgang und entweder ein HTTP-Status oder ein fester Fehlercode, je Aufruf
 * und über alle Functions der Umgebung. Nicht eingelöst — und ausdrücklich
 * auf der Seite gesagt — werden die Ausgangsverbindungen und die Ausgabe des
 * Containers.
 *
 * Nur lesend: eine Route, ein GET, kein Schreibverb.
 */
type Environment = "development" | "staging" | "production";
type FunctionItem = { id: string; name: string };
type LogRow = {
  functionId: string; functionName: string; invocationId: string; invokedBy: string;
  startedAt: string; durationMs: number; outcome: FunctionLogOutcomeId;
  statusCode: number | null; errorCode: string | null;
};
type LogPage = {
  rows: LogRow[]; limit: number; offset: number; hasMore: boolean;
  counts: { completed: number; failed: number };
};
type State = "loading" | "ready" | "disabled" | "unavailable" | "error";
type Payload = Record<string, unknown>;

const COMPUTE_DISABLED_ERROR = "Compute definitions are disabled";
const PAGE_SIZE = 50;

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


export function FunctionLogView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: State }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/compute`;
  const [functions, setFunctions] = useState<FunctionItem[]>([]);
  const [page, setPage] = useState<LogPage | null>(null);
  const [state, setState] = useState<State>(initialState ?? "loading");
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [functionFilter, setFunctionFilter] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const request = useRef<AbortController | null>(null);

  // Jede Ladung hat einen eigenen AbortController; eine abgebrochene setzt
  // keinen Zustand mehr.
  const load = useCallback(async (initial: boolean, next: {
    functionFilter: string; outcomeFilter: string; offset: number;
  }) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (initial) setState("loading"); else setRefreshing(true);

    const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(next.offset) });
    if (next.functionFilter) query.set("function", next.functionFilter);
    if (next.outcomeFilter) query.set("outcome", next.outcomeFilter);
    const [log, list] = await Promise.all([
      readJson(`${base}/invocations?${query.toString()}`, controller.signal),
      readJson(`${base}/functions`, controller.signal),
    ]);
    if (controller.signal.aborted) return;
    setRefreshing(false);

    const error = typeof log.payload.error === "string" ? log.payload.error : "";
    if (log.status === 503) {
      setPage(null);
      setState(error === COMPUTE_DISABLED_ERROR ? "disabled" : "unavailable");
      setMessage(error);
      return;
    }
    const data = log.payload.data as LogPage | undefined;
    if (log.status !== 200 || !data || !Array.isArray(data.rows)) {
      setPage(null);
      setMessage(error || t("Aufrufprotokoll nicht verfügbar"));
      setState("error");
      return;
    }
    const names = list.status === 200 && Array.isArray(list.payload.data)
      ? (list.payload.data as FunctionItem[]).map((entry) => ({ id: entry.id, name: entry.name }))
      : [];
    setFunctions(names);
    setPage(data);
    setMessage("");
    setState("ready");
  }, [base]);

  useEffect(() => {
    void load(true, { functionFilter, outcomeFilter, offset });
    return () => request.current?.abort();
  }, [load, functionFilter, outcomeFilter, offset]);

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Aufrufprotokoll wird geladen…")}</h3></div>;
  }
  if (state === "disabled" || state === "unavailable" || state === "error") {
    return <div className="console-card live-module-state"><FileClock size={26}/>
      <h3>{state === "disabled" ? t("Compute ist nicht eingeschaltet") : state === "unavailable" ? t("Aufrufprotokoll gerade nicht erreichbar") : t("Aufrufprotokoll nicht verfügbar")}</h3>
      <p>{state === "disabled" ? t(LOG_VIEW_STATES.disabled) : state === "unavailable" ? t(LOG_VIEW_STATES.unavailable) : message}</p>
      <button className="secondary-button" onClick={() => void load(true, { functionFilter, outcomeFilter, offset })}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  const rows = page?.rows ?? [];
  const counts = page?.counts ?? { completed: 0, failed: 0 };
  const total = counts.completed + counts.failed;
  const filtered = Boolean(functionFilter || outcomeFilter);
  const shown = rows.length;
  const from = shown ? (page?.offset ?? 0) + 1 : 0;
  const changeFilter = (next: { functionFilter?: string; outcomeFilter?: string }) => {
    // Ein Filterwechsel setzt den Seitenschnitt zurueck: Seite 4 eines
    // anderen Filters waere eine Aussage ueber nichts.
    setOffset(0);
    if (next.functionFilter !== undefined) setFunctionFilter(next.functionFilter);
    if (next.outcomeFilter !== undefined) setOutcomeFilter(next.outcomeFilter);
  };

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("AUFRUFE")}</span><strong>{total}</strong><small>{functionFilter ? t("dieser Function") : t("in dieser Umgebung")}</small></div>
      <div><span>{t("ERFOLGREICH")}</span><strong>{counts.completed}</strong><small>{t(FUNCTION_LOG_OUTCOMES.completed.meaning)}</small></div>
      <div><span>{t("FEHLGESCHLAGEN")}</span><strong>{counts.failed}</strong><small>{t(FUNCTION_LOG_OUTCOMES.failed.meaning)}</small></div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("LOGS")} · {environment.toUpperCase()}</span><h3>{t("Function-Aufrufe")}</h3></div><div>
        {/* Dasselbe Bauteil wie das Umgebungsmenue in der Kopfzeile. Ohne
            Erklaerzeile: Ein Function-Name steht fuer sich. */}
        <OptionMenu value={functionFilter} ariaLabel={t("Function")} listLabel={t("Function wählen")}
          icon={<Blocks size={14} aria-hidden="true"/>}
          onChange={(next) => changeFilter({ functionFilter: next })}
          options={[
            { id: "", label: t("Alle Functions") },
            ...functions.map((entry) => ({ id: entry.id, label: entry.name })),
          ]}/>
        {/* Die Erklaerzeile je Ausgang ist der Satz, der auch in der Legende
            steht: "erfolgreich" heisst nicht fehlerfrei, sondern mit einem
            HTTP-Status geantwortet, und das ist genau der Unterschied, der
            beim Filtern zaehlt. */}
        <OptionMenu value={outcomeFilter} ariaLabel={t("Ausgang")} listLabel={t("Ausgang wählen")}
          icon={<FileClock size={14} aria-hidden="true"/>}
          onChange={(next) => changeFilter({ outcomeFilter: next })}
          options={[
            { id: "", label: t("Jeder Ausgang"), hint: t("Dieser Filter wird nicht mitgeschickt") },
            { id: "completed", label: t(FUNCTION_LOG_OUTCOMES.completed.label), hint: t(FUNCTION_LOG_OUTCOMES.completed.meaning) },
            { id: "failed", label: t(FUNCTION_LOG_OUTCOMES.failed.label), hint: t(FUNCTION_LOG_OUTCOMES.failed.meaning) },
          ]}/>
        <button className="secondary-button" onClick={() => void load(false, { functionFilter, outcomeFilter, offset })} disabled={refreshing}>
          <RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/>
        </button>
      </div></div>

      <p className="muted">{t(FUNCTION_LOG_HONESTY)}</p>
      <p className="muted">{t(FUNCTION_LOG_CONTAINER_OUTPUT)}</p>
      <p className="muted">{t(FUNCTION_LOG_NO_EGRESS)}</p>

      {shown === 0 && <p className="muted">{filtered ? t(LOG_VIEW_STATES.emptyFiltered) : t(LOG_VIEW_STATES.empty)}</p>}

      {shown > 0 && <>
        <div className="log-row log-header">
          {FUNCTION_LOG_COLUMNS.map((column) => <span key={column.label}>{t(column.label)}</span>)}
        </div>
        {rows.map((row) => <div className="log-row" key={row.invocationId}>
          <time>{formatMoment(row.startedAt, "dateTimeSeconds")}</time>
          <span>{row.functionName}</span>
          <span>{row.invokedBy}</span>
          <code>{row.durationMs} ms</code>
          <span className={row.outcome === "completed" ? "secure" : "risk high"}>{t(FUNCTION_LOG_OUTCOMES[row.outcome].label)}</span>
          <span className={`log-status ${row.outcome}`}>{row.statusCode ?? row.errorCode ?? "–"}</span>
        </div>)}
        <p className="muted">{t("Zeilen")} {from}–{from + shown - 1} · {t("neueste zuerst")}</p>
      </>}

      <div className="card-head"><div/><div>
        <button className="secondary-button" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={refreshing || offset === 0}>
          {t("Neuere")}
        </button>
        <button className="secondary-button" onClick={() => setOffset(offset + PAGE_SIZE)} disabled={refreshing || !page?.hasMore}>
          {t("Ältere")}
        </button>
      </div></div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NUR LESEND")}</span><h3>{t("Was eine Zeile bedeutet")}</h3></div><FileClock size={18}/></div>
      <div className="log-row log-header"><span>{t("Spalte")}</span><span>{t("Was sie sagt")}</span></div>
      {FUNCTION_LOG_COLUMNS.map((column) => <div className="log-row" key={column.label}>
        <span>{t(column.label)}</span>
        <span className="muted">{t(column.meaning)}</span>
      </div>)}
    </article>
  </div>;
}
