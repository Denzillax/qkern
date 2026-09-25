"use client";

import { useCallback, useEffect, useState } from "react";
import { Inbox, Plus, RefreshCw, RotateCcw } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";
import { tAll } from "@/components/console/console-i18n";

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

type LoadState = "loading" | "ready" | "unavailable" | "error";

export function QueuesView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/queues`;
  const [queues, setQueues] = useState<QueueItem[]>([]);
  const [status, setStatus] = useState<Record<string, QueueStatus>>({});
  const [state, setState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [deadLetters, setDeadLetters] = useState<DeadLetter[]>([]);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch(base, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503) { setQueues([]); setState("unavailable"); setMessage(t("Project Queues sind für diese Umgebung nicht verbunden.")); return; }
      if (!response.ok) throw new Error(payload.error ?? t("Queues nicht verfügbar"));
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

  async function create() {
    const name = window.prompt(t("Name der Queue (Kleinbuchstaben, Ziffern, Bindestrich oder Unterstrich, 3 bis 63 Zeichen)"), "email_jobs");
    if (!name) return;
    const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
    if (!response.ok) { const payload = await response.json().catch(() => ({})); setMessage(payload.error ?? t("Queue konnte nicht angelegt werden")); return; }
    await load();
  }

  async function showDeadLetters(queue: QueueItem) {
    if (open === queue.name) { setOpen(null); setDeadLetters([]); return; }
    const response = await fetch(`${base}/${queue.name}/dead-letters?limit=50`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(payload.error ?? t("Dead Letters nicht verfügbar")); return; }
    setOpen(queue.name); setDeadLetters(payload.data as DeadLetter[]);
  }

  async function replay(letter: DeadLetter) {
    setBusy(letter.id);
    const response = await fetch(`${base}/${letter.queue}/dead-letters/${letter.id}/replay`, { method: "POST" });
    setBusy("");
    if (!response.ok) { const payload = await response.json().catch(() => ({})); setMessage(payload.error ?? t("Wiedereinreihen fehlgeschlagen")); return; }
    const refreshed = await fetch(`${base}/${letter.queue}/dead-letters?limit=50`, { cache: "no-store" });
    if (refreshed.ok) setDeadLetters(((await refreshed.json()).data) as DeadLetter[]);
    await load();
  }

  if (state === "loading" && queues.length === 0) return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Queues werden geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><Inbox size={26}/><h3>{state === "unavailable" ? t("Project Queues nicht verbunden") : t("Queues nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

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
      <div className="card-head"><div><span>{t("PROJECT QUEUES")} · {environment.toUpperCase()}</span><h3>{t("Queues des Projekts")}</h3></div><div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button><button className="button small" onClick={() => void create()}><Plus size={14}/> {t("Neue Queue")}</button></div></div>
      {message && <p className="muted">{message}</p>}
      {queues.length === 0 && <p className="muted">{t("Noch keine Queues. Eine Queue nimmt Nachrichten an, vergibt Leases an Worker und legt fehlgeschlagene Nachrichten nach dem letzten Versuch als Dead Letter ab.")}</p>}
      {queues.map((queue) => { const s = status[queue.name]; return <div key={queue.id}>
        <div className="bucket-row"><span className="bucket-icon"><Inbox size={16}/></span>
          <div><strong>{queue.name}</strong><small>{queue.enqueuePolicy === "service" ? t("nur Service Key") : t("angemeldete Nutzer")} · {queue.maxAttempts} {t("Versuche")} · {t("Lease")} {queue.visibilityTimeoutSeconds} s · {t("Retry")} {queue.retryBaseSeconds}–{queue.retryMaxSeconds} s{queue.dedupeWindowSeconds ? ` · ${t("Dedupe")} ${queue.dedupeWindowSeconds} s` : ""}</small></div>
          <span title={s?.oldestAvailableAt ? `${t("Älteste wartet seit")} ${new Intl.DateTimeFormat("de-CH", { dateStyle: "short", timeStyle: "short" }).format(new Date(s.oldestAvailableAt))}` : undefined}>{s ? `${s.available} ${t("wartend")} · ${s.inFlight} ${t("in Bearbeitung")} · ${s.completed} ${t("erledigt")}` : t("Status nicht verfügbar")}</span>
          <span className={s && s.deadLettered > 0 ? "risk high" : "muted"}>{s ? `${s.deadLettered} ${t("Dead Letters")}` : "–"}</span>
          <button className="plain-button" onClick={() => void showDeadLetters(queue)}><StableLabel current={open === queue.name ? t("Ausblenden") : t("Dead Letters")} variants={tAll("Ausblenden", "Dead Letters")}/></button>
        </div>
        {open === queue.name && <div className="detail-list">
          {deadLetters.length === 0 ? <div><span>{t("Keine Dead Letters")}</span><strong className="muted">–</strong></div> : deadLetters.map((letter) => <div key={letter.id}>
            <span><code>{letter.id.slice(0, 8)}</code><small>{t("Versuch")} {letter.attempt} · {letter.failureCode} · {new Intl.DateTimeFormat("de-CH", { dateStyle: "short", timeStyle: "short" }).format(new Date(letter.deadLetteredAt))}</small></span>
            {letter.replayed ? <strong className="muted">{t("wieder eingereiht")}</strong> : <button className="plain-button" disabled={busy === letter.id} onClick={() => void replay(letter)}><RotateCcw size={13}/> {t("Wieder einreihen")}</button>}
          </div>)}
        </div>}
      </div>; })}
    </article>
    <article className="console-card"><div className="card-head"><div><span>{t("METRICS")}</span><h3>{t("Export für Prometheus")}</h3></div></div><p className="muted">{t("Jeder Scrape holt den Stand des Augenblicks über alle Queues dieser Umgebung, im Prometheus-Textformat und mit derselben Admin-Grenze wie diese Ansicht.")}</p><code className="endpoint-code">GET {base}/metrics</code></article>
  </div>;
}
