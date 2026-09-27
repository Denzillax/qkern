"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Database, Lock, RefreshCw, ShieldCheck, UserCog } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";
import {
  BINDING_STEPS,
  LIMITS_SOURCE_NOTE,
  MISSING_CAPABILITIES,
  NO_CONNECTION_DETAILS_NOTE,
  ROLES_SOURCE_NOTE,
  ROLE_RIGHT_TEXTS,
  ROLE_VERDICT_TEXTS,
  TLS_SOURCE_NOTE,
  TLS_STATE_TEXTS,
  roleRights,
  roleVerdict,
  tlsState,
  type DatabaseTls,
  type SettingsRole,
} from "@/lib/console/database-settings-texts";

/**
 * Datenbank → Einstellungen (2.53), nur lesend.
 *
 * Der Platzhalter versprach „Verbindungsdaten, Pooler, SSL-Zwang,
 * Netzwerkbeschränkungen". Diese Ansicht zeigt keine Verbindungsdaten, und
 * sie sagt das als Erstes. Sie zeigt, was es wirklich gibt: die Rollen der
 * Projektdatenbank mit ihren Rechten, den TLS-Zustand der Verbindung mit
 * seiner Quelle, die Verbindungsgrenzen des Servers, Name und Eigentümer der
 * Datenbank. Daneben steht, was die Console nicht kann, und wie ein Betreiber
 * eine Datenbank heute bindet.
 *
 * Kein Eingabefeld, kein Speicherknopf, kein Schreibaufruf.
 */
type Environment = "development" | "staging" | "production";

type Limits = { maxConnections: number; superuserReserved: number; database: number | null; role: number | null };

type Settings = {
  source: string;
  databaseName: string;
  databaseOwner: string;
  currentRole: string;
  tls: DatabaseTls;
  limits: Limits;
  roles: SettingsRole[];
  truncated: boolean;
};

/** `disabled` heisst: Die Data Plane ist abgeschaltet. Das ist kein Fehler, sondern eine Entscheidung. */
type ViewState = "loading" | "ready" | "disabled" | "unavailable" | "error";

