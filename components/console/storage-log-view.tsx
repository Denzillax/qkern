"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Cloud, RefreshCw, ShieldAlert } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatDecimal, formatMoment } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import { OptionMenu } from "@/components/console/option-menu";
import {
  STORAGE_LOG_DELETED_NOTE,
  STORAGE_LOG_HONESTY,
  STORAGE_LOG_NOT_SHOWN,
  STORAGE_LOG_STATUS_IDS,
  STORAGE_LOG_STATUS_TEXTS,
  type StorageLogStatusId,
} from "@/lib/console/storage-log-texts";

/**
 * Der Stand der Speicherobjekte (2.51) — die Seite **Logs → Storage**.
 *
 * Sie heisst Log und ist keins. QKERN schreibt kein Ereignis je Zugriff; die
 * einzige Tatsache ueber ein Objekt ist seine Zeile mit Bucket, Schluessel,
 * Groesse, Typ, Urteil und drei Zeitpunkten. Die Ansicht zeigt genau das und
 * sagt vor der ersten Zeile, was sie deshalb nicht zeigen kann.
 *
 * Nur lesend. Eine Route (`storage/objects`), ein GET, kein Schreibverb,
 * keine signierte Adresse und kein Provider-Schluessel — das Signieren bleibt
 * unter Storage → Buckets.
 */
type Environment = "development" | "staging" | "production";
type Entry = {
  id: string;
  bucketId: string;
  bucketName: string;
  key: string;
  ownerSubject: string | null;
  sizeBytes: number;
  contentType: string;
  status: StorageLogStatusId;
  createdAt: string;
  deleteAfter: string | null;
  deletedAt: string | null;
};
type Data = {
  entries: Entry[];
  counts: Record<StorageLogStatusId, number>;
  nextCursor: string | null;
  buckets: Array<{ id: string; name: string }>;
};
type State = "loading" | "ready" | "disabled" | "unavailable" | "error";
type Payload = Record<string, unknown>;

const STORAGE_DISABLED_ERROR = "Project Storage is disabled";
const ALL = "";

async function readJson(url: string, signal: AbortSignal): Promise<{ status: number; payload: Payload }> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    const body: unknown = (await response.json().catch(() => ({}))) ?? {};
    return { status: response.status, payload: body !== null && typeof body === "object" && !Array.isArray(body) ? body as Payload : {} };
  } catch (cause) {
    return { status: 0, payload: { error: cause instanceof Error ? cause.message : "" } };
  }
}

const moment = (value: string) => formatMoment(value);

/**
 * Bytes in der Einheit, in der ein Mensch sie liest; die genaue Zahl bleibt im
 * Titel. Bleibt eigen und nimmt nicht `formatBytes` aus `console-format`: Das
 * Protokoll zeigt eine Nachkommastelle, die Kennzahlen runden ganzzahlig.
 */
