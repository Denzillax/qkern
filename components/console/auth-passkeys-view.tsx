"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Fingerprint, KeyRound, RefreshCw, ShieldOff } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import {
  authPasskeyAlgorithmText,
  AUTH_PASSKEYS_CANNOT_DO,
  AUTH_PASSKEYS_CHALLENGE_ONCE,
  AUTH_PASSKEYS_CHECKS_THAT_DO_NOT_RUN,
  AUTH_PASSKEYS_CHECKS_THAT_RUN,
  AUTH_PASSKEYS_CHECKS_RUN,
  AUTH_PASSKEYS_COUNTER,
  AUTH_PASSKEYS_DISCOVERABLE,
  AUTH_PASSKEYS_NO_ATTESTATION,
  AUTH_PASSKEYS_ONLY_ES256,
  AUTH_PASSKEYS_ORIGINS,
  AUTH_PASSKEYS_REFUSAL_TEXTS,
  AUTH_PASSKEYS_SAME_PATH,
  AUTH_PASSKEYS_STAYS_AAL1,
  AUTH_PASSKEYS_STORAGE,
} from "@/lib/console/auth-passkeys-texts";

/**
 * Auth → Passkeys (2.79), wie bei Supabase unter Authentication, Passkeys.
 *
 * Die Seite zeigt drei Zahlen, die geprüften Herkünfte, die zugelassenen
 * Verfahren und die Liste der Prüfungen: die, die laufen, und die, die nicht
 * laufen. Sie richtet keinen Passkey ein und entfernt keinen; die Route dahinter
 * kann es auch nicht, sie hat nur ein GET.
 *
 * Es gibt hier keinen Knopf, der etwas ändert, und darum auch keine Vorschau
 * wie bei Auth → Mehrfaktor (2.52). Der einzige Knopf lädt neu.
 */
type Environment = "development" | "staging" | "production";

type Policy = {
  users: number;
  passkeys: number;
  usersWithPasskey: number;
  usersWithoutPasskey: number;
  relyingParties: Array<{ origin: string; rpId: string }>;
  algorithms: Array<{ type: "public-key"; alg: number }>;
};

export function AuthPasskeysView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading" | "ready" | "unavailable" | "error" }) {
  const route = `/api/v1/projects/${projectId}/environments/${environment}/auth/admin/passkeys`;
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">(initialState ?? "loading");
  const [policy, setPolicy] = useState<Policy | null>(null);
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
        setPolicy(null); setState("unavailable");
        setMessage(serverErrorText(payload.error) ?? t("Project Auth ist für diese Umgebung deaktiviert."));
        return;
      }
      if (!response.ok || !payload.data) {
        setPolicy(null); setState("error");
        setMessage(serverErrorText(payload.error) ?? t("Die Route hat nicht geantwortet."));
        return;
      }
      setPolicy(payload.data as Policy); setMessage(""); setState("ready");
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

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Passkeys werden geladen…")}</h3></div>;
  }
  if (state === "unavailable" || state === "error" || !policy) {
    return <div className="console-card live-module-state"><ShieldOff size={26}/>
      <h3>{state === "unavailable" ? t("Project Auth nicht aktiviert") : t("Passkeys nicht verfügbar")}</h3>
      <p>{message}</p>
      <button className="secondary-button" onClick={() => void load(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("PASSKEYS")}</span><strong>{formatNumber(policy.passkeys)}</strong><small>{t("Abgelegte öffentliche Schlüssel")}</small></div>
      <div><span>{t("MIT PASSKEY")}</span><strong>{formatNumber(policy.usersWithPasskey)}</strong><small>{t("App-Nutzer insgesamt:")} {formatNumber(policy.users)}</small></div>
      <div><span>{t("OHNE PASSKEY")}</span><strong>{formatNumber(policy.usersWithoutPasskey)}</strong><small>{t("Diese melden sich weiter mit Passwort oder Magic Link an.")}</small></div>
    </article>

    <article className="console-card span-2">
      <div className="card-head">
        <div><span>{t("PROJECT AUTH")} · {environment.toUpperCase()}</span><h3>{t("Passkeys")}</h3></div>
        <div>
          <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
        </div>
      </div>

      <p className="muted">{t(AUTH_PASSKEYS_CHECKS_RUN)}</p>
      <p className="muted">{t(AUTH_PASSKEYS_SAME_PATH)}</p>
      <p className="muted">{t(AUTH_PASSKEYS_STORAGE)}</p>
      {message && <p className="risk medium">{message}</p>}
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("LÄUFT")}</span><h3>{t("Was bei jeder Anmeldung geprüft wird")}</h3></div><Fingerprint size={18}/></div>
      {AUTH_PASSKEYS_CHECKS_THAT_RUN.map((check) => <div className="log-row" key={check}>
        <span className="secure">{t(check)}</span>
      </div>)}
      <p className="muted">{t(AUTH_PASSKEYS_CHALLENGE_ONCE)}</p>
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("LÄUFT NICHT")}</span><h3>{t("Was diese Fläche bewusst nicht hält")}</h3></div><ShieldOff size={18}/></div>
      {AUTH_PASSKEYS_CHECKS_THAT_DO_NOT_RUN.map((check) => <div className="log-row" key={check}>
        <span className="muted">{t(check)}</span>
      </div>)}
      <p className="risk medium">{t(AUTH_PASSKEYS_NO_ATTESTATION)}</p>
      <p className="muted">{t(AUTH_PASSKEYS_COUNTER)}</p>
      <p className="muted">{t(AUTH_PASSKEYS_STAYS_AAL1)}</p>
      <p className="muted">{t(AUTH_PASSKEYS_DISCOVERABLE)}</p>
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("VERFAHREN")}</span><h3>{t("Was geprüft werden kann")}</h3></div><KeyRound size={18}/></div>
      {policy.algorithms.map((algorithm) => <div className="log-row" key={algorithm.alg}>
        <span className="secure">{t(authPasskeyAlgorithmText(algorithm.alg))}</span>
        <code>{algorithm.alg}</code>
      </div>)}
      <p className="muted">{t(AUTH_PASSKEYS_ONLY_ES256)}</p>
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("HERKÜNFTE")}</span><h3>{t("Wogegen geprüft wird")}</h3></div></div>
      {policy.relyingParties.map((party) => <div className="log-row" key={party.origin}>
        <span>{party.origin}</span>
        <code>{party.rpId}</code>
      </div>)}
      {policy.relyingParties.length === 0 && <p className="risk medium">{t("Diese Installation nennt keine Herkunft; damit kommt keine Antwort durch.")}</p>}
      <p className="muted">{t(AUTH_PASSKEYS_ORIGINS)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("ABLEHNUNGEN")}</span><h3>{t("Warum eine Antwort abgewiesen wird")}</h3></div></div>
      <p className="muted">{t("Nach aussen bekommt jede abgewiesene Antwort denselben Satz. Der Grund steht im Audit-Log unter project_auth.passkey.refused:")}</p>
      {Object.entries(AUTH_PASSKEYS_REFUSAL_TEXTS).map(([reason, text]) => <div className="log-row" key={reason}>
        <span>{t(text)}</span>
        <code>{reason}</code>
      </div>)}
      <p className="muted">{t(AUTH_PASSKEYS_CANNOT_DO)}</p>
    </article>
  </div>;
}
