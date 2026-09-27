"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Database, Gauge, Network, RefreshCw, Send } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatNumber, formatPercent } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import { useDatabaseActivity, type Environment } from "@/components/console/database-activity-source";
import {
  connectionLoad,
  connectionStateText,
  hiddenConnections,
  sessionAge,
} from "@/lib/console/database-activity-texts";
import { MISSING_LOG_STATES, POOLER_LOG_TEXTS } from "@/lib/console/missing-log-texts";

/**
 * Logs → Pooler (2.84): die ehrliche Antwort auf einen Platzhalter, der
 * „Warteschlange, abgewiesene Verbindungen, Grenzen" versprochen hat.
 *
 * Es gibt keinen Pooler. Nachgesehen in den Compose-Dateien und im Quelltext:
 * kein PgBouncer, kein Supavisor, kein zweiter Port neben 5432. Jeder Prozess
 * haelt seinen eigenen Pool je Rechtegrenze und verbindet sich direkt. Eine
 * gemeinsame Stelle, die ein Log schreiben koennte, gibt es nicht.
 *
 * Auch die Auslastung des Pools der Anwendung ist **nicht** lesbar, und das ist
 * der Teil, der ueberrascht: Der Treiber kennt offene, freie und wartende
 * Verbindungen, aber QKERN legt den Pool hinter eine Schnittstelle mit genau
 * drei Faehigkeiten (abfragen, verbinden, schliessen). Die Zaehler liegen
 * dahinter und werden nirgends gelesen; `DATABASE_POOL_MAX` erreicht keine
 * Route. Eine Warteschlange auf dieser Seite waere geschaetzt, und geschaetzt
 * wird hier nichts.
 *
 * Gezeigt wird deshalb, was der Server selbst weiss, aus `database/activity`:
 * die Verbindungen aus `pg_stat_activity`, gruppiert nach Rolle und Zustand,
 * der Stand gegen `max_connections`, und aus `database/settings` die vier
 * Grenzen, die ueber eine Abweisung entscheiden. Nach Rolle, nicht nach
 * Prozess: Der Anwendungsname wird ausdruecklich nicht gelesen.
 *
 * Nur lesend: zwei GETs, kein Schreibverb.
 */
type Limits = { maxConnections: number; superuserReserved: number; database: number | null; role: number | null };
type Payload = Record<string, unknown>;

