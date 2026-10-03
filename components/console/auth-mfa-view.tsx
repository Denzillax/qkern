"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { formatMoment } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import {
  AUTH_MFA_CANNOT_DO,
  AUTH_MFA_DISABLE_WARNING,
  AUTH_MFA_ENABLE_WARNING,
  AUTH_MFA_ENFORCEMENT_HONESTY,
  AUTH_MFA_FACTOR_TEXTS,
  AUTH_MFA_ONLY_TOTP,
  AUTH_MFA_STATE_TEXTS,
  AUTH_MFA_WITHOUT_FACTOR,
  type AuthMfaFactorId,
} from "@/lib/console/auth-mfa-texts";

/**
 * Auth → Mehrfaktor (2.52), wie bei Supabase unter Authentication,
 * Multi-Factor.
 *
 * Die Seite kann genau eines: den zweiten Faktor für diese Projektumgebung
 * verlangen oder freistellen. Sie richtet keinen Faktor ein, sie setzt
 * keinen zurück, und sie zeigt nie ein Geheimnis oder einen Recovery-Code —
 * die Route gibt keine heraus, also hat die Ansicht auch keine.
 *
 * Vor dem Einschalten steht eine vollständige Vorschau: was passiert, wen es
 * trifft und wie viele das sind. Erst danach gibt es den Knopf, der es
 * wirklich tut. Dieselbe Bauart wie der Tabellen-Designer (2.49).
 */
type Environment = "development" | "staging" | "production";

type Policy = {
  required: boolean;
  updatedAt: string | null;
  users: number;
  enrolled: number;
  notEnrolled: number;
  factors: AuthMfaFactorId[];
};

export function AuthMfaView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading" | "ready" | "unavailable" | "error" }) {
  const route = `/api/v1/projects/${projectId}/environments/${environment}/auth/admin/mfa`;
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">(initialState ?? "loading");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [preview, setPreview] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
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
        setPolicy(null); setState("unavailable");
        setMessage(serverErrorText(payload.error) ?? t("Project Auth ist für diese Umgebung deaktiviert."));
        return;
      }
      if (!response.ok || !payload.data) {
        setPolicy(null); setState("error");
        setMessage(serverErrorText(payload.error) ?? t("Die Route hat nicht geantwortet."));
        return;
      }
      setPolicy(payload.data as Policy); setMessage(""); setPreview(null); setState("ready");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setRefreshing(false); setPolicy(null); setState("error");
      setMessage(cause instanceof Error ? cause.message : t("Die Route hat nicht geantwortet."));
    }
  }, [route]);

  useEffect(() => {
    void load(true);
    return () => request.current?.abort();
  }, [load]);

  async function apply(required: boolean) {
    setSaving(true);
    try {
      const response = await fetch(route, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ required }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.data) {
        setMessage(serverErrorText(payload.error) ?? t("Die Einstellung konnte nicht geändert werden."));
        return;
      }
      setPolicy(payload.data as Policy); setPreview(null); setMessage("");
    } catch { setMessage(t("Die Einstellung konnte nicht geändert werden.")); }
    finally { setSaving(false); }
  }

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Einstellung wird geladen…")}</h3></div>;
  }
  if (state === "unavailable" || state === "error" || !policy) {
    return <div className="console-card live-module-state"><ShieldOff size={26}/>
      <h3>{state === "unavailable" ? t("Project Auth nicht aktiviert") : t("Mehrfaktor nicht verfügbar")}</h3>
      <p>{message}</p>
      <button className="secondary-button" onClick={() => void load(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  const format = (value: string) => formatMoment(value);
  const target = preview;

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("ERZWUNGEN")}</span><strong>{policy.required ? t("ja") : t("nein")}</strong><small>{t(AUTH_MFA_STATE_TEXTS[policy.required ? "required" : "optional"])}</small></div>
      <div><span>{t("MIT FAKTOR")}</span><strong>{policy.enrolled}</strong><small>{t("App-Nutzer mit bestätigtem TOTP")}</small></div>
      <div><span>{t("OHNE FAKTOR")}</span><strong>{policy.notEnrolled}</strong><small>{t("App-Nutzer insgesamt:")} {policy.users}</small></div>
    </article>

    <article className="console-card span-2">
      <div className="card-head">
        <div><span>{t("PROJECT AUTH")} · {environment.toUpperCase()}</span><h3>{t("Mehrfaktor")}</h3></div>
        <div>
          <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing || saving}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
        </div>
      </div>

      <p className="muted">{t(AUTH_MFA_ENFORCEMENT_HONESTY)}</p>
      <p className="muted">{t(AUTH_MFA_WITHOUT_FACTOR)}</p>
      <p className="muted">{t(AUTH_MFA_ONLY_TOTP)}</p>
      {message && <p className="risk medium">{message}</p>}

      <div className="log-row">
        <span className={policy.required ? "secure" : "muted"}>
          {policy.required ? <ShieldCheck size={15}/> : <ShieldOff size={15}/>} {t(AUTH_MFA_STATE_TEXTS[policy.required ? "required" : "optional"])}
        </span>
        <small>{policy.updatedAt ? `${t("Zuletzt geändert:")} ${format(policy.updatedAt)}` : t("Nie geändert; die Umgebung steht auf der Vorgabe.")}</small>
      </div>

      {target === null && <div className="log-row">
        <button className="secondary-button" onClick={() => setPreview(!policy.required)} disabled={saving}>
          <StableLabel current={policy.required ? t("Erzwingen aufheben") : t("Erzwingen einschalten")} variants={tAll("Erzwingen aufheben", "Erzwingen einschalten")}/>
        </button>
      </div>}

      {target !== null && <div className="console-card preview-card">
        <div className="card-head"><div><span>{t("VORSCHAU")}</span><h3>{target ? t("Erzwingen einschalten") : t("Erzwingen aufheben")}</h3></div><KeyRound size={18}/></div>
        <p className="risk medium">{t(target ? AUTH_MFA_ENABLE_WARNING : AUTH_MFA_DISABLE_WARNING)}</p>
        {target && <p className="muted">{t(AUTH_MFA_WITHOUT_FACTOR)}</p>}
        <div className="log-row"><span>{t("App-Nutzer in dieser Umgebung")}</span><code>{policy.users}</code></div>
        <div className="log-row"><span>{t("Davon mit bestätigtem Faktor")}</span><code>{policy.enrolled}</code></div>
        <div className="log-row"><span>{t("Davon ohne Faktor, müssen ihn zuerst einrichten")}</span><code>{policy.notEnrolled}</code></div>
        <div className="log-row"><span>{t("Ihre eigene Console-Anmeldung")}</span><small>{t("bleibt unberührt; sie läuft über QKERN selbst, nicht über Project Auth.")}</small></div>
        <div className="log-row">
          <button className="secondary-button" onClick={() => void apply(target)} disabled={saving}>
            <StableLabel current={saving ? t("Wird gespeichert…") : t("Jetzt anwenden")} variants={tAll("Wird gespeichert…", "Jetzt anwenden")}/>
          </button>
          <button className="plain-button" onClick={() => setPreview(null)} disabled={saving}>{t("Abbrechen")}</button>
        </div>
      </div>}
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("FAKTOREN")}</span><h3>{t("Was es gibt")}</h3></div></div>
      {policy.factors.map((factor) => <div className="log-row" key={factor}>
        <span className="secure">{t(AUTH_MFA_FACTOR_TEXTS[factor] ?? factor)}</span>
      </div>)}
      <p className="muted">{t(AUTH_MFA_CANNOT_DO)}</p>
    </article>
  </div>;
}
