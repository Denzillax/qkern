"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Database, GitBranch, Radio, RefreshCw, Satellite, Waypoints } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatNumber } from "@/components/console/console-display";
import { formatBytes } from "@/components/console/console-format";
import { StableLabel } from "@/components/stable-label";
import {
  CREATE_STEPS,
  LAG_NOTE,
  MISSING_REPLICATION_SURFACE,
  PUBLICATION_SOURCE_NOTE,
  READ_ONLY_NOTE,
  REALTIME_NOTE,
  RECOVERY_NOTE,
  SAFE_SIZE_NOTE,
  SCOPE_NOTE,
  SLOT_SOURCE_NOTE,
  SLOT_STATE_TEXTS,
  SUBSCRIPTION_SOURCE_NOTE,
  WAL_LEVEL_TEXTS,
  slotState,
} from "@/lib/console/replication-texts";

/**
 * Datenbank -> Replikation (2.74), nur lesend.
 *
 * Der Platzhalter versprach „Daten in externe Ziele replizieren". Das
 * Einrichten gibt es hier nicht, das Lesen schon: welche Publikationen es gibt,
 * welche Abonnements diese Datenbank hält, welche Slots WAL festhalten und wie
 * viel, und ob der Server überhaupt so eingestellt ist, dass davon etwas
 * möglich wäre.
 *
 * Die Zahl dieser Seite ist der Rückstand eines Slots. Ein verlassener Slot
 * hält WAL fest, bis die Platte voll ist, und das steht hier nicht im
 * Kleingedruckten, sondern neben der Zahl.
 *
 * Kein Eingabefeld, kein Speicherknopf, kein Schreibaufruf.
 */
type Environment = "development" | "staging" | "production";

type Publication = {
  name: string; owner: string; publishInsert: boolean; publishUpdate: boolean;
  publishDelete: boolean; publishTruncate: boolean; allTables: boolean; tables: string[];
};
type Subscription = { name: string; owner: string; enabled: boolean; slotName: string | null; publications: string[] };
/** `retainedBytes: null` heisst: keine Position reserviert, also nichts festgehalten. */
type Slot = {
  name: string; slotType: "physical" | "logical"; plugin: string | null; database: string | null;
  temporary: boolean; active: boolean;
  walStatus: "reserved" | "extended" | "unreserved" | "lost" | null;
  retainedBytes: number | null; safeBytes: number | null;
};

type Replication = {
  walLevel: "minimal" | "replica" | "logical";
  inRecovery: boolean;
  publications: Publication[];
  subscriptions: Subscription[];
  slots: Slot[];
  truncated: boolean;
};

/** `disabled` heisst: Die Data Plane ist abgeschaltet. Das ist kein Fehler, sondern eine Entscheidung. */
type ViewState = "loading" | "ready" | "disabled" | "unavailable" | "error";

