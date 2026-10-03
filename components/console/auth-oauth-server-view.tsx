"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, RefreshCw, ShieldAlert, ShieldCheck, ShieldOff, Trash2, UserCheck, Waypoints } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment, formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import {
  AUTH_OAUTH_CLAIMS_FOR_POLICIES,
  AUTH_OAUTH_CODE_BINDINGS,
  AUTH_OAUTH_CODE_CONSUMED_FIRST,
  AUTH_OAUTH_CODE_WHAT,
  AUTH_OAUTH_CONSENT_EXACT_SCOPES,
  AUTH_OAUTH_CONSENT_IS_A_ROW,
  AUTH_OAUTH_CONSENT_PROVES_NOT,
  AUTH_OAUTH_CONSENT_REQUIRED,
  AUTH_OAUTH_CONSENT_SAME_TWICE,
  AUTH_OAUTH_CONSENTS_OWN_PAGE,
  AUTH_OAUTH_CONSTANT_TIME,
  AUTH_OAUTH_DATA_API_ONLY,
  AUTH_OAUTH_DISABLED_USER,
  AUTH_OAUTH_GRANT_LIST,
  AUTH_OAUTH_GRANT_LIST_TRUNCATED,
  AUTH_OAUTH_KEY_STILL_REQUIRED,
  AUTH_OAUTH_NAME_IS_CLIENT_ID,
  AUTH_OAUTH_NO_CLEANUP,
  AUTH_OAUTH_NO_CONFIDENTIAL_CLIENT,
  AUTH_OAUTH_NO_CONSENT_SCREEN,
  AUTH_OAUTH_NO_DISCOVERY,
  AUTH_OAUTH_NO_EDIT,
  AUTH_OAUTH_NO_RATE_LIMIT,
  AUTH_OAUTH_NO_REASON_ON_EXCHANGE,
  AUTH_OAUTH_NO_REDIRECT,
  AUTH_OAUTH_NO_SELF_SERVICE_REVOCATION,
  AUTH_OAUTH_NO_SESSION,
  AUTH_OAUTH_NO_SILENT_NARROWING,
  AUTH_OAUTH_NO_TABLE_SCOPES,
  AUTH_OAUTH_NOT_A_SESSION_TOKEN,
  AUTH_OAUTH_OMISSION_TEXTS,
  AUTH_OAUTH_ONE_FLOW,
  AUTH_OAUTH_OPAQUE_COST,
  AUTH_OAUTH_PUBLIC_CLIENT,
  AUTH_OAUTH_REJECTIONS,
  AUTH_OAUTH_REPLAY_REFUSED,
  AUTH_OAUTH_REVOCATION,
  AUTH_OAUTH_REVOCATION_KEEPS_THE_ROW,
  AUTH_OAUTH_REVOCATION_PER_CONSENT,
  AUTH_OAUTH_ROLE_ALTERNATIVE,
  AUTH_OAUTH_ROLE_CEILING,
  AUTH_OAUTH_ROLE_WHERE,
  AUTH_OAUTH_ROLE_WHY,
  AUTH_OAUTH_S256_ONLY,
  AUTH_OAUTH_SAME_RLS_PATH,
  AUTH_OAUTH_SCOPE_TEXTS,
  AUTH_OAUTH_SCOPES_NOT_EVERYTHING,
  AUTH_OAUTH_SCOPES_WHAT,
  AUTH_OAUTH_SCOPES_WHERE_THEY_ACT,
  AUTH_OAUTH_TARGET_IS_A_BINDING,
  AUTH_OAUTH_TOKEN_LIFETIME,
  AUTH_OAUTH_VERSUS_THIRD_PARTY,
  AUTH_OAUTH_WHAT,
  AUTH_OAUTH_WHY_NO_SECRET,
  AUTH_OAUTH_WHY_OPAQUE,
  type AuthOAuthOmissionId,
  type AuthOAuthRejectionId,
  type AuthOAuthScopeId,
} from "@/lib/console/auth-oauth-server-texts";

