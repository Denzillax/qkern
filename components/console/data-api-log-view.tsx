"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, FileClock, RefreshCw, Table2 } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { formatCount, formatMoment } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import { DATA_API_LIMITS } from "@/lib/data-api-limits";
import { dataApiReadiness, exposedTablesFromOpenApi, type DataApiReadiness } from "@/lib/console/data-api-exposure";
import { DATA_API_LOG_TEXTS } from "@/lib/console/log-view-texts";

/**
 * Logs → Data API (2.51) — die ehrliche Antwort auf einen Platzhalter, der
 * „jede Anfrage mit Rolle, Tabelle und Antwortzeit" versprochen hat.
 *
 * Diese Zeile gibt es nicht. QKERN schreibt für die generierte Data API kein
 * Protokoll je Anfrage; an ihrer HTTP-Grenze wird gezählt, nicht
 * protokolliert. Ein Log zu bauen, damit die Seite eines hat, wäre genau der
 * Fehler, den die Platzhalter vermeiden sollen.
 *
 * Gezeigt wird deshalb, was es wirklich gibt, jedes Stück mit seinem Namen:
 *
 * 1. die Stundenreihe der Metrik `api_requests` aus 2.45 — ein Zähler über
 *    **alle** Quellen, nicht über die Data API allein;
 * 2. die Freigabe der Data API aus 2.32 — welche Tabellen im erzeugten
 *    OpenAPI-Dokument stehen;
 * 3. der Satz, woher ein echtes Anfrageprotokoll kommen müsste.
 *
 * Nur lesend: zwei GETs, kein Schreibverb.
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
const { schema } = DATA_API_LIMITS;

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

/**
 * Mengen sind Dezimalstrings und koennen ueber MAX_SAFE_INTEGER hinausgehen.
 * `usage-series-view` hat ein `amount` mit demselben Namen, das vorher prueft,
 * ob der String eine Zahl ist; hier kommt der Wert aus einer Zaehlspalte und
 * ist es immer.
 */
function amount(value: string): string {
  return formatCount(value);
}


