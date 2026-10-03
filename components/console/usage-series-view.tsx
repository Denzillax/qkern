"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatCount } from "@/components/console/console-display";
import { formatBucketMoment } from "@/components/console/console-format";
import { OptionMenu } from "@/components/console/option-menu";
import { StableLabel } from "@/components/stable-label";
import { buildUsageSeriesChart } from "@/lib/console/usage-series-chart";
import {
  USAGE_SERIES_HONESTY,
  USAGE_SERIES_METRIC_TEXTS,
  USAGE_SERIES_VIEWS,
  type UsageSeriesMetricId,
  type UsageSeriesViewId,
  type UsageSeriesViewText,
} from "@/lib/console/usage-series-texts";

/**
 * Die Zeitreihen der Nutzung (2.45): eine Ansicht, drei Seiten — Berichte →
 * API, Berichte → Storage und Berichte → Functions. Sie unterscheiden sich
 * nur in der Metrik, die sie zeigen, und in dem Satz, der sagt, was sie
 * nicht zeigen koennen.
 *
 * Nur lesend. Eine Route (`usage/series`), ein GET, kein Schreibverb.
 *
 * Das Bild entsteht aus `buildUsageSeriesChart`, einer reinen Funktion ohne
 * Farben und ohne Sprache; hier kommen nur `currentColor` und die
 * CSS-Variablen der Console dazu. Neben dem Bild stehen dieselben Zahlen als
 * Tabelle: Ein Diagramm ist fuer eine Vorleseausgabe nichts, und eine
 * Menge, die nur als Balkenhoehe existiert, ist keine Auskunft.
 */
type Environment = "development" | "staging" | "production";
type Bucket = "hour" | "day";
type SeriesBucket = { start: string; accepted: string; rejected: string; events: number };
type Series = {
  metric: string;
  bucket: Bucket;
  windowStart: string;
  windowEnd: string;
  bucketCount: number;
  truncated: boolean;
  buckets: SeriesBucket[];
  totals: { accepted: string; rejected: string; events: number };
};
type State = "loading" | "ready" | "disabled" | "unavailable" | "error";
type Payload = Record<string, unknown>;

const USAGE_METERING_DISABLED_ERROR = "Usage Metering is disabled";

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
 * Mengen sind Dezimalstrings und koennen ueber `Number.MAX_SAFE_INTEGER`
 * hinausgehen; `formatCount` gruppiert sie als BigInt verlustfrei.
 */
function amount(value: string): string {
  return /^\d{1,30}$/.test(value)
    ? formatCount(value)
    : value;
}

