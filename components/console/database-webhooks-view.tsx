"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, Plus, RefreshCw, ShieldCheck, Table2, Webhook } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { formatMomentOrRaw } from "@/components/console/console-format";
import { StableLabel } from "@/components/stable-label";
import {
  DATABASE_WEBHOOK_EVENTS,
  DATABASE_WEBHOOK_EVENT_LABELS,
  DATABASE_WEBHOOK_SCHEMA,
  DatabaseWebhookError,
  validateDatabaseWebhook,
  type DatabaseWebhookEvent,
  type DatabaseWebhookRecord,
} from "@/lib/console/database-webhooks";

/**
 * Datenbank-Webhooks (2.50), wie bei Supabase unter Integrations → Database
 * Webhooks.
 *
 * Die Ansicht zeigt die Kopplungen einer Umgebung, die letzten Zustellungen je
 * Kopplung mit ihrem Ausgang, und sie legt neue an. Sie kann **nicht**
 * loeschen; abschalten kann sie.
 *
 * Drei Saetze stehen woertlich auf der Seite, weil sie der Punkt des ganzen
 * Slices sind:
 *
 * 1. Das Signaturgeheimnis liegt im Vault. QKERN zeigt seinen Wert nie — hier
 *    steht nur die Referenz, und es gibt in dieser Ansicht kein Feld, in das
 *    ein Wert passen wuerde.
 * 2. Eine Zustellung traegt Schema, Tabelle, Operation, den Primaerschluessel,
 *    die Position im Feed und den Commit-Zeitpunkt. Keinen weiteren
 *    Spaltenwert, kein Vorher- und kein Nachher-Bild.
 * 3. Ausgeloest wird ueber den vorhandenen Aenderungs-Feed, den Realtime schon
 *    liest. Eine Tabelle, fuer die die Aenderungserfassung nicht angeschaltet
 *    ist, erzeugt keine Zustellung.
 *
 * Vor dem Absenden zeigt die Ansicht die vollstaendige Wirkung: Tabelle,
 * Operationen, Ziel, Referenz und die Ereignistypen, die daraus entstehen.
 * Geprueft wird dabei mit demselben reinen Modul, das auch die Route anwendet.
 */
type Environment = "development" | "staging" | "production";
type Delivery = {
  id: string; eventType: string; status: "pending" | "in_flight" | "delivered" | "dead_lettered";
  attemptCount: number; lastFailureCode: string | null; occurredAt: string; settledAt: string | null;
};
type State = "loading" | "ready" | "unavailable" | "error";
/**
 * Der Stand der Brücke (2.53).
 *
 * Seit der Compute-Prozess die Brücke wirklich betreibt, gibt es dazu eine
 * ehrliche Zahl: die zuletzt gelesene Position im Änderungs-Feed und wann sie
 * festgehalten wurde. `null` heisst "noch nie" — die Brücke läuft für diese
 * Umgebung nicht, oder sie hat noch keine Änderung gefunden. Die Ansicht sagt
 * das so und erfindet keinen Zeitpunkt.
 *
 * Bewusst **nicht** "zuletzt nachgesehen": Der Prozess liest im Sekundentakt
 * und hält nur fest, wenn er etwas gefunden hat. Eine Zahl für das Nachsehen
 * gibt es nirgends, und eine zu zeigen hiesse, sie zu erfinden.
 */
type BridgeState = { position: number; updatedAt: string } | null;

const STATUS_LABELS: Record<Delivery["status"], string> = {
  pending: "wartet",
  in_flight: "unterwegs",
  delivered: "zugestellt",
  dead_lettered: "aufgegeben",
};

