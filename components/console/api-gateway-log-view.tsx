"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, FileClock, RefreshCw, Send } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatCount, formatMoment, formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import { API_GATEWAY_LOG_TEXTS, MISSING_LOG_STATES } from "@/lib/console/missing-log-texts";

/**
 * Logs → API-Gateway (2.84): die ehrliche Antwort auf einen Platzhalter, der
 * „jede Anfrage am Rand mit Status und Dauer" versprochen hat.
 *
 * Hier fehlt nicht das Log, sondern der Rand. Nachgesehen in `app/api/`: Es
 * gibt keine `middleware.ts`, nirgends, und damit keine Stelle, durch die jede
 * Anfrage laeuft. Jeder Routenhandler steht fuer sich; das Einzige, was fuer
 * alle Pfade gilt, sind feste Header aus `next.config.ts`, und die schreiben
 * nichts mit. Ein Anfrageprotokoll koennte gar nicht entstehen.
 *
 * Gezeigt wird, was es wirklich gibt: die Stundenreihe der Metrik
 * `api_requests`. Ihre Reichweite ist nachgezaehlt, nicht angenommen.
 * `admitApiRequest` wird von genau drei Modulen gerufen (generierte Data API,
 * Project Storage, Queues), und gerufen wird es am **Ende** des
 * Kontext-Resolvers: Eine Anfrage, die schon an der Anmeldung scheitert, hat
 * keinen Scope und wird nie gezaehlt. Beides steht auf der Seite.
 *
 * Eine Aufteilung je Quelle gibt es ueber HTTP nicht: Die Reihe gruppiert nur
 * nach Metrik, und ein `?source=` ist an dieser Route ein 400. Diese Seite
 * baut sich darum keine.
 *
 * Nur lesend: ein GET, kein Schreibverb.
 */
type Environment = "development" | "staging" | "production";
type SeriesBucket = { start: string; accepted: string; rejected: string; events: number };
type Series = {
  bucket: "hour" | "day"; windowStart: string; windowEnd: string; truncated: boolean;
  buckets: SeriesBucket[]; totals: { accepted: string; rejected: string; events: number };
};
type State = "loading" | "ready" | "disabled" | "unavailable" | "error";
type Payload = Record<string, unknown>;

const USAGE_METERING_DISABLED_ERROR = "Usage Metering is disabled";

/**
 * Die Module, die diese Metrik wirklich erhoehen, und die, die es nicht tun.
 * Nachgezaehlt an den Aufrufstellen von `admitApiRequest`; die Messung kennt
 * neun Quellen, aber nur diese drei zaehlen Anfragen.
 */
const COUNTING_SOURCES = ["generated_data_api", "project_storage", "project_queues"] as const;
const SILENT_SOURCES = ["control_plane", "project_auth", "realtime", "compute", "mcp", "data_plane"] as const;

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

