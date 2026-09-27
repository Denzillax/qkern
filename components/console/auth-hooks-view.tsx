"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, RefreshCw, ShieldAlert, ShieldCheck, ShieldOff, Webhook } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment, formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import {
  AUTH_HOOKS_AUDIT,
  AUTH_HOOKS_AUTHORITY,
  AUTH_HOOKS_CLAIMS_ARE_DECLARED,
  AUTH_HOOKS_CLAIMS_CONTRACT,
  AUTH_HOOKS_CLAIMS_REFRESH_PRICE,
  AUTH_HOOKS_CLAIMS_WHERE,
  AUTH_HOOKS_FAILURE_MODE,
  AUTH_HOOKS_FAILURE_PRICE,
  AUTH_HOOKS_FAILURE_TEXTS,
  AUTH_HOOKS_NO_ADDRESS,
  AUTH_HOOKS_NO_FAIL_OPEN_SWITCH,
  AUTH_HOOKS_NO_INVOCATION_PATH,
  AUTH_HOOKS_NO_MAIL_HOOK,
  AUTH_HOOKS_NO_METADATA,
  AUTH_HOOKS_NO_OUTPUT,
  AUTH_HOOKS_NO_PASSWORD,
  AUTH_HOOKS_NO_SESSION_ID,
  AUTH_HOOKS_NO_SIGN_UP_HOOK,
  AUTH_HOOKS_NO_TEST_CALL,
  AUTH_HOOKS_NO_TOKEN,
  AUTH_HOOKS_PAYLOAD,
  AUTH_HOOKS_POINT_NOTES,
  AUTH_HOOKS_POINT_TEXTS,
  AUTH_HOOKS_REJECTIONS,
  AUTH_HOOKS_RESERVED,
  AUTH_HOOKS_RESERVED_IS_LOUD,
  AUTH_HOOKS_SAME_INVOCATION_PATH,
  AUTH_HOOKS_SCALARS_ONLY,
  AUTH_HOOKS_SIGN_IN_CONTRACT,
  AUTH_HOOKS_SIGN_IN_NOT_REFRESH,
  AUTH_HOOKS_SIGN_IN_WHERE,
  AUTH_HOOKS_TIMEOUT_IS_A_SETTING,
  AUTH_HOOKS_TIMEOUT_IS_WAITING,
  AUTH_HOOKS_WHAT,
  AUTH_HOOKS_WHY_TWO,
  type AuthHookFailureId,
  type AuthHookRejectionId,
} from "@/lib/console/auth-hooks-texts";

/**
 * Auth → Auth-Hooks (2.77), an der Stelle, an der bis hierher der Platzhalter
 * stand.
 *
 * Der Platzhalter nannte drei Punkte: „Eigener Code bei Anmeldung,
 * Token-Ausgabe oder Mailversand.“ Gebaut sind zwei. Der dritte fehlt, und die
 * Seite sagt in einer eigenen Karte, warum er nicht kommt: Der Link einer
 * Aktionsmail trägt ein Token, und eigener Code, der ein Token bekommt, ist ein
 * zweiter Weg zur Anmeldung.
 *
 * Die Seite kann genau eines: die beiden Punkte dieser Projektumgebung setzen.
 * Vor dem Speichern steht eine vollständige Vorschau, jeder Wert vorher und
 * nachher. Erst danach gibt es den Knopf, der es wirklich tut. Dieselbe Bauart
 * wie Auth → Passwortschutz (2.53) und Auth → Rate Limits (2.56).
 *
 * Der Satz, was bei einem Ausfall gilt, kommt aus der Antwort der Route
 * (`failureMode`) und nicht aus dieser Datei. Was bei einem Ausfall geschieht,
 * entscheidet der Dienst, und die Seite soll es nicht aus eigenem Wissen
 * behaupten.
 */
type Environment = "development" | "staging" | "production";

type Binding = { functionName: string | null; timeoutMs: number };
type ClaimsBinding = Binding & { claims: string[] };
type Hooks = { signIn: Binding; accessTokenClaims: ClaimsBinding };

type HookSettings = {
  hooks: Hooks;
  defaults: Hooks;
  bounds: {
    timeoutMs: { min: number; max: number };
    claims: { max: number };
    claimValueLength: { max: number };
    claimsBytes: { max: number };
  };
  points: string[];
  reservedClaims: string[];
  failureMode: Record<"sign_in" | "access_token_claims", AuthHookFailureId>;
  configured: boolean;
  updatedAt: string | null;
};

