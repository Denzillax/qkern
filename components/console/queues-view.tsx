"use client";

import { useCallback, useEffect, useState } from "react";
import { Inbox, Plus, RefreshCw, RotateCcw, Route } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { FormPanel } from "@/components/console/form-panel";
import { formatMoment, formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import { tAll } from "@/components/console/console-i18n";
import { InlineEmptyState } from "@/components/console/console-parts";

/**
 * Queues in der Console (2.6). Das Backend ist seit 1.88 zertifiziert
 * (Claims, Leases, Retry, Dead Letters, Metrics-Export); hier fehlte nur die
 * Ansicht. Alles kommt live von den Admin-Routen unter
 * `/queues`: Liste, Status je Queue, Dead Letters mit Wiedereinreihen.
 * Payloads erscheinen nie — der Zusteller sieht sie, die Console nicht.
 */
type Environment = "development" | "staging" | "production";

type QueueItem = {
  id: string; name: string; enqueuePolicy: "authenticated" | "service";
  maxAttempts: number; visibilityTimeoutSeconds: number; retryBaseSeconds: number; retryMaxSeconds: number;
  dedupeWindowSeconds: number; retentionSeconds: number; maxPendingMessages: number; createdAt: string; updatedAt: string;
};
type QueueStatus = {
  queue: string; available: number; scheduled: number; inFlight: number; completed: number; deadLettered: number;
  oldestAvailableAt: string | null;
};
type DeadLetter = { id: string; queue: string; attempt: number; failureCode: string; createdAt: string; deadLetteredAt: string; replayed: boolean };

/**
 * Die Spur einer Nachricht (2.121), so wie die Trace-Route sie herausgibt.
 * Keine Nutzlast: Die Route hat keine, und diese Ansicht erwartet auch keine.
 */
type TraceStation = {
  sequence: number; station: string; attempt: number;
  workerId: string | null; failureCode: string | null; occurredAt: string;
};
type Trace = {
  messageId: string; queue: string; traceId: string | null; parentSpanId: string | null;
  sourceMessageId: string | null; replayedIntoMessageId: string | null;
  messageExists: boolean; complete: boolean; stations: TraceStation[];
};

/**
 * Ein Treffer der Spursuche (2.131). Eine Zeile je Nachricht und nicht je
 * Station: Die Stationen holt dieselbe Ansicht mit einem Klick nach.
 */
type TraceHit = {
  messageId: string; queue: string; station: string;
  spanId: string; parentSpanId: string | null; sourceMessageId: string | null; occurredAt: string;
};
type TraceSearch = { traceId: string; messages: TraceHit[]; nextCursor: string | null };

type LoadState = "loading" | "ready" | "unavailable" | "error";

export function QueuesView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: LoadState }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/queues`;
  const [queues, setQueues] = useState<QueueItem[]>([]);
  const [status, setStatus] = useState<Record<string, QueueStatus>>({});
  const [state, setState] = useState<LoadState>(initialState ?? "loading");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [deadLetters, setDeadLetters] = useState<DeadLetter[]>([]);
  const [busy, setBusy] = useState("");
  const [trace, setTrace] = useState<Trace | null>(null);
  const [search, setSearch] = useState<TraceSearch | null>(null);
  // Welches Formular offen ist (2.166): eine neue Queue, die Spur einer
  // Nachricht in einer bestimmten Queue, oder die Suche nach einer Spur-Id.
  const [form, setForm] = useState<{ kind: "create" } | { kind: "lookup"; queue: string } | { kind: "search" } | null>(null);

  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch(base, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503) { setQueues([]); setState("unavailable"); setMessage(t("Project Queues sind für diese Umgebung nicht verbunden.")); return; }
      if (!response.ok) throw new Error(serverErrorText(payload.error) ?? t("Queues nicht verfügbar"));
      const list = payload.data as QueueItem[];
      setQueues(list);
      const entries = await Promise.all(list.map(async (queue) => {
        const statusResponse = await fetch(`${base}/${queue.name}/status`, { cache: "no-store" });
        const statusPayload = await statusResponse.json().catch(() => ({}));
        return [queue.name, statusResponse.ok ? (statusPayload.data as QueueStatus) : null] as const;
      }));
      setStatus(Object.fromEntries(entries.filter((entry): entry is readonly [string, QueueStatus] => entry[1] !== null)));
      setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("Queues nicht verfügbar")); }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  async function create(values: Record<string, string>): Promise<string | null> {
    const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: values.name.trim() }) });
    if (!response.ok) { const payload = await response.json().catch(() => ({})); return serverErrorText(payload.error) ?? t("Queue konnte nicht angelegt werden"); }
    setForm(null);
    await load();
    return null;
  }

  /**
   * Holt die Spur einer Nachricht.
   *
   * Die Id kommt entweder aus einer Dead-Letter-Zeile, die sie schon kennt,
   * oder aus der Eingabe: Eine Queue hat keine Liste ihrer Nachrichten, und
   * eine Liste wuerde die Nutzlasten der Umgebung in eine zweite Flaeche
   * holen. Wer eine Spur sucht, hat die Id aus der Quittung.
   */
  async function showTrace(queueName: string, messageId: string | null) {
    // Ohne bekannte Id oeffnet sich das Formular (2.166), vorher ein Prompt.
    if (messageId === null) { setForm({ kind: "lookup", queue: queueName }); return; }
    if (trace?.messageId === messageId) { setTrace(null); return; }
    const error = await loadTrace(queueName, messageId);
    if (error) setMessage(error);
  }

  async function loadTrace(queueName: string, id: string): Promise<string | null> {
    setBusy(id);
    const response = await fetch(`${base}/${queueName}/messages/${encodeURIComponent(id)}/trace`, { cache: "no-store" });
    setBusy("");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setTrace(null); return serverErrorText(payload.error) ?? t("Spur nicht verfügbar"); }
    setMessage("");
    setTrace(payload.data as Trace);
    return null;
  }

  /**
   * Sucht die Nachrichten einer fremden Spur-Id (2.131).
   *
   * Die Route liegt ausdruecklich nicht unter `queues/`: Eine Spur laeuft durch
   * die Queues dieser Umgebung und gehoert keiner. Geblaettert wird mit dem
   * Cursor der Antwort, und angehaengt statt ersetzt — wer blaettert, will mehr
   * sehen und nicht etwas anderes.
   */
  async function searchTrace(cursor: string | null, typed?: string): Promise<string | null> {
    // Die erste Seite fragt die Id im Formular ab (2.166), vorher ein Prompt.
    if (cursor === null && typed === undefined) { setForm({ kind: "search" }); return null; }
    const traceId = cursor === null ? (typed ?? "").trim() : search!.traceId;
    if (!traceId) return null;
    const query = new URLSearchParams({ traceId, limit: "20" });
    if (cursor !== null) query.set("cursor", cursor);
    const response = await fetch(
      `/api/v1/projects/${projectId}/environments/${environment}/queue-traces?${query.toString()}`,
      { cache: "no-store" },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setSearch(null);
      const error = serverErrorText(payload.error) ?? t("Suche nach der Spur nicht verfügbar");
      if (cursor === null) return error;
      setMessage(error);
      return null;
    }
    setMessage("");
    const page = payload.data as TraceSearch;
    setSearch(cursor === null ? page : { ...page, messages: [...search!.messages, ...page.messages] });
    return null;
  }

  async function showDeadLetters(queue: QueueItem) {
    if (open === queue.name) { setOpen(null); setDeadLetters([]); return; }
    const response = await fetch(`${base}/${queue.name}/dead-letters?limit=50`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(serverErrorText(payload.error) ?? t("Dead Letters nicht verfügbar")); return; }
    setOpen(queue.name); setDeadLetters(payload.data as DeadLetter[]);
  }

  async function replay(letter: DeadLetter) {
    setBusy(letter.id);
    const response = await fetch(`${base}/${letter.queue}/dead-letters/${letter.id}/replay`, { method: "POST" });
    setBusy("");
    if (!response.ok) { const payload = await response.json().catch(() => ({})); setMessage(serverErrorText(payload.error) ?? t("Wiedereinreihen fehlgeschlagen")); return; }
    const refreshed = await fetch(`${base}/${letter.queue}/dead-letters?limit=50`, { cache: "no-store" });
    if (refreshed.ok) setDeadLetters(((await refreshed.json()).data) as DeadLetter[]);
    await load();
  }

  if (state === "loading" && queues.length === 0) return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Queues werden geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><Inbox size={26}/><h3>{state === "unavailable" ? t("Project Queues nicht verbunden") : t("Queues nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  /**
   * Die Stationen als Wortlaut. Die Zuordnung steht in der Ansicht und nicht
   * auf dem Server: Der Server gibt feste Codes heraus, und ein Wortlaut, der
   * von dort kaeme, waere ein deutscher Satz in einer API-Antwort.
   */
  function stationLabel(station: string) {
    const labels: Record<string, string> = {
      enqueued: t("eingestellt"),
      deduplicated: t("als Doppel erkannt"),
      replayed: t("wieder eingereiht"),
      claimed: t("beansprucht"),
      completed: t("abgeschlossen"),
      retry_scheduled: t("Wiederholung geplant"),
      dead_lettered: t("als Dead Letter abgelegt"),
      lease_expired: t("Pacht verfallen"),
    };
    return labels[station] ?? station;
  }

  const totals = Object.values(status).reduce((sum, entry) => ({
    available: sum.available + entry.available, inFlight: sum.inFlight + entry.inFlight, deadLettered: sum.deadLettered + entry.deadLettered,
  }), { available: 0, inFlight: 0, deadLettered: 0 });

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("QUEUES")}</span><strong>{queues.length}</strong><small>{t("In dieser Umgebung")}</small></div>
      <div><span>{t("WARTEND")}</span><strong>{totals.available}</strong><small>{t("Sofort abholbar")}</small></div>
      <div><span>{t("DEAD LETTERS")}</span><strong>{totals.deadLettered}</strong><small>{totals.inFlight} {t("in Bearbeitung")}</small></div>
    </article>
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("PROJECT QUEUES")} · {environment.toUpperCase()}</span><h3>{t("Queues des Projekts")}</h3></div><div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button><button className="secondary-button" onClick={() => void searchTrace(null)}><Route size={14}/> {t("Spur suchen")}</button><button className="button small" onClick={() => setForm({ kind: "create" })}><Plus size={14}/> {t("Neue Queue")}</button></div></div>
      {form?.kind === "create" && <FormPanel key="create" title={t("Neue Queue")} submitLabel={t("Anlegen")} onCancel={() => setForm(null)} onSubmit={create}
        fields={[{ name: "name", label: t("Name der Queue (Kleinbuchstaben, Ziffern, Bindestrich oder Unterstrich, 3 bis 63 Zeichen)"), placeholder: "email_jobs", required: true, mono: true }]}/>}
      {form?.kind === "lookup" && <FormPanel key={`lookup-${form.queue}`} title={`${t("Spur")} · ${form.queue}`} submitLabel={t("Spur")} onCancel={() => setForm(null)}
        onSubmit={async (values) => { const error = await loadTrace(form.queue, values.id.trim()); if (!error) setForm(null); return error; }}
        fields={[{ name: "id", label: t("Nachrichten-Id, deren Spur du sehen willst"), required: true, mono: true }]}/>}
      {form?.kind === "search" && <FormPanel key="search" title={t("Spur suchen")} submitLabel={t("Spur suchen")} onCancel={() => setForm(null)}
        onSubmit={async (values) => { const error = await searchTrace(null, values.traceId); if (!error) setForm(null); return error; }}
        fields={[{ name: "traceId", label: t("Spur-Id (32 Hex-Zeichen, klein), deren Nachrichten du sehen willst"), required: true, mono: true }]}/>}
      {message && <p className="muted">{message}</p>}
      {queues.length === 0 && <InlineEmptyState text={t("Noch keine Queue in dieser Umgebung. Eine Queue nimmt Nachrichten an, vergibt Leases an Worker und legt fehlgeschlagene Nachrichten nach dem letzten Versuch als Dead Letter ab.")} action={<button className="button small" onClick={() => setForm({ kind: "create" })}><Plus size={14}/> {t("Erste Queue anlegen")}</button>}/>}
      {queues.map((queue) => { const s = status[queue.name]; return <div key={queue.id}>
        <div className="bucket-row"><span className="bucket-icon"><Inbox size={16}/></span>
          <div><strong>{queue.name}</strong><small>{queue.enqueuePolicy === "service" ? t("nur Service Key") : t("angemeldete Nutzer")} · {queue.maxAttempts} {t("Versuche")} · {t("Lease")} {queue.visibilityTimeoutSeconds} s · {t("Retry")} {queue.retryBaseSeconds}–{queue.retryMaxSeconds} s{queue.dedupeWindowSeconds ? ` · ${t("Dedupe")} ${queue.dedupeWindowSeconds} s` : ""}</small></div>
          <span title={s?.oldestAvailableAt ? `${t("Älteste wartet seit")} ${formatMoment(s.oldestAvailableAt)}` : undefined}>{s ? `${s.available} ${t("wartend")} · ${s.inFlight} ${t("in Bearbeitung")} · ${s.completed} ${t("erledigt")}` : t("Status nicht verfügbar")}</span>
          <span className={s && s.deadLettered > 0 ? "risk high" : "muted"}>{s ? `${s.deadLettered} ${t("Dead Letters")}` : "–"}</span>
          <button className="plain-button" onClick={() => void showDeadLetters(queue)}><StableLabel current={open === queue.name ? t("Ausblenden") : t("Dead Letters")} variants={tAll("Ausblenden", "Dead Letters")}/></button>
          <button className="plain-button" onClick={() => void showTrace(queue.name, null)}><Route size={13}/> {t("Spur")}</button>
        </div>
        {open === queue.name && <div className="detail-list">
          {deadLetters.length === 0 ? <div><span>{t("Keine Dead Letters in dieser Queue. Eine Nachricht landet hier erst, wenn sie auch den letzten Versuch nicht überlebt hat; eine leere Liste heisst, dass bisher jede durchkam.")}</span><strong className="muted">–</strong></div> : deadLetters.map((letter) => <div key={letter.id}>
            <span><code>{letter.id.slice(0, 8)}</code><small>{t("Versuch")} {formatNumber(letter.attempt)} · {letter.failureCode} · {formatMoment(letter.deadLetteredAt)}</small></span>
            <button className="plain-button" disabled={busy === letter.id} onClick={() => void showTrace(letter.queue, letter.id)}><Route size={13}/> {t("Spur")}</button>
            {letter.replayed ? <strong className="muted">{t("wieder eingereiht")}</strong> : <button className="plain-button" disabled={busy === letter.id} onClick={() => void replay(letter)}><RotateCcw size={13}/> {t("Wieder einreihen")}</button>}
          </div>)}
        </div>}
      </div>; })}
    </article>
    {search && <article className="console-card span-2">
      <div className="card-head">
        <div><span>{t("SPUR")} · <code>{search.traceId}</code></span><h3>{t("Nachrichten dieser Spur")}</h3></div>
        <div><button className="secondary-button" onClick={() => setSearch(null)}>{t("Schliessen")}</button></div>
      </div>
      <div className="detail-list">
        {search.messages.length === 0 ? <div><span>{t("Keine Nachricht zu dieser Spur in dieser Umgebung")}{" "}{t("Eine Spur läuft nie über eine Umgebung hinaus, also kann dieselbe Id anderswo Treffer haben.")}</span><strong className="muted">–</strong></div>
          : search.messages.map((hit) => <div key={hit.messageId}>
            <span>
              <strong>{hit.queue}</strong>
              <small><code>{hit.messageId}</code> · {stationLabel(hit.station)} · {formatMoment(hit.occurredAt)}</small>
            </span>
            <button className="plain-button" onClick={() => void showTrace(hit.queue, hit.messageId)}><Route size={13}/> {t("Spur")}</button>
          </div>)}
      </div>
      {search.nextCursor && <button className="secondary-button" onClick={() => void searchTrace(search.nextCursor)}>{t("Weitere laden")}</button>}
      <p className="muted">{t("Eine Spur läuft durch die Queues einer Umgebung und nie darüber hinaus; dieselbe Spur-Id in einer anderen Umgebung oder Organisation erscheint hier nicht. Je Nachricht steht ihre erste Station, also ob sie neu eingestellt oder wieder eingereiht wurde. Der Ausgang steht in der Spur der Nachricht selbst.")}</p>
    </article>}
    {trace && <article className="console-card span-2">
      <div className="card-head">
        <div><span>{t("SPUR")} · {trace.queue}</span><h3>{t("Eine Nachricht von ihrem Einstellen bis zu ihrem Ausgang")}</h3></div>
        <div><button className="secondary-button" onClick={() => setTrace(null)}>{t("Schliessen")}</button></div>
      </div>
      <p className="muted">
        <code>{trace.messageId}</code>
        {" · "}{formatNumber(trace.stations.length)} {t("Stationen")}
        {trace.complete ? "" : ` · ${t("Grenze erreicht, es können weitere Stationen gefolgt sein")}`}
        {trace.messageExists ? "" : ` · ${t("Die Nachricht selbst ist schon weggeräumt; die Spur bleibt.")}`}
      </p>
      {trace.traceId
        ? <p className="muted">{t("Fremde Spur")}: <code>{trace.traceId}</code>{trace.parentSpanId ? <> · <code>{trace.parentSpanId}</code></> : null}</p>
        : <p className="muted">{t("Kein traceparent beim Einstellen. Die Spur hält allein über die Nachrichten-Id zusammen, und die endet an der Grenze von QKERN.")}</p>}
      {trace.sourceMessageId && <p className="muted">{t("Entstanden aus")} <code>{trace.sourceMessageId}</code></p>}
      {trace.replayedIntoMessageId && <p className="muted">{t("Wieder eingereiht als")} <code>{trace.replayedIntoMessageId}</code></p>}
      <div className="detail-list">
        {trace.stations.map((station) => <div key={station.sequence}>
          <span>
            <strong>{formatNumber(station.sequence)}. {stationLabel(station.station)}</strong>
            <small>
              {formatMoment(station.occurredAt)} · {t("Versuch")} {formatNumber(station.attempt)}
              {station.workerId ? ` · ${t("Wirt")} ${station.workerId}` : ""}
              {station.failureCode ? ` · ${station.failureCode}` : ""}
            </small>
          </span>
        </div>)}
      </div>
      <p className="muted">{t("Die Spur trägt keine Nutzlast. Eine Station steht in derselben Transaktion wie der Zustandswechsel, den sie beschreibt, und übersteht darum einen Neustart des Wirts und zwei Instanzen. Eine Erneuerung der Pacht ist absichtlich keine Station: sie wäre der Takt und nicht die Arbeit.")}</p>
    </article>}
    <article className="console-card"><div className="card-head"><div><span>{t("METRICS")}</span><h3>{t("Export für Prometheus")}</h3></div></div><p className="muted">{t("Jeder Scrape holt den Stand des Augenblicks über alle Queues dieser Umgebung, im Prometheus-Textformat und mit derselben Admin-Grenze wie diese Ansicht.")}</p><code className="endpoint-code">GET {base}/metrics</code></article>
  </div>;
}