export function PoolerLogView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const { state, activity, message, refreshing, reload } = useDatabaseActivity(projectId, environment);
  const [limits, setLimits] = useState<Limits | null>(null);
  const request = useRef<AbortController | null>(null);

  // Die Grenzen stehen in einer zweiten Route. Ein Fehlschlag dort laesst die
  // Karte weg, statt eine Grenze zu erfinden.
  const loadLimits = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/environments/${environment}/database/settings`, {
        cache: "no-store", signal: controller.signal,
      });
      const body: unknown = (await response.json().catch(() => ({}))) ?? {};
      if (controller.signal.aborted) return;
      const payload: Payload = body !== null && typeof body === "object" && !Array.isArray(body) ? body as Payload : {};
      const data = payload.data as { limits?: Limits } | undefined;
      setLimits(response.status === 200 && data?.limits ? data.limits : null);
    } catch {
      if (!controller.signal.aborted) setLimits(null);
    }
  }, [projectId, environment]);

  useEffect(() => {
    void loadLimits();
    return () => request.current?.abort();
  }, [loadLimits]);

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Pooler-Seite wird geladen…")}</h3></div>;
  }

  const database = activity?.database ?? null;
  const groups = activity?.connections ?? [];
  const counted = groups.reduce((sum, group) => sum + group.count, 0);
  const load = database ? connectionLoad(database.backends, database.maxConnections) : null;
  const hidden = database ? hiddenConnections(database.backends, counted) : 0;
  const unlimited = t("ohne Grenze");

  const reloadAll = () => { reload(false); void loadLimits(); };

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t(POOLER_LOG_TEXTS.kicker)} · {environment.toUpperCase()}</span><h3>{t(POOLER_LOG_TEXTS.title)}</h3></div><div>
        <button className="secondary-button" onClick={reloadAll} disabled={refreshing}>
          <RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/>
        </button>
      </div></div>
      <p className="risk medium">{t(POOLER_LOG_TEXTS.noPooler)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS ES NICHT GIBT")}</span><h3>{t(POOLER_LOG_TEXTS.appPoolTitle)}</h3></div><Gauge size={18}/></div>
      <p className="muted">{t(POOLER_LOG_TEXTS.appPoolMeaning)}</p>
      <p className="risk medium">{t(POOLER_LOG_TEXTS.appPoolWhyNot)}</p>
      <p className="muted">{t(POOLER_LOG_TEXTS.appPoolNoQueueLog)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS ES GIBT")}</span><h3>{t(POOLER_LOG_TEXTS.connectionsTitle)}</h3></div><Network size={18}/></div>
      <p className="muted">{t(POOLER_LOG_TEXTS.connectionsMeaning)}</p>
      <p className="risk medium">{t(POOLER_LOG_TEXTS.connectionsLimit)}</p>

      {state === "disabled" && <p className="muted">{t("Die Data Plane ist für diese Umgebung abgeschaltet. Ohne sie gibt es keine Datenbank, die über ihre Verbindungen berichten könnte.")}</p>}
      {state === "unavailable" && <p className="muted">{t(MISSING_LOG_STATES.databaseUnavailable)}</p>}
      {state === "error" && <p className="muted">{message || t(MISSING_LOG_STATES.databaseUnavailable)}</p>}

      {database && <>
        <div className="auth-overview">
          <div><span>{t("OFFENE VERBINDUNGEN")}</span><strong>{formatNumber(database.backends)}</strong><small>{t("was der Server selbst meldet")}</small></div>
          <div><span>{t("GRENZE")}</span><strong>{formatNumber(database.maxConnections)}</strong><small>{t("max_connections, für den ganzen Cluster")}</small></div>
          <div><span>{t("AUSLASTUNG")}</span><strong>{load === null ? t("nicht zu rechnen") : formatPercent(load)}</strong><small>{t("offene Verbindungen an der Grenze")}</small></div>
          <div><span>{t("FÜR DIESE ROLLE UNSICHTBAR")}</span><strong>{formatNumber(hidden)}</strong><small>{t("gezählt, aber nicht zuzuordnen; die lesende Rolle sieht nicht jede Sitzung")}</small></div>
        </div>
        {activity?.truncated && <p className="risk medium">{t("Die Antwort wurde an der Gruppengrenze abgeschnitten; es gibt mehr Gruppen als hier stehen.")}</p>}

        {groups.length === 0
          ? <p className="muted">{t("Keine Verbindungsgruppe sichtbar. Das heisst nicht, dass niemand verbunden ist, sondern dass die lesende Rolle keine Sitzung sehen darf.")}</p>
          : <>
            <div className="log-row log-header"><span>{t("Rolle")}</span><span>{t("Zustand")}</span><span>{t("Anzahl")}</span><span>{t("Älteste Sitzung")}</span></div>
            {groups.map((group) => {
              const age = sessionAge(group.oldestSeconds);
              return <div className="log-row" key={`${group.role}:${group.state}`}>
                <code>{group.role}</code>
                <span>{t(connectionStateText(group.state).label)}</span>
                <span>{formatNumber(group.count)}</span>
                <span className="muted">{formatNumber(age.value)} {t(age.unit)}</span>
              </div>;
            })}
          </>}
        <p className="muted">{t(POOLER_LOG_TEXTS.connectionsNoHistory)}</p>
      </>}
    </article>

    {limits && <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS ES GIBT")}</span><h3>{t(POOLER_LOG_TEXTS.limitsTitle)}</h3></div><Database size={18}/></div>
      <p className="muted">{t(POOLER_LOG_TEXTS.limitsMeaning)}</p>
      <div className="log-row"><span>max_connections</span><code>{formatNumber(limits.maxConnections)}</code></div>
      <div className="log-row"><span>superuser_reserved_connections</span><code>{formatNumber(limits.superuserReserved)}</code></div>
      <div className="log-row"><span>{t("Grenze dieser Datenbank")}</span><code>{limits.database === null ? unlimited : formatNumber(limits.database)}</code></div>
      <div className="log-row"><span>{t("Grenze der lesenden Rolle")}</span><code>{limits.role === null ? unlimited : formatNumber(limits.role)}</code></div>
    </article>}

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("FÜR BETREIBER")}</span><h3>{t(POOLER_LOG_TEXTS.operatorTitle)}</h3></div><Send size={18}/></div>
      <p className="muted">{t(POOLER_LOG_TEXTS.operatorSteps)}</p>
      <p className="muted">{t(POOLER_LOG_TEXTS.operatorDrain)}</p>
    </article>
  </div>;
}
