"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, KeyRound, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMomentOrRaw, positionMoment } from "@/components/console/console-format";
import { StableLabel } from "@/components/stable-label";
import {
  DASHBOARD_EVENT_DEFINITIONS,
  DASHBOARD_EVENT_KINDS,
  DASHBOARD_EVENT_TEXTS,
  DASHBOARD_WEBHOOK_AT_LEAST_ONCE,
  DASHBOARD_WEBHOOK_NEVER,
  DASHBOARD_WEBHOOK_NO_BACKFILL,
  DASHBOARD_WEBHOOK_NO_CHAIN,
  DASHBOARD_WEBHOOK_NO_DELETE,
  DASHBOARD_WEBHOOK_NOT_DATABASE,
  DASHBOARD_WEBHOOK_SAME_PATH,
  DASHBOARD_WEBHOOK_SCHEMA_VERSION,
  DASHBOARD_WEBHOOK_SECRET,
  DASHBOARD_WEBHOOK_WHAT,
  DashboardWebhookError,
  validateDashboardWebhook,
  type DashboardEventKind,
  type DashboardWebhookRecord,
} from "@/lib/console/dashboard-webhooks";

/**
 * Einstellungen → Dashboard-Webhooks (2.75), wie bei Supabase unter Project
 * Settings → Webhooks.
 *
 * Die Ansicht zeigt die Dashboard-Webhooks einer Umgebung, ihre Ereignisarten,
 * ihr Ziel, ihren Zustand und die letzten Meldungen, und sie legt neue an. Sie
 * kann **nicht** loeschen; abschalten kann sie.
 *
 * Sechs Saetze stehen woertlich auf der Seite, weil sie der Punkt des ganzen
 * Slices sind:
 *
 * 1. Eine Meldung traegt genau die Felder, die diese Console fuer einen
 *    Audit-Eintrag schon zeigt. Die Seite listet sie je Ereignisart einzeln auf,
 *    damit niemand raten muss.
 * 2. Aenderungen an Ihren Tabellen meldet diese Seite nicht -- das sind die
 *    Datenbank-Webhooks, und sie haengen woanders.
 * 3. Was eine Meldung nie traegt, darunter die Referenz des Akteurs, obwohl die
 *    Audit-Ansicht sie zeigt.
 * 4. Das Signaturgeheimnis liegt im Vault. Hier steht nur die Referenz, und es
 *    gibt kein Feld, in das ein Wert passen wuerde.
 * 5. Zugestellt wird **mindestens einmal**, nicht genau einmal.
 * 6. Die Hashkette der Audit-Eintraege geht nicht mit hinaus; ein Empfaenger
 *    kann aus den Meldungen nicht beweisen, dass keine fehlt.
 *
 * Vor dem Absenden zeigt die Ansicht die vollstaendige Wirkung: Name,
 * Ereignisarten, Ziel, Referenz, Ereignistypen und die Feldliste je Art.
 * Geprueft wird dabei mit demselben reinen Modul, das auch die Route anwendet.
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
 * Der Stand des Sammlers, so wie die Route ihn liefert: je Webhook und
 * Ereignisart die zuletzt gemeldete Position und der Zeitpunkt dazu. Eine leere
 * Liste heisst "noch nie" -- es gibt keinen erfundenen Zeitpunkt.
 */
type Notification = {
  webhookId: string; kind: DashboardEventKind; position: string; notifiedAt: string;
};

