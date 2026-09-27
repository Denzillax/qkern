"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Database, FileWarning, HardDrive, RefreshCw, ShieldCheck, Timer } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment, formatNumber, formatPercent } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import { cacheHitRatio } from "@/lib/console/database-activity-texts";
import {
  CHECKPOINT_SOURCE_TEXTS,
  CHECKSUM_STATE_TEXTS,
  COUNTER_NOTE,
  MISSING_POSTGRES_LOG,
  NEVER_RESET_NOTE,
  NO_SERVER_LOG_NOTE,
  SCOPE_NOTE,
  WRITEBACK_SCOPE_NOTE,
  averageTempFileBytes,
  brokenSessions,
  checkpointSource,
  checksumState,
  requestedCheckpointRatio,
  rollbackRatio,
} from "@/lib/console/database-health-texts";

/**
 * Logs → Postgres-Zustand (2.70), nur lesend.
 *
 * Der Platzhalter versprach „das Serverlog der Projektdatenbank: Verbindungen,
 * Fehler, langsame Statements". Dieses Log gibt es nicht, und die Seite sagt
 * das als Erstes, noch vor der ersten Zahl.
 *
 * Was sie stattdessen hält, ist der Zustand: die Störungszähler aus
 * `pg_stat_database` und der Schreibweg des Servers aus `pg_stat_checkpointer`
 * beziehungsweise `pg_stat_bgwriter`. Jede Zahl ist ein Zähler seit der
 * letzten Rücksetzung, und auch das steht oben und nicht im Kleingedruckten.
 *
 * Die Verbindungen je Rolle und Zustand hat Berichte → Verbindungen; sie
 * werden hier nicht wiederholt. Kein Eingabefeld, kein Knopf, der etwas
 * zurücksetzt, kein Schreibaufruf.
 */
type Environment = "development" | "staging" | "production";

type Health = {
  source: string;
  database: {
    backends: number;
    commits: number;
    rollbacks: number;
    blocksRead: number;
    blocksHit: number;
    deadlocks: number;
    conflicts: number;
    tempFiles: number;
    tempBytes: number;
    checksumFailures: number | null;
    checksumLastFailure: string | null;
    sessions: number;
    sessionsAbandoned: number;
    sessionsFatal: number;
    sessionsKilled: number;
    statsReset: string | null;
  };
  writeback: {
    checkpointSource: string;
    checkpointsTimed: number;
    checkpointsRequested: number;
    checkpointWriteMs: number;
    checkpointSyncMs: number;
    buffersCheckpoint: number;
    buffersClean: number;
    maxwrittenClean: number;
    buffersAlloc: number;
    checkpointerStatsReset: string | null;
    bgwriterStatsReset: string | null;
  };
};

/** `disabled` heisst: Die Data Plane ist abgeschaltet. Das ist kein Fehler, sondern eine Entscheidung. */
type ViewState = "loading" | "ready" | "disabled" | "unavailable" | "error";

/** Bytes lesbar, ohne eine Genauigkeit vorzutäuschen, die der Zähler nicht hat. */
function bytes(value: number): string {
  if (value < 1024) return `${formatNumber(Math.round(value))} B`;
  if (value < 1024 * 1024) return `${formatNumber(Math.round(value / 1024))} KiB`;
  if (value < 1024 * 1024 * 1024) return `${formatNumber(Math.round(value / (1024 * 1024)))} MiB`;
  return `${formatNumber(Math.round(value / (1024 * 1024 * 1024)))} GiB`;
}

/** Millisekunden lesbar. Aufgerundet wird nie, damit keine Zeit entsteht, die nicht gemessen wurde. */
function duration(milliseconds: number): string {
  if (milliseconds < 1000) return `${formatNumber(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${formatNumber(Math.floor(milliseconds / 1000))} s`;
  return `${formatNumber(Math.floor(milliseconds / 60_000))} min`;
}

