"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Fingerprint, RefreshCw, TriangleAlert } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatNumber, formatPercent } from "@/components/console/console-display";
import { formatBucketMoment } from "@/components/console/console-format";
import { StableLabel } from "@/components/stable-label";
import {
  authFailureRanking,
  authFailureShare,
  type AuthPerformanceBucket,
  type AuthPerformanceCounts,
} from "@/lib/console/auth-performance";
import {
  AUTH_PERFORMANCE_CANNOT_SHOW,
  AUTH_PERFORMANCE_NOT_AN_ATTACK,
  AUTH_PERFORMANCE_NO_DURATION,
  AUTH_PERFORMANCE_SOURCE,
  AUTH_PERFORMANCE_WINDOW_EDGE,
} from "@/lib/console/auth-performance-texts";
import { AUTH_AUDIT_ACTION_TEXTS } from "@/lib/console/auth-observability-texts";

/**
 * Auth-Leistung (2.71): Auth, Auth-Leistung.
 *
 * Der Platzhalter dieser Seite versprach "Antwortzeiten und Fehlerraten der
 * Anmeldung". Die Haelfte davon gibt es. Die Audit-Kette haelt je Handlung
 * einen Zeitpunkt, eine Art, einen Ausgang und eine Referenz, keine Dauer;
 * eine Antwortzeit braeuchte einen zweiten Zeitpunkt derselben Handlung, und
 * den schreibt niemand. Der erste Satz der Seite sagt das, statt eine Zahl zu
 * zeigen, die niemand gemessen hat.
 *
 * Gelesen wird dieselbe Route wie unter Berichte, Auth: ein GET auf
 * `admin/audit/series`, kein Schreibverb, keine zweite Abfrage. Der
 * Unterschied ist die Frage. Berichte, Auth fragt "wie viel wann"; diese
 * Seite fragt "was scheitert, wie oft, und seit wann". Die Zahlen dafuer
 * stehen seit 2.71 in derselben Antwort: Die Datenbank gruppiert ohnehin nach
 * Handlung und zaehlt die gescheiterten mit.
 *
 * Gerechnet wird im reinen Modul `auth-performance`, formatiert ueber
 * `console-display`.
 */