export function DashboardWebhooksView({ projectId, environment, initialState }: {
  projectId: string; environment: Environment; initialState?: State }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/compute`;
  const [hooks, setHooks] = useState<DashboardWebhookRecord[]>([]);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [state, setState] = useState<State>(initialState ?? "loading");
  const [message, setMessage] = useState("");

  const [name, setName] = useState("");
  const [kinds, setKinds] = useState<DashboardEventKind[]>(["migration_applied"]);
  const [url, setUrl] = useState("");
  const [secretRef, setSecretRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");

  const load = useCallback(async () => {
    setMessage("");
    try {
      const response = await fetch(`${base}/dashboard-webhooks`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503) {
        setHooks([]); setState("unavailable");
        setMessage(payload.error ?? t("Compute ist für diese Umgebung deaktiviert."));
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? t("Dashboard-Webhooks nicht verfügbar"));
      const list = (payload.data ?? []) as DashboardWebhookRecord[];
      setHooks(list);
      setNotifications((payload.notifications ?? []) as Notification[]);
      setState("ready");

      // Der Zustellstatus haengt an der ausgehenden Definition; das ist dieselbe
      // Liste, die Functions & Jobs zeigt, und sie traegt keine Nutzlast.
      const found: Record<string, Delivery[]> = {};
      for (const hook of list) {
        const log = await fetch(`${base}/webhooks/${hook.webhookId}/deliveries?limit=5`,
          { cache: "no-store" });
        if (!log.ok) continue;
        const body = await log.json().catch(() => ({}));
        found[hook.id] = (body.data ?? []) as Delivery[];
      }
      setDeliveries(found);
    } catch (cause) {
      setState("error");
      setMessage(cause instanceof Error ? cause.message : t("Dashboard-Webhooks nicht verfügbar"));
    }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  // Der Entwurf wird bei jeder Eingabe neu gerechnet, mit demselben Modul, das
  // die Route anwendet. Was hier steht, ist genau das, was abgeschickt wird.
  const preview = useMemo(() => {
    try {
      return {
        draft: validateDashboardWebhook({ name, url, kinds, signingSecretRef: secretRef }),
        reason: "",
      };
    } catch (error) {
      return {
        draft: null,
        reason: error instanceof DashboardWebhookError
          ? t(error.reason)
          : t("Aus dieser Eingabe lässt sich kein Dashboard-Webhook bauen."),
      };
    }
  }, [name, url, kinds, secretRef]);

  async function submit() {
    const draft = preview.draft;
    if (!draft) return;
    setSubmitting(true);
    setSubmitMessage("");
    try {
      const response = await fetch(`${base}/dashboard-webhooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name, url: draft.url, kinds: draft.kinds,
          signingSecretRef: draft.signingSecretRef,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setSubmitMessage(body.error ?? t("Der Dashboard-Webhook wurde abgelehnt."));
        return;
      }
      setName(""); setUrl(""); setSecretRef(""); setKinds(["migration_applied"]);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function toggle(hook: DashboardWebhookRecord) {
    const response = await fetch(`${base}/dashboard-webhooks/${hook.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !hook.enabled }),
    });
    if (response.ok) { await load(); return; }
    const payload = await response.json().catch(() => ({}));
    setMessage(payload.error ?? t("Die Änderung wurde abgelehnt."));
  }

  /**
   * Der juengste Zeitpunkt, zu dem ueberhaupt etwas gemeldet wurde. Gibt es
   * keinen, steht in der Ansicht "noch nie" -- und nicht eine Null.
   */
  const newestNotification = notifications.reduce<string | null>(
    (newest, entry) => newest === null || entry.notifiedAt > newest ? entry.notifiedAt : newest,
    null);

  function toggleKind(kind: DashboardEventKind, checked: boolean) {
    setKinds((current) => checked
      ? [...current.filter((entry) => entry !== kind), kind]
      : current.filter((entry) => entry !== kind));
  }

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/>
      <h3>{t("Dashboard-Webhooks werden geladen…")}</h3></div>;
  }
  if (state === "unavailable" || state === "error") {
    return <div className="console-card live-module-state"><Bell size={26}/>
      <h3>{state === "unavailable"
        ? t("Compute nicht aktiv")
        : t("Dashboard-Webhooks nicht verfügbar")}</h3>
      <p>{message}</p>
      <button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("DASHBOARD-WEBHOOKS")}</span><strong>{hooks.length}</strong><small>{t("in dieser Umgebung")}</small></div>
      <div><span>{t("AKTIV")}</span><strong>{hooks.filter((hook) => hook.enabled).length}</strong><small>{t("melden")}</small></div>
      <div><span>{t("ABGESCHALTET")}</span><strong>{hooks.filter((hook) => !hook.enabled).length}</strong><small>{t("warten")}</small></div>
      <div><span>{t("FASSUNG")}</span><strong>{DASHBOARD_WEBHOOK_SCHEMA_VERSION}</strong><small>{t("Schema der Meldung")}</small></div>
      <div>
        <span>{t("ZULETZT GEMELDET")}</span>
        <strong>{newestNotification ? formatMomentOrRaw(newestNotification) : t("noch nie")}</strong>
        <small>{newestNotification
          ? t("durch den Sammler im Compute-Prozess")
          : t("kein Ereignis gemeldet")}</small>
      </div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS EINE MELDUNG TRÄGT")}</span><h3>{t("Genau das, was diese Console schon zeigt")}</h3></div><ShieldCheck size={18}/></div>
      <p className="muted">{t(DASHBOARD_WEBHOOK_WHAT)}</p>
      <p className="muted">{t(DASHBOARD_WEBHOOK_NOT_DATABASE)}</p>
      <p className="muted">{t(DASHBOARD_WEBHOOK_NEVER)}</p>
      <p className="muted">{t(DASHBOARD_WEBHOOK_SAME_PATH)}</p>
      <p className="muted">{t(DASHBOARD_WEBHOOK_AT_LEAST_ONCE)}</p>
      <p className="muted">{t(DASHBOARD_WEBHOOK_NO_BACKFILL)}</p>
      <p className="muted">{t(DASHBOARD_WEBHOOK_NO_CHAIN)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("EREIGNISARTEN")}</span><h3>{t("Jede Art und ihre Felder")}</h3></div><Bell size={18}/></div>
      {DASHBOARD_EVENT_KINDS.map((kind) => <div className="bucket-row" key={kind}>
        <span className="bucket-icon"><Bell size={16}/></span>
        <div>
          <strong>{t(DASHBOARD_EVENT_TEXTS[kind].label)}</strong>
          <small>{t(DASHBOARD_EVENT_TEXTS[kind].carries)}</small>
          <small><code>{DASHBOARD_EVENT_DEFINITIONS[kind].fields.join(", ")}</code></small>
          <small>{t("Zurückgehalten:")} {DASHBOARD_EVENT_DEFINITIONS[kind].withheld.join(", ")}</small>
          <small>{t("Aus dem Audit-Log:")} <code>{DASHBOARD_EVENT_DEFINITIONS[kind].auditActions.join(", ")}</code></small>
        </div>
      </div>)}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("SIGNATUR")}</span><h3>{t("Das Geheimnis liegt im Vault")}</h3></div><KeyRound size={18}/></div>
      <p className="muted">{t(DASHBOARD_WEBHOOK_SECRET)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("DASHBOARD-WEBHOOKS")} · {environment.toUpperCase()}</span><h3>{t("Ereignisarten, Ziel, Zustand")}</h3></div>
        <button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button>
      </div>
      {message && <p className="risk high">{message}</p>}
      {hooks.length === 0 && <p className="muted">{t("Noch kein Dashboard-Webhook. Jeder verbindet Ereignisse dieses Projekts mit einem Ziel, das QKERN signiert beliefert.")}</p>}
      {hooks.map((hook) => <div className="bucket-row" key={hook.id}>
        <span className="bucket-icon"><Bell size={16}/></span>
        <div>
          <strong>{hook.name}</strong>
          <small>{hook.kinds.map((kind) => t(DASHBOARD_EVENT_TEXTS[kind].label)).join(", ")} → {hook.url}</small>
          <small>{t("Signaturgeheimnis:")} {hook.signingSecretRef} · {t("angelegt")} {formatMomentOrRaw(hook.createdAt)}</small>
          <small>{notifications.filter((entry) => entry.webhookId === hook.webhookId).length === 0
            ? t("noch nie gemeldet")
            : notifications.filter((entry) => entry.webhookId === hook.webhookId).map((entry) =>
              `${t(DASHBOARD_EVENT_TEXTS[entry.kind].label)} ${t("gemeldet bis")} ${positionMoment(entry.position)} · ${formatMomentOrRaw(entry.notifiedAt)}`).join(" · ")}</small>
          <small>{(deliveries[hook.id] ?? []).length === 0
            ? t("noch keine Meldung")
            : (deliveries[hook.id] ?? []).map((delivery) =>
              `${delivery.eventType} ${t(STATUS_LABELS[delivery.status])}${delivery.lastFailureCode ? ` (${delivery.lastFailureCode})` : ""} · ${formatMomentOrRaw(delivery.occurredAt)}`).join(" · ")}</small>
        </div>
        <span className={hook.enabled ? "secure" : "muted"}>{hook.enabled ? t("aktiv") : t("abgeschaltet")}</span>
        <button className="plain-button" onClick={() => void toggle(hook)}>
          <StableLabel current={hook.enabled ? t("Abschalten") : t("Aktivieren")} variants={tAll("Abschalten", "Aktivieren")}/>
        </button>
      </div>)}
      <p className="muted">{t(DASHBOARD_WEBHOOK_NO_DELETE)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NEUER DASHBOARD-WEBHOOK")}</span><h3>{t("Ereignisse des Projekts mit einem Ziel verbinden")}</h3></div><Plus size={18}/></div>
      <div className="settings-form">
        <label>{t("Name des Webhooks")}
          <input value={name} onChange={(event) => setName(event.target.value)} spellCheck={false} placeholder="ereignisse-an-chat"/>
        </label>
        <div>
          <span>{t("Ereignisarten")}</span>
          {DASHBOARD_EVENT_KINDS.map((kind) => <label key={kind}>
            <input type="checkbox" checked={kinds.includes(kind)}
              onChange={(changed) => toggleKind(kind, changed.target.checked)}/> {t(DASHBOARD_EVENT_TEXTS[kind].label)}
          </label>)}
        </div>
        <label>{t("Ziel (öffentliches HTTPS)")}
          <input value={url} onChange={(event) => setUrl(event.target.value)} spellCheck={false} placeholder="https://chat.example.com/qkern/ereignisse"/>
        </label>
        <label>{t("Referenz auf das Signaturgeheimnis")}
          <input value={secretRef} onChange={(event) => setSecretRef(event.target.value)} spellCheck={false} placeholder="vault:dashboard-webhooks/chat"/>
        </label>
      </div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("VORSCHAU")}</span><h3>{t("Genau das wird angelegt")}</h3></div><ShieldCheck size={18}/></div>
      {preview.draft
        ? <>
          <pre>{[
            `${t("Name")}: ${preview.draft.name}`,
            `${t("Ereignisarten")}: ${preview.draft.kinds.join(", ")}`,
            `${t("Ereignistypen")}: ${preview.draft.eventTypes.join(", ")}`,
            `${t("Ziel")}: ${preview.draft.url}`,
            `${t("Signaturgeheimnis")}: ${preview.draft.signingSecretRef}`,
            ...preview.draft.kinds.map((kind) =>
              `${t("Felder")} ${kind}: ${DASHBOARD_EVENT_DEFINITIONS[kind].fields.join(", ")}`),
          ].join("\n")}</pre>
          <p className="muted">{t("Ab dem Anlegen meldet QKERN jedes neue Ereignis dieser Arten signiert an dieses Ziel. Die Vergangenheit bleibt liegen.")}</p>
        </>
        : <p className="muted">{preview.reason || t("Der Entwurf ist noch nicht vollständig.")}</p>}
      <button className="button" onClick={() => void submit()} disabled={!preview.draft || submitting}>
        <StableLabel current={submitting ? t("Wird angelegt…") : t("Dashboard-Webhook anlegen")} variants={tAll("Wird angelegt…", "Dashboard-Webhook anlegen")}/>
      </button>
      {submitMessage && <p className="risk high">{submitMessage}</p>}
    </article>
  </div>;
}
