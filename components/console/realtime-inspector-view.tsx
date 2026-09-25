"use client";

import { useEffect, useRef, useState } from "react";
import { Radio, Send, Unplug } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";

/**
 * Realtime-Inspector (2.7). Der Transport ist seit 1.6x zertifiziert; die
 * Console hatte keine Sicht darauf. Der Inspector ist ein reiner
 * Browser-Client: Er verbindet sich mit dem Realtime-Server über das
 * Protokoll `qkern.realtime.v1`, meldet sich mit einem Projekt-Key an,
 * abonniert einen Kanal und zeigt, was ankommt — Broadcasts, Presence,
 * Change-Feed, Fehler. Der Key bleibt in dieser Browser-Sitzung und
 * verlässt sie nur zum Realtime-Server; die Console speichert ihn nicht.
 */
type Environment = "development" | "staging" | "production";
type LogLine = { at: string; kind: string; text: string };

export const REALTIME_PROTOCOL = "qkern.realtime.v1";
const DEFAULT_URL = process.env.NEXT_PUBLIC_QKERN_REALTIME_URL ?? "ws://localhost:8788";

export function RealtimeInspectorView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [projectKey, setProjectKey] = useState("");
  const [channel, setChannel] = useState("demo");
  const [event, setEvent] = useState("ping");
  const [payload, setPayload] = useState('{"hello":"qkern"}');
  const [status, setStatus] = useState<"idle" | "connecting" | "ready" | "subscribed" | "closed">("idle");
  const [log, setLog] = useState<LogLine[]>([]);
  const socket = useRef<WebSocket | null>(null);
  const counter = useRef(0);

  const push = (kind: string, text: string) => setLog((current) => [{ at: new Date().toISOString(), kind, text }, ...current].slice(0, 200));
  const requestId = () => `req_${++counter.current}`;
  const send = (command: Record<string, unknown>) => { socket.current?.send(JSON.stringify(command)); push("→", JSON.stringify(command)); };

  useEffect(() => () => socket.current?.close(), []);

  function connect() {
    if (!/^qk_(public|service)_[A-Za-z0-9_-]{43}$/.test(projectKey)) { push("!", t("Der Projekt-Key hat nicht die Form qk_public_… oder qk_service_…")); return; }
    socket.current?.close();
    const target = `${url.replace(/\/+$/, "")}/realtime/v1/projects/${projectId}/environments/${environment}`;
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
  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("REALTIME")} · {environment.toUpperCase()}</span><h3>{t("Inspector")}</h3></div><span className={status === "subscribed" ? "secure" : "muted"}>{status === "idle" ? t("getrennt") : status === "connecting" ? t("verbindet…") : status === "ready" ? t("angemeldet") : status === "subscribed" ? t("abonniert") : t("geschlossen")}</span></div>
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
      {log.map((line, index) => <div className="log-row" key={`${line.at}-${index}`}><time>{new Intl.DateTimeFormat("de-CH", { timeStyle: "medium" }).format(new Date(line.at))}</time><span>{line.kind}</span><code style={{ gridColumn: "span 3", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{line.text}</code></div>)}
    </article>
  </div>;
}