export function DatabaseHealthView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const [state, setState] = useState<ViewState>("loading");
  const [health, setHealth] = useState<Health | null>(null);
  const [message, setMessage] = useState("");
  // Jede Ladung bekommt einen eigenen AbortController; eine abgebrochene
  // Ladung setzt keinen Zustand mehr.
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState((previous) => (previous === "ready" ? "ready" : "loading"));
    setMessage("");
    const url = `/api/v1/projects/${projectId}/environments/${environment}/database/health`;
    let status = 0;
    let payload: Record<string, unknown> = {};
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      const body: unknown = (await response.json().catch(() => ({}))) ?? {};
      status = response.status;
      payload = body !== null && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    } catch (cause) {
      if (controller.signal.aborted) return;
      payload = { error: cause instanceof Error ? cause.message : "" };
    }
    if (controller.signal.aborted) return;

    const data = payload.data as Health | undefined;
    if (status === 200 && data && typeof data.database === "object" && typeof data.writeback === "object") {
      setHealth(data);
      setState("ready");
      return;
    }
    setHealth(null);
    setMessage(typeof payload.error === "string" ? payload.error : "");
    const code = typeof payload.code === "string" ? payload.code : "";
    // Abgeschaltet, nicht bereit und nicht erreichbar sind drei verschiedene
    // Auskünfte. Ein 500 wäre eine vierte und heisst hier schlicht Fehler.
    if (code === "DATA_PLANE_DISABLED") setState("disabled");
    else if (status === 503 || status === 409) setState("unavailable");
    else setState("error");
  }, [projectId, environment]);

  useEffect(() => {
    void load();
    return () => { request.current?.abort(); };
  }, [load]);

  const loading = state === "loading";
  const refresh = <button className="secondary-button" onClick={() => void load()} disabled={loading}>
    <RefreshCw size={14}/> <StableLabel current={loading ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/>
  </button>;

  const database = health?.database ?? null;
  const writeback = health?.writeback ?? null;
  const hitRatio = database ? cacheHitRatio(database.blocksHit, database.blocksRead) : null;
  const rollbacks = database ? rollbackRatio(database.commits, database.rollbacks) : null;
  const checksum = database ? CHECKSUM_STATE_TEXTS[checksumState(database.checksumFailures)] : null;
  const broken = database ? brokenSessions(database.sessionsAbandoned, database.sessionsFatal, database.sessionsKilled) : 0;
  const averageTemp = database ? averageTempFileBytes(database.tempFiles, database.tempBytes) : null;
  const requested = writeback ? requestedCheckpointRatio(writeback.checkpointsTimed, writeback.checkpointsRequested) : null;
  const source = writeback ? CHECKPOINT_SOURCE_TEXTS[checkpointSource(writeback.checkpointSource)] : null;

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("LOGS")} · {environment.toUpperCase()}</span><h3>{t("Postgres-Zustand, kein Serverlog")}</h3></div><div>{refresh}</div></div>
      <p><strong>{t(NO_SERVER_LOG_NOTE)}</strong></p>
      <p className="muted">{t(COUNTER_NOTE)}</p>
      <p className="muted">{t(SCOPE_NOTE)}</p>

      {loading && !health && <p className="muted">{t("Die Datenbank wird gefragt…")}</p>}
      {state === "disabled" && <p><strong>{t("Data Plane abgeschaltet")}</strong> · {t("Diese Installation liest keine Projektdatenbank. Ohne sie gibt es keine Statistiksicht und darum auch keine Zahl.")}</p>}
      {state === "unavailable" && <p><strong>{t("Datenbank nicht bereit")}</strong> · {message || t("Die Projektdatenbank ist noch nicht bereit.")}</p>}
      {state === "error" && <p><strong>{t("Zustand nicht verfügbar")}</strong> · {message}</p>}
      {database && <p className="muted">{database.statsReset
        ? `${t("Zuletzt zurückgesetzt:")} ${formatMoment(database.statsReset)}`
        : t(NEVER_RESET_NOTE)}</p>}
    </article>

    {database && checksum && <article className="console-card auth-overview">
      <div><span>{t("ZURÜCKGEROLLT")}</span>
        <strong className={rollbacks !== null && rollbacks > 0.05 ? "risk medium" : undefined}>{rollbacks === null ? "–" : formatPercent(rollbacks)}</strong>
        <small>{rollbacks === null ? t("noch keine Transaktion") : `${formatNumber(database.rollbacks)} ${t("abgebrochene Transaktionen")}`}</small></div>
      <div><span>{t("DEADLOCKS")}</span>
        <strong className={database.deadlocks > 0 ? "risk medium" : undefined}>{formatNumber(database.deadlocks)}</strong>
        <small>{t("seit der letzten Rücksetzung")}</small></div>
      <div><span>{t("ABGERISSENE SITZUNGEN")}</span>
        <strong className={broken > 0 ? "risk medium" : undefined}>{formatNumber(broken)}</strong>
        <small>{t("verloren, fatal beendet oder abgeschossen")}</small></div>
      <div><span>{t("PRÜFSUMMEN")}</span>
        <strong className={checksum.tone}>{t(checksum.label)}</strong>
        <small>{t("Datenprüfsummen dieses Servers")}</small></div>
    </article>}

    {database && checksum && <article className="console-card span-2">
      <div className="card-head"><div><span>{t("PG_STAT_DATABASE")}</span><h3>{t("Was dieser Datenbank zugestossen ist")}</h3></div><AlertTriangle size={18}/></div>
      <div className="log-row log-header"><span>{t("Zahl")}</span><span>{t("Wert")}</span><span>{t("Was sie sagt")}</span></div>
      <div className="log-row"><span>{t("Abgebrochene Transaktionen")}</span><code className={database.rollbacks > 0 ? "risk medium" : undefined}>{formatNumber(database.rollbacks)}</code><small>{formatNumber(database.commits)} {t("Transaktionen wurden abgeschlossen")}</small></div>
      <div className="log-row"><span>{t("Deadlocks")}</span><code className={database.deadlocks > 0 ? "risk medium" : undefined}>{formatNumber(database.deadlocks)}</code><small>{t("gegenseitig blockierte Transaktionen, die die Datenbank aufgelöst hat")}</small></div>
      <div className="log-row"><span>{t("Konflikte")}</span><code className={database.conflicts > 0 ? "risk medium" : undefined}>{formatNumber(database.conflicts)}</code><small>{t("Abfragen, die eine Wiederherstellung abgebrochen hat; auf einem schreibfähigen Server bleibt die Zahl null")}</small></div>
      <div className="log-row"><span>{t("Eröffnete Sitzungen")}</span><code>{formatNumber(database.sessions)}</code><small>{t("seit der letzten Rücksetzung angenommen")}</small></div>
      <div className="log-row"><span>{t("Verlorene Sitzungen")}</span><code className={database.sessionsAbandoned > 0 ? "risk medium" : undefined}>{formatNumber(database.sessionsAbandoned)}</code><small>{t("die Gegenstelle war weg, ohne sich abzumelden")}</small></div>
      <div className="log-row"><span>{t("Fatal beendete Sitzungen")}</span><code className={database.sessionsFatal > 0 ? "risk medium" : undefined}>{formatNumber(database.sessionsFatal)}</code><small>{t("ein fataler Fehler hat die Sitzung beendet; woran, sagt der Zähler nicht")}</small></div>
      <div className="log-row"><span>{t("Abgeschossene Sitzungen")}</span><code>{formatNumber(database.sessionsKilled)}</code><small>{t("ein Operator oder ein Zeitlimit hat die Sitzung beendet")}</small></div>
      <div className="log-row"><span>{t("Offene Verbindungen")}</span><code>{formatNumber(database.backends)}</code><small>{t("ein Stand und kein Zähler; wer sie hält, steht unter Berichte → Verbindungen")}</small></div>
      <div className="bucket-row">
        <span className="bucket-icon"><ShieldCheck size={16}/></span>
        <div><strong className={checksum.tone}>{t(checksum.label)}</strong><p className="muted">{t(checksum.explains)}</p></div>
        {database.checksumFailures !== null && <code>{formatNumber(database.checksumFailures)}</code>}
      </div>
      {database.checksumLastFailure && <div className="log-row"><span>{t("Letzte gefallene Prüfsumme")}</span><span>{formatMoment(database.checksumLastFailure)}</span><small>{t("der einzige Zeitpunkt auf dieser Seite, den die Statistik selbst führt")}</small></div>}
    </article>}

    {database && <article className="console-card">
      <div className="card-head"><div><span>{t("PUFFER")}</span><h3>{t("Lesen und Treffen")}</h3></div><HardDrive size={18}/></div>
      <div className="bucket-row">
        <span className="bucket-icon"><HardDrive size={16}/></span>
        <div><strong>{hitRatio === null ? "–" : formatPercent(hitRatio)}</strong>
          <p className="muted">{hitRatio === null
            ? t("Solange kein Block gelesen wurde, gibt es keine Trefferquote. Null Prozent wäre hier eine Behauptung.")
            : t("Anteil der Blöcke, die schon im Speicher lagen")}</p></div>
      </div>
      <div className="log-row"><span>{t("Blöcke aus dem Cache")}</span><code>{formatNumber(database.blocksHit)}</code></div>
      <div className="log-row"><span>{t("Blöcke von der Platte")}</span><code>{formatNumber(database.blocksRead)}</code></div>
      <p className="muted">{t("Von der Platte heisst: nicht im Puffer von PostgreSQL. Das Betriebssystem kann den Block trotzdem im Speicher gehabt haben; diese Zahl unterscheidet das nicht.")}</p>
    </article>}

    {database && <article className="console-card">
      <div className="card-head"><div><span>{t("TEMPORÄRE DATEIEN")}</span><h3>{t("Was nicht in den Speicher passte")}</h3></div><FileWarning size={18}/></div>
      <div className="bucket-row">
        <span className="bucket-icon"><FileWarning size={16}/></span>
        <div><strong className={database.tempFiles > 0 ? "risk medium" : undefined}>{formatNumber(database.tempFiles)}</strong>
          <p className="muted">{t("Sortierungen und Verknüpfungen, die auf die Platte ausweichen mussten")}</p></div>
      </div>
      <div className="log-row"><span>{t("Menge auf der Platte")}</span><code>{bytes(database.tempBytes)}</code></div>
      <div className="log-row"><span>{t("Im Mittel je Datei")}</span><code>{averageTemp === null ? "–" : bytes(averageTemp)}</code></div>
      <p className="muted">{t("Welche Abfrage die Dateien geschrieben hat, sagt dieser Zähler nicht. Er zählt für die ganze Datenbank.")}</p>
    </article>}

    {writeback && source && <article className="console-card span-2">
      <div className="card-head"><div><span>{t("SCHREIBWEG")}</span><h3>{t("Checkpoints und Hintergrundschreiber")}</h3></div><Timer size={18}/></div>
      <p className="muted">{t(WRITEBACK_SCOPE_NOTE)}</p>
      <div className="bucket-row">
        <span className="bucket-icon"><Database size={16}/></span>
        <div><strong><code>{t(source.label)}</code></strong><p className="muted">{t(source.explains)}</p></div>
      </div>
      <div className="log-row log-header"><span>{t("Zahl")}</span><span>{t("Wert")}</span><span>{t("Was sie sagt")}</span></div>
      <div className="log-row"><span>{t("Checkpoints nach Zeitplan")}</span><code>{formatNumber(writeback.checkpointsTimed)}</code><small>{t("checkpoint_timeout hat sie ausgelöst")}</small></div>
      <div className="log-row"><span>{t("Angeforderte Checkpoints")}</span><code className={requested !== null && requested > 0.5 ? "risk medium" : undefined}>{formatNumber(writeback.checkpointsRequested)}</code><small>{requested === null
        ? t("noch kein Checkpoint")
        : `${formatPercent(requested)} ${t("aller Checkpoints; ein hoher Anteil heisst, dass die Menge an WAL sie erzwingt")}`}</small></div>
      <div className="log-row"><span>{t("Schreibphase")}</span><code>{duration(writeback.checkpointWriteMs)}</code><small>{t("Summe über alle Checkpoints")}</small></div>
      <div className="log-row"><span>{t("Synchronisationsphase")}</span><code>{duration(writeback.checkpointSyncMs)}</code><small>{t("Summe über alle Checkpoints")}</small></div>
      <div className="log-row"><span>{t("Puffer durch Checkpoints")}</span><code>{formatNumber(writeback.buffersCheckpoint)}</code><small>{t("geschrieben, während ein Checkpoint lief")}</small></div>
      <div className="log-row"><span>{t("Puffer durch den Hintergrundschreiber")}</span><code>{formatNumber(writeback.buffersClean)}</code><small>{t("geschrieben, bevor ein Checkpoint sie einholte")}</small></div>
      <div className="log-row"><span>{t("Hintergrundschreiber an seiner Grenze")}</span><code>{formatNumber(writeback.maxwrittenClean)}</code><small>{t("wie oft er aufhörte, weil er seine eigene Obergrenze erreicht hatte")}</small></div>
      <div className="log-row"><span>{t("Angeforderte Puffer")}</span><code>{formatNumber(writeback.buffersAlloc)}</code><small>{t("jede Leseanforderung zählt hier mit")}</small></div>
      <p className="muted">{writeback.bgwriterStatsReset
        ? `${t("pg_stat_bgwriter zuletzt zurückgesetzt:")} ${formatMoment(writeback.bgwriterStatsReset)}`
        : t("pg_stat_bgwriter wurde nie zurückgesetzt.")}</p>
      {writeback.checkpointerStatsReset && <p className="muted">{t("pg_stat_checkpointer zuletzt zurückgesetzt:")} {formatMoment(writeback.checkpointerStatsReset)}</p>}
    </article>}

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NICHT VORHANDEN")}</span><h3>{t("Was diese Seite nicht zeigt, und warum nicht")}</h3></div></div>
      {MISSING_POSTGRES_LOG.map((entry) => <div className="bucket-row" key={entry.title}>
        <span className="bucket-icon"><Database size={16}/></span>
        <div><strong>{t(entry.title)}</strong><p className="muted">{t(entry.body)}</p></div>
      </div>)}
    </article>
  </div>;
}
