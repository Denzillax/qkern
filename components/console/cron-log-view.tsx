"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, FileClock, RefreshCw } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import { OptionMenu } from "@/components/console/option-menu";
import {
  CRON_MESSAGE_STATE_TEXTS,
  CRON_OCCURRENCE_STATUS_TEXTS,
  CRON_OCCURRENCE_STATUSES,
  type CronMessageStateId,
  type CronOccurrenceStatusId,
} from "@/lib/console/cron-log-texts";

/**
 * Das Cron-Log (2.42), wie bei Supabase unter Logs → Cron, aber nur lesend:
 * kein Ausloesen von Hand, kein Wiederholen, kein Pausieren. Das gehoert nach
 * Functions & Jobs, wo die Definition auch entsteht.
 *
 * Zwei Routen: `/compute/cron` die Definitionen, `/compute/cron/{id}/occurrences`
 * das Log einer davon. Gezeigt wird ein zusammengesetztes Log — erwartete
 * Vorkommen aus dem Ausdruck, daneben die Nachricht, die der Dispatcher zu
 * diesem Vorkommen eingereiht hat. Keine Nutzlast, kein Dedupe-Schluessel.
 *
 * Vier Zustaende statt zwei, weil zwei gelogen waeren: Ein Vorkommen vor dem
 * Anlegen der Definition und ein Vorkommen jenseits des Dedupe-Fensters sind
 * keine Luecken, sondern Grenzen der Rekonstruktion. Die Legende sagt das.
 */
type Environment = "development" | "staging" | "production";
type CronDefinition = { id: string; name: string; expression: string; queue: string; enabled: boolean };
type OccurrenceMessage = { state: CronMessageStateId; attempts: number; enqueuedAt: string; settledAt: string | null };
type Occurrence = { occurredAt: string; status: CronOccurrenceStatusId; message: OccurrenceMessage | null };
type CronLog = {
  cronId: string; name: string; expression: string; queue: string; enabled: boolean; createdAt: string;
  window: { from: string; to: string; maxOccurrences: number; queueFound: boolean };
  counts: { found: number; missing: number; notYetDue: number; expected: number };
  occurrences: Occurrence[];
};
type State = "loading" | "ready" | "unavailable" | "error";
type Payload = Record<string, unknown>;

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

const moment = (value: string) =>
  formatMoment(value);