/**
 * Auth → OAuth-Server (2.82), an der Stelle, an der bis hierher der Platzhalter
 * stand.
 *
 * Der Platzhalter sagte: „QKERN selbst als OAuth-Anbieter für andere Apps. Für
 * die AI Bridge vorgesehen, noch nicht gebaut.“ Gebaut ist jetzt genau ein
 * Ablauf, Authorization Code mit PKCE, und die Seite sagt an derselben Stelle,
 * welche drei Verfahren daneben nicht gebaut sind und warum keines davon ein
 * Versehen ist.
 *
 * Die Seite kann genau zwei Dinge: einen Client anlegen und einen entfernen. Es
 * gibt kein Bearbeiten, und die Seite sagt, warum. Vor dem Anlegen und vor dem
 * Entfernen steht eine vollständige Vorschau; erst danach gibt es den Knopf, der
 * es wirklich tut. Dieselbe Bauart wie Auth → Fremde Anbieter (2.80).
 *
 * Die Bereiche, die Rolle, die verbotene Rolle, die nicht gebauten Verfahren und
 * die Grenzen kommen aus der Antwort der Route und nicht aus dieser Datei. Was
 * ein Token umfasst, entscheidet der Dienst, und die Seite soll es nicht aus
 * eigenem Wissen behaupten.
 *
 * ## Was 2.92 hinzufügt
 *
 * Eine Zustimmung ist eine Zeile, und die Seite zeigt sie: je Client, wer
 * zugestimmt hat, zu welchen Bereichen, seit wann, ob sie noch gilt, und ein
 * Knopf, der genau diese eine zurücknimmt. Kein Token, kein Code, keine
 * Prüfsumme; wer wissen will, was eine Anwendung getan hat, liest das
 * Audit-Log.
 *
 * Die drei Sätze oben bleiben in dieser Reihenfolge stehen, weil sie zusammen
 * die Wahrheit ergeben und einzeln nicht: Es gibt keine Zustimmungsseite von
 * QKERN; was stattdessen belegt ist, ist eine Zeile mit Zeitpunkt und
 * Bereichen; und was auch damit nicht belegt ist, ist, dass ein Mensch eine
 * Liste gelesen hat.
 *
 * Zwei Knöpfe nehmen hier etwas zurück, und sie tun Verschiedenes. Der Widerruf
 * einer Zustimmung lässt ihre Zeile stehen, mit beiden Zeitpunkten. Das
 * Entfernen des Clients nimmt seine Zustimmungen wirklich mit. Beide Vorschauen
 * sagen das, bevor jemand klickt.
 */
type Environment = "development" | "staging" | "production";

type Client = {
  id: string;
  name: string;
  redirectUris: string[];
  scopes: string[];
  createdAt: string;
};

/** Eine Zustimmung, wie die Route sie zeigt: ohne Token, ohne Code, ohne Geheimnis. */
type Consent = {
  id: string;
  clientId: string;
  clientName: string;
  userId: string;
  email: string;
  scopes: string[];
  grantedAt: string;
  revokedAt: string | null;
};

type OAuthServer = {
  clients: Client[];
  consents: Consent[];
  consentsTruncated: boolean;
  scopes: string[];
  role: string;
  forbiddenRole: string;
  unsupportedGrants: string[];
  grant: string;
  challengeMethod: string;
  bounds: {
    clients: { max: number };
    consents: { max: number };
    redirectUris: { min: number; max: number };
    redirectUriLength: number;
    codeTtlSeconds: number;
    tokenTtlSeconds: number;
    tokenLength: number;
  };
  configured: boolean;
};

/** Die Liste als Text im Feld, und zurück. Leer heisst leer, nicht [""]. */
function targetList(raw: string): string[] {
  return raw.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean);
}