export function DataApiLogView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: State }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}`;
  const [series, setSeries] = useState<Series | null>(null);
  const [readiness, setReadiness] = useState<DataApiReadiness | "loading">("loading");
  const [exposed, setExposed] = useState<string[]>([]);
  const [state, setState] = useState<State>(initialState ?? "loading");
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async (initial: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (initial) setState("loading"); else setRefreshing(true);

    const [usage, openApi] = await Promise.all([
      readJson(`${base}/usage/series?metric=api_requests&bucket=hour`, controller.signal),
      readJson(`${base}/generated-openapi?schema=${schema}`, controller.signal),
    ]);
    if (controller.signal.aborted) return;
    setRefreshing(false);

    // Die Freigabe steht fuer sich: Ist das Dokument nicht da, bleibt die
    // Liste leer und der Zustand sagt, warum — erfunden wird nichts.
    const status = dataApiReadiness(openApi.status, typeof openApi.payload.code === "string" ? openApi.payload.code : undefined);
    const paths = status === "ready" && openApi.payload.paths && typeof openApi.payload.paths === "object"
      ? openApi.payload.paths as Record<string, unknown> : {};
    setReadiness(status);
    setExposed(exposedTablesFromOpenApi(paths));

    const error = typeof usage.payload.error === "string" ? (serverErrorText(usage.payload.error) ?? "") : "";
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
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Data-API-Seite wird geladen…")}</h3></div>;
  }

  const readinessText = readiness === "ready" ? t("bereit")
    : readiness === "not-ready" ? t("noch nicht bereit")
      : readiness === "disabled" ? t("abgeschaltet") : t("nicht erreichbar");

  // Nur die jüngsten Stunden: 48 Zeilen sind eine Tapete, und die Aussage der
  // Seite steht in den Sätzen darüber, nicht in der Länge der Tabelle.
  const recent = (series?.buckets ?? []).slice(-12).reverse();

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t(DATA_API_LOG_TEXTS.kicker)} · {environment.toUpperCase()}</span><h3>{t(DATA_API_LOG_TEXTS.title)}</h3></div><div>
        <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing}>
          <RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/>
        </button>
      </div></div>
      <p className="risk medium">{t(DATA_API_LOG_TEXTS.noRequestLog)}</p>
      <p className="muted">{t(DATA_API_LOG_TEXTS.whatItWouldTake)}</p>
      <p className="muted">{t(DATA_API_LOG_TEXTS.neverInIt)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS ES GIBT")}</span><h3>{t(DATA_API_LOG_TEXTS.counterTitle)}</h3></div><BarChart3 size={18}/></div>
      <p className="muted">{t(DATA_API_LOG_TEXTS.counterMeaning)}</p>
      <p className="risk medium">{t(DATA_API_LOG_TEXTS.counterLimit)}</p>

      {state === "disabled" && <p className="muted">{t("Usage Metering ist nicht aktiv. Ohne Nutzungsereignisse gibt es auch diesen Zähler nicht.")}</p>}
      {(state === "unavailable" || state === "error") && <p className="muted">{message || t("Zeitreihe nicht verfügbar")}</p>}

      {series && <>
        <div className="auth-overview">
          <div><span>{t("ANFRAGEN")}</span><strong>{amount(series.totals.accepted)}</strong><small>{t("angenommen im Fenster, alle Quellen zusammen")}</small></div>
          <div><span>{t("ABGELEHNT")}</span><strong>{amount(series.totals.rejected)}</strong><small>{t("an einer Quota gescheitert")}</small></div>
          <div><span>{t("EREIGNISSE")}</span><strong>{series.totals.events}</strong><small>{t("gemessene Vorgänge im Fenster")}</small></div>
        </div>
        {series.truncated && <p className="risk medium">{t("Die Antwort wurde an der Zeilengrenze abgeschnitten; die Reihe zeigt nicht jeden Abschnitt des Fensters.")}</p>}
        <p className="muted">{t("Fenster")}: {formatMoment(series.windowStart)} – {formatMoment(series.windowEnd)}</p>
        <div className="log-row log-header"><span>{t("Stunde")}</span><span>{t("Angenommen")}</span><span>{t("Abgelehnt")}</span><span>{t("Ereignisse")}</span></div>
        {recent.map((entry) => <div className="log-row" key={entry.start}>
          <time>{formatMoment(entry.start)}</time>
          <span>{amount(entry.accepted)}</span>
          <span className={entry.rejected === "0" ? "muted" : "risk medium"}>{amount(entry.rejected)}</span>
          <code>{entry.events}</code>
        </div>)}
        <p className="muted">{t("Gezeigt werden die jüngsten zwölf Stunden. Die ganze Reihe über 48 Stunden steht unter Berichte → API.")}</p>
      </>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS ES GIBT")}</span><h3>{t(DATA_API_LOG_TEXTS.exposureTitle)}</h3></div><Table2 size={18}/></div>
      <p className="muted">{t(DATA_API_LOG_TEXTS.exposureMeaning)}</p>
      <p className="muted">{t("Zustand der Data API")}: {readinessText} · {t("Schema")}: {schema}</p>
      {exposed.length === 0
        ? <p className="muted">{t("Keine freigegebene Tabelle im Dokument. Das heisst nicht, dass es keine Tabellen gibt — nur, dass keine die Bedingungen der Data API erfüllt oder das Dokument nicht gelesen werden konnte.")}</p>
        : <>
          <div className="log-row log-header"><span>{t("Freigegebene Tabelle")}</span></div>
          {exposed.map((name) => <div className="log-row" key={name}><code>{name}</code></div>)}
        </>}
      <p className="muted">{t("Welche Anfragen an diese Tabellen gestellt wurden, steht nirgends. Die Freigabe sagt, was möglich ist, nicht was geschehen ist.")}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NUR LESEND")}</span><h3>{t("Ein Protokoll je Function-Aufruf gibt es dagegen")}</h3></div><FileClock size={18}/></div>
      <p className="muted">{t("Für Function-Aufrufe schreibt QKERN seit 1.89 eine Zeile je Aufruf; sie steht unter Logs → Functions. Für die Data API gibt es diese Zeile nicht, und diese Seite tut nicht so, als wäre der Zähler dasselbe.")}</p>
    </article>
  </div>;
}
