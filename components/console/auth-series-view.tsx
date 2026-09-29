"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Fingerprint, RefreshCw } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatNumber } from "@/components/console/console-display";
import { formatBucketMoment } from "@/components/console/console-format";
import { StableLabel } from "@/components/stable-label";
import { buildUsageSeriesChart } from "@/lib/console/usage-series-chart";
import {
  AUTH_AUDIT_ACTION_TEXTS,
  AUTH_SERIES_CANNOT_SHOW,
  AUTH_SERIES_HONESTY,
  PROJECT_AUTH_AUDIT_ACTION_IDS,
  type ProjectAuthAuditActionId,
} from "@/lib/console/auth-observability-texts";

/**
 * Anmeldungen ueber die Zeit (2.47): Berichte, Auth.
 *
 * Die Reihe entsteht aus dem Auth-Audit, das seit 2.35 in der Hash-Kette der
 * Plattform liegt. Aggregiert wird in der Datenbank; diese Ansicht liest nur.
 * Ein GET, kein Schreibverb.
 *
 * Das Bild ist dieselbe reine Funktion wie bei den Nutzungsreihen
 * (`buildUsageSeriesChart`): unten die gelungenen Handlungen, darueber die
 * gescheiterten. Daneben stehen dieselben Zahlen als Tabelle, weil ein Bild
 * fuer eine Vorleseausgabe nichts ist und eine Zahl, die nur als Balkenhoehe
 * existiert, keine Auskunft ist.
 */
type Environment = "development" | "staging" | "production";
type Bucket = "hour" | "day";
type Counts = {
  total: number;
  succeeded: number;
  failed: number;
  actions: Record<ProjectAuthAuditActionId, number>;
};
type Series = {
  bucket: Bucket;
  windowStart: string;
  windowEnd: string;
  bucketCount: number;
  truncated: boolean;
  buckets: Array<Counts & { start: string }>;
  totals: Counts;
};
type State = "loading" | "ready" | "disabled" | "unavailable" | "error";
type Payload = Record<string, unknown>;

const PROJECT_AUTH_DISABLED_ERROR = "Project Auth is disabled";
const AUDIT_UNAVAILABLE_ERROR = "Project Auth audit is not configured";

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

