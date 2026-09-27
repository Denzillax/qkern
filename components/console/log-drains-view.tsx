"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileClock, KeyRound, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";
import {
  LOG_DRAIN_GAPS,
  LOG_DRAIN_NEVER,
  LOG_DRAIN_NO_CRON,
  LOG_DRAIN_NO_DELETE,
  LOG_DRAIN_SAME_PATH,
  LOG_DRAIN_SCHEMA_VERSION,
  LOG_DRAIN_SECRET,
  LOG_DRAIN_SOURCE_DEFINITIONS,
  LOG_DRAIN_SOURCE_TEXTS,
  LOG_DRAIN_SOURCES,
  LOG_DRAIN_WHAT,
  LogDrainError,
  validateLogDrain,
  type LogDrainRecord,
  type LogDrainSourceId,
} from "@/lib/console/log-drains";

/**
 * Einstellungen → Log-Drains (2.54), wie bei Supabase unter Project Settings →
 * Log Drains.
 *
 * Die Ansicht zeigt die Drains einer Umgebung, ihre Quellen, ihr Ziel, ihren
 * Zustand und die letzten Ladungen, und sie legt neue an. Sie kann **nicht**
 * loeschen; abschalten kann sie.
 *
 * Fuenf Saetze stehen woertlich auf der Seite, weil sie der Punkt des ganzen
 * Slices sind:
 *
 * 1. Ein Drain traegt genau die Felder, die diese Console fuer dieselbe Quelle
 *    schon zeigt. Die Seite listet sie einzeln auf, damit niemand raten muss.
 * 2. Was er nie traegt: keine Container-Ausgabe, keine Nutzlast, keinen
 *    Zeilenwert, keine Adresse, kein Token, kein Geheimnis.
 * 3. Das Signaturgeheimnis liegt im Vault. Hier steht nur die Referenz, und es
 *    gibt kein Feld, in das ein Wert passen wuerde.
 * 4. Zugestellt wird ueber den vorhandenen Webhook-Weg, mit derselben Outbox,
 *    demselben Backoff und demselben Dead Letter.
 * 5. Ein Drain verspricht keine Lueckenlosigkeit, und das Cron-Log steht darum
 *    gar nicht auf der Liste der Quellen.
 *
 * Vor dem Absenden zeigt die Ansicht die vollstaendige Wirkung: Name, Quellen,
 * Ziel, Referenz, Ereignistypen und die Feldliste je Quelle. Geprueft wird dabei
 * mit demselben reinen Modul, das auch die Route anwendet.
 */
type Environment = "development" | "staging" | "production";
type Delivery = {
  id: string; eventType: string; status: "pending" | "in_flight" | "delivered" | "dead_lettered";
  attemptCount: number; lastFailureCode: string | null; occurredAt: string; settledAt: string | null;
};
type State = "loading" | "ready" | "unavailable" | "error";

const STATUS_LABELS: Record<Delivery["status"], string> = {
  pending: "wartet",
  in_flight: "unterwegs",
  delivered: "zugestellt",
  dead_lettered: "aufgegeben",
};

/**
 * Der Stand des Sammlers (2.64), so wie die Route ihn liefert: je Drain und
 * Quelle die zuletzt weitergeleitete Position und der Zeitpunkt dazu. Eine
 * leere Liste heisst "noch nie" -- es gibt keinen erfundenen Zeitpunkt.
 */
type Forward = {
  webhookId: string; source: LogDrainSourceId; position: string; updatedAt: string;
};

function formatTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("de-CH", { dateStyle: "short", timeStyle: "short" }).format(parsed);
}

/**
 * Die Position ist `<zeitpunkt>#<id>` und undurchsichtig. Gezeigt wird ihr
 * Zeitanteil: Er sagt einem Menschen, bis wann die Quelle weitergeleitet ist.
 * Die Id dahinter ist die Kennung eines Log-Eintrags und beantwortet keine
 * Frage, die in dieser Ansicht jemand stellt.
 */
