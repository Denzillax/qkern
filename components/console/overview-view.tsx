"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Bot, Braces, ChevronRight, Database, HardDrive, Plug, RefreshCw, Rocket, ShieldAlert, Users } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { formatDecimal, formatNumber } from "@/components/console/console-display";
import { formatHourMinute } from "@/components/console/console-format";
import { CopyButton } from "@/components/docs/copy-button";
import type { ViewId } from "@/components/console/navigation";
import type { Snapshot } from "@/lib/console/console-snapshot";
import { HEALTH_STATE_TEXTS, HEALTH_SUBSYSTEMS } from "@/lib/console/health-advisor-texts";
import {
  needsOperatorAction,
  overviewRows,
  projectEmptiness,
  type HealthSubsystemReading,
  type OverviewRow,
  type OverviewTone,
} from "@/lib/console/project-health";
import { QUICK_START_INSTALL, QUICK_START_STEPS, connectSnippet, type QuickStartStepId } from "@/lib/console/quick-start";
import type { Project } from "@/lib/types";

/**
 * Die Uebersicht, aus `console-app.tsx` ausgezogen.
 *
 * 2.136 ordnet sie neu. Oben stehen weiter die vier Zahlen aus dem
 * Projektdatensatz; sie sind heute 0, und die Zeile darunter sagt weiter, wo
 * sie herkommen. Darunter steht neu der Zustand der fuenf Dienste, und zwar
 * aus derselben Lesung, die `advisors/health` fuer die Gesundheitsseite macht.
 *
 * WARUM DIESE SEITE JETZT DOCH ETWAS HOLT
 *
 * Bis hierher stand hier "Sie holt nichts": Kennzahlen, Aktivitaet und
 * Freigaben kommen aus den Requisiten. An die Stelle des Dienststatus hat das
 * eine Karte gesetzt, die "Noch nicht verbunden" sagte und sonst nichts, denn
 * in den Requisiten liegt keine Lesung je Dienst. Entweder bleibt die Zeile
 * leer, oder die Seite fragt die Stelle, die wirklich probt. Sie fragt. Die
 * Kennzahlen und die beiden unteren Karten haengen davon nicht ab und stehen
 * waehrend der Ladung schon da.
 *
 * KEIN GRUEN OHNE MESSUNG
 *
 * Welcher Zustand welchen Ton bekommt, entscheidet `lib/console/project-health`
 * und nicht diese Datei. Gruen gibt es nur fuer `ok`, also nur dort, wo ein
 * Dienst gefragt wurde und geantwortet hat. Liegt fuer einen Dienst keine
 * Lesung vor, steht "nicht verbunden" in Grau. Ein grosser Kasten kommt nur
 * fuer `degraded`, denn nur das heisst: eingerichtet und antwortet nicht.
 *
 * Der Schnellstart erscheint nur, wenn gelesen ist, dass das Projekt leer ist:
 * keine Tabelle, kein Bucket, kein Anmeldeanbieter. Fehlt eine der drei
 * Zahlen, erscheint er nicht, denn dann ist die Frage unbeantwortet.
 */

type State = "loading" | "ready" | "error";

/** Der Tonname aus dem reinen Modul, in die Klassen der Console uebersetzt. */
const TONE_CLASS: Record<OverviewTone, string> = {
  green: "secure",
  amber: "risk medium",
  red: "risk high",
  neutral: "muted",
};

/** Die Beschriftung einer Zustandszeile. Ohne Lesung steht kein Urteil da. */
function stateLabel(row: OverviewRow): string {
  return row.state === null ? t("nicht verbunden") : t(HEALTH_STATE_TEXTS[row.state].label);
}

/**
 * Die Ueberschrift eines Schnellstart-Schritts. Die Zuordnung steht hier und
 * nicht im reinen Modul, weil der Uebersetzungsvertrag nur die `t`-Aufrufe in
 * `components/console` findet.
 */
function stepTitle(id: QuickStartStepId): string {
  if (id === "table") return t("Tabelle anlegen");
  if (id === "auth") return t("Anmeldung einrichten");
  return t("Anwendung verbinden");
}

function stepText(id: QuickStartStepId): string {
  if (id === "table") return t("Im Tabellen-Designer entsteht die erste Tabelle mit Spalten, Primärschlüssel und RLS.");
  if (id === "auth") return t("Ohne Anmeldeverfahren kann sich niemand anmelden. Eines genügt für den Anfang.");
  return t("Die generierte REST-API und die Keys des Projekts stehen unter API.");
}

/**
 * Zwei Nahten fuer die Vertraege, nach dem Muster von 2.65.
 *
 * `initialState` setzt die Ladephase, `initialReadings` die Lesung. Ohne die
 * zweite waere in einem Vertrag nur die Seite ohne Antwort zu sehen, denn
 * `renderToStaticMarkup` fuehrt keinen Effekt aus und holt darum nichts. Die
 * Schale uebergibt beides nicht; in der Console bleibt es bei `loading` und
 * keiner Lesung, bis die Antwort da ist.
 */