export function AuthSeriesView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: State }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/auth/admin/audit/series`;
  const [bucket, setBucket] = useState<Bucket>("hour");
  const [state, setState] = useState<State>(initialState ?? "loading");
  const [series, setSeries] = useState<Series | null>(null);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null);

  // Jede Ladung hat einen eigenen AbortController; eine abgebrochene setzt
  // keinen Zustand mehr.
  const load = useCallback(async (initial: boolean, next: Bucket) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (initial) setState("loading"); else setRefreshing(true);
    const result = await readJson(`${base}?bucket=${next}`, controller.signal);
    if (controller.signal.aborted) return;
    setRefreshing(false);
    const error = typeof result.payload.error === "string" ? result.payload.error : "";
    if (result.status === 503) {
      setSeries(null);
      setState(error === PROJECT_AUTH_DISABLED_ERROR || error === AUDIT_UNAVAILABLE_ERROR ? "disabled" : "unavailable");
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
    setMessage(error || t("Reihe nicht verfügbar"));
    setState("error");
  }, [base]);

  useEffect(() => {
    void load(true, bucket);
    return () => request.current?.abort();
  }, [load, bucket]);

  const chart = useMemo(() => buildUsageSeriesChart({
    buckets: (series?.buckets ?? []).map((entry) => ({
      start: entry.start,
      accepted: String(entry.succeeded),
      rejected: String(entry.failed),
      events: entry.total,
    })),
  }), [series]);

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Reihe wird geladen…")}</h3></div>;
  }
  if (state === "disabled" || state === "unavailable" || state === "error") {
    return <div className="console-card live-module-state"><Fingerprint size={26}/>
      <h3>{state === "disabled" ? t("Kein Auth-Protokoll vorhanden") : state === "unavailable" ? t("Reihe gerade nicht erreichbar") : t("Reihe nicht verfügbar")}</h3>
      <p>{state === "disabled" ? t("Ohne protokollierte Anmeldungen gibt es keine Reihe. Diese Seite erfindet keinen Verlauf.") : message}</p>
      <button className="secondary-button" onClick={() => void load(true, bucket)}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  const totals = series?.totals;
  const windowText = bucket === "hour"
    ? t("Gezeigt werden die letzten 48 Stunden in Stundenschritten.")
    : t("Gezeigt werden die letzten 90 Tage in Tagesschritten.");
  const label = `${t("Anmeldungen über die Zeit")}: ${series?.bucketCount ?? 0} ${bucket === "hour" ? t("Stundenwerte") : t("Tageswerte")}, ${t("höchster Wert")} ${chart.max}`;
  const used = PROJECT_AUTH_AUDIT_ACTION_IDS.filter((id) => (totals?.actions[id] ?? 0) > 0);

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("HANDLUNGEN")}</span><strong>{formatNumber(totals?.total ?? 0)}</strong><small>{t("protokolliert im Fenster")}</small></div>
      <div><span>{t("ERFOLGREICH")}</span><strong>{formatNumber(totals?.succeeded ?? 0)}</strong><small>{t("ohne Fehler abgeschlossen")}</small></div>
      <div><span>{t("FEHLVERSUCHE")}</span><strong>{formatNumber(totals?.failed ?? 0)}</strong><small>{t("als fehlgeschlagen protokolliert")}</small></div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("BERICHTE")} · {environment.toUpperCase()}</span><h3>{t("Anmeldungen über die Zeit")}</h3></div><div>
        <button className="secondary-button" onClick={() => setBucket(bucket === "hour" ? "day" : "hour")} disabled={refreshing}>
          <StableLabel current={bucket === "hour" ? t("Stunden") : t("Tage")} variants={tAll("Stunden", "Tage")}/>
        </button>
        <button className="secondary-button" onClick={() => void load(false, bucket)} disabled={refreshing}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
      </div></div>

      <p className="muted">{t(AUTH_SERIES_HONESTY)}</p>
      <p className="muted">{t(AUTH_SERIES_CANNOT_SHOW)}</p>
      <p className="muted">{windowText} {series && <>{formatBucketMoment(series.windowStart, bucket)} – {formatBucketMoment(series.windowEnd, bucket)}</>}</p>
      {series?.truncated && <p className="risk medium">{t("Die Antwort wurde an der Zeilengrenze abgeschnitten; die Reihe zeigt nicht jeden Abschnitt des Fensters.")}</p>}
      {chart.empty && <p className="muted">{t("Keine Ereignisse im Zeitraum")}</p>}

      {!chart.empty && <div className="usage-series-chart">
        <svg role="img" aria-label={label} viewBox={`0 0 ${chart.width} ${chart.height}`} width={chart.width} height={chart.height}>
          <line x1={chart.plot.x} y1={chart.baselineY} x2={chart.plot.x + chart.plot.width} y2={chart.baselineY} stroke="currentColor" strokeWidth={1}/>
          {chart.ticks.map((tick) => <g key={tick.value + tick.y}>
            <line x1={chart.plot.x} y1={tick.y} x2={chart.plot.x + chart.plot.width} y2={tick.y} stroke="currentColor" strokeWidth={0.5} strokeDasharray="3 4" opacity={0.4}/>
            <text x={chart.plot.x - 8} y={tick.y + 4} textAnchor="end" className="usage-series-tick">{tick.value}</text>
          </g>)}
          {chart.bars.map((bar) => <g key={bar.start} className="usage-series-bar">
            <rect x={bar.x} y={bar.accepted.y} width={bar.width} height={bar.accepted.height} fill="currentColor" opacity={0.75}/>
            <rect x={bar.x} y={bar.rejected.y} width={bar.width} height={bar.rejected.height} fill="var(--qkern-surface)" stroke="currentColor" strokeWidth={1}/>
          </g>)}
          {chart.labels.map((entry) => <text key={entry.start} x={entry.x} y={chart.baselineY + 16} textAnchor="middle" className="usage-series-label">{formatBucketMoment(entry.start, bucket)}</text>)}
        </svg>
      </div>}
      {!chart.empty && <p className="muted">{t("Gefüllt gezeichnet sind die gelungenen Handlungen, umrandet darüber die gescheiterten. Ein Abschnitt ohne Eintrag ist eine Lücke, kein fehlender Wert.")}</p>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NUR LESEND")}</span><h3>{t("Dieselben Zahlen als Tabelle")}</h3></div><BarChart3 size={18}/></div>
      <p className="muted">{t("Dieselbe Auskunft wie das Bild, für Vorleseausgaben und zum Nachlesen. Abschnitte ohne Eintrag stehen als Null da, nicht als Lücke.")}</p>
      <div className="usage-series-table">
        <div className="log-row log-header">
          <span>{t("Abschnitt")}</span><span>{t("Handlungen")}</span><span>{t("Erfolgreich")}</span><span>{t("Fehlversuche")}</span>
        </div>
        {series?.buckets.map((entry) => <div className="log-row" key={entry.start}>
          <time>{formatBucketMoment(entry.start, bucket)}</time>
          <span>{formatNumber(entry.total)}</span>
          <span>{formatNumber(entry.succeeded)}</span>
          <span className={entry.failed === 0 ? "muted" : "risk medium"}>{formatNumber(entry.failed)}</span>
        </div>)}
      </div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NACH HANDLUNG")}</span><h3>{t("Was im Fenster protokolliert wurde")}</h3></div><Fingerprint size={18}/></div>
      {used.length === 0 && <p className="muted">{t("Keine Ereignisse im Zeitraum")}</p>}
      {used.length > 0 && <div className="usage-series-table">
        <div className="log-row log-header"><span>{t("Handlung")}</span><span>{t("Anzahl")}</span></div>
        {used.map((id) => <div className="log-row" key={id}>
          <span title={id}>{t(AUTH_AUDIT_ACTION_TEXTS[id])}</span>
          <span>{formatNumber(totals?.actions[id] ?? 0)}</span>
        </div>)}
      </div>}
    </article>
  </div>;
}
