"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, ClipboardList, Link2, RefreshCw, Send, Server } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment, formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import {
  BINDING_FIELDS,
  ORDER_FIELDS,
  PROVISIONING_ERROR_TEXTS,
  PROVISIONING_JOB_STATE_TEXTS,
  PROVISIONING_ORDER_STATES,
  PROVISIONING_ORDER_TEXTS,
  provisioningJobState,
} from "@/lib/console/provisioning-order-texts";

/**
 * Einstellungen → Compute und Disk (2.88), nur lesend.
 *
 * Der Platzhalter versprach „Groesse der Instanz und der Platte" und
 * behauptete dazu, die Provisionierung sei „noch nicht verbunden". Beides war
 * falsch. Die Provisionierung ist gebaut, laeuft unter einer eigenen Rolle
 * und hat seit 1.60 eine Route; was es nicht gibt, ist die Groesse, und zwar
 * grundsaetzlich.
 *
 * Nachgesehen in Migration 0020 und im Prozess des Provisionierers: Ein
 * Auftrag traegt zwanzig Spalten, eine Bindung fuenfzehn, und keine davon ist
 * eine Groesse. Die Bestellung, die QKERN hinausschickt, hat sechs Felder.
 * Die Antwort des Vermittlers wird gegen einen geschlossenen Schluesselsatz
 * aus neun Namen geprueft, und ein zehntes Feld macht sie ungueltig. Eine
 * Groesse koennte hier also nicht einmal versehentlich entstehen.
 *
 * Infrastruktur (2.68) sagt schon, dass es keine Instanzgroesse gibt, und
 * zeigt Version, Kodierung und die gemessene Groesse der Datenbank. Das wird
 * hier nicht wiederholt. Diese Seite beantwortet die zwei Fragen davor: was
 * ist bestellt, und was ist gebunden.
 *
 * Die echte Lesung ist der Zustand des Auftrags. Bis jetzt hat keine Ansicht
 * der Console ihn gelesen. Die Bindung selbst ist **nicht** lesbar: Die
 * Laufzeit des Webs hat auf ihre Tabelle kein Leserecht, und die einzige
 * Funktion, die sie zum Auftrag befragen darf, gibt kein Feld der Bindung
 * heraus. Die Seite laesst die Werte also nicht weg, sie bekommt sie nie.
 *
 * Nur lesend: ein GET, kein Schreibverb, kein Eingabefeld, kein Knopf ausser
 * dem zum Neuladen.
 */
type Environment = "development" | "staging" | "production";

/** Genau die Felder, die `publicStatus` herausgibt. Mehr kommt nicht an. */
type Job = {
  jobId: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  retryCycleCount: number;
  maxRetryCycles: number;
  lastErrorCode?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * `noJob` deckt zwei Ursachen ab, weil die Route sie mit Absicht nicht
 * trennt: kein Auftrag, oder keine Berechtigung. Beide antworten 404.
 */
type ViewState = "loading" | "ready" | "noJob" | "unavailable" | "notReady" | "error";

type Payload = Record<string, unknown>;

async function readJson(url: string, signal: AbortSignal): Promise<{ status: number; payload: Payload }> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    const body: unknown = (await response.json().catch(() => ({}))) ?? {};
    const payload = body !== null && typeof body === "object" && !Array.isArray(body) ? body as Payload : {};
    return { status: response.status, payload };
  } catch (cause) {
    if (signal.aborted) return { status: 0, payload: {} };
    return { status: 0, payload: { error: cause instanceof Error ? cause.message : "" } };
  }
}

