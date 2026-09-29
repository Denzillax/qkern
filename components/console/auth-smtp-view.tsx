"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mail, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";
import {
  AUTH_SMTP_CERTIFIED,
  AUTH_SMTP_FIELD_TEXTS,
  AUTH_SMTP_HONESTY,
  AUTH_SMTP_HOW_TO_CHANGE,
  AUTH_SMTP_MODE_TEXTS,
  AUTH_SMTP_NO_SECRET,
  AUTH_SMTP_ORIGIN_TEXTS,
  type AuthSmtpFieldId,
  type AuthSmtpModeId,
  type AuthSmtpOriginId,
} from "@/lib/console/auth-settings-texts";

/**
 * Auth → SMTP (2.54), wie bei Supabase unter Authentication, Emails, SMTP
 * Settings — mit einem wesentlichen Unterschied: Diese Seite **liest nur**.
 *
 * Der Mailweg steht in der Umgebung des Prozesses. Es gibt keinen Ort, an den
 * ein Formular hier schreiben könnte, also gibt es kein Formular. Das steht
 * auch auf der Seite, in ganzen Sätzen, statt als ausgegrauter Knopf.
 *
 * Gezeigt wird je Wert die Herkunft: aus der Umgebung, Vorgabe des Dienstes
 * oder nicht gesetzt. Das Geheimnis des Mailkontos kommt gar nicht erst an
 * den Browser — es steht auch in diesem Quelltext nirgends, damit ein
 * Vertrag einfach danach suchen kann; die
 * Route gibt es nicht heraus.
 */
type Environment = "development" | "staging" | "production";

type Value = { value: string | null; origin: AuthSmtpOriginId };

type Settings = {
  mode: AuthSmtpModeId;
  host: Value;
  port: Value;
  security: Value;
  sender: Value;
  actionBaseUrl: Value;
  authenticated: boolean;
};

export function AuthSmtpView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading" | "ready" | "unavailable" | "error" }) {
  const route = `/api/v1/projects/${projectId}/environments/${environment}/auth/admin/mail`;
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">(initialState ?? "loading");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async (initial: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (initial) setState("loading"); else setRefreshing(true);
    try {
      const response = await fetch(route, { cache: "no-store", signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      setRefreshing(false);
      if (response.status === 503) {
        setSettings(null); setState("unavailable");
        setMessage(payload.error ?? t("Project Auth ist für diese Umgebung deaktiviert."));
        return;
      }
      if (!response.ok || !payload.data) {
        setSettings(null); setState("error");
        setMessage(payload.error ?? t("Die Route hat nicht geantwortet."));
        return;
      }
      setSettings(payload.data as Settings); setMessage(""); setState("ready");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setRefreshing(false); setSettings(null); setState("error");
      setMessage(cause instanceof Error ? cause.message : t("Die Route hat nicht geantwortet."));
    }
  }, [route]);

  useEffect(() => {
    void load(true);
    return () => request.current?.abort();
  }, [load]);

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Mailweg wird geladen…")}</h3></div>;
  }
  if (state === "unavailable" || state === "error" || !settings) {
    return <div className="console-card live-module-state"><ShieldOff size={26}/>
      <h3>{state === "unavailable" ? t("Project Auth nicht aktiviert") : t("Mailweg nicht verfügbar")}</h3>
      <p>{message}</p>
      <button className="secondary-button" onClick={() => void load(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  const rows: ReadonlyArray<{ field: AuthSmtpFieldId; entry: Value }> = [
    { field: "host", entry: settings.host },
    { field: "port", entry: settings.port },
    { field: "security", entry: settings.security },
    { field: "sender", entry: settings.sender },
    { field: "actionBaseUrl", entry: settings.actionBaseUrl },
  ];

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("BETRIEBSART")}</span><strong>{settings.mode === "smtp" ? t("SMTP") : settings.mode === "development_noop" ? t("Entwicklung") : t("aus")}</strong><small>{t(AUTH_SMTP_MODE_TEXTS[settings.mode])}</small></div>
      <div><span>{t("ANMELDUNG")}</span><strong>{settings.authenticated ? t("ja") : t("nein")}</strong><small>{t("ob sich der Dienst am Mailserver anmeldet")}</small></div>
      <div><span>{t("SCHREIBWEG")}</span><strong>{t("keiner")}</strong><small>{t("diese Seite liest nur")}</small></div>
    </article>

    <article className="console-card span-2">
      <div className="card-head">
        <div><span>{t("PROJECT AUTH")} · {environment.toUpperCase()}</span><h3>{t("Mailweg")}</h3></div>
        <div>
          <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
        </div>
      </div>

      <p className="muted">{t(AUTH_SMTP_HONESTY)}</p>
      <p className="muted">{t(AUTH_SMTP_NO_SECRET)}</p>
      <p className="muted">{t(AUTH_SMTP_HOW_TO_CHANGE)}</p>
      <p className="muted">{t(AUTH_SMTP_CERTIFIED)}</p>

      <div className="log-row">
        <span className={settings.mode === "smtp" ? "secure" : "muted"}>
          {settings.mode === "smtp" ? <ShieldCheck size={15}/> : <Mail size={15}/>} {t(AUTH_SMTP_MODE_TEXTS[settings.mode])}
        </span>
      </div>

      {rows.map((row) => <div className="log-row" key={row.field}>
        <span>{t(AUTH_SMTP_FIELD_TEXTS[row.field])}</span>
        <code>{row.entry.value ?? "∅"}</code>
        <small>{t(AUTH_SMTP_ORIGIN_TEXTS[row.entry.origin])}</small>
      </div>)}
    </article>
  </div>;
}