export function ApiGatewayLogView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: State }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}`;
  const [series, setSeries] = useState<Series | null>(null);
  const [state, setState] = useState<State>(initialState ?? "loading");
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async (initial: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (initial) setState("loading"); else setRefreshing(true);

    const usage = await readJson(`${base}/usage/series?metric=api_requests&bucket=hour`, controller.signal);
    if (controller.signal.aborted) return;
    setRefreshing(false);

    const error = typeof usage.payload.error === "string" ? usage.payload.error : "";
    if (usage.status === 503) {
      setSeries(null);
      setState(error === USAGE_METERING_DISABLED_ERROR ? "disabled" : "unavailable");
      setMessage(error);
      return;
    }
    const data = usage.payload.data as Series | undefined;
    if (usage.status !== 200 || !data || !Array.isArray(data.buckets)) {
      setSeries(null);
      setMessage(error || t("Zeitreihe nicht verfügbar"));
      setState("error");
      return;
    }
    setSeries(data);
    setMessage("");
    setState("ready");
  }, [base]);

  useEffect(() => {
    void load(true);
    return () => request.current?.abort();
  }, [load]);

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("API-Gateway-Seite wird geladen…")}</h3></div>;
  }

  // Nur die juengsten Stunden: 48 Zeilen sind eine Tapete, und die Aussage der
  // Seite steht in den Saetzen darueber, nicht in der Laenge der Tabelle.
  const recent = (series?.buckets ?? []).slice(-12).reverse();

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t(API_GATEWAY_LOG_TEXTS.kicker)} · {environment.toUpperCase()}</span><h3>{t(API_GATEWAY_LOG_TEXTS.title)}</h3></div><div>
        <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing}>
          <RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/>
        </button>
      </div></div>
      <p className="risk medium">{t(API_GATEWAY_LOG_TEXTS.noEdge)}</p>
      <p className="muted">{t(API_GATEWAY_LOG_TEXTS.whatItWouldTake)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS ES GIBT")}</span><h3>{t(API_GATEWAY_LOG_TEXTS.counterTitle)}</h3></div><BarChart3 size={18}/></div>
      <p className="muted">{t(API_GATEWAY_LOG_TEXTS.counterMeaning)}</p>
      <p className="risk medium">{t(API_GATEWAY_LOG_TEXTS.counterLimit)}</p>
      <p className="risk medium">{t(API_GATEWAY_LOG_TEXTS.counterBlindSpot)}</p>

      <div className="log-row log-header"><span>{t("Zählt Anfragen")}</span><span>{t("Zählt unter dieser Metrik nicht")}</span></div>
      <div className="log-row">
        <span>{COUNTING_SOURCES.map((source) => <code key={source}>{source} </code>)}</span>
        <span className="muted">{SILENT_SOURCES.map((source) => <code key={source}>{source} </code>)}</span>
      </div>

      {state === "disabled" && <p className="muted">{t("Usage Metering ist nicht aktiv. Ohne Nutzungsereignisse gibt es auch diesen Zähler nicht.")}</p>}
      {state === "unavailable" && <p className="muted">{t(MISSING_LOG_STATES.unavailable)}</p>}
      {state === "error" && <p className="muted">{message || t("Zeitreihe nicht verfügbar")}</p>}

      {series && <>
        <div className="auth-overview">
          <div><span>{t("GEZÄHLT")}</span><strong>{formatCount(series.totals.accepted)}</strong><small>{t("angenommen im Fenster, in diesen drei Modulen")}</small></div>
          <div><span>{t("ABGELEHNT")}</span><strong>{formatCount(series.totals.rejected)}</strong><small>{t("an einer Quota gescheitert")}</small></div>
          <div><span>{t("EREIGNISSE")}</span><strong>{formatNumber(series.totals.events)}</strong><small>{t("gemessene Vorgänge im Fenster")}</small></div>
        </div>
        <p className="muted">{t(API_GATEWAY_LOG_TEXTS.rejectedMeaning)}</p>
        {series.truncated && <p className="risk medium">{t("Die Antwort wurde an der Zeilengrenze abgeschnitten; die Reihe zeigt nicht jeden Abschnitt des Fensters.")}</p>}
        <p className="muted">{t("Fenster")}: {formatMoment(series.windowStart)} bis {formatMoment(series.windowEnd)}</p>
        <div className="log-row log-header"><span>{t("Stunde")}</span><span>{t("Angenommen")}</span><span>{t("Abgelehnt")}</span><span>{t("Ereignisse")}</span></div>
        {recent.map((entry) => <div className="log-row" key={entry.start}>
          <time>{formatMoment(entry.start)}</time>
          <span>{formatCount(entry.accepted)}</span>
          <span className={entry.rejected === "0" ? "muted" : "risk medium"}>{formatCount(entry.rejected)}</span>
          <code>{formatNumber(entry.events)}</code>
        </div>)}
        <p className="muted">{t("Gezeigt werden die jüngsten zwölf Stunden. Die ganze Reihe über 48 Stunden steht unter Berichte → API.")}</p>
      </>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS ES GIBT")}</span><h3>{t(API_GATEWAY_LOG_TEXTS.whereRowsExistTitle)}</h3></div><FileClock size={18}/></div>
      <p className="muted">{t(API_GATEWAY_LOG_TEXTS.whereRowsExistMeaning)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("FÜR BETREIBER")}</span><h3>{t(API_GATEWAY_LOG_TEXTS.operatorTitle)}</h3></div><Send size={18}/></div>
      <p className="muted">{t(API_GATEWAY_LOG_TEXTS.operatorSteps)}</p>
      <p className="muted">{t(API_GATEWAY_LOG_TEXTS.operatorDrain)}</p>
    </article>
  </div>;
}
