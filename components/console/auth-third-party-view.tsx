"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Fingerprint, KeyRound, RefreshCw, ShieldAlert, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment, formatNumber } from "@/components/console/console-display";
import { OptionMenu } from "@/components/console/option-menu";
import { StableLabel } from "@/components/stable-label";
import {
  AUTH_THIRD_PARTY_ALGORITHM_FROM_LIST,
  AUTH_THIRD_PARTY_CHECKS,
  AUTH_THIRD_PARTY_CLOCK_SKEW,
  AUTH_THIRD_PARTY_EXPIRY_REQUIRED,
  AUTH_THIRD_PARTY_EXTERNAL_CLAIMS,
  AUTH_THIRD_PARTY_HOLE_NONE,
  AUTH_THIRD_PARTY_HOLE_SYMMETRIC,
  AUTH_THIRD_PARTY_ISS_IN_CLAIMS,
  AUTH_THIRD_PARTY_JWKS_EGRESS,
  AUTH_THIRD_PARTY_JWKS_FAILURE,
  AUTH_THIRD_PARTY_JWKS_LIMITS,
  AUTH_THIRD_PARTY_JWKS_ROTATION,
  AUTH_THIRD_PARTY_JWKS_WHEN,
  AUTH_THIRD_PARTY_KEY_STILL_REQUIRED,
  AUTH_THIRD_PARTY_NO_ACCOUNT,
  AUTH_THIRD_PARTY_NO_ACCOUNT_FEATURES,
  AUTH_THIRD_PARTY_NO_DISCOVERY,
  AUTH_THIRD_PARTY_NO_EDIT,
  AUTH_THIRD_PARTY_NO_INVENTED_CLAIMS,
  AUTH_THIRD_PARTY_NO_LIFETIME_CAP,
  AUTH_THIRD_PARTY_NO_LIST,
  AUTH_THIRD_PARTY_NO_REVOCATION,
  AUTH_THIRD_PARTY_NO_SILENT_DOWNGRADE,
  AUTH_THIRD_PARTY_NO_TEST_CALL,
  AUTH_THIRD_PARTY_OWN_CLAIMS_WIN,
  AUTH_THIRD_PARTY_OWN_TOKEN_FIRST,
  AUTH_THIRD_PARTY_REFUSALS,
  AUTH_THIRD_PARTY_REJECTIONS,
  AUTH_THIRD_PARTY_ROLE_ALTERNATIVE,
  AUTH_THIRD_PARTY_ROLE_CEILING,
  AUTH_THIRD_PARTY_ROLE_MAPPING,
  AUTH_THIRD_PARTY_ROLE_TEXTS,
  AUTH_THIRD_PARTY_ROLE_WHERE,
  AUTH_THIRD_PARTY_ROLE_WHY,
  AUTH_THIRD_PARTY_SAME_RLS_PATH,
  AUTH_THIRD_PARTY_VERSUS_OIDC,
  AUTH_THIRD_PARTY_WHAT,
  type AuthThirdPartyRefusalId,
  type AuthThirdPartyRejectionId,
  type AuthThirdPartyRoleId,
} from "@/lib/console/auth-third-party-texts";

/**
 * Auth → Fremde Anbieter (2.80), an der Stelle, an der bis hierher der
 * Platzhalter stand.
 *
 * Der Platzhalter sagte: „Token fremder Identitätsdienste akzeptieren, ohne
 * eigene Nutzerkonten.“ Genau das ist gebaut. Die Seite zeigt zuerst den
 * Unterschied zum OIDC-Weg, weil er der einzige Grund ist, warum es diese Seite
 * überhaupt gibt, und sie nennt an derselben Stelle, was der Unterschied kostet:
 * keinen Widerruf, keine Nutzerliste, keinen zweiten Faktor.
 *
 * Die Seite kann genau zwei Dinge: einen Anbieter anlegen und einen entfernen.
 * Es gibt kein Bearbeiten, und die Seite sagt, warum. Vor dem Anlegen und vor
 * dem Entfernen steht eine vollständige Vorschau; erst danach gibt es den Knopf,
 * der es wirklich tut. Dieselbe Bauart wie Auth → Auth-Hooks (2.77).
 *
 * Die Rollen, die verbotene Rolle, die geprüften Verfahren und die Grenzen
 * kommen aus der Antwort der Route und nicht aus dieser Datei. Was geprüft wird
 * und welche Rolle ein fremdes Token höchstens bekommt, entscheidet der Dienst,
 * und die Seite soll es nicht aus eigenem Wissen behaupten.
 */
