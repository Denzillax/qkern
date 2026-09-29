"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, RefreshCw, ShieldAlert, Stethoscope } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import {
  HEALTH_STATES,
  HEALTH_STATE_TEXTS,
  HEALTH_SUBSYSTEMS,
  type HealthState,
  type HealthSubsystemId,
} from "@/lib/console/health-advisor-texts";

/**
 * Die Projekt-Gesundheit (2.44), wie bei Supabase unter Advisors → Health,
 * aber nur lesend: kein Neustart, kein Einschalten, keine Reparatur.
 *
 * Die Route probt auf dem Server, was QKERN ohnehin lesen darf, und liefert je
 * Teil einen Zustand, einen Satz und den Beleg. Die Ansicht zeigt das Urteil
 * oben, die Teile darunter und sagt bei jedem Teil, dessen Probe nicht lief,
 * warum sie nicht lief. Texte kommen deutsch vom Server und laufen durch den
 * Katalog.
 */
type Environment = "development" | "staging" | "production";
type Evidence = { measure: string; label: string; count: number | null };
type Subsystem = { id: HealthSubsystemId; state: HealthState; detail: string; evidence: Evidence[] };
type State = "loading" | "ready" | "error";
type Payload = Record<string, unknown>;

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

function stateLabel(state: HealthState): string {
  const text = HEALTH_STATE_TEXTS[state];
  return text ? t(text.label) : state;
}

function stateTone(state: HealthState): string {
  const text = HEALTH_STATE_TEXTS[state];
  return text ? text.tone : "muted";
}

function subsystemTitle(id: HealthSubsystemId): string {
  const text = HEALTH_SUBSYSTEMS[id];
  return text ? t(text.title) : id;
}

export function HealthAdvisorView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: State }) {
  const url = `/api/v1/projects/${projectId}/environments/${environment}/advisors/health`;
  const [state, setState] = useState<State>(initialState ?? "loading");
  const [overall, setOverall] = useState<HealthState>("unknown");
  const [counts, setCounts] = useState<Partial<Record<HealthState, number>>>({});
  const [subsystems, setSubsystems] = useState<Subsystem[]>([]);
  const [checkedAt, setCheckedAt] = useState("");
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null);

  // Jede Ladung hat einen eigenen AbortController; eine abgebrochene setzt keinen Zustand mehr.
  const load = useCallback(async (initial: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (initial) setState("loading"); else setRefreshing(true);
    const result = await readJson(url, controller.signal);
    if (controller.signal.aborted) return;
    setRefreshing(false);
    const data = result.payload.data as
      { overall?: unknown; counts?: unknown; subsystems?: unknown; checkedAt?: unknown } | undefined;
    if (result.status === 200 && data && Array.isArray(data.subsystems) && typeof data.overall === "string") {
      setOverall(data.overall as HealthState);
      setCounts((data.counts ?? {}) as Partial<Record<HealthState, number>>);
      setSubsystems(data.subsystems as Subsystem[]);
      setCheckedAt(typeof data.checkedAt === "string" ? data.checkedAt : "");
      setState("ready");
      return;
    }
    setMessage(typeof result.payload.error === "string" && result.payload.error ? result.payload.error : t("Projekt-Gesundheit nicht verfügbar"));
    setState("error");
  }, [url]);

  useEffect(() => {
    void load(true);
    return () => request.current?.abort();
  }, [load]);

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Dienste werden geprüft…")}</h3></div>;
  if (state === "error") return <div className="console-card live-module-state"><ShieldAlert size={26}/><h3>{t("Projekt-Gesundheit nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const unchecked = subsystems.filter((item) => item.state === "unknown");

  return <div className="module-grid">
    <article className="console-card auth-overview">
      {HEALTH_STATES.map((item) => <div key={item}>
        <span>{stateLabel(item).toUpperCase()}</span><strong>{counts[item] ?? 0}</strong><small>{t("Dienste")}</small>
      </div>)}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("ADVISORS")} · {environment.toUpperCase()}</span><h3>{t("Gesamturteil")}</h3></div><div>
        <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Prüft…") : t("Neu prüfen")} variants={tAll("Prüft…", "Neu prüfen")}/></button>
      </div></div>
      <p><span className={stateTone(overall)}>{stateLabel(overall)}</span> — {t(HEALTH_STATE_TEXTS[overall]?.explains ?? "")}</p>
      <p className="muted">{t("Das Gesamturteil ist der schlechteste Zustand, den ein Teil trägt. Ein abgeschalteter Dienst zieht es darum weiter herunter als ein erreichbarer, aber weniger als ein gestörter.")}</p>
      <p className="muted">{t("Gesund heisst hier: erreichbar und eingerichtet. Ob deine Anwendung funktioniert, sagt diese Seite nicht.")}</p>
      <p className="muted">{t("Erreichbar heisst: Der Dienst wurde gefragt und hat geantwortet. Eingerichtet heisst: Es ist eine Adresse oder eine Anbindung hinterlegt, gefragt wurde niemand. Realtime und Vault tragen nie mehr als das.")}</p>
      {checkedAt && <p className="muted">{t("Geprüft")}: {formatMoment(checkedAt, "dateTimeSeconds")}</p>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NUR LESEND")}</span><h3>{t("Dienste dieser Umgebung")}</h3></div><Activity size={18}/></div>
      <div className="log-row log-header"><span>{t("Dienst")}</span><span>{t("Zustand")}</span></div>
      {subsystems.length === 0 && <p className="muted">{t("Keine Probe hat ein Ergebnis geliefert")}</p>}
      {subsystems.map((item) => <div className="log-row" key={item.id}>
        <div>
          <strong>{subsystemTitle(item.id)}</strong> <code>{item.id}</code>
          <p>{t(item.detail)}</p>
          <p className="muted">{item.evidence.map((entry) => entry.count === null ? t(entry.label) : `${entry.count} ${t(entry.label)}`).join(" · ")}</p>
          {HEALTH_SUBSYSTEMS[item.id] && <p className="muted">{t(HEALTH_SUBSYSTEMS[item.id].probes)}</p>}
        </div>
        <span className={stateTone(item.state)}>{stateLabel(item.state)}</span>
      </div>)}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("OFFEN")}</span><h3>{t("Was nicht geprüft werden konnte")}</h3></div><Stethoscope size={18}/></div>
      {unchecked.length === 0 && <p className="muted">{t("Jede Probe dieser Seite konnte laufen.")}</p>}
      {unchecked.map((item) => <div className="log-row" key={item.id}>
        <div><strong>{subsystemTitle(item.id)}</strong><p className="muted">{t(item.detail)}</p></div>
        <span className="risk medium">{t("nicht geprüft")}</span>
      </div>)}
      <p className="muted">{t("Diese Seite fragt nur, ob ein Dienst antwortet und eingerichtet ist. Sie misst keine Antwortzeit, sie ruft keine Function auf, sie baut keine Realtime-Verbindung auf und sie liest kein Secret.")}</p>
    </article>
  </div>;
}
