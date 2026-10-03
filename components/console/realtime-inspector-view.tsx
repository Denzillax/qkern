"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Radio, RefreshCw, Send, Table2, Unplug } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment, formatNumber } from "@/components/console/console-display";
import { CopyValue } from "@/components/console/copy-value";
import { StableLabel } from "@/components/stable-label";
import {
  REALTIME_CAPTURE_STATE_TEXTS,
  REALTIME_TABLES_EMPTY,
  REALTIME_TABLES_GLOBAL_NOTE,
  REALTIME_TABLES_HONESTY,
  REALTIME_TABLES_KEY_NOTE,
  REALTIME_TABLES_ROLE_NOTE,
  REALTIME_TABLES_SDK_NOTE,
  REALTIME_TABLES_SOURCE_NOTE,
  REALTIME_TABLES_VIEW_NOTE,
  REALTIME_TERM_TEXTS,
  REALTIME_TERMS,
  realtimeCaptureState,
  realtimeCaptureStatement,
  realtimeCaptureTitle,
  REALTIME_CAPTURE_INVITE,
  REALTIME_CAPTURE_PREPARED,
  REALTIME_CAPTURE_REFUSED,
  realtimeChangesChannel,
  realtimeChangesExample,
  realtimeSocketTarget,
  type RealtimeCaptureStateId,
  type RealtimeCaptureTrigger,
} from "@/lib/console/realtime-texts";

/**
 * Realtime-Inspector (2.7, erweitert in 2.144).
 *
 * Der untere Teil ist der alte: ein reiner Browser-Client, der sich mit dem
 * Realtime-Server über das Protokoll `qkern.realtime.v1` verbindet, sich mit
 * einem Projekt-Key anmeldet, einen Kanal abonniert und zeigt, was ankommt. Der
 * Key bleibt in dieser Browser-Sitzung und verlässt sie nur zum
 * Realtime-Server; die Console speichert ihn nicht.
 *
 * ## Was 2.144 dazugelegt hat, und was ausdrücklich nicht
 *
 * Ein Einsteiger stand vor dieser Seite mit einem leeren Kanalfeld und wusste
 * nicht, welchen Namen er dort eintragen soll. Darum steht jetzt die Liste der
 * Tabellen darüber: je Tabelle ihr echter Zustand, ihr Kanalname und der Code,
 * mit dem eine Anwendung sie abonniert.
 *
 * **Kein Schalter.** Ob Änderungen einer Tabelle ankommen, hängt an einem
 * Trigger auf `qkern_internal.capture_change` in der Projektdatenbank. Es gibt
 * keine Route, die diesen Trigger setzt oder entfernt: `/schema/triggers`
 * kennt nur `GET`, und eine Schemaänderung läuft über ein Change Set. Ein
 * Schalter wäre darum ein Knopf, der nichts tut, und das ist schlimmer als
 * kein Knopf. Die Liste sagt stattdessen in einem Satz, woran der Zustand
 * hängt und wo man ihn ändert.
 *
 * **Keine Replikation.** Publikationen und Slots stehen unter Datenbank, in
 * der vollständigen Ansicht. Für Realtime sind sie bedeutungslos, und der
 * Begriffskasten unten sagt genau das, statt den Namen zu verschweigen.
 */
type Environment = "development" | "staging" | "production";
type LogLine = { at: string; kind: string; text: string };

/** Eine Tabelle des Schemas mit dem Zustand, den die Lesung ergeben hat. */
type CapturedTable = { name: string; state: RealtimeCaptureStateId };

type SchemaTable = { name: string; kind: "table" | "partitioned_table" | "view" | "materialized_view" };

export const REALTIME_PROTOCOL = "qkern.realtime.v1";
const DEFAULT_URL = process.env.NEXT_PUBLIC_QKERN_REALTIME_URL ?? "ws://localhost:8788";
/** Dieselbe Wahl wie auf allen Schema-Seiten der Console: das Schema `public`. */
const SCHEMA = "public";