export function ProvisioningOrderView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const [state, setState] = useState<ViewState>("loading");
  const [job, setJob] = useState<Job | null>(null);
  const [message, setMessage] = useState("");
  // Jede Ladung bekommt einen eigenen AbortController; eine abgebrochene
  // Ladung setzt keinen Zustand mehr.
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState((previous) => (previous === "loading" ? "loading" : previous));
    setMessage("");
    const answer = await readJson(
      `/api/v1/projects/${projectId}/environments/${environment}/provisioning`,
      controller.signal,
    );
    if (controller.signal.aborted) return;

    const data = (answer.payload.data as { provisioning?: Job } | undefined)?.provisioning;
    if (answer.status === 200 && data && typeof data.status === "string" && typeof data.createdAt === "string") {
      setJob(data);
      setState("ready");
      return;
    }
    setJob(null);
    setMessage(typeof answer.payload.error === "string" ? answer.payload.error : "");
    // Vier Antworten, vier verschiedene Auskuenfte. Ein 404 heisst hier
    // absichtlich zweierlei, und der Text sagt beides.
    if (answer.status === 404) setState("noJob");
    else if (answer.status === 503) setState("unavailable");
    else if (answer.status === 409) setState("notReady");
    else setState("error");
  }, [projectId, environment]);

  useEffect(() => {
    void load();
    return () => { request.current?.abort(); };
  }, [load]);

  const loading = state === "loading";
  const reload = <button className="secondary-button" onClick={() => void load()} disabled={loading}>
    <RefreshCw size={14}/> <StableLabel current={loading ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/>
  </button>;

  const jobState = job ? provisioningJobState(job.status) : null;
  const jobText = jobState ? PROVISIONING_JOB_STATE_TEXTS[jobState] : null;
  // Ein Fehlercode, den die Tabelle nicht kennt, kann es nicht geben. Kommt
  // doch einer an, wird er roh gezeigt statt stillschweigend uebersetzt.
  const errorText = job?.lastErrorCode ? PROVISIONING_ERROR_TEXTS[job.lastErrorCode] : undefined;

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t(PROVISIONING_ORDER_TEXTS.kicker)} · {environment.toUpperCase()}</span><h3>{t(PROVISIONING_ORDER_TEXTS.title)}</h3></div><div>{reload}</div></div>
      <p className="risk medium">{t(PROVISIONING_ORDER_TEXTS.noSize)}</p>
      <p className="muted">{t(PROVISIONING_ORDER_TEXTS.closedShape)}</p>
      <p className="muted">{t(PROVISIONING_ORDER_TEXTS.scope)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS BESTELLT WIRD")}</span><h3>{t(PROVISIONING_ORDER_TEXTS.orderTitle)}</h3></div><Send size={18}/></div>
      <p className="muted">{t(PROVISIONING_ORDER_TEXTS.orderMeaning)}</p>
      <div className="log-row log-header"><span>{t("Feld")}</span><span>{t("Bedeutung")}</span></div>
      {ORDER_FIELDS.map((entry) => <div className="log-row" key={entry.field}>
        <code>{entry.field}</code>
        <span className="muted">{t(entry.meaning)}</span>
      </div>)}
      <p className="muted">{t(PROVISIONING_ORDER_TEXTS.orderRegion)}</p>
      <p className="muted">{t(PROVISIONING_ORDER_TEXTS.orderContract)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS ES GIBT")}</span><h3>{t(PROVISIONING_ORDER_TEXTS.jobTitle)}</h3></div><ClipboardList size={18}/></div>
      <p className="muted">{t(PROVISIONING_ORDER_TEXTS.jobMeaning)}</p>

      {loading && <p className="muted">{t("Der Auftrag wird gelesen…")}</p>}
      {state === "noJob" && <p className="muted">{t(PROVISIONING_ORDER_STATES.noJob)}</p>}
      {state === "unavailable" && <p className="muted">{t(PROVISIONING_ORDER_STATES.unavailable)}</p>}
      {state === "notReady" && <p className="risk medium">{t(PROVISIONING_ORDER_STATES.notReady)}</p>}
      {state === "error" && <p className="muted">{t(PROVISIONING_ORDER_STATES.failed)}{message ? ` ${message}` : ""}</p>}

      {job && jobText && <>
        <div className="auth-overview">
          <div><span>{t("ZUSTAND")}</span><strong className={jobText.tone}>{t(jobText.label)}</strong><small>{t(jobText.explains)}</small></div>
          <div><span>{t("VERSUCHE")}</span><strong>{formatNumber(job.attemptCount)} / {formatNumber(job.maxAttempts)}</strong><small>{t("verbrauchte Versuche an der festen Obergrenze")}</small></div>
          <div><span>{t("WIEDERHOLUNGSRUNDEN")}</span><strong>{formatNumber(job.retryCycleCount)} / {formatNumber(job.maxRetryCycles)}</strong><small>{t("von einem Betreiber angestossen, nicht vom Prozess")}</small></div>
          <div><span>{t("ZULETZT BEWEGT")}</span><strong>{formatMoment(job.updatedAt)}</strong><small>{t("angelegt")} {formatMoment(job.createdAt)}</small></div>
        </div>
        {job.lastErrorCode && <p className="risk medium">
          <code>{job.lastErrorCode}</code>{errorText ? ` · ${t(errorText)}` : ""}
        </p>}
        <p className="muted">{t(PROVISIONING_ORDER_TEXTS.jobLimits)}</p>
        <p className="muted">{t(PROVISIONING_ORDER_TEXTS.jobNoHistory)}</p>
      </>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS NICHT HIERHER KOMMT")}</span><h3>{t(PROVISIONING_ORDER_TEXTS.bindingTitle)}</h3></div><Link2 size={18}/></div>
      <p className="muted">{t(PROVISIONING_ORDER_TEXTS.bindingMeaning)}</p>
      <p className="risk medium">{t(PROVISIONING_ORDER_TEXTS.bindingUnreadable)}</p>
      <h4>{t(PROVISIONING_ORDER_TEXTS.bindingFieldsTitle)}</h4>
      <p className="muted">{t(PROVISIONING_ORDER_TEXTS.bindingFieldsMeaning)}</p>
      <div className="log-row log-header"><span>{t("Feld")}</span><span>{t("Bedeutung")}</span></div>
      {BINDING_FIELDS.map((entry) => <div className="log-row" key={entry.field}>
        <code>{entry.field}</code>
        <span className="muted">{t(entry.meaning)}</span>
      </div>)}
      <p className="muted">{t(PROVISIONING_ORDER_TEXTS.bindingFieldsNoValues)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS ES NICHT GIBT")}</span><h3>{t(PROVISIONING_ORDER_TEXTS.noResizeTitle)}</h3></div><Ban size={18}/></div>
      <p className="muted">{t(PROVISIONING_ORDER_TEXTS.noResizeMeaning)}</p>
      <p className="muted">{t(PROVISIONING_ORDER_TEXTS.noResizeStorage)}</p>
      <p className="muted">{t(PROVISIONING_ORDER_TEXTS.noResizeWrite)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("FÜR BETREIBER")}</span><h3>{t(PROVISIONING_ORDER_TEXTS.operatorTitle)}</h3></div><Server size={18}/></div>
      <p className="muted">{t(PROVISIONING_ORDER_TEXTS.operatorSteps)}</p>
      <p className="muted">{t(PROVISIONING_ORDER_TEXTS.operatorCodes)}</p>
      <div className="log-row log-header"><span>{t("Fehlerklasse")}</span><span>{t("Bedeutung")}</span></div>
      {Object.entries(PROVISIONING_ERROR_TEXTS).map(([code, meaning]) => <div className="log-row" key={code}>
        <code>{code}</code>
        <span className="muted">{t(meaning)}</span>
      </div>)}
    </article>
  </div>;
}
