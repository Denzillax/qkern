"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, EyeOff, Plug, RefreshCw, Wrench } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import { HEALTH_STATE_TEXTS, type HealthState } from "@/lib/console/health-advisor-texts";
import {
  INTEGRATIONS_INVISIBLE,
  INTEGRATIONS_MISSING,
  INTEGRATIONS_STATES,
  INTEGRATIONS_TEXTS,
  INTEGRATION_SERVICES,
  INTEGRATION_SERVICE_IDS,
  type IntegrationServiceId,
} from "@/lib/console/integrations-services-texts";

/**
 * Einstellungen → Integrationen (2.88), nur lesend.
 *
 * Der Platzhalter versprach „verknuepfte Dienste wie Git-Hosting oder
 * Deploy-Plattformen". Git-Hosting und Deploy-Plattformen gibt es nicht, und
 * das ist nachgesehen: Im ganzen Baum spricht kein Modul mit GitHub, GitLab,
 * Bitbucket, Vercel, Netlify oder Fly. Die Treffer, die die Suche findet,
 * stehen in der CI des Projekts selbst und in einem Testnamen.
 *
 * Verknuepfte Dienste gibt es trotzdem, nur andere: ein Geheimnisspeicher,
 * ein Objektspeicher, ein Mailserver, fremde Anmeldedienste, fremde
 * Tokenaussteller, Webhook-Ziele und Log-Ziele. Das **ist** die versprochene
 * Liste, und diese Seite zeigt sie.
 *
 * Gelesen wird ausschliesslich aus Routen, die es schon gibt, und je Dienst
 * nur so viel, wie fuer ein Ja oder Nein noetig ist: aus der Gesundheit der
 * Zustand von Geheimnis- und Objektspeicher, aus der Mail-Auskunft die
 * Betriebsart und ein abgeleitetes Ja, aus den drei Listen je eine Anzahl.
 *
 * **Kein Wert verlaesst diese Seite.** Kein Host, kein Port, keine Adresse,
 * kein Benutzername, kein Token, kein Schluessel, kein Name eines Anbieters.
 * Wo gezaehlt wird, steht eine Anzahl und sonst nichts. Die Zustaende und
 * ihre Bedeutung kommen aus `health-advisor-texts`, damit „eingerichtet" hier
 * dasselbe heisst wie unter Advisors → Gesundheit: hinterlegt, niemand
 * gefragt.
 *
 * Nur lesend: sechs GETs, kein Schreibverb, kein Eingabefeld.
 */
type Environment = "development" | "staging" | "production";
type Payload = Record<string, unknown>;

/**
 * Die Zustaende sind genau die des Gesundheitsberaters, ohne einen eigenen
 * daneben. Die drei Dienste, ueber die es nichts zu lesen gibt, stehen weiter
 * unten in einem eigenen Abschnitt und bekommen gar keinen Zustand, statt
 * einen erfundenen.
 */
type ServiceReading = {
  state: HealthState;
  /** Eine Anzahl, wenn es eine gibt. Nie ein Name und nie ein Wert. */
  count: number | null;
  /** Wahr, wenn die Route nicht geantwortet hat oder nichts sagen durfte. */
  unreadable: boolean;
};

const UNREADABLE: ServiceReading = { state: "unknown", count: null, unreadable: true };

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

/** Ein Zaehler wird zu einem Zustand: mehr als nichts heisst eingerichtet. */
function fromCount(count: number): ServiceReading {
  return { state: count > 0 ? "configured" : "unconfigured", count, unreadable: false };
}

/**
 * Eine Liste hinter `data`, mit ihrer Laenge. Eine abgeschaltete
 * Compute-Flaeche meldet sich mit einem eigenen Satz und ist kein Defekt.
 */
function fromList(answer: { status: number; payload: Payload }): ServiceReading {
  if (answer.status === 503 && answer.payload.error === "Compute definitions are disabled") {
    return { state: "off", count: null, unreadable: false };
  }
  const data = answer.payload.data;
  if (answer.status !== 200 || !Array.isArray(data)) return UNREADABLE;
  return fromCount(data.length);
}

