"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Database, KeyRound, Plug, RefreshCw, Table2, Users } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import {
  CREATE_STEPS,
  FOREIGN_TABLE_SOURCE_NOTE,
  MISSING_WRAPPER_SURFACE,
  OPTION_EXPOSURE_NOTE,
  OPTION_POLICY_NOTE,
  READ_ONLY_NOTE,
  SCOPE_NOTE,
  SERVER_SOURCE_NOTE,
  USER_MAPPING_NOTE,
  VALIDATOR_STATE_TEXTS,
  WRAPPER_SOURCE_NOTE,
  validatorState,
} from "@/lib/console/wrappers-texts";

/**
 * Integrationen -> Wrappers (2.72), nur lesend.
 *
 * Der Platzhalter versprach „fremde Datenquellen als Tabellen einbinden". Das
 * Einbinden gibt es hier nicht, das Lesen schon: welche Wrapper installiert
 * sind, welche Fremdserver darauf stehen, wer ihnen zugeordnet ist und welche
 * Fremdtabellen darüber gehen.
 *
 * Die Grenze zieht die Seite selbst, statt sie nur einzuhalten. Optionen eines
 * Fremdservers zeigen ihren Wert nur, wenn ihr Schlüssel auf der Liste im
 * Dienst steht; jede andere Option steht mit Namen da und ohne Wert. Die
 * Optionen der Benutzerzuordnungen kommen gar nicht erst aus der Datenbank,
 * denn dort steht das Passwort des fremden Systems.
 *
 * Kein Eingabefeld, kein Speicherknopf, kein Schreibaufruf.
 */
type Environment = "development" | "staging" | "production";

type Wrapper = { name: string; owner: string; handler: string | null; validator: string | null };
/** `value: null` heisst zurückgehalten, `""` heisst leer. */
type ServerOption = { key: string; value: string | null };
type ForeignServer = { name: string; wrapper: string; owner: string; type: string | null; version: string | null; options: ServerOption[] };
type UserMapping = { server: string; user: string };
type ForeignTable = { schema: string; name: string; server: string };

type Wrappers = {
  wrappers: Wrapper[];
  servers: ForeignServer[];
  userMappings: UserMapping[];
  tables: ForeignTable[];
  truncated: boolean;
};

/** `disabled` heisst: Die Data Plane ist abgeschaltet. Das ist kein Fehler, sondern eine Entscheidung. */
type ViewState = "loading" | "ready" | "disabled" | "unavailable" | "error";