type Environment = "development" | "staging" | "production";
type Bucket = "hour" | "day";
type Series = {
  bucket: Bucket;
  windowStart: string;
  windowEnd: string;
  bucketCount: number;
  truncated: boolean;
  buckets: AuthPerformanceBucket[];
  totals: AuthPerformanceCounts;
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

export function AuthPerformanceView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: State }) {
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
    setMessage(error || t("Auth-Leistung nicht verfügbar"));
    setState("error");
  }, [base]);

  useEffect(() => {
    void load(true, bucket);
    return () => request.current?.abort();
  }, [load, bucket]);

  const ranking = useMemo(() => series ? authFailureRanking(series) : [], [series]);
  // Abschnitte ohne jede Handlung bleiben aus der Tabelle. Ein Fenster von 90
  // Tagen haette sonst 90 Zeilen mit lauter Nullen, und die Zeile, auf die es
  // ankommt, ginge darin unter. Wie viele weggelassen wurden, steht daneben.
  const active = useMemo(() => (series?.buckets ?? []).filter((entry) => entry.total > 0), [series]);

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Auth-Leistung wird geladen…")}</h3></div>;
  }
  if (state === "disabled" || state === "unavailable" || state === "error") {
    return <div className="console-card live-module-state"><Fingerprint size={26}/>
      <h3>{state === "disabled" ? t("Kein Auth-Protokoll vorhanden") : state === "unavailable" ? t("Auth-Leistung gerade nicht erreichbar") : t("Auth-Leistung nicht verfügbar")}</h3>
      <p>{state === "disabled" ? t("Ohne protokollierte Anmeldungen gibt es keine Fehlerrate. Diese Seite erfindet keine.") : message}</p>
      <button className="secondary-button" onClick={() => void load(true, bucket)}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  const totals = series?.totals;
  const share = totals ? authFailureShare(totals) : 0;
  const windowText = bucket === "hour"
    ? t("Gezeigt werden die letzten 48 Stunden in Stundenschritten.")
    : t("Gezeigt werden die letzten 90 Tage in Tagesschritten.");
  const quiet = (series?.bucketCount ?? 0) - active.length;

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("HANDLUNGEN")}</span><strong>{formatNumber(totals?.total ?? 0)}</strong><small>{t("protokolliert im Fenster")}</small></div>
      <div><span>{t("FEHLSCHLÄGE")}</span><strong>{formatNumber(totals?.failed ?? 0)}</strong><small>{t("als fehlgeschlagen protokolliert")}</small></div>
      <div><span>{t("ANTEIL GESCHEITERT")}</span>
        <strong>{(totals?.total ?? 0) > 0 ? formatPercent(share) : t("keine Angabe")}</strong>
        <small>{(totals?.total ?? 0) > 0 ? t("der protokollierten Handlungen") : t("im Fenster wurde nichts protokolliert")}</small></div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("AUTH")} · {environment.toUpperCase()}</span><h3>{t("Was scheitert, und seit wann")}</h3></div><div>
        <button className="secondary-button" onClick={() => setBucket(bucket === "hour" ? "day" : "hour")} disabled={refreshing}>
          <StableLabel current={bucket === "hour" ? t("Stunden") : t("Tage")} variants={tAll("Stunden", "Tage")}/>
        </button>
        <button className="secondary-button" onClick={() => void load(false, bucket)} disabled={refreshing}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
      </div></div>

      <p className="risk medium">{t(AUTH_PERFORMANCE_NO_DURATION)}</p>
      <p className="muted">{t(AUTH_PERFORMANCE_SOURCE)}</p>
      <p className="muted">{windowText} {series && <>{formatBucketMoment(series.windowStart, bucket)} {t("bis")} {formatBucketMoment(series.windowEnd, bucket)}</>}</p>
      {series?.truncated && <p className="risk medium">{t("Die Antwort wurde an der Zeilengrenze abgeschnitten; die Zahlen unten decken nicht das ganze Fenster ab.")}</p>}

      {ranking.length === 0 && <p className="muted">{t("Im Fenster ist keine Handlung gescheitert. Das ist eine Aussage über das Fenster, nicht über die Anmeldung überhaupt.")}</p>}
      {ranking.length > 0 && <div className="usage-series-table">
        <div className="log-row log-header">
          <span>{t("Handlung")}</span><span>{t("Handlungen")}</span><span>{t("Fehlschläge")}</span><span>{t("Anteil")}</span><span>{t("Gescheitert seit")}</span>
        </div>
        {ranking.map((row) => <div className="log-row" key={row.id}>
          <span title={row.id}>{t(AUTH_AUDIT_ACTION_TEXTS[row.id])}</span>
          <span>{formatNumber(row.total)}</span>
          <span className="risk medium">{formatNumber(row.failed)}</span>
          <span>{formatPercent(row.share)}</span>
          <time>{formatBucketMoment(row.firstFailureStart, bucket)}</time>
        </div>)}
      </div>}
      {ranking.length > 0 && <p className="muted">{t(AUTH_PERFORMANCE_WINDOW_EDGE)}</p>}
      {ranking.length > 0 && <p className="muted">{t("Sortiert nach der Zahl der Fehlschläge, nicht nach dem Anteil: Eine Art, die einmal vorkam und einmal scheiterte, hat den Anteil 100 Prozent und sagt trotzdem wenig.")}</p>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("JE ABSCHNITT")}</span><h3>{t("Handlungen und Fehlschläge über die Zeit")}</h3></div><TriangleAlert size={18}/></div>
      <p className="muted">{t("Abschnitte ohne jede Handlung stehen nicht in der Tabelle; sie wären lauter Nullen.")} {t("Ohne Eintrag geblieben")}: {formatNumber(quiet)} / {formatNumber(series?.bucketCount ?? 0)}</p>
      {active.length === 0 && <p className="muted">{t("Keine Ereignisse im Zeitraum")}{" "}{t("Das ist eine Aussage über das gewählte Fenster, nicht über die Anmeldung überhaupt; ein längeres Fenster kann Zeilen zeigen.")}</p>}
      {active.length > 0 && <div className="usage-series-table">
        <div className="log-row log-header">
          <span>{t("Abschnitt")}</span><span>{t("Handlungen")}</span><span>{t("Fehlschläge")}</span><span>{t("Anteil")}</span>
        </div>
        {active.map((entry) => <div className="log-row" key={entry.start}>
          <time>{formatBucketMoment(entry.start, bucket)}</time>
          <span>{formatNumber(entry.total)}</span>
          <span className={entry.failed === 0 ? "muted" : "risk medium"}>{formatNumber(entry.failed)}</span>
          <span>{formatPercent(authFailureShare(entry))}</span>
        </div>)}
      </div>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("EHRLICH GESAGT")}</span><h3>{t("Was diese Seite nicht sagt")}</h3></div><Fingerprint size={18}/></div>
      <p className="muted">{t(AUTH_PERFORMANCE_NOT_AN_ATTACK)}</p>
      <p className="muted">{t(AUTH_PERFORMANCE_CANNOT_SHOW)}</p>
      <p className="muted">{t("Wer einem einzelnen Fehlschlag nachgehen will, findet den Eintrag unter Auth, Audit-Log. Auch dort steht die Handlung und ihr Ausgang, nicht der Grund.")}</p>
    </article>
  </div>;
}