export function DatabaseWebhooksView({ projectId, environment, initialState }: {
  projectId: string; environment: Environment; initialState?: State }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/compute`;
  const [hooks, setHooks] = useState<DatabaseWebhookRecord[]>([]);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});
  const [bridge, setBridge] = useState<BridgeState>(null);
  const [state, setState] = useState<State>(initialState ?? "loading");
  const [message, setMessage] = useState("");

  const [name, setName] = useState("");
  const [table, setTable] = useState("");
  const [events, setEvents] = useState<DatabaseWebhookEvent[]>(["insert"]);
  const [url, setUrl] = useState("");
  const [secretRef, setSecretRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");

  const load = useCallback(async () => {
    setMessage("");
    try {
      const response = await fetch(`${base}/database-webhooks`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503) {
        setHooks([]); setState("unavailable");
        setMessage(serverErrorText(payload.error) ?? t("Compute ist für diese Umgebung deaktiviert."));
        return;
      }
      if (!response.ok) throw new Error(serverErrorText(payload.error) ?? t("Datenbank-Webhooks nicht verfügbar"));
      const list = (payload.data ?? []) as DatabaseWebhookRecord[];
      setHooks(list);
      setBridge((payload.bridge ?? null) as BridgeState);
      setState("ready");

      // Der Zustellstatus haengt an der ausgehenden Definition; das ist
      // dieselbe Liste, die Functions & Jobs zeigt, und sie traegt keine
      // Nutzlast.
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
      setMessage(cause instanceof Error ? cause.message : t("Datenbank-Webhooks nicht verfügbar"));
    }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  // Der Entwurf wird bei jeder Eingabe neu gerechnet, mit demselben Modul, das
  // die Route anwendet. Was hier steht, ist genau das, was abgeschickt wird.
  const preview = useMemo(() => {
    try {
      return { draft: validateDatabaseWebhook({ name, table, events, url, signingSecretRef: secretRef }), reason: "" };
    } catch (error) {
      return {
        draft: null,
        reason: error instanceof DatabaseWebhookError
          ? t(error.reason)
          : t("Aus dieser Eingabe lässt sich kein Datenbank-Webhook bauen."),
      };
    }
  }, [name, table, events, url, secretRef]);

  async function submit() {
    const draft = preview.draft;
    if (!draft) return;
    setSubmitting(true);
    setSubmitMessage("");
    try {
      const response = await fetch(`${base}/database-webhooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name, table: draft.table, events: draft.events,
          url: draft.url, signingSecretRef: draft.signingSecretRef,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setSubmitMessage(serverErrorText(body.error) ?? t("Der Datenbank-Webhook wurde abgelehnt."));
        return;
      }
      setName(""); setTable(""); setUrl(""); setSecretRef(""); setEvents(["insert"]);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function toggle(hook: DatabaseWebhookRecord) {
    const response = await fetch(`${base}/database-webhooks/${hook.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !hook.enabled }),
    });
    if (response.ok) { await load(); return; }
    const payload = await response.json().catch(() => ({}));
    setMessage(serverErrorText(payload.error) ?? t("Die Änderung wurde abgelehnt."));
  }

  function toggleEvent(event: DatabaseWebhookEvent, checked: boolean) {
    setEvents((current) => checked
      ? [...current.filter((entry) => entry !== event), event]
      : current.filter((entry) => entry !== event));
  }

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/>
      <h3>{t("Datenbank-Webhooks werden geladen…")}</h3></div>;
  }
  if (state === "unavailable" || state === "error") {
    return <div className="console-card live-module-state"><Webhook size={26}/>
      <h3>{state === "unavailable" ? t("Compute nicht aktiv") : t("Datenbank-Webhooks nicht verfügbar")}</h3>
      <p>{message}</p>
      <button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("KOPPLUNGEN")}</span><strong>{hooks.length}</strong><small>{t("in dieser Umgebung")}</small></div>
      <div><span>{t("AKTIV")}</span><strong>{hooks.filter((hook) => hook.enabled).length}</strong><small>{t("lösen aus")}</small></div>
      <div><span>{t("ABGESCHALTET")}</span><strong>{hooks.filter((hook) => !hook.enabled).length}</strong><small>{t("warten")}</small></div>
      <div>
        <span>{t("BRÜCKE ZULETZT")}</span>
        <strong>{bridge ? formatMomentOrRaw(bridge.updatedAt) : t("noch nie")}</strong>
        <small>{bridge
          ? `${t("gelesen bis Position")} ${bridge.position}`
          : t("kein Änderungs-Feed gelesen")}</small>
      </div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS EINE ZUSTELLUNG TRÄGT")}</span><h3>{t("Und was sie bewusst nicht trägt")}</h3></div><ShieldCheck size={18}/></div>
      <p className="muted">{t("Eine Zustellung trägt genau sechs Angaben: Schema, Tabelle, Operation, die Werte des Primärschlüssels, die Position im Änderungs-Feed und den Zeitpunkt des Commits.")}</p>
      <p className="muted">{t("Sie trägt keinen weiteren Spaltenwert, kein Bild der Zeile vor der Änderung, keines danach und keine Liste der geänderten Spalten. Der Änderungs-Feed speichert diese Werte gar nicht; Realtime liest die Zeile für jeden Abonnenten einzeln unter dessen Rechten. Ein Empfänger im Internet hat keine solchen Rechte, unter denen gelesen werden könnte.")}</p>
      <p className="muted">{t("Der Primärschlüssel geht mit, sonst könnte ein Empfänger nichts damit anfangen. Damit erfährt er, dass es eine Zeile mit diesem Schlüssel gibt. Das ist die eine bewusste Offenlegung, und sie gilt auch für gelöschte Zeilen.")}</p>
      <p className="muted">{t("Ausgelöst wird über den Änderungs-Feed, den Realtime bereits liest. QKERN legt dafür keinen zusätzlichen Trigger in Ihrer Datenbank an. Eine Tabelle, für die die Änderungserfassung nicht angeschaltet ist, erzeugt keine Zustellung; das Anschalten ist eine Schemaänderung und läuft über die Freigabezentrale.")}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("SIGNATUR")}</span><h3>{t("Das Geheimnis liegt im Vault")}</h3></div><KeyRound size={18}/></div>
      <p className="muted">{t("Jede Zustellung wird mit HMAC-SHA256 signiert, genau wie jeder andere ausgehende Webhook von QKERN. Der Schlüssel liegt im Vault; hier steht ausschliesslich seine Referenz.")}</p>
      <p className="muted">{t("QKERN zeigt den Wert eines Signaturgeheimnisses nie — weder in dieser Ansicht noch über eine Route. Es gibt in dieser Ansicht kein Feld, in das ein Geheimnis gehört; tragen Sie hier nur die Referenz ein.")}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("DATENBANK-WEBHOOKS")} · {environment.toUpperCase()}</span><h3>{t("Tabelle, Ereignisse, Ziel, Zustand")}</h3></div>
        <button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button>
      </div>
      {message && <p className="risk high">{message}</p>}
      {hooks.length === 0 && <p className="muted">{t("Noch kein Datenbank-Webhook. Jede Kopplung verbindet eine Tabelle im Schema public mit einem Ziel, das QKERN signiert beliefert.")}</p>}
      {hooks.map((hook) => <div className="bucket-row" key={hook.id}>
        <span className="bucket-icon"><Table2 size={16}/></span>
        <div>
          <strong>{hook.name}</strong>
          <small>{hook.schema}.{hook.table} · {hook.events.map((event) => t(DATABASE_WEBHOOK_EVENT_LABELS[event])).join(", ")} → {hook.url}</small>
          <small>{t("Signaturgeheimnis:")} {hook.signingSecretRef} · {t("angelegt")} {formatMomentOrRaw(hook.createdAt)}</small>
          <small>{(deliveries[hook.id] ?? []).length === 0
            ? t("noch keine Zustellung")
            : (deliveries[hook.id] ?? []).map((delivery) =>
              `${delivery.eventType} ${t(STATUS_LABELS[delivery.status])}${delivery.lastFailureCode ? ` (${delivery.lastFailureCode})` : ""} · ${formatMomentOrRaw(delivery.occurredAt)}`).join(" · ")}</small>
        </div>
        <span className={hook.enabled ? "secure" : "muted"}>{hook.enabled ? t("aktiv") : t("abgeschaltet")}</span>
        <button className="plain-button" onClick={() => void toggle(hook)}>
          <StableLabel current={hook.enabled ? t("Abschalten") : t("Aktivieren")} variants={tAll("Abschalten", "Aktivieren")}/>
        </button>
      </div>)}
      <p className="muted">{t("Löschen gibt es hier nicht. Ein Löschen nähme die wartenden Zustellungen mit; Abschalten hält sie an, ohne etwas zu verlieren.")}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NEUE KOPPLUNG")}</span><h3>{t("Eine Tabelle mit einem Ziel verbinden")}</h3></div><Plus size={18}/></div>
      <div className="settings-form">
        <label>{t("Name der Kopplung")}
          <input value={name} onChange={(event) => setName(event.target.value)} spellCheck={false} placeholder="bestellungen-an-erp"/>
        </label>
        <label>{t("Tabelle im Schema public")}
          <input value={table} onChange={(event) => setTable(event.target.value)} spellCheck={false} placeholder="bestellungen"/>
        </label>
        <div>
          <span>{t("Ereignisse")}</span>
          {DATABASE_WEBHOOK_EVENTS.map((event) => <label key={event}>
            <input type="checkbox" checked={events.includes(event)}
              onChange={(changed) => toggleEvent(event, changed.target.checked)}/> {t(DATABASE_WEBHOOK_EVENT_LABELS[event])}
          </label>)}
        </div>
        <label>{t("Ziel (öffentliches HTTPS)")}
          <input value={url} onChange={(event) => setUrl(event.target.value)} spellCheck={false} placeholder="https://empfaenger.example.com/hooks/qkern"/>
        </label>
        <label>{t("Referenz auf das Signaturgeheimnis")}
          <input value={secretRef} onChange={(event) => setSecretRef(event.target.value)} spellCheck={false} placeholder="vault:webhooks/bestellungen"/>
        </label>
      </div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("VORSCHAU")}</span><h3>{t("Genau das wird angelegt")}</h3></div><ShieldCheck size={18}/></div>
      {preview.draft
        ? <>
          <pre>{[
            `${t("Name")}: ${preview.draft.name}`,
            `${t("Tabelle")}: ${preview.draft.schema}.${preview.draft.table}`,
            `${t("Ereignisse")}: ${preview.draft.events.join(", ")}`,
            `${t("Ereignistypen")}: ${preview.draft.eventTypes.join(", ")}`,
            `${t("Ziel")}: ${preview.draft.url}`,
            `${t("Signaturgeheimnis")}: ${preview.draft.signingSecretRef}`,
          ].join("\n")}</pre>
          <p className="muted">{t("Ab dem Anlegen erzeugt jede erfasste Änderung dieser Tabelle mit einer dieser Operationen eine signierte Zustellung an dieses Ziel.")}</p>
        </>
        : <p className="muted">{preview.reason || t("Der Entwurf ist noch nicht vollständig.")}</p>}
      <button className="button" onClick={() => void submit()} disabled={!preview.draft || submitting}>
        <StableLabel current={submitting ? t("Wird angelegt…") : t("Datenbank-Webhook anlegen")} variants={tAll("Wird angelegt…", "Datenbank-Webhook anlegen")}/>
      </button>
      {submitMessage && <p className="risk high">{submitMessage}</p>}
      <p className="muted">{t("Das Schema ist fest:")} {DATABASE_WEBHOOK_SCHEMA}</p>
    </article>
  </div>;
}