export function WrappersView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: ViewState }) {
  const [data, setData] = useState<Wrappers | null>(null);
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
        `/api/v1/projects/${projectId}/environments/${environment}/schema/foreign-data-wrappers`,
        { cache: "no-store", signal: controller.signal },
      );
      const body: unknown = (await response.json().catch(() => ({}))) ?? {};
      const payload = body !== null && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
      if (controller.signal.aborted) return;
      const answer = payload.data as Wrappers | undefined;
      if (response.status === 200 && answer && Array.isArray(answer.wrappers)) {
        setData(answer);
        setState("ready");
        return;
      }
      setData(null);
      setMessage(typeof payload.error === "string" ? (serverErrorText(payload.error) ?? "") : "");
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

  const wrappers = data?.wrappers ?? [];
  const servers = data?.servers ?? [];
  const mappings = data?.userMappings ?? [];
  const tables = data?.tables ?? [];

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("INTEGRATIONEN")} · {environment.toUpperCase()}</span><h3>{t("Fremde Datenquellen")}</h3></div><div>{refresh}</div></div>
      <p className="muted">{t(SCOPE_NOTE)}</p>
      {loading && !data && <p className="muted">{t("Der Katalog wird gelesen…")}</p>}
      {state === "disabled" && <p><strong>{t("Data Plane abgeschaltet")}</strong> · {t("Diese Installation liest keine Projektdatenbank. Ohne sie gibt es keinen Katalog, in dem ein Wrapper stünde.")}</p>}
      {state === "unavailable" && <p><strong>{t("Datenbank nicht bereit")}</strong> · {message || t("Die Projektdatenbank ist noch nicht bereit.")}</p>}
      {state === "error" && <p><strong>{t("Fremde Datenquellen nicht verfügbar")}</strong> · {message}</p>}
      {data?.truncated && <p className="muted">{t("Eine der vier Listen wurde an ihrer Grenze abgeschnitten; es gibt mehr, als hier steht.")}</p>}
      <p className="muted">{t(READ_ONLY_NOTE)}</p>
    </article>

    {data && <article className="console-card auth-overview">
      <div><span>{t("WRAPPER")}</span><strong>{formatNumber(wrappers.length)}</strong><small>{t("installiert")}</small></div>
      <div><span>{t("FREMDSERVER")}</span><strong>{formatNumber(servers.length)}</strong><small>{t("angelegt")}</small></div>
      <div><span>{t("ZUORDNUNGEN")}</span><strong>{formatNumber(mappings.length)}</strong><small>{t("Rollen mit Zugang")}</small></div>
      <div><span>{t("FREMDTABELLEN")}</span><strong>{formatNumber(tables.length)}</strong><small>{t("in dieser Datenbank")}</small></div>
    </article>}

    {data && <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WRAPPER")}</span><h3>{t("Installierte Foreign Data Wrapper")}</h3></div><Plug size={18}/></div>
      {wrappers.length === 0 && <p className="muted">{t("In dieser Datenbank ist kein Foreign Data Wrapper installiert. Die Schritte darunter sagen, was ein Mensch mit Superuser-Rechten stattdessen tut.")}</p>}
      {wrappers.map((wrapper) => {
        const validator = VALIDATOR_STATE_TEXTS[validatorState(wrapper.validator)];
        return <div className="bucket-row" key={wrapper.name}>
          <span className="bucket-icon"><Plug size={16}/></span>
          <div>
            <strong>{wrapper.name}</strong>
            <small>{t("Eigentümer")} {wrapper.owner} · {wrapper.handler ? <>{t("Handler")} <code>{wrapper.handler}</code></> : t("ohne Handler")}</small>
            <p className="muted">{t(validator.explains)}</p>
          </div>
          <span className={validator.tone}>{t(validator.label)}</span>
        </div>;
      })}
      <p className="muted">{t(WRAPPER_SOURCE_NOTE)}</p>
    </article>}

    {data && <article className="console-card span-2">
      <div className="card-head"><div><span>{t("FREMDSERVER")}</span><h3>{t("Wohin verbunden wird")}</h3></div><Database size={18}/></div>
      {servers.length === 0 && <p className="muted">{t("Es ist kein Fremdserver angelegt. Ein Fremdserver sagt einem Wrapper, wohin er greifen soll; angelegt wird er mit Superuser-Rechten und nicht aus dieser Ansicht.")}</p>}
      {servers.map((server) => <div className="bucket-row" key={server.name}>
        <span className="bucket-icon"><Database size={16}/></span>
        <div>
          <strong>{server.name}</strong>
          <small>{t("über")} {server.wrapper} · {t("Eigentümer")} {server.owner}{server.type ? ` · ${t("Typ")} ${server.type}` : ""}{server.version ? ` · ${t("Version")} ${server.version}` : ""}</small>
          {server.options.length === 0 && <small>{t("keine Option gesetzt")}</small>}
          {server.options.map((option) => <div className="log-row" key={option.key}>
            <span><code>{option.key}</code></span>
            {option.value === null
              ? <span className="risk medium">{t("zurückgehalten")}</span>
              : <code>{option.value}</code>}
          </div>)}
        </div>
      </div>)}
      <p className="muted">{t(OPTION_POLICY_NOTE)}</p>
      <p className="muted">{t(OPTION_EXPOSURE_NOTE)}</p>
      <p className="muted">{t(SERVER_SOURCE_NOTE)}</p>
    </article>}

    {data && <article className="console-card">
      <div className="card-head"><div><span>{t("ZUORDNUNGEN")}</span><h3>{t("Als wer QKERN auftritt")}</h3></div><Users size={18}/></div>
      {mappings.length === 0 && <p className="muted">{t("Keiner Rolle ist ein Fremdserver zugeordnet.")}</p>}
      {mappings.map((mapping) => <div className="bucket-row" key={`${mapping.server}/${mapping.user}`}>
        <span className="bucket-icon"><KeyRound size={16}/></span>
        <div><strong>{mapping.user}</strong><small>{t("auf")} {mapping.server}</small></div>
        <span className="muted">{t("Optionen ungelesen")}</span>
      </div>)}
      <p className="muted">{t(USER_MAPPING_NOTE)}</p>
    </article>}

    {data && <article className="console-card">
      <div className="card-head"><div><span>{t("FREMDTABELLEN")}</span><h3>{t("Was als Tabelle erscheint")}</h3></div><Table2 size={18}/></div>
      {tables.length === 0 && <p className="muted">{t("Es gibt keine Fremdtabelle in dieser Datenbank.")}</p>}
      {tables.map((table) => <div className="bucket-row" key={`${table.schema}.${table.name}`}>
        <span className="bucket-icon"><Table2 size={16}/></span>
        <div><strong>{table.schema}.{table.name}</strong><small>{t("über")} {table.server}</small></div>
      </div>)}
      <p className="muted">{t(FOREIGN_TABLE_SOURCE_NOTE)}</p>
    </article>}

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("STATTDESSEN")}</span><h3>{t("Wie ein Wrapper entsteht")}</h3></div></div>
      {CREATE_STEPS.map((step) => <div className="bucket-row" key={step.title}>
        <span className="bucket-icon"><Plug size={16}/></span>
        <div><strong>{t(step.title)}</strong><p className="muted">{t(step.body)}</p></div>
      </div>)}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NICHT VORHANDEN")}</span><h3>{t("Was diese Seite bewusst nicht kann")}</h3></div></div>
      {MISSING_WRAPPER_SURFACE.map((entry) => <div className="bucket-row" key={entry.title}>
        <span className="bucket-icon"><Plug size={16}/></span>
        <div><strong>{t(entry.title)}</strong><p className="muted">{t(entry.body)}</p></div>
      </div>)}
    </article>
  </div>;
}