export function DatabaseSettingsView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const url = `/api/v1/projects/${projectId}/environments/${environment}/database/settings`;
  const [state, setState] = useState<ViewState>("loading");
  const [settings, setSettings] = useState<Settings | null>(null);
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
    let status = 0;
    let payload: Record<string, unknown> = {};
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      status = response.status;
      const body: unknown = (await response.json().catch(() => ({}))) ?? {};
      if (body !== null && typeof body === "object" && !Array.isArray(body)) payload = body as Record<string, unknown>;
    } catch (cause) {
      if (controller.signal.aborted) return;
      payload = { error: cause instanceof Error ? cause.message : "" };
    }
    if (controller.signal.aborted) return;
    const data = payload.data as Settings | undefined;
    if (status === 200 && data && data.tls && data.limits && Array.isArray(data.roles)) {
      setSettings(data);
      setState("ready");
      return;
    }
    setSettings(null);
    setMessage(typeof payload.error === "string" ? payload.error : "");
    const code = typeof payload.code === "string" ? payload.code : "";
    // Abgeschaltet, nicht bereit und nicht erreichbar sind drei verschiedene
    // Auskuenfte. Ein 500 waere eine vierte und heisst hier schlicht Fehler.
    if (code === "DATA_PLANE_DISABLED") setState("disabled");
    else if (status === 503 || status === 409) setState("unavailable");
    else setState("error");
  }, [url]);

  useEffect(() => {
    void load();
    return () => { request.current?.abort(); };
  }, [load]);

  const loading = state === "loading";
  const refresh = <button className="secondary-button" onClick={() => void load()} disabled={loading}>
    <RefreshCw size={14}/> <StableLabel current={loading ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/>
  </button>;

  const tls = settings ? TLS_STATE_TEXTS[tlsState(settings.tls)] : null;
  const unlimited = t("unbegrenzt");

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("DATENBANK")} · {environment.toUpperCase()}</span><h3>{t("Einstellungen der Projektdatenbank")}</h3></div><div>{refresh}</div></div>
      <p className="muted">{t(NO_CONNECTION_DETAILS_NOTE)}</p>

      {loading && !settings && <p className="muted">{t("Die Datenbank wird gefragt…")}</p>}
      {state === "disabled" && <p><strong>{t("Data Plane abgeschaltet")}</strong> · {t("Diese Installation liest keine Projektdatenbank. Solange das so bleibt, gibt es hier nichts zu zeigen.")}</p>}
      {state === "unavailable" && <p><strong>{t("Datenbank nicht bereit")}</strong> · {message || t("Die Projektdatenbank ist noch nicht bereit.")}</p>}
      {state === "error" && <p><strong>{t("Einstellungen nicht verfügbar")}</strong> · {message}</p>}

      {settings && <>
        <div className="log-row log-header"><span>{t("Angabe")}</span><span>{t("Wert")}</span></div>
        <div className="log-row"><span>{t("Datenbank")}</span><code>{settings.databaseName}</code></div>
        <div className="log-row"><span>{t("Eigentümerin")}</span><code>{settings.databaseOwner}</code></div>
        <div className="log-row"><span>{t("Gelesen als Rolle")}</span><code>{settings.currentRole}</code></div>
      </>}
    </article>

    {settings && tls && <article className="console-card">
      <div className="card-head"><div><span>{t("TRANSPORT")}</span><h3>{t("TLS")}</h3></div><Lock size={18}/></div>
      <div className="bucket-row">
        <span className="bucket-icon"><ShieldCheck size={16}/></span>
        <div><strong className={tls.tone}>{t(tls.label)}</strong><p className="muted">{t(tls.explains)}</p></div>
      </div>
      <div className="log-row log-header"><span>{t("Angabe")}</span><span>{t("Wert")}</span></div>
      <div className="log-row"><span>{t("Diese Verbindung")}</span><span>{settings.tls.encrypted ? t("verschlüsselt") : t("unverschlüsselt")}</span></div>
      <div className="log-row"><span>{t("Protokoll")}</span><span>{settings.tls.version ?? t("keines")}</span></div>
      <div className="log-row"><span>{t("Server bietet TLS an")}</span><span>{settings.tls.serverEnabled ? t("ja") : t("nein")}</span></div>
      <p className="muted">{t(TLS_SOURCE_NOTE)}</p>
    </article>}

    {settings && <article className="console-card">
      <div className="card-head"><div><span>{t("GRENZEN")}</span><h3>{t("Verbindungen")}</h3></div><Database size={18}/></div>
      <div className="log-row log-header"><span>{t("Grenze")}</span><span>{t("Wert")}</span></div>
      <div className="log-row"><span>max_connections</span><span>{settings.limits.maxConnections}</span></div>
      <div className="log-row"><span>superuser_reserved_connections</span><span>{settings.limits.superuserReserved}</span></div>
      <div className="log-row"><span>{t("Grenze dieser Datenbank")}</span><span>{settings.limits.database ?? unlimited}</span></div>
      <div className="log-row"><span>{t("Grenze der lesenden Rolle")}</span><span>{settings.limits.role ?? unlimited}</span></div>
      <p className="muted">{t(LIMITS_SOURCE_NOTE)}</p>
    </article>}

    {settings && <article className="console-card span-2">
      <div className="card-head"><div><span>{t("RECHTE")}</span><h3>{t("Rollen dieser Datenbank")}</h3></div><UserCog size={18}/></div>
      {settings.truncated && <p className="muted">{t("Die Liste ist bei 200 Rollen abgeschnitten.")}</p>}
      {settings.roles.length === 0 && <p className="muted">{t("Der Katalog meldet keine Rolle, die diese Datenbank betrifft.")}</p>}
      {settings.roles.map((role) => {
        const verdict = ROLE_VERDICT_TEXTS[roleVerdict(role)];
        return <div className="bucket-row" key={role.name}>
          <span className="bucket-icon"><UserCog size={16}/></span>
          <div>
            <strong>{role.name}</strong>
            <p className="muted">{roleRights(role).map((right) => t(ROLE_RIGHT_TEXTS[right].label)).join(" · ")}</p>
            {role.connectionLimit !== null && <small>{t("Höchstens")} {role.connectionLimit} {t("Verbindungen")}</small>}
            {role.validUntil !== null && <small>{t("Gültig bis")} {role.validUntil.slice(0, 10)}</small>}
          </div>
          <span className={verdict.tone}>{t(verdict.label)}</span>
        </div>;
      })}
      <p className="muted">{t(ROLES_SOURCE_NOTE)}</p>
    </article>}

    <article className="console-card">
      <div className="card-head"><div><span>{t("NOCH NICHT DA")}</span><h3>{t("Was diese Seite nicht kann")}</h3></div><Lock size={18}/></div>
      {MISSING_CAPABILITIES.map((entry) => <div className="bucket-row" key={entry.title}>
        <span className="bucket-icon"><Lock size={16}/></span>
        <div><strong>{t(entry.title)}</strong><p className="muted">{t(entry.body)}</p></div>
      </div>)}
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("AUSSERHALB DER CONSOLE")}</span><h3>{t("Wie eine Datenbank gebunden wird")}</h3></div><Database size={18}/></div>
      {BINDING_STEPS.map((entry) => <div className="bucket-row" key={entry.title}>
        <span className="bucket-icon"><ShieldCheck size={16}/></span>
        <div><strong>{t(entry.title)}</strong><p className="muted">{t(entry.body)}</p></div>
      </div>)}
    </article>
  </div>;
}