export function RealtimeInspectorView({ projectId, environment, initialState }: {
  projectId: string;
  environment: Environment;
  initialState?: "loading" | "ready" | "unavailable" | "error";
}) {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [projectKey, setProjectKey] = useState("");
  const [channel, setChannel] = useState("demo");
  const [event, setEvent] = useState("ping");
  const [payload, setPayload] = useState('{"hello":"qkern"}');
  const [status, setStatus] = useState<"idle" | "connecting" | "ready" | "subscribed" | "closed">("idle");
  const [log, setLog] = useState<LogLine[]>([]);
  const socket = useRef<WebSocket | null>(null);
  const counter = useRef(0);

  // Einschalten heisst: eine Schemaaenderung vorbereiten (2.154). Es gibt keine
  // Route, die einen Trigger setzt, und das soll auch so bleiben; Aenderungen am
  // Schema laufen bei QKERN durch den Weg mit Risiko, Freigabe und Protokoll.
  // Diese Ansicht legt darum einen Change Set an und sagt daneben, dass bis zur
  // Freigabe nichts passiert.
  const [preparing, setPreparing] = useState("");
  const [prepared, setPrepared] = useState<"done" | "refused" | null>(null);
  async function prepareCapture(table: string) {
    setPreparing(table);
    setPrepared(null);
    try {
      const answer = await fetch("/api/v1/changesets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, environment,
          title: realtimeCaptureTitle(table),
          statement: realtimeCaptureStatement(table),
        }),
      });
      setPrepared(answer.ok ? "done" : "refused");
    } catch {
      setPrepared("refused");
    } finally {
      setPreparing("");
    }
  }

  const [tableState, setTableState] = useState<"loading" | "ready" | "unavailable" | "error">(initialState ?? "loading");
  const [tables, setTables] = useState<CapturedTable[]>([]);
  const [tableMessage, setTableMessage] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);

  const push = (kind: string, text: string) => setLog((current) => [{ at: new Date().toISOString(), kind, text }, ...current].slice(0, 200));
  const requestId = () => `req_${++counter.current}`;
  const send = (command: Record<string, unknown>) => { socket.current?.send(JSON.stringify(command)); push("→", JSON.stringify(command)); };

  useEffect(() => () => socket.current?.close(), []);

  /**
   * Zwei Lesungen, beide nur lesend, beide gleichzeitig: `/schema` nennt die
   * Tabellen, `/schema/triggers` nennt die Trigger. Erst beide zusammen
   * ergeben den Zustand. Nur die Trigger zu lesen hiesse, Tabellen ohne
   * Erfassung zu verschweigen, und das sind gerade die, die ein Einsteiger
   * sucht.
   */
  const loadTables = useCallback(async () => {
    setTableState("loading");
    setTableMessage("");
    const base = `/api/v1/projects/${projectId}/environments/${environment}`;
    try {
      const [schema, triggers] = await Promise.all([
        fetch(`${base}/schema?schema=${SCHEMA}`, { cache: "no-store" }),
        fetch(`${base}/schema/triggers?schema=${SCHEMA}`, { cache: "no-store" }),
      ]);
      const schemaBody = (await schema.json().catch(() => ({}))) as { data?: { tables?: SchemaTable[] }; error?: string };
      const triggerBody = (await triggers.json().catch(() => ({}))) as { data?: { triggers?: RealtimeCaptureTrigger[] }; error?: string };
      // 503 und 409 heissen: Die Projektdatenbank ist noch nicht bereit. Das ist
      // etwas anderes als ein Fehler und bekommt darum einen eigenen Zustand.
      if ([schema.status, triggers.status].some((code) => code === 503 || code === 409)) {
        setTableState("unavailable");
        setTableMessage(schemaBody.error ?? triggerBody.error ?? t("Die Projektdatenbank ist noch nicht bereit."));
        return;
      }
      if (!schema.ok || !triggers.ok) {
        throw new Error(schemaBody.error ?? triggerBody.error ?? t("Tabellen nicht verfügbar"));
      }
      const found = (schemaBody.data?.tables ?? [])
        // Sichten tragen keinen Trigger je Zeile. Sie hier zu zeigen hiesse,
        // einen Zustand zu behaupten, den es für sie nicht gibt.
        .filter((table) => table.kind === "table" || table.kind === "partitioned_table")
        .map((table) => ({ name: table.name, state: realtimeCaptureState(triggerBody.data?.triggers ?? [], table.name) }));
      setTables(found);
      setTableState("ready");
    } catch (cause) {
      setTableState("error");
      setTableMessage(cause instanceof Error ? cause.message : t("Tabellen nicht verfügbar"));
    }
  }, [projectId, environment]);

  useEffect(() => { void loadTables(); }, [loadTables]);

  function connect() {
    if (!/^qk_(public|service)_[A-Za-z0-9_-]{43}$/.test(projectKey)) { push("!", t("Der Projekt-Key hat nicht die Form qk_public_… oder qk_service_…")); return; }
    socket.current?.close();
    const target = realtimeSocketTarget(url, projectId, environment);
    setStatus("connecting"); push("·", `${t("Verbinde mit")} ${target}`);
    let ws: WebSocket;
    try { ws = new WebSocket(target, REALTIME_PROTOCOL); } catch (cause) { push("!", cause instanceof Error ? cause.message : t("Verbindung fehlgeschlagen")); setStatus("closed"); return; }
    socket.current = ws;
    ws.onopen = () => { const id = requestId(); ws.send(JSON.stringify({ type: "auth", requestId: id, projectKey })); push("→", `{"type":"auth","requestId":"${id}","projectKey":"qk_…"}`); };
    ws.onmessage = (message) => {
      let parsed: { type?: string; requestId?: string; channel?: string; code?: string } = {};
      try { parsed = JSON.parse(String(message.data)); } catch { push("←", String(message.data)); return; }
      push("←", String(message.data).slice(0, 600));
      if (parsed.type === "ready") { setStatus("ready"); const id = requestId(); send({ type: "subscribe", requestId: id, channel }); }
      if (parsed.type === "subscribed") setStatus("subscribed");
      if (parsed.type === "error" && (parsed.code === "REALTIME_AUTH_FAILED" || parsed.code === "REALTIME_AUTH_REQUIRED")) setStatus("closed");
    };
    ws.onerror = () => push("!", t("Verbindung fehlgeschlagen. Läuft der Realtime-Server, und erlaubt seine Origin-Liste diese Console?"));
    ws.onclose = (closed) => { setStatus("closed"); push("·", `${t("Verbindung geschlossen")} (${closed.code})`); };
  }

  function disconnect() { socket.current?.close(); socket.current = null; setStatus("idle"); }

  function broadcast() {
    if (status !== "subscribed") return;
    let body: unknown;
    try { body = JSON.parse(payload); } catch { push("!", t("Der Payload ist kein gültiges JSON.")); return; }
    send({ type: "broadcast", requestId: requestId(), channel, event, payload: body });
  }

  const connected = status === "ready" || status === "subscribed" || status === "connecting";
  const arriving = tables.filter((table) => table.state === "arrives").length;
  // Gezeigt wird die Tabelle, die jemand angetippt hat; ohne Wahl die erste,
  // bei der wirklich etwas ankommt, und sonst die erste überhaupt.
  const example = tables.find((table) => table.name === chosen)
    ?? tables.find((table) => table.state === "arrives")
    ?? tables[0];
  const copyLabels = { copy: t("Kopieren"), copied: t("Kopiert"), failed: t("Zwischenablage nicht erreichbar") };
  // Einmal gebaut, zweimal gezeigt: im Kasten zum Lesen und im Knopf zum
  // Kopieren. Zwei Aufrufe wären zwei Gelegenheiten, auseinanderzulaufen.
  const exampleCode = example === undefined ? "" : realtimeChangesExample({
    url, projectId, environment, schema: SCHEMA, table: example.name, protocol: REALTIME_PROTOCOL,
  });

  return <div className="module-grid">
    <article className="console-card span-2 realtime-tables">
      <div className="card-head"><div><span>{t("REALTIME")} · {environment.toUpperCase()}</span><h3>{t("Welche Tabellen Änderungen melden")}</h3></div><div>
        <button className="secondary-button" onClick={() => void loadTables()} disabled={tableState === "loading"}><RefreshCw size={14}/> <StableLabel current={tableState === "loading" ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
      </div></div>

      <p className="muted">{t(REALTIME_TABLES_HONESTY)}</p>
      <p className="muted">{t(REALTIME_TABLES_SOURCE_NOTE)}</p>

      {tableState === "loading" && <p className="muted">{t("Tabellen werden gelesen…")}</p>}
      {(tableState === "unavailable" || tableState === "error") && <div className="live-module-state compact">
        <Table2 size={22}/>
        <h3>{tableState === "unavailable" ? t("Datenbank nicht bereit") : t("Tabellen nicht verfügbar")}</h3>
        <p>{tableMessage}</p>
        <button className="secondary-button" onClick={() => void loadTables()}><RefreshCw size={14}/> {t("Noch einmal")}</button>
      </div>}

      {tableState === "ready" && tables.length === 0 && <p className="muted">{t(REALTIME_TABLES_EMPTY)}</p>}

      {tableState === "ready" && tables.length > 0 && <>
        <div className="log-row log-header"><span>{t("Tabelle")}</span><span>{t("Zustand")}</span><span>{t("Kanal")}</span><span>{t("Beispielcode")}</span></div>
        {tables.map((table) => {
          const state = REALTIME_CAPTURE_STATE_TEXTS[table.state];
          const name = realtimeChangesChannel(SCHEMA, table.name);
          return <div className="log-row" key={table.name}>
            <button className="plain-button" onClick={() => setChosen(table.name)}><code>{SCHEMA}.{table.name}</code></button>
            <span className={state.tone}>{t(state.label)}</span>
            <CopyValue value={name} labels={copyLabels} className="plain-button"><code>{name}</code></CopyValue>
            <CopyValue value={realtimeChangesExample({ url, projectId, environment, schema: SCHEMA, table: table.name, protocol: REALTIME_PROTOCOL })} labels={copyLabels} className="plain-button"/>
            <small style={{ gridColumn: "span 4" }}>{t(state.explains)}
              {table.state === "off" && <> <button className="plain-button" disabled={preparing === table.name}
                onClick={() => void prepareCapture(table.name)}>
                <StableLabel current={preparing === table.name ? t("Wird vorbereitet…") : t("Einschalten vorbereiten")}
                  variants={tAll("Wird vorbereitet…", "Einschalten vorbereiten")}/>
              </button></>}
            </small>
          </div>;
        })}
        <p className="muted">{t("Tabellen im Schema public, die ihre Änderungen melden")}: {formatNumber(arriving)} / {formatNumber(tables.length)}</p>
        <p className="muted">{t(REALTIME_CAPTURE_INVITE)}</p>
        {prepared === "done" && <p className="secure">{t(REALTIME_CAPTURE_PREPARED)}</p>}
        {prepared === "refused" && <p className="risk medium">{t(REALTIME_CAPTURE_REFUSED)}</p>}
      </>}

      <p className="muted">{t(REALTIME_TABLES_GLOBAL_NOTE)}</p>
      <p className="muted">{t(REALTIME_TABLES_KEY_NOTE)}</p>
      <p className="muted">{t(REALTIME_TABLES_VIEW_NOTE)}</p>
    </article>

    <article className="console-card span-2 realtime-example">
      <div className="card-head"><div><span>{t("BEISPIEL")}</span><h3>{example ? t("So abonniert eine Anwendung diese Tabelle") : t("So abonniert eine Anwendung eine Tabelle")}</h3></div>
        {example && <CopyValue value={exampleCode} labels={copyLabels}/>}
      </div>
      {example
        ? <pre>{exampleCode}</pre>
        : <p className="muted">{t("Sobald eine Tabelle gelesen ist, steht hier der Code, mit dem eine Anwendung genau ihre Änderungen abonniert.")}</p>}
      <p className="muted">{t(REALTIME_TABLES_SDK_NOTE)}</p>
      <p className="muted">{t(REALTIME_TABLES_ROLE_NOTE)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("BEGRIFFE")}</span><h3>{t("Vier Wörter, die hier dauernd vorkommen")}</h3></div><BookOpen size={18}/></div>
      {REALTIME_TERMS.map((term) => <div className="log-row" key={term}>
        <code>{t(REALTIME_TERM_TEXTS[term].term)}</code>
        <small style={{ gridColumn: "span 3" }}>{t(REALTIME_TERM_TEXTS[term].explains)}</small>
      </div>)}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("VERBINDUNG")}</span><h3>{t("Inspector")}</h3></div><span className={status === "subscribed" ? "secure" : "muted"}>{status === "idle" ? t("getrennt") : status === "connecting" ? t("verbindet…") : status === "ready" ? t("angemeldet") : status === "subscribed" ? t("abonniert") : t("geschlossen")}</span></div>
      <div className="automation-fields">
        <label>{t("Realtime-Server")}<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="ws://localhost:8788" disabled={connected}/></label>
        <label>{t("Projekt-Key")}<input type="password" value={projectKey} onChange={(e) => setProjectKey(e.target.value)} placeholder="qk_public_…" autoComplete="off" disabled={connected}/></label>
        <label>{t("Kanal")}<input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="demo" disabled={connected}/></label>
      </div>
      <p className="muted">{t("Der Key bleibt in dieser Browser-Sitzung und geht nur an den Realtime-Server. Einen Public Key legst du unter API an; er erscheint dort einmal.")}</p>
      <div className="automation-footer">
        <span>{t("Protokoll")} {REALTIME_PROTOCOL}</span>
        {connected ? <button className="secondary-button" onClick={disconnect}><Unplug size={14}/> {t("Trennen")}</button> : <button className="button small" onClick={connect}><Radio size={14}/> <StableLabel current={t("Verbinden und abonnieren")} variants={tAll("Verbinden und abonnieren")}/></button>}
      </div>
    </article>
    <article className="console-card">
      <div className="card-head"><div><span>{t("SENDEN")}</span><h3>{t("Broadcast auf den Kanal")}</h3></div></div>
      <div className="automation-fields">
        <label>{t("Ereignis")}<input value={event} onChange={(e) => setEvent(e.target.value)} placeholder="ping"/></label>
        <label>{t("Payload (JSON)")}<textarea value={payload} onChange={(e) => setPayload(e.target.value)} rows={4} spellCheck={false}/></label>
      </div>
      <button className="button small" onClick={broadcast} disabled={status !== "subscribed"}><Send size={14}/> {t("Senden")}</button>
    </article>
    <article className="console-card span-2 activity-log">
      <div className="card-head"><div><span>{t("PROTOKOLL")}</span><h3>{t("Nachrichten, neueste zuerst")}</h3></div><button className="plain-button" onClick={() => setLog([])}>{t("Leeren")}</button></div>
      {log.length === 0 && <p className="muted">{t("Noch nichts empfangen. Nach dem Abonnieren erscheinen Broadcasts, Presence und der Change-Feed des Kanals hier.")}</p>}
      {log.map((line, index) => <div className="log-row" key={`${line.at}-${index}`}><time>{formatMoment(line.at, "time")}</time><span>{line.kind}</span><code style={{ gridColumn: "span 3", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{line.text}</code></div>)}
    </article>
  </div>;
}
