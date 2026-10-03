"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Fingerprint, RefreshCw, ScrollText } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { formatMoment, formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import { TimeZoneNote } from "@/components/console/console-parts";
import {
  AUTH_AUDIT_ACTION_TEXTS,
  AUTH_LOG_ACTOR_TEXTS,
  AUTH_LOG_CANNOT_SHOW,
  AUTH_LOG_HONESTY,
  PROJECT_AUTH_AUDIT_ACTIONS,
  type AuthLogActorId,
  type ProjectAuthAuditActionId,
} from "@/lib/console/auth-observability-texts";

/**
 * Das Protokoll des Anmeldedienstes (2.47): Logs → Auth.
 *
 * Dieselbe Quelle wie Auth → Audit-Log, andere Frage: Dort geht es um die
 * Beweiskette, hier um den Betrieb: was ist zuletzt passiert, und was davon
 * ist gescheitert. Nur lesend, ueber dieselbe Route (`auth/admin/audit`), ein
 * GET, kein Schreibverb.
 *
 * Die Ansicht liest bewusst nur fuenf Felder: Zeit, Handlung, Ausgang, die
 * schon bereinigte Referenz und die Art des Akteurs. Metadaten und
 * Akteursreferenz bleiben draussen; sie enthielten zwar auch keine Adresse,
 * aber was nicht angezeigt wird, kann auch nicht versehentlich etwas zeigen.
 */
type Environment = "development" | "staging" | "production";
type Entry = {
  id: string;
  createdAt: string;
  action: string;
  actorType: string;
  resourceRef: string;
  status: string;
};
type State = "loading" | "ready" | "disabled" | "unavailable" | "error";
type Payload = Record<string, unknown>;

const PAGE_SIZE = 50;
const PROJECT_AUTH_DISABLED_ERROR = "Project Auth is disabled";
const KNOWN_ACTIONS = new Set<string>(PROJECT_AUTH_AUDIT_ACTIONS);

/** GET mit JSON-Antwort; ein Body, der kein Objekt ist, wird zu `{}`. */
async function readJson(url: string, signal: AbortSignal): Promise<{ status: number; payload: Payload }> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    const body: unknown = (await response.json().catch(() => ({}))) ?? {};
    return { status: response.status, payload: body !== null && typeof body === "object" && !Array.isArray(body) ? body as Payload : {} };
  } catch (cause) {
    return { status: 0, payload: { error: cause instanceof Error ? cause.message : "" } };
  }
}

/** Eine Handlung, die diese Fassung nicht kennt, bleibt als sie selbst stehen. */
function actionLabel(action: string): string {
  return KNOWN_ACTIONS.has(action)
    ? t(AUTH_AUDIT_ACTION_TEXTS[action as ProjectAuthAuditActionId])
    : action;
}

function actorLabel(entry: Entry): string {
  const id: AuthLogActorId = entry.actorType === "admin" || entry.actorType === "system" || entry.actorType === "app_user"
    ? entry.actorType
    : "anonymous";
  return t(AUTH_LOG_ACTOR_TEXTS[id]);
}

export function AuthLogView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: State }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/auth/admin/audit`;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [state, setState] = useState<State>(initialState ?? "loading");
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async (initial: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (initial) setState("loading"); else setRefreshing(true);
    const result = await readJson(`${base}?limit=${PAGE_SIZE}`, controller.signal);
    if (controller.signal.aborted) return;
    setRefreshing(false);
    const error = typeof result.payload.error === "string" ? (serverErrorText(result.payload.error) ?? "") : "";
    if (result.status === 503) {
      setEntries([]);
      setState(error === PROJECT_AUTH_DISABLED_ERROR ? "disabled" : "unavailable");
      setMessage(error);
      return;
    }
    const data = result.payload.data as { events?: Entry[] } | undefined;
    if (result.status === 200 && data && Array.isArray(data.events)) {
      setEntries(data.events);
      setMessage("");
      setState("ready");
      return;
    }
    setEntries([]);
    setMessage(error || t("Protokoll nicht verfügbar"));
    setState("error");
  }, [base]);

  useEffect(() => {
    void load(true);
    return () => request.current?.abort();
  }, [load]);

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Protokoll wird geladen…")}</h3></div>;
  }
  if (state === "disabled" || state === "unavailable" || state === "error") {
    return <div className="console-card live-module-state"><Fingerprint size={26}/>
      <h3>{state === "disabled" ? t("Project Auth nicht aktiviert") : state === "unavailable" ? t("Protokoll gerade nicht erreichbar") : t("Protokoll nicht verfügbar")}</h3>
      <p>{state === "disabled" ? t("Ohne Anmeldedienst gibt es kein Protokoll. Diese Seite erfindet keine Einträge.") : message}</p>
      <button className="secondary-button" onClick={() => void load(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  const failed = entries.filter((entry) => entry.status === "failed").length;
  const columns = { gridTemplateColumns: "160px 1.4fr 1fr 110px 1.4fr" };

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("EINTRÄGE")}</span><strong>{formatNumber(entries.length)}</strong><small>{t("die neuesten 50")}</small></div>
      <div><span>{t("FEHLVERSUCHE")}</span><strong>{formatNumber(failed)}</strong><small>{t("unter den geladenen")}</small></div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("LOGS")} · {environment.toUpperCase()}</span><h3>{t("Log des Anmeldedienstes")}</h3></div><div>
        <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
      </div></div>

      <p className="muted">{t(AUTH_LOG_HONESTY)}</p>
      <p className="muted">{t(AUTH_LOG_CANNOT_SHOW)}</p>
      <p className="muted">{t("Gezeigt werden die neuesten 50 Einträge dieses Projekts und dieser Umgebung. Die ganze Kette samt Seitenwechsel steht unter Auth → Audit-Log.")}</p>

      {entries.length === 0 && <div className="live-module-state compact"><ScrollText size={24}/><p>{t("Noch keine Auth-Ereignisse. Registrierungen, Anmeldungen, Fehlversuche und Widerrufe erscheinen hier.")}</p></div>}
      {entries.length > 0 && <div className="log-row log-header" style={columns}>
        <span>{t("Zeit")}</span><span>{t("Handlung")}</span><span>{t("Akteur")}</span><span>{t("Ausgang")}</span><span>{t("Betroffen")}</span>
      </div>}
      {entries.map((entry) => <div className="log-row" key={entry.id} style={columns}>
        <time>{formatMoment(entry.createdAt, "dateTimeSeconds")}</time>
        <span title={entry.action}>{actionLabel(entry.action)}</span>
        <span>{actorLabel(entry)}</span>
        <span className={entry.status === "failed" ? "risk medium" : "secure"}>{entry.status === "failed" ? t("fehlgeschlagen") : t("erfolgreich")}</span>
        <code>{entry.resourceRef}</code>
      </div>)}
      <TimeZoneNote/>
    </article>
  </div>;
}