function positionTime(position: string): string {
  const separator = position.indexOf("#");
  return formatTime(separator < 1 ? position : position.slice(0, separator));
}

export function LogDrainsView({ projectId, environment }: {
  projectId: string; environment: Environment;
}) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/compute`;
  const [drains, setDrains] = useState<LogDrainRecord[]>([]);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});
  const [forwards, setForwards] = useState<Forward[]>([]);
  const [state, setState] = useState<State>("loading");
  const [message, setMessage] = useState("");

  const [name, setName] = useState("");
  const [sources, setSources] = useState<LogDrainSourceId[]>(["auth_audit"]);
  const [url, setUrl] = useState("");
  const [secretRef, setSecretRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");

  const load = useCallback(async () => {
    setMessage("");
    try {
      const response = await fetch(`${base}/log-drains`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503) {
        setDrains([]); setState("unavailable");
        setMessage(payload.error ?? t("Compute ist für diese Umgebung deaktiviert."));
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? t("Log-Drains nicht verfügbar"));
      const list = (payload.data ?? []) as LogDrainRecord[];
      setDrains(list);
      setForwards((payload.forwards ?? []) as Forward[]);
      setState("ready");

      // Der Zustellstatus haengt an der ausgehenden Definition; das ist
      // dieselbe Liste, die Functions & Jobs zeigt, und sie traegt keine
      // Nutzlast.
      const found: Record<string, Delivery[]> = {};
      for (const drain of list) {
        const log = await fetch(`${base}/webhooks/${drain.webhookId}/deliveries?limit=5`,
          { cache: "no-store" });
        if (!log.ok) continue;
        const body = await log.json().catch(() => ({}));
        found[drain.id] = (body.data ?? []) as Delivery[];
      }
      setDeliveries(found);
    } catch (cause) {
      setState("error");
      setMessage(cause instanceof Error ? cause.message : t("Log-Drains nicht verfügbar"));
    }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  // Der Entwurf wird bei jeder Eingabe neu gerechnet, mit demselben Modul, das
  // die Route anwendet. Was hier steht, ist genau das, was abgeschickt wird.
  const preview = useMemo(() => {
    try {
      return { draft: validateLogDrain({ name, url, sources, signingSecretRef: secretRef }), reason: "" };
    } catch (error) {
      return {
        draft: null,
        reason: error instanceof LogDrainError
          ? t(error.reason)
          : t("Aus dieser Eingabe lässt sich kein Log-Drain bauen."),
      };
    }
  }, [name, url, sources, secretRef]);

  async function submit() {
    const draft = preview.draft;
    if (!draft) return;
    setSubmitting(true);
    setSubmitMessage("");
    try {
      const response = await fetch(`${base}/log-drains`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name, url: draft.url, sources: draft.sources,
          signingSecretRef: draft.signingSecretRef,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setSubmitMessage(body.error ?? t("Der Log-Drain wurde abgelehnt."));
        return;
      }
      setName(""); setUrl(""); setSecretRef(""); setSources(["auth_audit"]);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function toggle(drain: LogDrainRecord) {
    const response = await fetch(`${base}/log-drains/${drain.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !drain.enabled }),
    });
    if (response.ok) { await load(); return; }
    const payload = await response.json().catch(() => ({}));
    setMessage(payload.error ?? t("Die Änderung wurde abgelehnt."));
  }

  /**
   * Der juengste Zeitpunkt, zu dem ueberhaupt etwas hinausgegangen ist. Gibt
   * es keinen, steht in der Ansicht "noch nie" -- und nicht eine Null.
   */
  const newestForward = forwards.reduce<string | null>(
    (newest, entry) => newest === null || entry.updatedAt > newest ? entry.updatedAt : newest,
    null);

  function toggleSource(source: LogDrainSourceId, checked: boolean) {
    setSources((current) => checked
      ? [...current.filter((entry) => entry !== source), source]
      : current.filter((entry) => entry !== source));
  }

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/>
      <h3>{t("Log-Drains werden geladen…")}</h3></div>;
  }
  if (state === "unavailable" || state === "error") {
    return <div className="console-card live-module-state"><FileClock size={26}/>
      <h3>{state === "unavailable" ? t("Compute nicht aktiv") : t("Log-Drains nicht verfügbar")}</h3>
      <p>{message}</p>
      <button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("LOG-DRAINS")}</span><strong>{drains.length}</strong><small>{t("in dieser Umgebung")}</small></div>
      <div><span>{t("AKTIV")}</span><strong>{drains.filter((drain) => drain.enabled).length}</strong><small>{t("leiten weiter")}</small></div>
      <div><span>{t("ABGESCHALTET")}</span><strong>{drains.filter((drain) => !drain.enabled).length}</strong><small>{t("warten")}</small></div>
      <div><span>{t("FASSUNG")}</span><strong>{LOG_DRAIN_SCHEMA_VERSION}</strong><small>{t("Schema der Ladung")}</small></div>
      <div>
        <span>{t("ZULETZT WEITERGELEITET")}</span>
        <strong>{newestForward ? formatTime(newestForward) : t("noch nie")}</strong>
        <small>{newestForward
          ? t("durch den Sammler im Compute-Prozess")
          : t("kein Log weitergeleitet")}</small>
      </div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS EIN DRAIN TRÄGT")}</span><h3>{t("Genau das, was diese Console schon zeigt")}</h3></div><ShieldCheck size={18}/></div>
      <p className="muted">{t(LOG_DRAIN_WHAT)}</p>
      <p className="muted">{t(LOG_DRAIN_NEVER)}</p>
      <p className="muted">{t(LOG_DRAIN_SAME_PATH)}</p>
      <p className="muted">{t(LOG_DRAIN_NO_CRON)}</p>
      <p className="muted">{t(LOG_DRAIN_GAPS)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("QUELLEN")}</span><h3>{t("Jede Quelle und ihre Felder")}</h3></div><FileClock size={18}/></div>
      {LOG_DRAIN_SOURCES.map((source) => <div className="bucket-row" key={source}>
        <span className="bucket-icon"><FileClock size={16}/></span>
        <div>
          <strong>{t(LOG_DRAIN_SOURCE_TEXTS[source].label)}</strong>
          <small>{t(LOG_DRAIN_SOURCE_TEXTS[source].carries)}</small>
          <small><code>{LOG_DRAIN_SOURCE_DEFINITIONS[source].fields.join(", ")}</code></small>
          <small>{t("Zurückgehalten:")} {LOG_DRAIN_SOURCE_DEFINITIONS[source].withheld.length === 0
            ? t("nichts") : LOG_DRAIN_SOURCE_DEFINITIONS[source].withheld.join(", ")}</small>
        </div>
      </div>)}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("SIGNATUR")}</span><h3>{t("Das Geheimnis liegt im Vault")}</h3></div><KeyRound size={18}/></div>
      <p className="muted">{t(LOG_DRAIN_SECRET)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("LOG-DRAINS")} · {environment.toUpperCase()}</span><h3>{t("Quellen, Ziel, Zustand")}</h3></div>
        <button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button>
      </div>
      {message && <p className="risk high">{message}</p>}
      {drains.length === 0 && <p className="muted">{t("Noch kein Log-Drain. Jeder Drain verbindet die Logs dieser Umgebung mit einem Ziel, das QKERN signiert beliefert.")}</p>}
      {drains.map((drain) => <div className="bucket-row" key={drain.id}>
        <span className="bucket-icon"><FileClock size={16}/></span>
        <div>
          <strong>{drain.name}</strong>
          <small>{drain.sources.map((source) => t(LOG_DRAIN_SOURCE_TEXTS[source].label)).join(", ")} → {drain.url}</small>
          <small>{t("Signaturgeheimnis:")} {drain.signingSecretRef} · {t("angelegt")} {formatTime(drain.createdAt)}</small>
          <small>{forwards.filter((entry) => entry.webhookId === drain.webhookId).length === 0
            ? t("noch nie weitergeleitet")
            : forwards.filter((entry) => entry.webhookId === drain.webhookId).map((entry) =>
              `${t(LOG_DRAIN_SOURCE_TEXTS[entry.source].label)} ${t("weitergeleitet bis")} ${positionTime(entry.position)} · ${formatTime(entry.updatedAt)}`).join(" · ")}</small>
          <small>{(deliveries[drain.id] ?? []).length === 0
            ? t("noch keine Ladung")
            : (deliveries[drain.id] ?? []).map((delivery) =>
              `${delivery.eventType} ${t(STATUS_LABELS[delivery.status])}${delivery.lastFailureCode ? ` (${delivery.lastFailureCode})` : ""} · ${formatTime(delivery.occurredAt)}`).join(" · ")}</small>
        </div>
        <span className={drain.enabled ? "secure" : "muted"}>{drain.enabled ? t("aktiv") : t("abgeschaltet")}</span>
        <button className="plain-button" onClick={() => void toggle(drain)}>
          <StableLabel current={drain.enabled ? t("Abschalten") : t("Aktivieren")} variants={tAll("Abschalten", "Aktivieren")}/>
        </button>
      </div>)}
      <p className="muted">{t(LOG_DRAIN_NO_DELETE)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NEUER LOG-DRAIN")}</span><h3>{t("Logs mit einem Ziel verbinden")}</h3></div><Plus size={18}/></div>
      <div className="settings-form">
        <label>{t("Name des Drains")}
          <input value={name} onChange={(event) => setName(event.target.value)} spellCheck={false} placeholder="logs-an-siem"/>
        </label>
        <div>
          <span>{t("Quellen")}</span>
          {LOG_DRAIN_SOURCES.map((source) => <label key={source}>
            <input type="checkbox" checked={sources.includes(source)}
              onChange={(changed) => toggleSource(source, changed.target.checked)}/> {t(LOG_DRAIN_SOURCE_TEXTS[source].label)}
          </label>)}
        </div>
        <label>{t("Ziel (öffentliches HTTPS)")}
          <input value={url} onChange={(event) => setUrl(event.target.value)} spellCheck={false} placeholder="https://siem.example.com/qkern/logs"/>
        </label>
        <label>{t("Referenz auf das Signaturgeheimnis")}
          <input value={secretRef} onChange={(event) => setSecretRef(event.target.value)} spellCheck={false} placeholder="vault:log-drains/siem"/>
        </label>
      </div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("VORSCHAU")}</span><h3>{t("Genau das wird angelegt")}</h3></div><ShieldCheck size={18}/></div>
      {preview.draft
        ? <>
          <pre>{[
            `${t("Name")}: ${preview.draft.name}`,
            `${t("Quellen")}: ${preview.draft.sources.join(", ")}`,
            `${t("Ereignistypen")}: ${preview.draft.eventTypes.join(", ")}`,
            `${t("Ziel")}: ${preview.draft.url}`,
            `${t("Signaturgeheimnis")}: ${preview.draft.signingSecretRef}`,
            ...preview.draft.sources.map((source) =>
              `${t("Felder")} ${source}: ${LOG_DRAIN_SOURCE_DEFINITIONS[source].fields.join(", ")}`),
          ].join("\n")}</pre>
          <p className="muted">{t("Ab dem Anlegen sammelt QKERN diese Quellen und schickt sie in Ladungen signiert an dieses Ziel.")}</p>
        </>
        : <p className="muted">{preview.reason || t("Der Entwurf ist noch nicht vollständig.")}</p>}
      <button className="button" onClick={() => void submit()} disabled={!preview.draft || submitting}>
        <StableLabel current={submitting ? t("Wird angelegt…") : t("Log-Drain anlegen")} variants={tAll("Wird angelegt…", "Log-Drain anlegen")}/>
      </button>
      {submitMessage && <p className="risk high">{submitMessage}</p>}
    </article>
  </div>;
}