type Environment = "development" | "staging" | "production";

type Provider = {
  id: string;
  name: string;
  issuer: string;
  jwksUri: string;
  audiences: string[];
  subjectClaim: string;
  roleClaim: string | null;
  defaultRole: string;
  createdAt: string;
};

type ThirdParty = {
  providers: Provider[];
  roles: string[];
  forbiddenRole: string;
  algorithms: string[];
  ownClaims: string[];
  bounds: {
    clockSkewSeconds: number;
    tokenLength: number;
    subjectLength: number;
    audiences: { min: number; max: number };
    externalClaims: { max: number };
    externalBytes: { max: number };
    jwksKeys: { max: number };
    jwksBytes: { max: number };
    jwksTimeoutMs: number;
    jwksTtlSeconds: number;
    jwksFailureTtlSeconds: number;
    providers: { max: number };
  };
  configured: boolean;
};

/** Die Liste als Text im Feld, und zurück. Leer heisst leer, nicht [""]. */
function audienceList(raw: string): string[] {
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
}

export function AuthThirdPartyView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading" | "ready" | "unavailable" | "error" }) {
  const route = `/api/v1/projects/${projectId}/environments/${environment}/auth/admin/third-party`;
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">(initialState ?? "loading");
  const [data, setData] = useState<ThirdParty | null>(null);
  const [name, setName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [jwksUri, setJwksUri] = useState("");
  const [audiencesRaw, setAudiencesRaw] = useState("");
  const [subjectClaim, setSubjectClaim] = useState("sub");
  const [roleClaim, setRoleClaim] = useState("");
  const [defaultRole, setDefaultRole] = useState("authenticated");
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
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
        setData(null); setState("unavailable");
        setMessage(payload.error ?? t("Project Auth ist für diese Umgebung deaktiviert."));
        return;
      }
      if (!response.ok || !payload.data) {
        setData(null); setState("error");
        setMessage(payload.error ?? t("Die Route hat nicht geantwortet."));
        return;
      }
      setData(payload.data as ThirdParty);
      setMessage(""); setPreview(false); setState("ready");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setRefreshing(false); setData(null); setState("error");
      setMessage(cause instanceof Error ? cause.message : t("Die Route hat nicht geantwortet."));
    }
  }, [route]);

  useEffect(() => {
    void load(true);
    return () => request.current?.abort();
  }, [load]);

  function explain(payload: { reason?: string; error?: string }, fallback: string): string {
    const reason = payload.reason as AuthThirdPartyRejectionId | undefined;
    if (reason && reason in AUTH_THIRD_PARTY_REJECTIONS) return t(AUTH_THIRD_PARTY_REJECTIONS[reason]);
    return payload.error ?? fallback;
  }

  async function create() {
    setSaving(true);
    try {
      const response = await fetch(route, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: {
            name: name.trim(),
            issuer: issuer.trim(),
            jwksUri: jwksUri.trim(),
            audiences: audienceList(audiencesRaw),
            subjectClaim: subjectClaim.trim() || "sub",
            roleClaim: roleClaim.trim() || null,
            defaultRole,
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.data) {
        setMessage(explain(payload, t("Der fremde Anbieter konnte nicht angelegt werden.")));
        return;
      }
      setData(payload.data as ThirdParty);
      setPreview(false); setMessage("");
      setName(""); setIssuer(""); setJwksUri(""); setAudiencesRaw("");
      setSubjectClaim("sub"); setRoleClaim(""); setDefaultRole("authenticated");
    } catch { setMessage(t("Der fremde Anbieter konnte nicht angelegt werden.")); }
    finally { setSaving(false); }
  }

  async function remove(providerId: string) {
    setRemoving(null);
    setSaving(true);
    try {
      const response = await fetch(`${route}/${providerId}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.data) {
        setMessage(explain(payload, t("Der fremde Anbieter konnte nicht entfernt werden.")));
        return;
      }
      setData(payload.data as ThirdParty);
      setMessage("");
    } catch { setMessage(t("Der fremde Anbieter konnte nicht entfernt werden.")); }
    finally { setSaving(false); }
  }

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Fremde Anbieter werden geladen…")}</h3></div>;
  }
  if (state === "unavailable" || state === "error" || !data) {
    return <div className="console-card live-module-state"><ShieldOff size={26}/>
      <h3>{state === "unavailable" ? t("Project Auth nicht aktiviert") : t("Fremde Anbieter nicht verfügbar")}</h3>
      <p>{message}</p>
      <button className="secondary-button" onClick={() => void load(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  const audiences = audienceList(audiencesRaw);
  const full = data.providers.length >= data.bounds.providers.max;
  // Dieselben Formfehler, die die Route ohnehin abweist, schon hier benannt: Ein
  // Aussteller mit Schrägstrich am Ende ist der haeufigste, weil viele Dienste
  // ihn in ihrer Dokumentation so schreiben.
  const trailingSlash = issuer.trim().endsWith("/");
  const complete = name.trim().length > 1 && issuer.trim().length > 11 &&
    jwksUri.trim().length > 11 && audiences.length >= data.bounds.audiences.min;
  const blocked = !complete || trailingSlash || full ||
    audiences.length > data.bounds.audiences.max;
  const roleNote = (role: string) => role in AUTH_THIRD_PARTY_ROLE_TEXTS
    ? t(AUTH_THIRD_PARTY_ROLE_TEXTS[role as AuthThirdPartyRoleId])
    : role;

  function edit(change: () => void) {
    setPreview(false); setMessage(""); change();
  }

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div>
        <span>{t("FREMDE ANBIETER")}</span>
        <strong>{formatNumber(data.providers.length)}</strong>
        <small>{t("von höchstens")} {formatNumber(data.bounds.providers.max)}</small>
      </div>
      <div>
        <span>{t("HÖCHSTE ROLLE")}</span>
        <strong>authenticated</strong>
        <small>{t("nie")} {data.forbiddenRole}</small>
      </div>
      <div>
        <span>{t("GEPRÜFTE VERFAHREN")}</span>
        <strong>{formatNumber(data.algorithms.length)}</strong>
        <small>{data.algorithms.join(", ")}</small>
      </div>
    </article>

    <article className="console-card span-2">
      <div className="card-head">
        <div><span>{t("PROJECT AUTH")} · {environment.toUpperCase()}</span><h3>{t("Token fremder Dienste, ohne eigene Nutzerkonten")}</h3></div>
        <div>
          <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing || saving}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
        </div>
      </div>

      <p className="muted">{t(AUTH_THIRD_PARTY_WHAT)}</p>
      {/* Der Unterschied zum OIDC-Weg steht oben und nicht in einer Fussnote:
          Er ist der einzige Grund, warum es diese Seite gibt. */}
      <p className="muted">{t(AUTH_THIRD_PARTY_VERSUS_OIDC)}</p>
      <p className="muted">{t(AUTH_THIRD_PARTY_NO_ACCOUNT)}</p>
      <p className="risk medium">{t(AUTH_THIRD_PARTY_NO_REVOCATION)}</p>
      <p className="muted">{t(AUTH_THIRD_PARTY_KEY_STILL_REQUIRED)}</p>
      <p className="muted">{t(AUTH_THIRD_PARTY_OWN_TOKEN_FIRST)}</p>
      {message && <p className="risk medium">{message}</p>}

      <div className="log-row">
        <span className={data.configured ? "secure" : "muted"}>
          {data.configured ? <ShieldCheck size={15}/> : <ShieldOff size={15}/>} {data.configured ? t("Diese Umgebung nimmt Token fremder Dienste an.") : t("Diese Umgebung nimmt kein fremdes Token an.")}
        </span>
        <small>{t("Ohne hinterlegten Anbieter wird nichts geholt und nichts geprüft.")}</small>
      </div>

      {data.providers.length === 0 && <p className="muted">{t("Kein fremder Anbieter hinterlegt.")}</p>}
      {data.providers.map((provider) => <div className="console-card preview-card" key={provider.id}>
        <div className="card-head">
          <div><span>{t("ANBIETER")}</span><h3>{provider.name}</h3></div>
          <div>
            <button className="plain-button" onClick={() => { setMessage(""); setRemoving(provider.id); }} disabled={saving}>
              <Trash2 size={14}/> <StableLabel current={t("Entfernen")} variants={tAll("Entfernen")}/>
            </button>
          </div>
        </div>
        <div className="log-row"><span className="muted">{t("Aussteller")}</span><code>{provider.issuer}</code></div>
        <div className="log-row"><span className="muted">{t("Schlüsselsatz")}</span><code>{provider.jwksUri}</code></div>
        <div className="log-row"><span className="muted">{t("Erwartetes Publikum")}</span><code>{provider.audiences.join(", ")}</code></div>
        <div className="log-row"><span className="muted">{t("Anspruch für die Identität")}</span><code>{provider.subjectClaim}</code></div>
        <div className="log-row"><span className="muted">{t("Anspruch für die Rolle")}</span><code>{provider.roleClaim ?? t("Keiner")}</code></div>
        <div className="log-row"><span className="muted">{t("Rolle ohne Anspruch")}</span><code>{provider.defaultRole}</code></div>
        <div className="log-row"><span className="muted">{t("Angelegt")}</span><small>{formatMoment(provider.createdAt)}</small></div>
        <small className="muted">{roleNote(provider.defaultRole)}</small>
        {removing === provider.id && <div className="console-card preview-card">
          <div className="card-head"><div><span>{t("VORSCHAU")}</span><h3>{t("Anbieter entfernen")}</h3></div><ShieldAlert size={18}/></div>
          <p className="risk medium">{t("Entfernen wirkt sofort. Jedes Token dieses Ausstellers fällt danach, auch die noch gültigen.")}</p>
          <div className="log-row"><span className="muted">{t("Aussteller")}</span><code>{provider.issuer}</code></div>
          <div className="log-row">
            <button className="secondary-button" onClick={() => void remove(provider.id)} disabled={saving}>
              <StableLabel current={saving ? t("Wird entfernt…") : t("Jetzt entfernen")} variants={tAll("Wird entfernt…", "Jetzt entfernen")}/>
            </button>
            <button className="plain-button" onClick={() => setRemoving(null)} disabled={saving}>{t("Abbrechen")}</button>
          </div>
        </div>}
      </div>)}

      <div className="console-card preview-card">
        <div className="card-head"><div><span>{t("NEU")}</span><h3>{t("Einen fremden Anbieter hinterlegen")}</h3></div><Fingerprint size={18}/></div>
        <p className="muted">{t(AUTH_THIRD_PARTY_NO_DISCOVERY)}</p>
        <div className="log-row">
          <label>{t("Name")}<input
            type="text" value={name} maxLength={63} disabled={saving || full}
            aria-label={t("Name")}
            onChange={(event) => edit(() => setName(event.target.value))}
          /></label>
          <small>{t("Nur eine Beschriftung; er wandert in kein Token.")}</small>
        </div>
        <div className="log-row">
          <label>{t("Aussteller")}<input
            type="text" value={issuer} maxLength={512} disabled={saving || full}
            aria-label={t("Aussteller")}
            onChange={(event) => edit(() => setIssuer(event.target.value))}
          /></label>
          <small>{t("Genau der Wert des Anspruchs iss, ohne Schrägstrich am Ende.")}</small>
        </div>
        {trailingSlash && <p className="risk medium">{t(AUTH_THIRD_PARTY_REJECTIONS.issuer_trailing_slash)}</p>}
        <div className="log-row">
          <label>{t("Schlüsselsatz")}<input
            type="text" value={jwksUri} maxLength={512} disabled={saving || full}
            aria-label={t("Schlüsselsatz")}
            onChange={(event) => edit(() => setJwksUri(event.target.value))}
          /></label>
          <small>{t("Die volle https-Adresse des JWKS.")}</small>
        </div>
        <div className="log-row">
          <label>{t("Erwartetes Publikum, durch Komma getrennt")}<input
            type="text" value={audiencesRaw} maxLength={512} disabled={saving || full}
            aria-label={t("Erwartetes Publikum, durch Komma getrennt")}
            onChange={(event) => edit(() => setAudiencesRaw(event.target.value))}
          /></label>
          <small>{t("Erlaubt:")} {formatNumber(data.bounds.audiences.min)} {t("bis")} {formatNumber(data.bounds.audiences.max)}</small>
        </div>
        <div className="log-row">
          <label>{t("Anspruch für die Identität")}<input
            type="text" value={subjectClaim} maxLength={127} disabled={saving || full}
            aria-label={t("Anspruch für die Identität")}
            onChange={(event) => edit(() => setSubjectClaim(event.target.value))}
          /></label>
          <small>{t("Wird der Anspruch sub in der Zeilensicherheit.")}</small>
        </div>
        <div className="log-row">
          <label>{t("Anspruch für die Rolle, leer für keinen")}<input
            type="text" value={roleClaim} maxLength={127} disabled={saving || full}
            aria-label={t("Anspruch für die Rolle, leer für keinen")}
            onChange={(event) => edit(() => setRoleClaim(event.target.value))}
          /></label>
          <small>{t("Erlaubte Werte im Token:")} {data.roles.join(", ")}</small>
        </div>
        <div className="log-row">
          {/* 2.133: Dasselbe Menue wie oben in der Kopfzeile statt eines
              `select` des Betriebssystems. Der Rollenname ist ein Bezeichner
              und wird nicht uebersetzt; die Erklaerzeile ist derselbe Satz, den
              die Seite unter dem Feld und in der Rollenliste zeigt, und sie
              sagt, was die Rolle darf. */}
          <label>{t("Rolle ohne Anspruch")}
            <OptionMenu value={defaultRole} align="left" disabled={saving || full}
              ariaLabel={t("Rolle ohne Anspruch")} listLabel={t("Rolle ohne Anspruch wählen")}
              onChange={(next) => edit(() => setDefaultRole(next))}
              options={data.roles.map((role) => {
                // `roleNote` gibt den Rollennamen zurueck, wenn es zu ihm keinen
                // Satz gibt. Als Erklaerzeile waere das der Titel noch einmal.
                const note = roleNote(role);
                return { id: role, label: role, hint: note === role ? undefined : note };
              })}/>
          </label>
          <small>{roleNote(defaultRole)}</small>
        </div>
        <p className="muted">{t(AUTH_THIRD_PARTY_ROLE_MAPPING)}</p>
        <p className="risk medium">{t(AUTH_THIRD_PARTY_NO_SILENT_DOWNGRADE)}</p>
        {full && <p className="risk medium">{t(AUTH_THIRD_PARTY_REJECTIONS.too_many_providers)}</p>}

        {!preview && <div className="log-row">
          <button className="secondary-button" onClick={() => { setMessage(""); setPreview(true); }} disabled={saving || blocked}>
            <StableLabel current={t("Eintrag prüfen")} variants={tAll("Eintrag prüfen")}/>
          </button>
          {!complete && !full && <small>{t("Name, Aussteller, Schlüsselsatz und Publikum fehlen noch.")}</small>}
        </div>}

        {preview && <div className="console-card preview-card">
          <div className="card-head"><div><span>{t("VORSCHAU")}</span><h3>{t("Anbieter anlegen")}</h3></div><ShieldAlert size={18}/></div>
          <p className="risk medium">{t("Anlegen wirkt sofort für diese Umgebung: Ab dem nächsten Aufruf nimmt die Data API Token dieses Ausstellers an.")}</p>
          <div className="log-row"><span className="muted">{t("Name")}</span><code>{name.trim()}</code></div>
          <div className="log-row"><span className="muted">{t("Aussteller")}</span><code>{issuer.trim()}</code></div>
          <div className="log-row"><span className="muted">{t("Schlüsselsatz")}</span><code>{jwksUri.trim()}</code></div>
          <div className="log-row"><span className="muted">{t("Erwartetes Publikum")}</span><code>{audiences.join(", ")}</code></div>
          <div className="log-row"><span className="muted">{t("Anspruch für die Identität")}</span><code>{subjectClaim.trim() || "sub"}</code></div>
          <div className="log-row"><span className="muted">{t("Anspruch für die Rolle")}</span><code>{roleClaim.trim() || t("Keiner")}</code></div>
          <div className="log-row"><span className="muted">{t("Rolle ohne Anspruch")}</span><code>{defaultRole}</code></div>
          <div className="log-row">
            <button className="secondary-button" onClick={() => void create()} disabled={saving}>
              <StableLabel current={saving ? t("Wird angelegt…") : t("Jetzt anlegen")} variants={tAll("Wird angelegt…", "Jetzt anlegen")}/>
            </button>
            <button className="plain-button" onClick={() => setPreview(false)} disabled={saving}>{t("Abbrechen")}</button>
          </div>
        </div>}
      </div>
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("PRÜFUNG")}</span><h3>{t("Was an einem fremden Token geprüft wird")}</h3></div><ShieldCheck size={18}/></div>
      <p className="muted">{t(AUTH_THIRD_PARTY_CHECKS)}</p>
      <p className="muted">{t(AUTH_THIRD_PARTY_ALGORITHM_FROM_LIST)}</p>
      <div className="log-row">
        <span>{t("Geprüfte Verfahren")}</span>
        <code>{data.algorithms.join(", ")}</code>
      </div>
      <p className="risk medium">{t(AUTH_THIRD_PARTY_HOLE_NONE)}</p>
      <p className="risk medium">{t(AUTH_THIRD_PARTY_HOLE_SYMMETRIC)}</p>
      <p className="muted">{t(AUTH_THIRD_PARTY_CLOCK_SKEW)}</p>
      <p className="muted">{t(AUTH_THIRD_PARTY_EXPIRY_REQUIRED)}</p>
      <p className="risk medium">{t(AUTH_THIRD_PARTY_NO_LIFETIME_CAP)}</p>
      {/* Die Gruende sind hier aufgelistet, weil die Data API sie dem Aufrufer
          nicht gibt: ein 401 und sonst nichts. Wer erfaehrt, ob sein Publikum
          oder seine Unterschrift nicht gepasst hat, bekommt ein Werkzeug zum
          Probieren. */}
      <div className="log-row">
        <span className="muted">{t("Ein abgewiesenes Token bekommt einen 401 und keinen Grund. Wonach geprüft wird, steht hier:")}</span>
      </div>
      {(Object.keys(AUTH_THIRD_PARTY_REFUSALS) as AuthThirdPartyRefusalId[]).map((refusal) => <div className="log-row" key={refusal}>
        <code>{refusal}</code>
        <small>{t(AUTH_THIRD_PARTY_REFUSALS[refusal])}</small>
      </div>)}
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("ROLLE")}</span><h3>{t("Welche Rolle ein fremdes Token bekommt")}</h3></div><KeyRound size={18}/></div>
      <p className="risk medium">{t(AUTH_THIRD_PARTY_ROLE_CEILING)}</p>
      <p className="muted">{t(AUTH_THIRD_PARTY_ROLE_WHY)}</p>
      <p className="muted">{t(AUTH_THIRD_PARTY_ROLE_WHERE)}</p>
      <p className="muted">{t(AUTH_THIRD_PARTY_ROLE_ALTERNATIVE)}</p>
      {data.roles.map((role) => <div className="log-row" key={role}>
        <code>{role}</code>
        <small>{roleNote(role)}</small>
      </div>)}
      <div className="log-row">
        <code>{data.forbiddenRole}</code>
        <small className="risk medium">{roleNote(data.forbiddenRole)}</small>
      </div>
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("ZEILENSICHERHEIT")}</span><h3>{t("Wie die Ansprüche in die Policies kommen")}</h3></div><ShieldCheck size={18}/></div>
      <p className="muted">{t(AUTH_THIRD_PARTY_SAME_RLS_PATH)}</p>
      <p className="muted">{t(AUTH_THIRD_PARTY_ISS_IN_CLAIMS)}</p>
      <p className="muted">{t(AUTH_THIRD_PARTY_EXTERNAL_CLAIMS)}</p>
      <p className="muted">{t(AUTH_THIRD_PARTY_OWN_CLAIMS_WIN)}</p>
      <p className="muted">{t(AUTH_THIRD_PARTY_NO_INVENTED_CLAIMS)}</p>
      <div className="log-row">
        <span>{t("Ansprüche, die QKERN selbst setzt")}</span>
        <code>{data.ownClaims.join(", ")}</code>
      </div>
      <div className="log-row">
        <span>{t("Höchstens Ansprüche aus dem fremden Token")}</span>
        <small>{formatNumber(data.bounds.externalClaims.max)} · {formatNumber(data.bounds.externalBytes.max)} {t("Byte")}</small>
      </div>
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("SCHLÜSSELSATZ")}</span><h3>{t("Wie QKERN die Schlüssel holt")}</h3></div><KeyRound size={18}/></div>
      <p className="muted">{t(AUTH_THIRD_PARTY_JWKS_WHEN)}</p>
      <p className="muted">{t(AUTH_THIRD_PARTY_JWKS_LIMITS)}</p>
      <p className="muted">{t(AUTH_THIRD_PARTY_JWKS_EGRESS)}</p>
      <p className="risk medium">{t(AUTH_THIRD_PARTY_JWKS_FAILURE)}</p>
      <p className="muted">{t(AUTH_THIRD_PARTY_JWKS_ROTATION)}</p>
      <div className="log-row">
        <span>{t("Frist beim Holen")}</span>
        <small>{formatNumber(data.bounds.jwksTimeoutMs)} {t("Millisekunden")}</small>
      </div>
      <div className="log-row">
        <span>{t("Wie lange ein Satz gehalten wird")}</span>
        <small>{formatNumber(data.bounds.jwksTtlSeconds)} {t("Sekunden")}</small>
      </div>
      <div className="log-row">
        <span>{t("Höchstens Schlüssel je Satz")}</span>
        <small>{formatNumber(data.bounds.jwksKeys.max)}</small>
      </div>
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("NICHT GEBAUT")}</span><h3>{t("Was diese Seite nicht hält")}</h3></div><ShieldAlert size={18}/></div>
      <p className="muted">{t(AUTH_THIRD_PARTY_NO_EDIT)}</p>
      <p className="muted">{t(AUTH_THIRD_PARTY_NO_TEST_CALL)}</p>
      <p className="muted">{t(AUTH_THIRD_PARTY_NO_DISCOVERY)}</p>
      <p className="risk medium">{t(AUTH_THIRD_PARTY_NO_ACCOUNT_FEATURES)}</p>
      <p className="muted">{t(AUTH_THIRD_PARTY_NO_LIST)}</p>
      <p className="risk medium">{t(AUTH_THIRD_PARTY_NO_LIFETIME_CAP)}</p>
    </article>
  </div>;
}