export function IntegrationsServicesView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const [readings, setReadings] = useState<Record<IntegrationServiceId, ServiceReading> | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    const base = `/api/v1/projects/${projectId}/environments/${environment}`;
    const [health, mail, oidc, thirdParty, webhooks, drains] = await Promise.all([
      readJson(`${base}/advisors/health`, controller.signal),
      readJson(`${base}/auth/admin/mail`, controller.signal),
      readJson(`${base}/auth/admin/providers`, controller.signal),
      readJson(`${base}/auth/admin/third-party`, controller.signal),
      readJson(`${base}/compute/webhooks`, controller.signal),
      readJson(`${base}/compute/log-drains`, controller.signal),
    ]);
    if (controller.signal.aborted) return;
    setLoading(false);

    // Geheimnis- und Objektspeicher stehen schon im Gesundheitsbericht, mit
    // genau der Bedeutung, die diese Seite braucht. Sie noch einmal selbst zu
    // proben hiesse, zweimal dasselbe und vielleicht verschieden zu sagen.
    const subsystems = (health.payload.data as { subsystems?: unknown } | undefined)?.subsystems;
    const subsystem = (id: string): ServiceReading => {
      if (health.status !== 200 || !Array.isArray(subsystems)) return UNREADABLE;
      const found = (subsystems as Array<{ id?: unknown; state?: unknown }>).find((entry) => entry.id === id);
      return found && typeof found.state === "string"
        ? { state: found.state as HealthState, count: null, unreadable: false }
        : UNREADABLE;
    };

    // Die Mail-Auskunft traegt Werte (Host, Absender). Gelesen werden hier
    // ausschliesslich die Betriebsart und das abgeleitete Ja der Anmeldung.
    const mailData = mail.payload.data as { mode?: unknown } | undefined;
    const mailMode = mail.status === 200 && typeof mailData?.mode === "string" ? mailData.mode : null;
    const smtp: ServiceReading = mailMode === null
      ? UNREADABLE
      : mailMode === "smtp"
        ? { state: "configured", count: null, unreadable: false }
        : mailMode === "development_noop"
          ? { state: "off", count: null, unreadable: false }
          : { state: "unconfigured", count: null, unreadable: false };

    const oidcList = oidc.payload.data;
    const thirdPartyData = thirdParty.payload.data as { providers?: unknown } | undefined;

    setReadings({
      vault: subsystem("vault"),
      storage: subsystem("storage"),
      smtp,
      oidc: oidc.status === 200 && Array.isArray(oidcList) ? fromCount(oidcList.length) : UNREADABLE,
      third_party: thirdParty.status === 200 && Array.isArray(thirdPartyData?.providers)
        ? fromCount((thirdPartyData!.providers as unknown[]).length)
        : UNREADABLE,
      webhooks: fromList(webhooks),
      log_drains: fromList(drains),
    });
  }, [projectId, environment]);

  useEffect(() => {
    void load();
    return () => { request.current?.abort(); };
  }, [load]);

  const reload = <button className="secondary-button" onClick={() => void load()} disabled={loading}>
    <RefreshCw size={14}/> <StableLabel current={loading ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/>
  </button>;

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t(INTEGRATIONS_TEXTS.kicker)} · {environment.toUpperCase()}</span><h3>{t(INTEGRATIONS_TEXTS.title)}</h3></div><div>{reload}</div></div>
      <p className="risk medium">{t(INTEGRATIONS_TEXTS.noGitNoDeploy)}</p>
      <p className="muted">{t(INTEGRATIONS_TEXTS.noValues)}</p>
      <p className="muted">{t(INTEGRATIONS_TEXTS.whatConfiguredMeans)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS VERKNÜPFT IST")}</span><h3>{t(INTEGRATIONS_TEXTS.servicesTitle)}</h3></div><Plug size={18}/></div>
      <p className="muted">{t(INTEGRATIONS_TEXTS.servicesMeaning)}</p>

      {loading && !readings && <p className="muted">{t(INTEGRATIONS_STATES.loading)}</p>}

      {readings && INTEGRATION_SERVICE_IDS.map((id) => {
        const service = INTEGRATION_SERVICES[id];
        const reading = readings[id];
        const stateText = HEALTH_STATE_TEXTS[reading.state];
        return <article className="console-card span-2" key={id}>
          <div className="card-head">
            <div><span>{t(service.managedAt)}</span><h4>{t(service.label)}</h4></div>
            <div>
              {reading.count !== null && <span className="muted">{formatNumber(reading.count)} {t(INTEGRATIONS_STATES.serviceCount)} · </span>}
              <span className={stateText.tone}>{t(stateText.label)}</span>
            </div>
          </div>
          <p>{t(service.purpose)}</p>
          {reading.unreadable
            ? <p className="muted">{t(INTEGRATIONS_STATES.notReadable)}</p>
            : <p className="muted">{t(stateText.explains)}</p>}
          <p className="muted">{t(service.evidence)}</p>
          <p className="risk medium">{t(service.limit)}</p>
        </article>;
      })}

      <p className="muted">{t(INTEGRATIONS_TEXTS.servicesWhereToChange)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("OHNE AUSKUNFT")}</span><h3>{t(INTEGRATIONS_TEXTS.invisibleTitle)}</h3></div><EyeOff size={18}/></div>
      <p className="muted">{t(INTEGRATIONS_TEXTS.invisibleMeaning)}</p>
      {INTEGRATIONS_INVISIBLE.map((entry) => <div className="bucket-row" key={entry.title}>
        <span className="bucket-icon"><EyeOff size={16}/></span>
        <div><strong>{t(entry.title)}</strong><p className="muted">{t(entry.body)}</p></div>
      </div>)}
      <p className="muted">{t(INTEGRATIONS_TEXTS.invisibleWhyNoProbe)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS ES NICHT GIBT")}</span><h3>{t(INTEGRATIONS_TEXTS.missingTitle)}</h3></div><Ban size={18}/></div>
      <p className="muted">{t(INTEGRATIONS_TEXTS.missingMeaning)}</p>
      {INTEGRATIONS_MISSING.map((entry) => <div className="bucket-row" key={entry.title}>
        <span className="bucket-icon"><Ban size={16}/></span>
        <div><strong>{t(entry.title)}</strong><p className="muted">{t(entry.body)}</p></div>
      </div>)}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("FÜR BETREIBER")}</span><h3>{t(INTEGRATIONS_TEXTS.operatorTitle)}</h3></div><Wrench size={18}/></div>
      <p className="muted">{t(INTEGRATIONS_TEXTS.operatorSteps)}</p>
      <p className="muted">{t(INTEGRATIONS_TEXTS.operatorNoTest)}</p>
    </article>
  </div>;
}