export function UsageSeriesView({ view, projectId, environment, initialState }: {
  view: UsageSeriesViewId;
  projectId: string;
  environment: Environment; initialState?: State }) {
  const definition: UsageSeriesViewText = USAGE_SERIES_VIEWS[view];
  const base = `/api/v1/projects/${projectId}/environments/${environment}/usage/series`;
  const [chosen, setMetric] = useState<UsageSeriesMetricId>(definition.metrics[0]);
  // Wechselt die Seite, ohne dass React die Ansicht neu anlegt, bleibt die
  // gewaehlte Metrik stehen — und koennte eine sein, die zu dieser Seite gar
  // nicht gehoert. Dann gilt wieder die erste der Seite.
  const metric = definition.metrics.includes(chosen) ? chosen : definition.metrics[0];
  const [bucket, setBucket] = useState<Bucket>("hour");
  const [state, setState] = useState<State>(initialState ?? "loading");
  const [series, setSeries] = useState<Series | null>(null);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null);

  // Jede Ladung hat einen eigenen AbortController; eine abgebrochene setzt keinen Zustand mehr.
  const load = useCallback(async (initial: boolean, next: { metric: UsageSeriesMetricId; bucket: Bucket }) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (initial) setState("loading"); else setRefreshing(true);
    const result = await readJson(`${base}?metric=${next.metric}&bucket=${next.bucket}`, controller.signal);
    if (controller.signal.aborted) return;
    setRefreshing(false);
    const error = typeof result.payload.error === "string" ? result.payload.error : "";
    if (result.status === 503) {
      setSeries(null);
      setState(error === USAGE_METERING_DISABLED_ERROR ? "disabled" : "unavailable");
      setMessage(error);
      return;
    }
    const data = result.payload.data as Series | undefined;
    if (result.status === 200 && data && Array.isArray(data.buckets)) {
      setSeries(data);
      setMessage("");
      setState("ready");
      return;
    }
    setSeries(null);
    setMessage(error || t("Zeitreihe nicht verfügbar"));
    setState("error");
  }, [base]);

  useEffect(() => {
    void load(true, { metric, bucket });
    return () => request.current?.abort();
  }, [load, metric, bucket]);

  const chart = useMemo(() => buildUsageSeriesChart({ buckets: series?.buckets ?? [] }), [series]);

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Zeitreihe wird geladen…")}</h3></div>;
  }
  if (state === "disabled" || state === "unavailable" || state === "error") {
    return <div className="console-card live-module-state"><BarChart3 size={26}/>
      <h3>{state === "disabled" ? t("Usage Metering ist nicht aktiv") : state === "unavailable" ? t("Zeitreihe gerade nicht erreichbar") : t("Zeitreihe nicht verfügbar")}</h3>
      <p>{state === "disabled" ? t("Ohne Nutzungsereignisse gibt es keine Reihe. Diese Seite erfindet keinen Verlauf.") : message}</p>
      <button className="secondary-button" onClick={() => void load(true, { metric, bucket })}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  const text = USAGE_SERIES_METRIC_TEXTS[metric];
  const windowText = bucket === "hour"
    ? t("Gezeigt werden die letzten 48 Stunden in Stundenschritten.")
    : t("Gezeigt werden die letzten 90 Tage in Tagesschritten.");
  const label = `${t(text.label)}: ${series?.bucketCount ?? 0} ${bucket === "hour" ? t("Stundenwerte") : t("Tageswerte")}, ${t("höchster Wert")} ${amount(chart.max)} ${t(text.unit)}`;

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("ANGENOMMEN")}</span><strong>{amount(series?.totals.accepted ?? "0")}</strong><small>{t(text.unit)}</small></div>
      <div><span>{t("ABGELEHNT")}</span><strong>{amount(series?.totals.rejected ?? "0")}</strong><small>{t("an einer Quota gescheitert")}</small></div>
      <div><span>{t("EREIGNISSE")}</span><strong>{series?.totals.events ?? 0}</strong><small>{t("gemessene Vorgänge im Fenster")}</small></div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t(definition.kicker)} · {environment.toUpperCase()}</span><h3>{t(definition.title)}</h3></div><div>
        {/* 2.133: Ohne Erklaerzeile, und das ist hier die Entscheidung. Das
            einzige, was neben dem Namen der Metrik steht, ist ihre Einheit,
            und "Gelesene Datenbankzeilen / Zeilen" sagt zweimal dasselbe. Die
            Einheit steht ohnehin unter jeder Kennzahl der Karte darueber. */}
        {definition.metrics.length > 1 && <OptionMenu value={metric} ariaLabel={t("Metrik")} listLabel={t("Metrik wählen")}
          icon={<BarChart3 size={14} aria-hidden="true"/>} onChange={(next) => setMetric(next)}
          options={definition.metrics.map((entry) => ({ id: entry, label: t(USAGE_SERIES_METRIC_TEXTS[entry].label) }))}/>}
        <button className="secondary-button" onClick={() => setBucket(bucket === "hour" ? "day" : "hour")} disabled={refreshing}>
          <StableLabel current={bucket === "hour" ? t("Stunden") : t("Tage")} variants={tAll("Stunden", "Tage")}/>
        </button>
        <button className="secondary-button" onClick={() => void load(false, { metric, bucket })} disabled={refreshing}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
      </div></div>

      <p className="muted">{t(USAGE_SERIES_HONESTY)}</p>
      <p className="muted">{t(definition.cannotShow)}</p>
      <p className="muted">{windowText} {series && <>{formatBucketMoment(series.windowStart, bucket)} – {formatBucketMoment(series.windowEnd, bucket)}</>}</p>
      {series?.truncated && <p className="risk medium">{t("Die Antwort wurde an der Zeilengrenze abgeschnitten; die Reihe zeigt nicht jeden Abschnitt des Fensters.")}</p>}
      {chart.empty && <p className="muted">{t("Keine Ereignisse im Zeitraum")}</p>}

      {!chart.empty && <div className="usage-series-chart">
        <svg role="img" aria-label={label} viewBox={`0 0 ${chart.width} ${chart.height}`} width={chart.width} height={chart.height}>
          <line x1={chart.plot.x} y1={chart.baselineY} x2={chart.plot.x + chart.plot.width} y2={chart.baselineY} stroke="currentColor" strokeWidth={1}/>
          {chart.ticks.map((tick) => <g key={tick.value + tick.y}>
            <line x1={chart.plot.x} y1={tick.y} x2={chart.plot.x + chart.plot.width} y2={tick.y} stroke="currentColor" strokeWidth={0.5} strokeDasharray="3 4" opacity={0.4}/>
            <text x={chart.plot.x - 8} y={tick.y + 4} textAnchor="end" className="usage-series-tick">{amount(tick.value)}</text>
          </g>)}
          {chart.bars.map((bar) => <g key={bar.start} className="usage-series-bar">
            <rect x={bar.x} y={bar.accepted.y} width={bar.width} height={bar.accepted.height} fill="currentColor" opacity={0.75}/>
            <rect x={bar.x} y={bar.rejected.y} width={bar.width} height={bar.rejected.height} fill="var(--qkern-surface)" stroke="currentColor" strokeWidth={1}/>
          </g>)}
          {chart.labels.map((entry) => <text key={entry.start} x={entry.x} y={chart.baselineY + 16} textAnchor="middle" className="usage-series-label">{formatBucketMoment(entry.start, bucket)}</text>)}
        </svg>
      </div>}
      {!chart.empty && <p className="muted">{t("Gefüllt gezeichnet ist die angenommene Menge, umrandet darüber die abgelehnte. Ein Abschnitt ohne Ereignis ist eine Lücke, kein fehlender Wert.")}</p>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NUR LESEND")}</span><h3>{t("Dieselben Zahlen als Tabelle")}</h3></div><BarChart3 size={18}/></div>
      <p className="muted">{t("Dieselbe Auskunft wie das Bild, für Vorleseausgaben und zum Nachlesen. Abschnitte ohne Ereignis stehen als Null da, nicht als Lücke.")}</p>
      <div className="usage-series-table">
        <div className="log-row log-header">
          <span>{t("Abschnitt")}</span><span>{t("Angenommen")}</span><span>{t("Abgelehnt")}</span><span>{t("Ereignisse")}</span>
        </div>
        {series?.buckets.map((entry) => <div className="log-row" key={entry.start}>
          <time>{formatBucketMoment(entry.start, bucket)}</time>
          <span>{amount(entry.accepted)}</span>
          <span className={entry.rejected === "0" ? "muted" : "risk medium"}>{amount(entry.rejected)}</span>
          <code>{entry.events}</code>
        </div>)}
      </div>
    </article>
  </div>;
}