/** Bytes lesbar, ohne eine Genauigkeit vorzutäuschen, die die Messung nicht hat. */
export function ReplicationView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: ViewState }) {
  const [data, setData] = useState<Replication | null>(null);
  const [state, setState] = useState<ViewState>(initialState ?? "loading");
  const [message, setMessage] = useState("");
  // Jede Ladung bekommt einen eigenen AbortController; eine abgebrochene
  // Ladung setzt keinen Zustand mehr.
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState((previous) => (previous === "ready" ? "ready" : "loading"));
    setMessage("");
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/environments/${environment}/schema/replication`,
        { cache: "no-store", signal: controller.signal },
      );
      const body: unknown = (await response.json().catch(() => ({}))) ?? {};
      const payload = body !== null && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
      if (controller.signal.aborted) return;
      const answer = payload.data as Replication | undefined;
      if (response.status === 200 && answer && Array.isArray(answer.slots) && typeof answer.walLevel === "string") {
        setData(answer);
        setState("ready");
        return;
      }
      setData(null);
      setMessage(typeof payload.error === "string" ? payload.error : "");
      // Abgeschaltet, nicht bereit und nicht erreichbar sind drei
      // verschiedene Auskuenfte, und keine davon ist ein Fehler dieser Seite.
      const code = typeof payload.code === "string" ? payload.code : "";
      if (code === "DATA_PLANE_DISABLED") setState("disabled");
      else if (response.status === 503 || response.status === 409) setState("unavailable");
      else setState("error");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setData(null);
      setState("error");
      setMessage(cause instanceof Error ? cause.message : "");
    }
  }, [projectId, environment]);

  useEffect(() => {
    void load();
    return () => { request.current?.abort(); };
  }, [load]);

  const loading = state === "loading";
  const refresh = <button className="secondary-button" onClick={() => void load()} disabled={loading}>
    <RefreshCw size={14}/> <StableLabel current={loading ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/>
  </button>;

  const publications = data?.publications ?? [];
  const subscriptions = data?.subscriptions ?? [];
  const slots = data?.slots ?? [];
  const walLevel = data ? WAL_LEVEL_TEXTS[data.walLevel] : null;
  // Die Summe steht nur ueber Slots, die wirklich eine Position halten. Ein
  // Slot ohne Position traegt nichts bei, und null ist nicht null Bytes.
  const retained = slots.reduce((sum, slot) => sum + (slot.retainedBytes ?? 0), 0);
  const holding = slots.filter((slot) => slot.retainedBytes !== null).length;

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("DATENBANK")} · {environment.toUpperCase()}</span><h3>{t("Replikation")}</h3></div><div>{refresh}</div></div>
      <p className="muted">{t(SCOPE_NOTE)}</p>
      {loading && !data && <p className="muted">{t("Der Katalog wird gelesen…")}</p>}
      {state === "disabled" && <p><strong>{t("Data Plane abgeschaltet")}</strong> · {t("Diese Installation liest keine Projektdatenbank. Ohne sie gibt es keinen Katalog, in dem ein Slot stünde.")}</p>}
      {state === "unavailable" && <p><strong>{t("Datenbank nicht bereit")}</strong> · {message || t("Die Projektdatenbank ist noch nicht bereit.")}</p>}
      {state === "error" && <p><strong>{t("Replikation nicht verfügbar")}</strong> · {message}</p>}
      {data?.truncated && <p className="muted">{t("Eine der drei Listen wurde an ihrer Grenze abgeschnitten; es gibt mehr, als hier steht.")}</p>}
      <p className="muted">{t(READ_ONLY_NOTE)}</p>
    </article>

    {data && <article className="console-card auth-overview">
      <div><span>{t("PUBLIKATIONEN")}</span><strong>{formatNumber(publications.length)}</strong><small>{t("in dieser Datenbank")}</small></div>
      <div><span>{t("ABONNEMENTS")}</span><strong>{formatNumber(subscriptions.length)}</strong><small>{t("holen von aussen")}</small></div>
      <div><span>{t("SLOTS")}</span><strong>{formatNumber(slots.length)}</strong><small>{t("angelegt")}</small></div>
      <div><span>{t("RÜCKSTAND")}</span><strong>{formatBytes(retained)}</strong><small>{holding === slots.length ? t("festgehaltenes WAL") : t("über die Slots mit Position")}</small></div>
    </article>}

    {data && <article className="console-card span-2">
      <div className="card-head"><div><span>{t("SLOTS")}</span><h3>{t("Was WAL festhält")}</h3></div><Waypoints size={18}/></div>
      <p className="muted">{t(LAG_NOTE)}</p>
      {slots.length === 0 && <p className="muted">{t("Kein Replikations-Slot. Dann hält auch keiner WAL fest.")}</p>}
      {slots.map((slot) => {
        const judgement = SLOT_STATE_TEXTS[slotState(slot)];
        return <div className="bucket-row" key={slot.name}>
          <span className="bucket-icon"><Waypoints size={16}/></span>
          <div>
            <strong>{slot.name}</strong>
            <small>
              {slot.slotType === "logical" ? t("logisch") : t("physisch")}
              {slot.plugin ? <> · {t("Plugin")} <code>{slot.plugin}</code></> : ""}
              {slot.database ? ` · ${t("Datenbank")} ${slot.database}` : ""}
              {slot.temporary ? ` · ${t("temporär")}` : ""}
              {` · ${slot.active ? t("Konsument hängt daran") : t("kein Konsument")}`}
            </small>
            <div className="log-row">
              <span>{t("Rückstand")}</span>
              <span>{slot.retainedBytes === null ? t("keine Position reserviert") : formatBytes(slot.retainedBytes)}</span>
            </div>
            <div className="log-row">
              <span>{t("Restfrist")}</span>
              <span>{slot.safeBytes === null ? t("keine Grenze gesetzt") : formatBytes(slot.safeBytes)}</span>
            </div>
            <p className="muted">{t(judgement.explains)}</p>
          </div>
          <span className={judgement.tone}>{t(judgement.label)}</span>
        </div>;
      })}
      <p className="muted">{t(SAFE_SIZE_NOTE)}</p>
      <p className="muted">{t(SLOT_SOURCE_NOTE)}</p>
    </article>}

    {data && <article className="console-card">
      <div className="card-head"><div><span>{t("EINSTELLUNG")}</span><h3>{t("Was dieser Server erlaubt")}</h3></div><Database size={18}/></div>
      {walLevel && <div className="bucket-row">
        <span className="bucket-icon"><Database size={16}/></span>
        <div>
          <strong><code>wal_level = {data.walLevel}</code></strong>
          <p className="muted">{t(walLevel.explains)}</p>
        </div>
        <span className={walLevel.tone}>{t(walLevel.label)}</span>
      </div>}
      <div className="bucket-row">
        <span className="bucket-icon"><GitBranch size={16}/></span>
        <div>
          <strong>{data.inRecovery ? t("Wiederherstellung läuft") : t("keine Wiederherstellung")}</strong>
          <small><code>pg_is_in_recovery()</code></small>
        </div>
        <span className={data.inRecovery ? "risk medium" : "secure"}>{data.inRecovery ? t("Standby") : t("Primär")}</span>
      </div>
      <p className="muted">{t(RECOVERY_NOTE)}</p>
    </article>}

    {data && <article className="console-card">
      <div className="card-head"><div><span>{t("ABONNEMENTS")}</span><h3>{t("Was diese Datenbank holt")}</h3></div><Satellite size={18}/></div>
      {subscriptions.length === 0 && <p className="muted">{t("Diese Datenbank hält kein Abonnement. Sie holt von keinem anderen Server Änderungen.")}</p>}
      {subscriptions.map((subscription) => <div className="bucket-row" key={subscription.name}>
        <span className="bucket-icon"><Satellite size={16}/></span>
        <div>
          <strong>{subscription.name}</strong>
          <small>
            {t("Eigentümer")} {subscription.owner}
            {subscription.slotName ? ` · ${t("Slot drüben")} ${subscription.slotName}` : ` · ${t("ohne Slot")}`}
            {subscription.publications.length > 0 ? ` · ${subscription.publications.join(", ")}` : ` · ${t("keine Publikation genannt")}`}
          </small>
          <small>{t("ohne Verbindungsangabe gelesen")}</small>
        </div>
        <span className={subscription.enabled ? "secure" : "risk medium"}>{subscription.enabled ? t("angeschaltet") : t("abgeschaltet")}</span>
      </div>)}
      <p className="muted">{t(SUBSCRIPTION_SOURCE_NOTE)}</p>
    </article>}

    {data && <article className="console-card span-2">
      <div className="card-head"><div><span>{t("PUBLIKATIONEN")}</span><h3>{t("Was diese Datenbank anbietet")}</h3></div><Radio size={18}/></div>
      {publications.length === 0 && <p className="muted">{t("Keine Publikation. Damit bietet diese Datenbank keiner Seite Änderungen an.")}</p>}
      {publications.map((publication) => {
        const operations = [
          publication.publishInsert && "INSERT", publication.publishUpdate && "UPDATE",
          publication.publishDelete && "DELETE", publication.publishTruncate && "TRUNCATE",
        ].filter(Boolean).join(", ");
        return <div className="bucket-row" key={publication.name}>
          <span className="bucket-icon"><Radio size={16}/></span>
          <div>
            <strong>{publication.name}</strong>
            <small>
              {operations || t("nichts")} · {publication.allTables
                ? t("alle Tabellen")
                : publication.tables.length > 0 ? publication.tables.join(", ") : t("keine Tabelle")}
              {` · ${t("Eigentümer")} ${publication.owner}`}
            </small>
          </div>
          <span className={publication.allTables ? "risk medium" : "secure"}>
            {publication.allTables ? t("alle Tabellen") : `${formatNumber(publication.tables.length)} ${t("Tabellen")}`}
          </span>
        </div>;
      })}
      <p className="muted">{t(PUBLICATION_SOURCE_NOTE)}</p>
      <p className="muted">{t(REALTIME_NOTE)}</p>
    </article>}

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("STATTDESSEN")}</span><h3>{t("Wie Replikation entsteht")}</h3></div></div>
      {CREATE_STEPS.map((step) => <div className="bucket-row" key={step.title}>
        <span className="bucket-icon"><Waypoints size={16}/></span>
        <div><strong>{t(step.title)}</strong><p className="muted">{t(step.body)}</p></div>
      </div>)}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NICHT VORHANDEN")}</span><h3>{t("Was diese Seite bewusst nicht kann")}</h3></div></div>
      {MISSING_REPLICATION_SURFACE.map((entry) => <div className="bucket-row" key={entry.title}>
        <span className="bucket-icon"><Waypoints size={16}/></span>
        <div><strong>{t(entry.title)}</strong><p className="muted">{t(entry.body)}</p></div>
      </div>)}
    </article>
  </div>;
}