/** Die Liste als Text im Feld, und zurück. Leer heisst leer, nicht [""]. */
function claimList(raw: string): string[] {
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
}

export function AuthHooksView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const route = `/api/v1/projects/${projectId}/environments/${environment}/auth/admin/hooks`;
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [data, setData] = useState<HookSettings | null>(null);
  const [signInFunction, setSignInFunction] = useState("");
  const [signInTimeout, setSignInTimeout] = useState(0);
  const [claimsFunction, setClaimsFunction] = useState("");
  const [claimsTimeout, setClaimsTimeout] = useState(0);
  const [claimsRaw, setClaimsRaw] = useState("");
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const request = useRef<AbortController | null>(null);

  const adopt = useCallback((loaded: HookSettings) => {
    setData(loaded);
    setSignInFunction(loaded.hooks.signIn.functionName ?? "");
    setSignInTimeout(loaded.hooks.signIn.timeoutMs);
    setClaimsFunction(loaded.hooks.accessTokenClaims.functionName ?? "");
    setClaimsTimeout(loaded.hooks.accessTokenClaims.timeoutMs);
    setClaimsRaw(loaded.hooks.accessTokenClaims.claims.join(", "));
  }, []);

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
        setData(null); setState("unavailable");
        setMessage(payload.error ?? t("Project Auth ist für diese Umgebung deaktiviert."));
        return;
      }
      if (!response.ok || !payload.data) {
        setData(null); setState("error");
        setMessage(payload.error ?? t("Die Route hat nicht geantwortet."));
        return;
      }
      adopt(payload.data as HookSettings);
      setMessage(""); setPreview(false); setState("ready");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setRefreshing(false); setData(null); setState("error");
      setMessage(cause instanceof Error ? cause.message : t("Die Route hat nicht geantwortet."));
    }
  }, [route, adopt]);

  useEffect(() => {
    void load(true);
    return () => request.current?.abort();
  }, [load]);

  async function apply() {
    setSaving(true);
    try {
      const response = await fetch(route, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hooks: {
            signIn: { functionName: signInFunction.trim() || null, timeoutMs: signInTimeout },
            accessTokenClaims: {
              functionName: claimsFunction.trim() || null,
              timeoutMs: claimsTimeout,
              claims: claimList(claimsRaw),
            },
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.data) {
        const reason = payload.reason as AuthHookRejectionId | undefined;
        const explained = reason && reason in AUTH_HOOKS_REJECTIONS
          ? t(AUTH_HOOKS_REJECTIONS[reason])
          : payload.error ?? t("Die Auth-Hooks konnten nicht gespeichert werden.");
        setMessage(explained);
        return;
      }
      adopt(payload.data as HookSettings);
      setPreview(false); setMessage("");
    } catch { setMessage(t("Die Auth-Hooks konnten nicht gespeichert werden.")); }
    finally { setSaving(false); }
  }

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Auth-Hooks werden geladen…")}</h3></div>;
  }
  if (state === "unavailable" || state === "error" || !data) {
    return <div className="console-card live-module-state"><ShieldOff size={26}/>
      <h3>{state === "unavailable" ? t("Project Auth nicht aktiviert") : t("Auth-Hooks nicht verfügbar")}</h3>
      <p>{message}</p>
      <button className="secondary-button" onClick={() => void load(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  const claims = claimList(claimsRaw);
  const nextSignIn = signInFunction.trim() || null;
  const nextClaimsFunction = claimsFunction.trim() || null;
  const changed = nextSignIn !== data.hooks.signIn.functionName ||
    signInTimeout !== data.hooks.signIn.timeoutMs ||
    nextClaimsFunction !== data.hooks.accessTokenClaims.functionName ||
    claimsTimeout !== data.hooks.accessTokenClaims.timeoutMs ||
    claims.join(",") !== data.hooks.accessTokenClaims.claims.join(",");
  // Die beiden Formfehler, die die Route ohnehin abweist, schon hier benannt:
  // Eine Liste ohne Function ist eine Erlaubnis fuer niemanden, und eine
  // Function ohne Liste waere ein Hook, dessen Antwort ganz verworfen wuerde.
  const claimsWithoutFunction = !nextClaimsFunction && claims.length > 0;
  const functionWithoutClaims = Boolean(nextClaimsFunction) && claims.length === 0;
  const reserved = claims.filter((claim) => data.reservedClaims.includes(claim));
  const blocked = claimsWithoutFunction || functionWithoutClaims || reserved.length > 0;
  const active = [data.hooks.signIn.functionName, data.hooks.accessTokenClaims.functionName]
    .filter((name) => name !== null).length;

  function edit(change: () => void) {
    setPreview(false); setMessage(""); change();
  }

  const nameOrNone = (name: string | null) => name ?? t("Kein Hook");

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div>
        <span>{t("AKTIVE PUNKTE")}</span>
        <strong>{formatNumber(active)}</strong>
        <small>{t("von zwei")}</small>
      </div>
      <div>
        <span>{t(AUTH_HOOKS_POINT_TEXTS.sign_in).toUpperCase()}</span>
        <strong>{nameOrNone(data.hooks.signIn.functionName)}</strong>
        <small>{formatNumber(data.hooks.signIn.timeoutMs)} {t("Millisekunden Frist")}</small>
      </div>
      <div>
        <span>{t(AUTH_HOOKS_POINT_TEXTS.access_token_claims).toUpperCase()}</span>
        <strong>{nameOrNone(data.hooks.accessTokenClaims.functionName)}</strong>
        <small>{formatNumber(data.hooks.accessTokenClaims.timeoutMs)} {t("Millisekunden Frist")}</small>
      </div>
    </article>

    <article className="console-card span-2">
      <div className="card-head">
        <div><span>{t("PROJECT AUTH")} · {environment.toUpperCase()}</span><h3>{t("Eigener Code an den Punkten der Anmeldung")}</h3></div>
        <div>
          <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing || saving}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
        </div>
      </div>

      <p className="muted">{t(AUTH_HOOKS_WHAT)}</p>
      <p className="muted">{t(AUTH_HOOKS_WHY_TWO)}</p>
      {/* Der wichtigste Satz dieser Seite steht als Warnung und nicht als
          Fussnote: Wer hier etwas eintraegt, soll vorher gelesen haben, was
          ein Ausfall kostet. */}
      <p className="risk medium">{t(AUTH_HOOKS_FAILURE_MODE)}</p>
      <p className="risk medium">{t(AUTH_HOOKS_FAILURE_PRICE)}</p>
      <p className="muted">{t(AUTH_HOOKS_SAME_INVOCATION_PATH)}</p>
      <p className="muted">{t(AUTH_HOOKS_AUTHORITY)}</p>
      <p className="muted">{t(AUTH_HOOKS_AUDIT)}</p>
      {message && <p className="risk medium">{message}</p>}

      <div className="log-row">
        <span className={data.configured ? "secure" : "muted"}>
          {data.configured ? <ShieldCheck size={15}/> : <ShieldOff size={15}/>} {data.configured ? t("Diese Umgebung führt eigene Hooks.") : t("Diese Umgebung ruft an keinem Punkt etwas.")}
        </span>
        <small>{data.updatedAt ? `${t("Zuletzt geändert:")} ${formatMoment(data.updatedAt)}` : t("Nie geändert; es wird nichts gerufen.")}</small>
      </div>

      <div className="console-card preview-card">
        <div className="card-head"><div><span>{t("PUNKT")}</span><h3>{t(AUTH_HOOKS_POINT_TEXTS.sign_in)}</h3></div><ShieldAlert size={18}/></div>
        <p className="muted">{t(AUTH_HOOKS_POINT_NOTES.sign_in)}</p>
        <div className="log-row">
          <label>{t("Hinterlegte Function, leer für keinen Hook")}<input
            type="text"
            value={signInFunction}
            maxLength={63}
            disabled={saving}
            aria-label={t("Hinterlegte Function, leer für keinen Hook")}
            onChange={(event) => edit(() => setSignInFunction(event.target.value))}
          /></label>
          <small>{t(AUTH_HOOKS_FAILURE_TEXTS[data.failureMode.sign_in])}</small>
        </div>
        <div className="log-row">
          <label>{t("Frist in Millisekunden")}<input
            type="number"
            value={signInTimeout}
            min={data.bounds.timeoutMs.min}
            max={data.bounds.timeoutMs.max}
            step={100}
            disabled={saving}
            aria-label={t("Frist in Millisekunden")}
            onChange={(event) => edit(() => setSignInTimeout(Number(event.target.value)))}
          /></label>
          <small>{t("Erlaubt:")} {formatNumber(data.bounds.timeoutMs.min)} {t("bis")} {formatNumber(data.bounds.timeoutMs.max)}</small>
        </div>
        <p className="muted">{t(AUTH_HOOKS_SIGN_IN_WHERE)}</p>
        <p className="muted">{t(AUTH_HOOKS_SIGN_IN_NOT_REFRESH)}</p>
        <p className="muted">{t(AUTH_HOOKS_SIGN_IN_CONTRACT)}</p>
      </div>

      <div className="console-card preview-card">
        <div className="card-head"><div><span>{t("PUNKT")}</span><h3>{t(AUTH_HOOKS_POINT_TEXTS.access_token_claims)}</h3></div><KeyRound size={18}/></div>
        <p className="muted">{t(AUTH_HOOKS_POINT_NOTES.access_token_claims)}</p>
        <div className="log-row">
          <label>{t("Hinterlegte Function, leer für keinen Hook")}<input
            type="text"
            value={claimsFunction}
            maxLength={63}
            disabled={saving}
            aria-label={t("Hinterlegte Function für die Ausgabe des Access Token")}
            onChange={(event) => edit(() => setClaimsFunction(event.target.value))}
          /></label>
          <small>{t(AUTH_HOOKS_FAILURE_TEXTS[data.failureMode.access_token_claims])}</small>
        </div>
        <div className="log-row">
          <label>{t("Frist in Millisekunden")}<input
            type="number"
            value={claimsTimeout}
            min={data.bounds.timeoutMs.min}
            max={data.bounds.timeoutMs.max}
            step={100}
            disabled={saving}
            aria-label={t("Frist für die Ausgabe des Access Token")}
            onChange={(event) => edit(() => setClaimsTimeout(Number(event.target.value)))}
          /></label>
          <small>{t("Erlaubt:")} {formatNumber(data.bounds.timeoutMs.min)} {t("bis")} {formatNumber(data.bounds.timeoutMs.max)}</small>
        </div>
        <div className="log-row">
          <label>{t("Erlaubte Ansprüche, durch Komma getrennt")}<input
            type="text"
            value={claimsRaw}
            maxLength={320}
            disabled={saving}
            aria-label={t("Erlaubte Ansprüche, durch Komma getrennt")}
            onChange={(event) => edit(() => setClaimsRaw(event.target.value))}
          /></label>
          <small>{t("Höchstens:")} {formatNumber(data.bounds.claims.max)}</small>
        </div>
        <p className="muted">{t(AUTH_HOOKS_CLAIMS_ARE_DECLARED)}</p>
        <p className="muted">{t(AUTH_HOOKS_CLAIMS_CONTRACT)}</p>
        <p className="muted">{t(AUTH_HOOKS_CLAIMS_WHERE)}</p>
        <p className="risk medium">{t(AUTH_HOOKS_CLAIMS_REFRESH_PRICE)}</p>
        <p className="muted">{t(AUTH_HOOKS_SCALARS_ONLY)}</p>
        {claimsWithoutFunction && <p className="risk medium">{t(AUTH_HOOKS_REJECTIONS.claims_without_function)}</p>}
        {functionWithoutClaims && <p className="risk medium">{t(AUTH_HOOKS_REJECTIONS.claims_required)}</p>}
        {reserved.length > 0 && <p className="risk medium">{t(AUTH_HOOKS_REJECTIONS.claim_reserved)} <code>{reserved.join(", ")}</code></p>}
      </div>

      <div className="console-card preview-card">
        <div className="card-head"><div><span>{t("FRIST")}</span><h3>{t("Wie lange eine Anmeldung wartet")}</h3></div><RefreshCw size={18}/></div>
        <p className="muted">{t(AUTH_HOOKS_TIMEOUT_IS_A_SETTING)}</p>
        <p className="risk medium">{t(AUTH_HOOKS_TIMEOUT_IS_WAITING)}</p>
      </div>

      {!preview && <div className="log-row">
        <button className="secondary-button" onClick={() => { setMessage(""); setPreview(true); }} disabled={saving || !changed || blocked}>
          <StableLabel current={t("Änderung prüfen")} variants={tAll("Änderung prüfen")}/>
        </button>
        {!changed && <small>{t("Nichts geändert.")}</small>}
      </div>}

      {preview && <div className="console-card preview-card">
        <div className="card-head"><div><span>{t("VORSCHAU")}</span><h3>{t("Auth-Hooks ersetzen")}</h3></div><ShieldAlert size={18}/></div>
        <p className="risk medium">{t("Speichern wirkt sofort für diese Umgebung und gilt ab dem nächsten Anmeldeversuch.")}</p>
        <div className="log-row">
          <span className={nextSignIn !== data.hooks.signIn.functionName ? "risk medium" : "muted"}>{t(AUTH_HOOKS_POINT_TEXTS.sign_in)}</span>
          <code>{nameOrNone(data.hooks.signIn.functionName)} → {nameOrNone(nextSignIn)}</code>
        </div>
        <div className="log-row">
          <span className={signInTimeout !== data.hooks.signIn.timeoutMs ? "risk medium" : "muted"}>{t("Frist in Millisekunden")}</span>
          <code>{formatNumber(data.hooks.signIn.timeoutMs)} → {formatNumber(signInTimeout)}</code>
        </div>
        <div className="log-row">
          <span className={nextClaimsFunction !== data.hooks.accessTokenClaims.functionName ? "risk medium" : "muted"}>{t(AUTH_HOOKS_POINT_TEXTS.access_token_claims)}</span>
          <code>{nameOrNone(data.hooks.accessTokenClaims.functionName)} → {nameOrNone(nextClaimsFunction)}</code>
        </div>
        <div className="log-row">
          <span className={claimsTimeout !== data.hooks.accessTokenClaims.timeoutMs ? "risk medium" : "muted"}>{t("Frist für die Ausgabe des Access Token")}</span>
          <code>{formatNumber(data.hooks.accessTokenClaims.timeoutMs)} → {formatNumber(claimsTimeout)}</code>
        </div>
        <div className="log-row">
          <span className={claims.join(",") !== data.hooks.accessTokenClaims.claims.join(",") ? "risk medium" : "muted"}>{t("Erlaubte Ansprüche, durch Komma getrennt")}</span>
          <code>{data.hooks.accessTokenClaims.claims.join(", ") || t("Keine")} → {claims.join(", ") || t("Keine")}</code>
        </div>
        <div className="log-row">
          <button className="secondary-button" onClick={() => void apply()} disabled={saving}>
            <StableLabel current={saving ? t("Wird gespeichert…") : t("Jetzt anwenden")} variants={tAll("Wird gespeichert…", "Jetzt anwenden")}/>
          </button>
          <button className="plain-button" onClick={() => setPreview(false)} disabled={saving}>{t("Abbrechen")}</button>
        </div>
      </div>}
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("NUTZLAST")}</span><h3>{t("Was ein Hook sieht")}</h3></div><Webhook size={18}/></div>
      <p className="muted">{t(AUTH_HOOKS_PAYLOAD)}</p>
      <p className="risk medium">{t(AUTH_HOOKS_NO_PASSWORD)}</p>
      <p className="risk medium">{t(AUTH_HOOKS_NO_TOKEN)}</p>
      <p className="muted">{t(AUTH_HOOKS_NO_ADDRESS)}</p>
      <p className="muted">{t(AUTH_HOOKS_NO_METADATA)}</p>
      <p className="muted">{t(AUTH_HOOKS_NO_SESSION_ID)}</p>
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("RESERVIERT")}</span><h3>{t("Was ein Hook nicht setzen darf")}</h3></div><KeyRound size={18}/></div>
      <p className="muted">{t(AUTH_HOOKS_RESERVED)}</p>
      <p className="risk medium">{t(AUTH_HOOKS_RESERVED_IS_LOUD)}</p>
      <div className="log-row">
        <span>{t("Reservierte Namen")}</span>
        <code>{data.reservedClaims.join(", ")}</code>
      </div>
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("NICHT GEBAUT")}</span><h3>{t("Was diese Seite nicht hält")}</h3></div><ShieldAlert size={18}/></div>
      <p className="risk medium">{t(AUTH_HOOKS_NO_MAIL_HOOK)}</p>
      <p className="muted">{t(AUTH_HOOKS_NO_SIGN_UP_HOOK)}</p>
      <p className="muted">{t(AUTH_HOOKS_NO_FAIL_OPEN_SWITCH)}</p>
      <p className="muted">{t(AUTH_HOOKS_NO_OUTPUT)}</p>
      <p className="muted">{t(AUTH_HOOKS_NO_TEST_CALL)}</p>
      <p className="muted">{t(AUTH_HOOKS_NO_INVOCATION_PATH)}</p>
    </article>
  </div>;
}