export function AuthOAuthServerView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading" | "ready" | "unavailable" | "error" }) {
  const route = `/api/v1/projects/${projectId}/environments/${environment}/auth/admin/oauth-clients`;
  // Die Zustimmungen kommen in derselben Antwort wie die Clients; nur ihr
  // Widerruf hat eine eigene Adresse.
  const consentRoute = `/api/v1/projects/${projectId}/environments/${environment}/auth/admin/oauth-consents`;
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">(initialState ?? "loading");
  const [data, setData] = useState<OAuthServer | null>(null);
  const [name, setName] = useState("");
  const [targetsRaw, setTargetsRaw] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
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
      setData(payload.data as OAuthServer);
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
    const reason = payload.reason as AuthOAuthRejectionId | undefined;
    if (reason && reason in AUTH_OAUTH_REJECTIONS) return t(AUTH_OAUTH_REJECTIONS[reason]);
    return payload.error ?? fallback;
  }

  async function create() {
    setSaving(true);
    try {
      const response = await fetch(route, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client: { name: name.trim(), redirectUris: targetList(targetsRaw), scopes },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.data) {
        setMessage(explain(payload, t("Der OAuth-Client konnte nicht angelegt werden.")));
        return;
      }
      setData(payload.data as OAuthServer);
      setPreview(false); setMessage("");
      setName(""); setTargetsRaw(""); setScopes([]);
    } catch { setMessage(t("Der OAuth-Client konnte nicht angelegt werden.")); }
    finally { setSaving(false); }
  }

  async function remove(clientId: string) {
    setRemoving(null);
    setSaving(true);
    try {
      const response = await fetch(`${route}/${clientId}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.data) {
        setMessage(explain(payload, t("Der OAuth-Client konnte nicht entfernt werden.")));
        return;
      }
      setData(payload.data as OAuthServer);
      setMessage("");
    } catch { setMessage(t("Der OAuth-Client konnte nicht entfernt werden.")); }
    finally { setSaving(false); }
  }

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Der OAuth-Server wird geladen…")}</h3></div>;
  }
  if (state === "unavailable" || state === "error" || !data) {
    return <div className="console-card live-module-state"><ShieldOff size={26}/>
      <h3>{state === "unavailable" ? t("Project Auth nicht aktiviert") : t("OAuth-Server nicht verfügbar")}</h3>
      <p>{message}</p>
      <button className="secondary-button" onClick={() => void load(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  const targets = targetList(targetsRaw);
  const full = data.clients.length >= data.bounds.clients.max;
  const complete = name.trim().length > 1 && targets.length >= data.bounds.redirectUris.min &&
    scopes.length > 0;
  const blocked = !complete || full || targets.length > data.bounds.redirectUris.max;
  const scopeNote = (scope: string) => scope in AUTH_OAUTH_SCOPE_TEXTS
    ? t(AUTH_OAUTH_SCOPE_TEXTS[scope as AuthOAuthScopeId])
    : scope;

  function edit(change: () => void) {
    setPreview(false); setMessage(""); change();
  }

  function toggleScope(scope: string) {
    edit(() => setScopes((current) => current.includes(scope)
      ? current.filter((entry) => entry !== scope)
      : [...current, scope]));
  }

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div>
        <span>{t("OAUTH-CLIENTS")}</span>
        <strong>{formatNumber(data.clients.length)}</strong>
        <small>{t("von höchstens")} {formatNumber(data.bounds.clients.max)}</small>
      </div>
      <div>
        <span>{t("ROLLE EINES TOKENS")}</span>
        <strong>{data.role}</strong>
        <small>{t("nie")} {data.forbiddenRole}</small>
      </div>
      <div>
        <span>{t("GEBAUTE VERFAHREN")}</span>
        <strong>{formatNumber(1)}</strong>
        <small>{data.grant} · {data.challengeMethod}</small>
      </div>
    </article>

    <article className="console-card span-2">
      <div className="card-head">
        <div><span>{t("PROJECT AUTH")} · {environment.toUpperCase()}</span><h3>{t("QKERN gibt Token an fremde Anwendungen aus")}</h3></div>
        <div>
          <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing || saving}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
        </div>
      </div>

      <p className="muted">{t(AUTH_OAUTH_WHAT)}</p>
      {/* Der Unterschied zu den fremden Anbietern steht oben und nicht in einer
          Fussnote: Die beiden Seiten sehen einander aehnlich und meinen das
          Gegenteil. */}
      <p className="muted">{t(AUTH_OAUTH_VERSUS_THIRD_PARTY)}</p>
      <p className="muted">{t(AUTH_OAUTH_ONE_FLOW)}</p>
      <p className="muted">{t(AUTH_OAUTH_NO_REDIRECT)}</p>
      <p className="risk medium">{t(AUTH_OAUTH_NO_CONSENT_SCREEN)}</p>
      {/* Der Satz zur fehlenden Seite steht weiter oben und bleibt stehen. Was
          danebengehoert, ist das, was stattdessen belegt ist, und die Grenze
          davon: Beides steht hier und nicht in einer Fussnote. */}
      <p className="muted">{t(AUTH_OAUTH_CONSENT_IS_A_ROW)}</p>
      <p className="risk medium">{t(AUTH_OAUTH_CONSENT_PROVES_NOT)}</p>
      <p className="muted">{t(AUTH_OAUTH_KEY_STILL_REQUIRED)}</p>
      <p className="muted">{t(AUTH_OAUTH_DATA_API_ONLY)}</p>
      {message && <p className="risk medium">{message}</p>}

      <div className="log-row">
        <span className={data.configured ? "secure" : "muted"}>
          {data.configured ? <ShieldCheck size={15}/> : <ShieldOff size={15}/>} {data.configured ? t("Diese Umgebung gibt Token an fremde Anwendungen aus.") : t("Diese Umgebung gibt kein Token an eine fremde Anwendung aus.")}
        </span>
        <small>{t("Ohne hinterlegten Client wird kein Code ausgegeben und kein Token eingelöst.")}</small>
      </div>

      {data.clients.length === 0 && <p className="muted">{t("Kein OAuth-Client hinterlegt.")}{" "}{t("Ein Client ist die fremde Anwendung, der ein Nutzer Zugriff auf seine Daten in deiner Anwendung geben kann. Das Formular darüber legt den ersten an.")}</p>}
      {data.clients.map((client) => <div className="console-card preview-card" key={client.id}>
        <div className="card-head">
          <div><span>{t("CLIENT")}</span><h3>{client.name}</h3></div>
          <div>
            <button className="plain-button" onClick={() => { setMessage(""); setRemoving(client.id); }} disabled={saving}>
              <Trash2 size={14}/> <StableLabel current={t("Entfernen")} variants={tAll("Entfernen")}/>
            </button>
          </div>
        </div>
        <div className="log-row"><span className="muted">{t("client_id")}</span><code>{client.name}</code></div>
        {client.redirectUris.map((uri) => <div className="log-row" key={uri}>
          <span className="muted">{t("Rücksprungziel")}</span><code>{uri}</code>
        </div>)}
        <div className="log-row"><span className="muted">{t("Bereiche")}</span><code>{client.scopes.join(" ")}</code></div>
        <div className="log-row"><span className="muted">{t("Geheimnis")}</span><small>{t("Keines. Dieser Client ist öffentlich und wird über PKCE geschützt.")}</small></div>
        <div className="log-row"><span className="muted">{t("Angelegt")}</span><small>{formatMoment(client.createdAt)}</small></div>
        {client.scopes.map((scope) => <small className="muted" key={scope}>{scopeNote(scope)}</small>)}
        <div className="log-row"><span className="muted">{t("Zustimmungen")}</span>
          <small>{formatNumber(data.consents.filter((consent) => consent.clientId === client.id).length)}</small>
        </div>
        {data.consents.filter((consent) => consent.clientId === client.id).length === 0 &&
          <small className="muted">{t("Diesem Client hat noch niemand zugestimmt.")}</small>}
        {removing === client.id && <div className="console-card preview-card">
          <div className="card-head"><div><span>{t("VORSCHAU")}</span><h3>{t("Client entfernen")}</h3></div><ShieldAlert size={18}/></div>
          <p className="risk medium">{t("Entfernen wirkt sofort. Alle Token dieses Clients fallen, von allen Nutzern, auch die noch gültigen.")}</p>
          <p className="risk medium">{t("Und die Zustimmungen dieses Clients verschwinden wirklich, samt ihren Zeitpunkten. Das ist der Unterschied zum Widerruf einer einzelnen Zustimmung, der die Zeile stehen lässt.")}</p>
          <div className="log-row"><span className="muted">{t("client_id")}</span><code>{client.name}</code></div>
          <div className="log-row">
            <button className="secondary-button" onClick={() => void remove(client.id)} disabled={saving}>
              <StableLabel current={saving ? t("Wird entfernt…") : t("Jetzt entfernen")} variants={tAll("Wird entfernt…", "Jetzt entfernen")}/>
            </button>
            <button className="plain-button" onClick={() => setRemoving(null)} disabled={saving}>{t("Abbrechen")}</button>
          </div>
        </div>}
      </div>)}

      <div className="console-card preview-card">
        <div className="card-head"><div><span>{t("NEU")}</span><h3>{t("Einen OAuth-Client hinterlegen")}</h3></div><Waypoints size={18}/></div>
        <p className="muted">{t(AUTH_OAUTH_PUBLIC_CLIENT)}</p>
        <p className="muted">{t(AUTH_OAUTH_WHY_NO_SECRET)}</p>
        <div className="log-row">
          <label>{t("Name")}<input
            type="text" value={name} maxLength={63} disabled={saving || full}
            aria-label={t("Name")}
            onChange={(event) => edit(() => setName(event.target.value))}
          /></label>
          <small>{t(AUTH_OAUTH_NAME_IS_CLIENT_ID)}</small>
        </div>
        <div className="log-row">
          <label>{t("Rücksprungziele, durch Komma oder Leerzeichen getrennt")}<input
            type="text" value={targetsRaw} maxLength={1024} disabled={saving || full}
            aria-label={t("Rücksprungziele, durch Komma oder Leerzeichen getrennt")}
            onChange={(event) => edit(() => setTargetsRaw(event.target.value))}
          /></label>
          <small>{t("Erlaubt:")} {formatNumber(data.bounds.redirectUris.min)} {t("bis")} {formatNumber(data.bounds.redirectUris.max)}</small>
        </div>
        <p className="muted">{t(AUTH_OAUTH_TARGET_IS_A_BINDING)}</p>
        <div className="log-row"><span>{t("Bereiche")}</span></div>
        {data.scopes.map((scope) => <div className="log-row" key={scope}>
          <label>
            <input
              type="checkbox" checked={scopes.includes(scope)} disabled={saving || full}
              aria-label={scope}
              onChange={() => toggleScope(scope)}
            />
            <code>{scope}</code>
          </label>
          <small>{scopeNote(scope)}</small>
        </div>)}
        <p className="muted">{t(AUTH_OAUTH_SCOPES_WHAT)}</p>
        <p className="muted">{t(AUTH_OAUTH_SCOPES_WHERE_THEY_ACT)}</p>
        <p className="muted">{t(AUTH_OAUTH_SCOPES_NOT_EVERYTHING)}</p>
        <p className="risk medium">{t(AUTH_OAUTH_NO_SILENT_NARROWING)}</p>
        {full && <p className="risk medium">{t(AUTH_OAUTH_REJECTIONS.too_many_clients)}</p>}

        {!preview && <div className="log-row">
          <button className="secondary-button" onClick={() => { setMessage(""); setPreview(true); }} disabled={saving || blocked}>
            <StableLabel current={t("Eintrag prüfen")} variants={tAll("Eintrag prüfen")}/>
          </button>
          {!complete && !full && <small>{t("Name, Rücksprungziel und mindestens ein Bereich fehlen noch.")}</small>}
        </div>}

        {preview && <div className="console-card preview-card">
          <div className="card-head"><div><span>{t("VORSCHAU")}</span><h3>{t("Client anlegen")}</h3></div><ShieldAlert size={18}/></div>
          <p className="risk medium">{t("Anlegen wirkt sofort für diese Umgebung: Ab dem nächsten Aufruf kann diese Anwendung einen Nutzer um Zustimmung bitten.")}</p>
          <div className="log-row"><span className="muted">{t("client_id")}</span><code>{name.trim()}</code></div>
          {targets.map((uri) => <div className="log-row" key={uri}>
            <span className="muted">{t("Rücksprungziel")}</span><code>{uri}</code>
          </div>)}
          <div className="log-row"><span className="muted">{t("Bereiche")}</span><code>{scopes.join(" ")}</code></div>
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
      <div className="card-head"><div><span>{t("DER CODE")}</span><h3>{t("Was zwischen Zustimmung und Token passiert")}</h3></div><ShieldCheck size={18}/></div>
      <p className="muted">{t(AUTH_OAUTH_CODE_WHAT)}</p>
      <p className="muted">{t(AUTH_OAUTH_CODE_BINDINGS)}</p>
      <p className="muted">{t(AUTH_OAUTH_CODE_CONSUMED_FIRST)}</p>
      <p className="risk medium">{t(AUTH_OAUTH_REPLAY_REFUSED)}</p>
      <p className="muted">{t(AUTH_OAUTH_S256_ONLY)}</p>
      <p className="muted">{t(AUTH_OAUTH_CONSTANT_TIME)}</p>
      <p className="muted">{t(AUTH_OAUTH_NO_REASON_ON_EXCHANGE)}</p>
      <div className="log-row">
        <span>{t("Wie lange ein Code gilt")}</span>
        <small>{formatNumber(data.bounds.codeTtlSeconds)} {t("Sekunden")}</small>
      </div>
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("DAS TOKEN")}</span><h3>{t("Was QKERN ausgibt, und was es nicht ist")}</h3></div><KeyRound size={18}/></div>
      <p className="muted">{t(AUTH_OAUTH_NOT_A_SESSION_TOKEN)}</p>
      <p className="muted">{t(AUTH_OAUTH_WHY_OPAQUE)}</p>
      <p className="muted">{t(AUTH_OAUTH_OPAQUE_COST)}</p>
      <p className="muted">{t(AUTH_OAUTH_TOKEN_LIFETIME)}</p>
      <p className="muted">{t(AUTH_OAUTH_NO_SESSION)}</p>
      <p className="muted">{t(AUTH_OAUTH_DISABLED_USER)}</p>
      <div className="log-row">
        <span>{t("Wie lange ein Token gilt")}</span>
        <small>{formatNumber(data.bounds.tokenTtlSeconds)} {t("Sekunden")}</small>
      </div>
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("ROLLE")}</span><h3>{t("Welche Rolle ein OAuth-Token bekommt")}</h3></div><KeyRound size={18}/></div>
      <p className="risk medium">{t(AUTH_OAUTH_ROLE_CEILING)}</p>
      <p className="muted">{t(AUTH_OAUTH_ROLE_WHY)}</p>
      <p className="muted">{t(AUTH_OAUTH_ROLE_WHERE)}</p>
      <p className="muted">{t(AUTH_OAUTH_ROLE_ALTERNATIVE)}</p>
      <div className="log-row">
        <code>{data.role}</code>
        <small>{t("Die Rolle, die jedes Token dieses Ablaufs bekommt.")}</small>
      </div>
      <div className="log-row">
        <code>{data.forbiddenRole}</code>
        <small className="risk medium">{t("Die Rolle, die es nie bekommt. Es gibt keine Spalte, die sie tragen könnte.")}</small>
      </div>
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("ZEILENSICHERHEIT")}</span><h3>{t("Wie die Ansprüche in die Policies kommen")}</h3></div><ShieldCheck size={18}/></div>
      <p className="muted">{t(AUTH_OAUTH_SAME_RLS_PATH)}</p>
      <p className="muted">{t(AUTH_OAUTH_CLAIMS_FOR_POLICIES)}</p>
      <p className="muted">{t(AUTH_OAUTH_NO_TABLE_SCOPES)}</p>
      <div className="log-row">
        <span>{t("Ansprüche, die nur ein OAuth-Token trägt")}</span>
        <code>token_use, client_id, scope</code>
      </div>
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("WIDERRUF")}</span><h3>{t("Wie eine Erlaubnis wieder aufhört")}</h3></div><Trash2 size={18}/></div>
      <p className="muted">{t(AUTH_OAUTH_REVOCATION_PER_CONSENT)}</p>
      <p className="muted">{t(AUTH_OAUTH_REVOCATION_KEEPS_THE_ROW)}</p>
      <p className="muted">{t(AUTH_OAUTH_REVOCATION)}</p>
      <p className="risk medium">{t(AUTH_OAUTH_NO_SELF_SERVICE_REVOCATION)}</p>
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("ZUSTIMMUNGEN")}</span><h3>{t("Wer welchem Client was erlaubt hat")}</h3></div><UserCheck size={18}/></div>
      <p className="muted">{t(AUTH_OAUTH_GRANT_LIST)}</p>
      <p className="muted">{t(AUTH_OAUTH_CONSENT_REQUIRED)}</p>
      <p className="muted">{t(AUTH_OAUTH_CONSENT_EXACT_SCOPES)}</p>
      <p className="muted">{t(AUTH_OAUTH_CONSENT_SAME_TWICE)}</p>
      <div className="log-row">
        <span>{t("Zustimmungen in dieser Umgebung")}</span>
        <small>{formatNumber(data.consents.length)} {t("von höchstens")} {formatNumber(data.bounds.consents.max)}</small>
      </div>
      <div className="log-row">
        <span>{t("Davon noch gültig")}</span>
        <small>{formatNumber(data.consents.filter((consent) => consent.revokedAt === null).length)}</small>
      </div>
      <p className="muted">{t(AUTH_OAUTH_CONSENTS_OWN_PAGE)}</p>
      {data.consentsTruncated && <p className="risk medium">{t(AUTH_OAUTH_GRANT_LIST_TRUNCATED)}</p>}
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("NICHT GEBAUT")}</span><h3>{t("Welche Verfahren dieser Server nicht kennt")}</h3></div><ShieldAlert size={18}/></div>
      {/* Die Liste kommt aus der Antwort der Route, der Grund aus den Texten.
          Ein Verfahren, das der Dienst eines Tages kennt, verschwindet damit
          hier von selbst, und ein Grund ohne Verfahren faellt auf. */}
      {data.unsupportedGrants.map((grant) => <div className="log-row" key={grant}>
        <code>{grant}</code>
        <small>{grant in AUTH_OAUTH_OMISSION_TEXTS
          ? t(AUTH_OAUTH_OMISSION_TEXTS[grant as AuthOAuthOmissionId])
          : grant}</small>
      </div>)}
      <p className="muted">{t(AUTH_OAUTH_NO_EDIT)}</p>
      <p className="muted">{t(AUTH_OAUTH_NO_CONFIDENTIAL_CLIENT)}</p>
      <p className="muted">{t(AUTH_OAUTH_NO_DISCOVERY)}</p>
      <p className="muted">{t(AUTH_OAUTH_NO_RATE_LIMIT)}</p>
      <p className="risk medium">{t(AUTH_OAUTH_NO_CLEANUP)}</p>
    </article>
  </div>;
}