export function OverviewView({ snapshot, project, navigate, initialState, initialReadings }: { snapshot: Snapshot; project: Project; navigate: (view: ViewId) => void; initialState?: State; initialReadings?: HealthSubsystemReading[] | null }) {
  const url = `/api/v1/projects/${project.id}/environments/${project.environment}/advisors/health`;
  const [state, setState] = useState<State>(initialState ?? "loading");
  const [subsystems, setSubsystems] = useState<HealthSubsystemReading[] | null>(initialReadings ?? null);
  const [message, setMessage] = useState("");
  // Die Adresse dieser Console kennt erst der Browser. Vor dem ersten Effekt
  // steht im Beispiel darum eine sichtbare Luecke und keine erfundene Adresse.
  const [origin, setOrigin] = useState("");
  const request = useRef<AbortController | null>(null);

  // Jede Ladung hat ihren eigenen AbortController; eine abgebrochene setzt
  // keinen Zustand mehr.
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState("loading");
    setMessage("");
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      const body: unknown = (await response.json().catch(() => null)) ?? null;
      if (controller.signal.aborted) return;
      const data = body !== null && typeof body === "object" ? (body as { data?: { subsystems?: unknown } }).data : undefined;
      if (response.ok && data && Array.isArray(data.subsystems)) {
        setSubsystems(data.subsystems as HealthSubsystemReading[]);
        setState("ready");
        return;
      }
      setSubsystems(null);
      setState("error");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setSubsystems(null);
      setMessage(cause instanceof Error ? cause.message : "");
      setState("error");
    }
  }, [url]);

  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
    return () => request.current?.abort();
  }, [load]);

  const metrics = [
    ["API-ANFRAGEN", formatNumber(project.apiRequests), Braces],
    [t("AKTIVE NUTZER"), formatNumber(project.activeUsers), Users],
    [t("DATENBANK"), `${formatNumber(project.databaseSizeMb)} MB`, Database],
    ["STORAGE", `${formatDecimal(project.storageSizeMb / 1024, 2)} GB`, HardDrive],
  ] as const;

  // Ohne Antwort ist jede Zeile grau. Das ist dieselbe Rechnung wie mit
  // Antwort, nur ohne Lesung, und darum steht hier keine zweite Verzweigung.
  const rows = overviewRows(state === "ready" ? subsystems : null);
  const emptiness = projectEmptiness(state === "ready" ? subsystems : null);
  const broken = needsOperatorAction(rows) ? rows.filter((row) => row.tone === "red") : [];
  const pending = snapshot.approvals.filter((item) => item.status === "pending");
  const events = snapshot.audit.slice(0, 3);
  const snippet = connectSnippet({ baseUrl: origin, projectId: project.id, environment: project.environment });
  const copyLabels = { copy: t("Kopieren"), copied: t("Kopiert") };

  return <>
    <div className="metric-grid">{metrics.map(([label, value, Icon]) => <article className="console-card metric-tile" key={label}><div><span>{label}</span><Icon size={17}/></div><strong>{value}</strong><small>{t("Aus dem Projektdatensatz")}</small></article>)}</div>

    {/* Der grosse Kasten kommt nur fuer einen gestoerten Dienst. Ein nicht
        eingerichteter Dienst steht in seiner Zeile und sonst nirgends. */}
    {broken.length > 0 && <article className="console-card overview-alert">
      <ShieldAlert size={24}/>
      <div>
        <strong>{t("Ein Dienst ist eingerichtet und antwortet nicht")}</strong>
        <p>{broken.map((row) => t(HEALTH_SUBSYSTEMS[row.id].title)).join(", ")}</p>
        <button className="button small" onClick={() => navigate("advisors-health")}>{t("Zur Projekt-Gesundheit")}</button>
      </div>
    </article>}

    <article className="console-card overview-health">
      <div className="card-head">
        <div><span>{t("PROJEKT-ZUSTAND")}</span><h3>{t("Dienste dieser Umgebung")}</h3></div>
        <button className="secondary-button" onClick={() => void load()} disabled={state === "loading"}><RefreshCw size={14}/> {t("Neu prüfen")}</button>
      </div>
      {state === "loading" && <p className="muted">{t("Dienste werden geprüft…")}</p>}
      {state === "error" && <p className="muted">{message || t("Die Probe der Dienste hat nicht geantwortet. Darum steht unten bei jedem Dienst keine Lesung.")}</p>}
      {state !== "loading" && <div className="overview-health-rows">{rows.map((row) => <div className="overview-health-row" key={row.id}>
        <strong>{t(HEALTH_SUBSYSTEMS[row.id].title)}</strong>
        <span className={TONE_CLASS[row.tone]}>{stateLabel(row)}</span>
      </div>)}</div>}
      <p className="muted">{t("Grün heisst: Der Dienst wurde gefragt und hat geantwortet. Grau heisst: Es liegt keine Lesung vor, und dann steht hier auch kein Urteil.")}</p>
      {/* Die Vorschau-Notiz der Schale sagt schon, dass der Metrik-Dienst
          fehlt. Hier steht die Folge daraus als eine ruhige Zeile und nicht
          mehr als Karte ueber die halbe Seite. */}
      <p className="muted">{t("Einen Verlauf über die Zeit und Antwortzeiten je Dienst gibt es erst mit dem Metrik-Dienst. Diese Seite zeigt bis dahin keinen erfundenen Verlauf.")}</p>
      <button className="plain-button" onClick={() => navigate("advisors-health")}>{t("Jede Probe im Einzelnen")}</button>
    </article>

    {/* Der Schnellstart erscheint nur im nachweislich leeren Projekt. */}
    {emptiness.empty && <article className="console-card overview-quickstart">
      <div className="card-head"><div><span>{t("ERSTE SCHRITTE")}</span><h3>{t("Backend aufbauen")}</h3></div><Rocket size={18}/></div>
      <p className="muted">{t("Dieses Projekt hat weder eine Tabelle noch einen Bucket noch ein Anmeldeverfahren. Diese drei Schritte reichen für den Anfang.")}</p>
      <ol className="overview-steps">{QUICK_START_STEPS.map((step, index) => <li key={step.id}>
        <span className="step-number">{formatNumber(index + 1)}</span>
        <div><strong>{stepTitle(step.id)}</strong><small>{stepText(step.id)}</small></div>
        <button className="secondary-button" onClick={() => navigate(step.view)}>{t("Öffnen")}</button>
      </li>)}</ol>
      <div className="overview-connect">
        <h4>{t("Projekt verbinden")}</h4>
        {/* Ohne Adresse gibt es nichts zu kopieren; ein Knopf, der die Zwischenablage leert, waere schlimmer als keiner. */}
        <div className="overview-value"><span>{t("Projekt-URL")}</span><code>{origin || t("wird im Browser gelesen")}</code>{origin !== "" && <CopyButton code={origin} labels={copyLabels}/>}</div>
        <div className="overview-value"><span>{t("Projekt-ID")}</span><code>{project.id}</code><CopyButton code={project.id} labels={copyLabels}/></div>
        <div className="overview-value"><span>{t("Paket")}</span><code>{QUICK_START_INSTALL}</code><CopyButton code={QUICK_START_INSTALL} labels={copyLabels}/></div>
        <pre>{snippet}</pre>
        <CopyButton code={snippet} labels={copyLabels}/>
        <p className="muted">{t("Der Key steht nicht im Beispiel. Die Console speichert ihn nicht und zeigt ihn beim Anlegen genau einmal; das Beispiel liest ihn aus der Umgebung.")}</p>
        <button className="plain-button" onClick={() => navigate("set-api-keys")}>{t("Key anlegen")}</button>
      </div>
    </article>}

    <div className="dashboard-grid lower">
      <article className="console-card"><div className="card-head"><div><span>{t("LETZTE AKTIVITÄT")}</span><h3>{t("Agentenaktionen")}</h3></div><button className="plain-button" onClick={() => navigate("activity")}>{t("Alle anzeigen")}</button></div>
        {events.map((event) => <div className="event-row" key={event.id}><span className="event-icon"><Bot size={14}/></span><div><strong>{event.action}</strong><small>{event.actor} · {event.resource}</small></div><time>{formatHourMinute(event.createdAt)}</time></div>)}
        {/* Leer heisst hier nicht "keine Daten", sondern: was an dieser Stelle
            erscheinen wird, sobald ein Agent etwas tut. */}
        {events.length === 0 && <div className="overview-empty"><Activity size={22}/><p>{t("Sobald ein Agent eine Änderung vorschlägt oder ausführt, stehen die letzten drei Aktionen hier.")}</p><button className="plain-button" onClick={() => navigate("ai")}>{t("AI Bridge öffnen")}</button></div>}
      </article>
      <article className="console-card"><div className="card-head"><div><span>{t("FREIGABEN")}</span><h3>{formatNumber(pending.length)} {t("offen")}</h3></div><button className="plain-button" onClick={() => navigate("approvals")}>{t("Prüfen")}</button></div>
        {snapshot.approvals.slice(0, 2).map((approval) => <div className="approval-mini" key={approval.id}><span className={`risk ${approval.risk}`}>{approval.risk}</span><div><strong>{approval.action}</strong><small>{approval.requestedBy} · {approval.environment}</small></div><ChevronRight size={15}/></div>)}
        {snapshot.approvals.length === 0 && <div className="overview-empty"><Plug size={22}/><p>{t("Hier stehen Änderungen, die auf eine Freigabe warten. Im Moment wartet keine.")}</p><button className="plain-button" onClick={() => navigate("approvals")}>{t("Freigabezentrale öffnen")}</button></div>}
      </article>
    </div>
  </>;
}