export function CronLogView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: State }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/compute/cron`;
  const [state, setState] = useState<State>(initialState ?? "loading");
  const [definitions, setDefinitions] = useState<CronDefinition[]>([]);
  const [selected, setSelected] = useState("");
  const [log, setLog] = useState<CronLog | null>(null);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null);

  const loadLog = useCallback(async (id: string, signal: AbortSignal) => {
    if (!id) { setLog(null); return; }
    const result = await readJson(`${base}/${id}/occurrences`, signal);
    if (signal.aborted) return;
    const data = result.payload.data as CronLog | undefined;
    if (result.status === 200 && data && Array.isArray(data.occurrences)) { setLog(data); setMessage(""); return; }
    setLog(null);
    setMessage(typeof result.payload.error === "string" && result.payload.error ? result.payload.error : t("Cron-Log nicht verfügbar"));
  }, [base]);

  // Jede Ladung hat einen eigenen AbortController; eine abgebrochene setzt keinen Zustand mehr.
  const load = useCallback(async (initial: boolean, id?: string) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (initial) setState("loading"); else setRefreshing(true);
    const result = await readJson(base, controller.signal);
    if (controller.signal.aborted) return;
    if (result.status === 503) {
      setRefreshing(false); setDefinitions([]); setLog(null); setState("unavailable");
      setMessage(typeof result.payload.error === "string" ? result.payload.error : t("Compute ist für diese Umgebung deaktiviert."));
      return;
    }
    if (result.status !== 200 || !Array.isArray(result.payload.data)) {
      setRefreshing(false); setState("error");
      setMessage(typeof result.payload.error === "string" && result.payload.error ? result.payload.error : t("Cron-Definitionen nicht verfügbar"));
      return;
    }
    const list = result.payload.data as CronDefinition[];
    setDefinitions(list);
    const wanted = id && list.some((entry) => entry.id === id) ? id : (list[0]?.id ?? "");
    setSelected(wanted);
    await loadLog(wanted, controller.signal);
    if (controller.signal.aborted) return;
    setRefreshing(false);
    setState("ready");
  }, [base, loadLog]);

  useEffect(() => {
    void load(true);
    return () => request.current?.abort();
  }, [load]);

  function pick(id: string) {
    setSelected(id);
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    void loadLog(id, controller.signal);
  }

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Cron-Definitionen werden geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><Clock3 size={26}/><h3>{state === "unavailable" ? t("Compute nicht aktiv") : t("Cron-Log nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const current = definitions.find((entry) => entry.id === selected);

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("GEFUNDEN")}</span><strong>{log?.counts.found ?? 0}</strong><small>{t("Vorkommen mit Nachricht")}</small></div>
      <div><span>{t("FEHLT")}</span><strong>{log?.counts.missing ?? 0}</strong><small>{t("fällig, ohne Nachricht")}</small></div>
      <div><span>{t("NOCH NICHT FÄLLIG")}</span><strong>{log?.counts.notYetDue ?? 0}</strong><small>{t("steht noch an")}</small></div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("LOGS")} · {environment.toUpperCase()}</span><h3>{t("Cron-Log")}</h3></div><div>
        {/* Dasselbe Bauteil wie das Umgebungsmenue in der Kopfzeile. Die
            Erklaerzeile traegt den Ausdruck, denn zwei Definitionen
            unterscheiden sich nicht im Namen, sondern im Takt; `0 3 * * *`
            bleibt in jeder Sprache `0 3 * * *`. Dazu das Wort, das den Takt
            aufhebt: Eine pausierte Definition reiht nichts ein, und das
            erklaert eine leere Liste darunter. Ohne Eintraege steht der Knopf
            abgeschaltet da. */}
        <OptionMenu value={selected} ariaLabel={t("Cron-Definition")} listLabel={t("Cron-Definition wählen")}
          icon={<Clock3 size={14} aria-hidden="true"/>} onChange={pick}
          options={definitions.map((entry) => ({
            id: entry.id, label: entry.name,
            hint: entry.enabled ? entry.expression : `${entry.expression} · ${t("pausiert")}`,
          }))}/>
        <button className="secondary-button" onClick={() => void load(false, selected)} disabled={refreshing}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
      </div></div>

      <p className="muted">{t("Das Log wird aus den erwarteten Vorkommen und den Nachrichten der Queue zusammengesetzt. Was der Container ausgegeben hat, steht nicht hier.")}</p>
      {definitions.length === 0 && <p className="muted">{t("Keine Cron-Definitionen in dieser Umgebung. Lege eine unter Functions & Jobs an; ihre Vorkommen erscheinen dann hier.")}</p>}
      {current && <p className="muted"><code>{current.expression}</code> · {t("Queue")} <code>{current.queue}</code> · {current.enabled ? t("aktiv") : t("pausiert")}</p>}
      {log && !log.window.queueFound && <p className="risk high">{t("Die Zielqueue dieser Definition gibt es nicht. Ohne sie scheitert jedes Einreihen.")}</p>}
      {message && <p className="muted">{message}</p>}
      {log && <p className="muted">{t("Gezeigt werden die letzten 24 Stunden und die nächste Stunde, höchstens 50 Vorkommen, neueste zuerst.")} {moment(log.window.from)} – {moment(log.window.to)}</p>}
      {log && log.occurrences.length === 0 && <p className="muted">{t("Kein Vorkommen im Fenster")}</p>}

      {log && log.occurrences.length > 0 && <div className="log-row log-header">
        <span>{t("Zeit")}</span><span>{t("Zustand")}</span><span>{t("Nachricht")}</span><span>{t("Versuche")}</span><span>{t("Eingereiht")}</span>
      </div>}
      {log?.occurrences.map((occurrence) => {
        const status = CRON_OCCURRENCE_STATUS_TEXTS[occurrence.status];
        return <div className="log-row" key={occurrence.occurredAt}>
          <time>{moment(occurrence.occurredAt)}</time>
          <span className={status ? status.tone : "muted"}>{status ? t(status.label) : occurrence.status}</span>
          <span>{occurrence.message ? t(CRON_MESSAGE_STATE_TEXTS[occurrence.message.state]) : "–"}</span>
          <code>{occurrence.message ? occurrence.message.attempts : "–"}</code>
          <time>{occurrence.message ? moment(occurrence.message.enqueuedAt) : "–"}</time>
        </div>;
      })}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NUR LESEND")}</span><h3>{t("Was die Zustände bedeuten")}</h3></div><FileClock size={18}/></div>
      {CRON_OCCURRENCE_STATUSES.map((status) => <div className="log-row" key={status}>
        <span className={CRON_OCCURRENCE_STATUS_TEXTS[status].tone}>{t(CRON_OCCURRENCE_STATUS_TEXTS[status].label)}</span>
        <p className="muted">{t(CRON_OCCURRENCE_STATUS_TEXTS[status].explains)}</p>
      </div>)}
      <p className="muted">{t("Nicht im Blick: die Ausgabe des Containers, das Ergebnis des Jobs selbst und jedes Vorkommen, dessen Nachricht die Aufbewahrung der Queue schon entfernt hat.")}</p>
    </article>
  </div>;
}