function size(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${unit === 0 ? formatDecimal(value, 0) : formatDecimal(value, 1)} ${units[unit]}`;
}

export function StorageLogView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: State }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/storage/objects`;
  const [bucket, setBucket] = useState<string>(ALL);
  const [status, setStatus] = useState<StorageLogStatusId | "">(ALL);
  const [state, setState] = useState<State>(initialState ?? "loading");
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null);

  // Jede Ladung hat einen eigenen AbortController; eine abgebrochene setzt keinen Zustand mehr.
  const load = useCallback(async (initial: boolean, filter: { bucket: string; status: string }) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (initial) setState("loading"); else setRefreshing(true);
    const query = new URLSearchParams();
    if (filter.bucket) query.set("bucket", filter.bucket);
    if (filter.status) query.set("status", filter.status);
    const suffix = query.toString();
    const result = await readJson(suffix ? `${base}?${suffix}` : base, controller.signal);
    if (controller.signal.aborted) return;
    setRefreshing(false);
    const error = typeof result.payload.error === "string" ? result.payload.error : "";
    if (result.status === 503) {
      setData(null);
      setState(error === STORAGE_DISABLED_ERROR ? "disabled" : "unavailable");
      setMessage(error);
      return;
    }
    const payload = result.payload.data as Data | undefined;
    if (result.status === 200 && payload && Array.isArray(payload.entries)) {
      setData(payload);
      setMessage("");
      setState("ready");
      return;
    }
    setData(null);
    setMessage(error || t("Stand der Objekte nicht verfügbar"));
    setState("error");
  }, [base]);

  useEffect(() => {
    void load(true, { bucket, status });
    return () => request.current?.abort();
  }, [load, bucket, status]);

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Stand der Objekte wird geladen…")}</h3></div>;
  }
  if (state === "disabled" || state === "unavailable" || state === "error") {
    return <div className="console-card live-module-state"><Cloud size={26}/>
      <h3>{state === "disabled" ? t("Object Storage ist nicht aktiv") : state === "unavailable" ? t("Storage gerade nicht erreichbar") : t("Stand der Objekte nicht verfügbar")}</h3>
      <p>{state === "disabled" ? t("Ohne eingeschalteten Object Storage gibt es keine Objekte. Diese Seite erfindet keine.") : message}</p>
      <button className="secondary-button" onClick={() => void load(true, { bucket, status })}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  const entries = data?.entries ?? [];
  const buckets = data?.buckets ?? [];

  return <div className="module-grid">
    <article className="console-card auth-overview">
      {STORAGE_LOG_STATUS_IDS.map((id) => <div key={id}>
        <span>{t(STORAGE_LOG_STATUS_TEXTS[id].label).toUpperCase()}</span>
        <strong>{data?.counts[id] ?? 0}</strong>
        <small>{t("Objekte im gewählten Ausschnitt")}</small>
      </div>)}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("LOGS")} · {environment.toUpperCase()}</span><h3>{t("Speicherobjekte und ihr Urteil")}</h3></div><div>
        {/* Dasselbe Bauteil wie das Umgebungsmenue in der Kopfzeile. Ohne
            Erklaerzeile: Ein Bucket-Name ist die Angabe selbst, und was ueber
            ihn hinaus zu sagen waere, weiss diese Ansicht nicht. */}
        <OptionMenu value={bucket} ariaLabel={t("Bucket")} listLabel={t("Bucket wählen")}
          icon={<Cloud size={14} aria-hidden="true"/>} onChange={(next) => setBucket(next)}
          options={[
            { id: ALL, label: t("Alle Buckets") },
            ...buckets.map((entry) => ({ id: entry.id, label: entry.name })),
          ]}/>
        {/* Hier traegt die Erklaerzeile die Folge des Urteils fuer das Objekt,
            kurz. Die langen Saetze aus `STORAGE_LOG_STATUS_TEXTS` stehen in
            der Legende unten; zweimal derselbe Absatz auf einer Seite hilft
            niemandem. */}
        <OptionMenu value={status} ariaLabel={t("Urteil")} listLabel={t("Urteil wählen")}
          icon={<ShieldAlert size={14} aria-hidden="true"/>}
          onChange={setStatus}
          options={[
            { id: ALL, label: t("Jedes Urteil"), hint: t("Dieser Filter wird nicht mitgeschickt") },
            { id: "quarantined", label: t(STORAGE_LOG_STATUS_TEXTS.quarantined.label), hint: t("Noch ohne Urteil, der Download ist gesperrt") },
            { id: "clean", label: t(STORAGE_LOG_STATUS_TEXTS.clean.label), hint: t("Freigegeben, nur dafür gibt es eine signierte Adresse") },
            { id: "infected", label: t(STORAGE_LOG_STATUS_TEXTS.infected.label), hint: t("Abgelehnt und im selben Schritt entfernt") },
          ]}/>
        <button className="secondary-button" onClick={() => void load(false, { bucket, status })} disabled={refreshing}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
      </div></div>

      <p className="muted">{t(STORAGE_LOG_HONESTY)}</p>
      <p className="muted">{t(STORAGE_LOG_NOT_SHOWN)}</p>
      <p className="muted">{t(STORAGE_LOG_DELETED_NOTE)}</p>

      {entries.length === 0 && <p className="muted">{buckets.length === 0
        ? t("In dieser Umgebung gibt es noch keinen Bucket.")
        : t("Zu diesem Ausschnitt liegt kein Objekt vor.")}</p>}

      {entries.length > 0 && <div className="usage-series-table">
        <div className="log-row log-header">
          <span>{t("Bucket")}</span><span>{t("Schlüssel")}</span><span>{t("Grösse")}</span>
          <span>{t("Typ")}</span><span>{t("Urteil")}</span><span>{t("Angelegt")}</span>
        </div>
        {entries.map((entry) => <div className="log-row" key={entry.id}>
          <span>{entry.bucketName}</span>
          <code title={entry.key}>{entry.key}</code>
          <span title={`${entry.sizeBytes}`}>{size(entry.sizeBytes)}</span>
          <span className="muted">{entry.contentType}</span>
          <span className={entry.status === "infected" ? "risk high" : entry.status === "quarantined" ? "risk medium" : "muted"}>
            {t(STORAGE_LOG_STATUS_TEXTS[entry.status].label)}
            {entry.deletedAt && <> · {t("entfernt")} {moment(entry.deletedAt)}</>}
          </span>
          <time>{moment(entry.createdAt)}{entry.deleteAfter && <> · {t("verfällt")} {moment(entry.deleteAfter)}</>}</time>
        </div>)}
      </div>}

      {data?.nextCursor && <p className="muted">{t("Die Liste zeigt die neuesten 50 Objekte dieses Ausschnitts; ältere liegen dahinter.")}</p>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NUR LESEND")}</span><h3>{t("Was ein Urteil bedeutet")}</h3></div><ShieldAlert size={18}/></div>
      <div className="usage-series-table">
        <div className="log-row log-header"><span>{t("Urteil")}</span><span>{t("Was es sagt")}</span></div>
        {STORAGE_LOG_STATUS_IDS.map((id) => <div className="log-row" key={id}>
          <span>{t(STORAGE_LOG_STATUS_TEXTS[id].label)}</span>
          <span className="muted">{t(STORAGE_LOG_STATUS_TEXTS[id].meaning)}</span>
        </div>)}
      </div>
    </article>
  </div>;
}
