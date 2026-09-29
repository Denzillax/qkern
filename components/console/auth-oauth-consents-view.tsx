"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, RefreshCw, ShieldAlert, ShieldCheck, ShieldOff, Trash2, UserCheck } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment, formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import {
  AUTH_CONSENTS_GROUPED_BY_USER,
  AUTH_CONSENTS_NO_USAGE,
  AUTH_CONSENTS_OPERATOR_VIEW,
  AUTH_CONSENTS_SEE_OAUTH_SERVER,
  AUTH_CONSENTS_THREE_REVOCATIONS,
  AUTH_CONSENTS_TOKEN_REVOKE_IS_A_DELETE,
  AUTH_CONSENTS_TOKEN_REVOKE_KEEPS_CONSENT,
  AUTH_CONSENTS_TOKEN_REVOKE_TRACE,
  AUTH_CONSENTS_TOKENS_EXPIRED_SHOWN,
  AUTH_CONSENTS_TOKENS_TRUNCATED,
  AUTH_CONSENTS_TOKENS_WHAT,
  AUTH_CONSENTS_WHAT,
} from "@/lib/console/auth-oauth-consents-texts";
import {
  AUTH_OAUTH_CONSENT_EXACT_SCOPES,
  AUTH_OAUTH_CONSENT_IS_A_ROW,
  AUTH_OAUTH_CONSENT_PROVES_NOT,
  AUTH_OAUTH_CONSENT_SAME_TWICE,
  AUTH_OAUTH_GRANT_LIST_TRUNCATED,
  AUTH_OAUTH_NO_CONSENT_SCREEN,
  AUTH_OAUTH_NO_SELF_SERVICE_REVOCATION,
  AUTH_OAUTH_REJECTIONS,
  AUTH_OAUTH_REVOCATION_KEEPS_THE_ROW,
  AUTH_OAUTH_SCOPE_TEXTS,
  type AuthOAuthRejectionId,
  type AuthOAuthScopeId,
} from "@/lib/console/auth-oauth-server-texts";

/**
 * Auth → Zustimmungen (2.93).
 *
 * ## Warum es diese Seite gibt
 *
 * 2.92 hat aus der Zustimmung eine Zeile gemacht und sie auf der Seite des
 * OAuth-Servers unter ihrem Client gezeigt. Die Frage, die ein Betreiber
 * wirklich stellt, geht aber vom Menschen aus: Was hat dieser Nutzer erlaubt,
 * und was ist davon gerade offen? Nach Client geordnet ist sie nur zu
 * beantworten, indem man alle Clients durchgeht.
 *
 * Diese Seite ordnet dieselbe Menge nach Nutzer und stellt daneben, was 2.92
 * gar nicht zeigte: die ausgegebenen Token. Ohne sie ist eine Zustimmung eine
 * Erlaubnis ohne sichtbare Folge, und der Widerruf eines einzelnen Zugangs
 * wäre ein Knopf ohne Liste.
 *
 * ## Woher die Daten kommen
 *
 * Aus derselben einen Antwort wie die Seite des OAuth-Servers
 * (`GET /auth/admin/oauth-clients`). Eine zweite Route für dieselben Zeilen
 * wäre eine zweite Stelle, an der eine Zustimmung anders aussehen könnte.
 * Eigene Adressen haben nur die beiden Widerrufe.
 *
 * ## Die drei Widerrufe
 *
 * Ein Token, eine Zustimmung, ein Client: drei Mengen, drei Wirkungen. Vor
 * jedem Klick steht eine Vorschau, die sagt, welche davon getroffen wird, und
 * ob die Zeile danach stehen bleibt. Das Entfernen des Clients bleibt auf der
 * Seite des OAuth-Servers, weil dort der Client hinterlegt wird.
 *
 * ## Was diese Seite nicht zeigt
 *
 * Kein Token, keine Prüfsumme, keinen Code, keinen Prüftext. Und keinen
 * Zeitpunkt der letzten Benutzung, denn den schreibt die Prüfung nirgends hin.
 */
type Environment = "development" | "staging" | "production";

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

/** Ein ausgegebenes Token, ebenfalls ohne das Token selbst. */
type IssuedToken = {
  id: string;
  clientId: string;
  clientName: string;
  userId: string;
  email: string;
  consentId: string | null;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
};

type OAuthServer = {
  clients: Array<{ id: string; name: string }>;
  consents: Consent[];
  consentsTruncated: boolean;
  tokens: IssuedToken[];
  tokensTruncated: boolean;
  bounds: { consents: { max: number }; tokens: { max: number } };
};

export function AuthOAuthConsentsView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/auth/admin`;
  const route = `${base}/oauth-clients`;
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [data, setData] = useState<OAuthServer | null>(null);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  // Zwei getrennte Zustaende, weil es zwei verschiedene Handlungen sind: Der
  // eine Widerruf laesst die Zeile stehen, der andere loescht sie.
  const [revokingConsent, setRevokingConsent] = useState<string | null>(null);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);
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
      setMessage(""); setState("ready");
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

  /**
   * Beide Widerrufe gehen denselben Weg und antworten mit demselben Stand.
   * Getrennt sind nur die Adresse und der Satz, der bei einem Fehlschlag
   * dasteht.
   */
  async function revoke(path: string, id: string, fallback: string) {
    setRevokingConsent(null); setRevokingToken(null);
    setSaving(true);
    try {
      const response = await fetch(`${base}/${path}/${id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.data) {
        setMessage(explain(payload, fallback));
        return;
      }
      setData(payload.data as OAuthServer);
      setMessage("");
    } catch { setMessage(fallback); }
    finally { setSaving(false); }
  }

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Die Zustimmungen werden geladen…")}</h3></div>;
  }
  if (state === "unavailable" || state === "error" || !data) {
    return <div className="console-card live-module-state"><ShieldOff size={26}/>
      <h3>{state === "unavailable" ? t("Project Auth nicht aktiviert") : t("Zustimmungen nicht verfügbar")}</h3>
      <p>{message}</p>
      <button className="secondary-button" onClick={() => void load(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  const scopeNote = (scope: string) => scope in AUTH_OAUTH_SCOPE_TEXTS
    ? t(AUTH_OAUTH_SCOPE_TEXTS[scope as AuthOAuthScopeId])
    : scope;
  // Die Ordnung steht hier und nicht in der Antwort: Die Route liefert nach
  // Zeitpunkt geordnet, diese Seite fasst nach Nutzer zusammen. Sortiert wird
  // nach der Adresse, damit dieselbe Menge zweimal gleich aussieht.
  const users = [...new Set(data.consents.map((consent) => consent.email))].sort();
  const standing = data.consents.filter((consent) => consent.revokedAt === null);
  const tokensOf = (consentId: string) => data.tokens.filter((token) => token.consentId === consentId);

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div>
        <span>{t("ZUSTIMMUNGEN")}</span>
        <strong>{formatNumber(data.consents.length)}</strong>
        <small>{t("von höchstens")} {formatNumber(data.bounds.consents.max)}</small>
      </div>
      <div>
        <span>{t("DAVON NOCH GÜLTIG")}</span>
        <strong>{formatNumber(standing.length)}</strong>
        <small>{formatNumber(users.length)} {t("Nutzer")}</small>
      </div>
      <div>
        <span>{t("AUSGEGEBENE TOKEN")}</span>
        <strong>{formatNumber(data.tokens.length)}</strong>
        <small>{t("von höchstens")} {formatNumber(data.bounds.tokens.max)}</small>
      </div>
    </article>

    <article className="console-card span-2">
      <div className="card-head">
        <div><span>{t("PROJECT AUTH")} · {environment.toUpperCase()}</span><h3>{t("Wer welchem Client was erlaubt hat")}</h3></div>
        <div>
          <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing || saving}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
        </div>
      </div>

      <p className="muted">{t(AUTH_CONSENTS_WHAT)}</p>
      <p className="muted">{t(AUTH_CONSENTS_GROUPED_BY_USER)}</p>
      <p className="muted">{t(AUTH_OAUTH_CONSENT_IS_A_ROW)}</p>
      <p className="risk medium">{t(AUTH_OAUTH_CONSENT_PROVES_NOT)}</p>
      <p className="risk medium">{t(AUTH_OAUTH_NO_CONSENT_SCREEN)}</p>
      <p className="risk medium">{t(AUTH_CONSENTS_OPERATOR_VIEW)}</p>
      {message && <p className="risk medium">{message}</p>}

      {data.consents.length === 0 && <p className="muted">{t("In dieser Umgebung hat noch niemand zugestimmt.")}</p>}

      {users.map((email) => <div className="console-card preview-card" key={email}>
        <div className="card-head">
          <div><span>{t("NUTZER")}</span><h3>{email}</h3></div>
          <UserCheck size={18}/>
        </div>
        {data.consents.filter((consent) => consent.email === email).map((consent) => <div key={consent.id}>
          <div className="log-row">
            <span className={consent.revokedAt === null ? "secure" : "muted"}>
              {consent.revokedAt === null ? <ShieldCheck size={15}/> : <ShieldOff size={15}/>} {consent.clientName}
            </span>
            <code>{consent.scopes.join(" ")}</code>
            {/* Zwei Schlüssel und nicht einer: Auf Deutsch ist "Widerrufen"
                zugleich der Knopf und der Zustand, in anderen Sprachen sind das
                zwei verschiedene Wörter. */}
            <small>{consent.revokedAt === null
              ? `${t("Zugestimmt am")} ${formatMoment(consent.grantedAt)}`
              : `${t("Widerrufen am")} ${formatMoment(consent.revokedAt)}`}</small>
            {consent.revokedAt === null && <button className="plain-button" onClick={() => { setMessage(""); setRevokingToken(null); setRevokingConsent(consent.id); }} disabled={saving}>
              <Trash2 size={14}/> <StableLabel current={t("Widerrufen")} variants={tAll("Widerrufen")}/>
            </button>}
          </div>
          {consent.scopes.map((scope) => <small className="muted" key={scope}>{scopeNote(scope)}</small>)}

          {revokingConsent === consent.id && <div className="console-card preview-card">
            <div className="card-head"><div><span>{t("VORSCHAU")}</span><h3>{t("Zustimmung widerrufen")}</h3></div><ShieldAlert size={18}/></div>
            <p className="risk medium">{t("Der Widerruf wirkt sofort. Die Token dieser Zustimmung gelten ab der nächsten Anfrage nicht mehr.")}</p>
            <div className="log-row"><span className="muted">{t("Nutzer")}</span><code>{consent.email}</code></div>
            <div className="log-row"><span className="muted">{t("Bereiche")}</span><code>{consent.scopes.join(" ")}</code></div>
            <div className="log-row"><span className="muted">{t("Zugestimmt")}</span><small>{formatMoment(consent.grantedAt)}</small></div>
            <div className="log-row"><span className="muted">{t("Betroffene Token")}</span><small>{formatNumber(tokensOf(consent.id).length)}</small></div>
            <p className="muted">{t(AUTH_OAUTH_REVOCATION_KEEPS_THE_ROW)}</p>
            <div className="log-row">
              <button className="secondary-button" onClick={() => void revoke("oauth-consents", consent.id, t("Die Zustimmung konnte nicht widerrufen werden."))} disabled={saving}>
                <StableLabel current={saving ? t("Wird widerrufen…") : t("Jetzt widerrufen")} variants={tAll("Wird widerrufen…", "Jetzt widerrufen")}/>
              </button>
              <button className="plain-button" onClick={() => setRevokingConsent(null)} disabled={saving}>{t("Abbrechen")}</button>
            </div>
          </div>}

          {tokensOf(consent.id).length === 0 && <small className="muted">{t("Auf dieser Zustimmung ist kein Token ausgegeben.")}</small>}
          {tokensOf(consent.id).map((token) => <div key={token.id}>
            <div className="log-row">
              <span className="muted"><KeyRound size={15}/> {t("Token")}</span>
              <code>{token.scopes.join(" ")}</code>
              <small>{t("Ausgegeben")} {formatMoment(token.createdAt)}</small>
              <small>{t("Gültig bis")} {formatMoment(token.expiresAt)}</small>
              <button className="plain-button" onClick={() => { setMessage(""); setRevokingConsent(null); setRevokingToken(token.id); }} disabled={saving}>
                <Trash2 size={14}/> <StableLabel current={t("Widerrufen")} variants={tAll("Widerrufen")}/>
              </button>
            </div>
            {revokingToken === token.id && <div className="console-card preview-card">
              <div className="card-head"><div><span>{t("VORSCHAU")}</span><h3>{t("Token widerrufen")}</h3></div><ShieldAlert size={18}/></div>
              <p className="risk medium">{t("Der Widerruf wirkt sofort und trifft genau diesen einen Zugang. Seine Zeile wird gelöscht.")}</p>
              <div className="log-row"><span className="muted">{t("Nutzer")}</span><code>{token.email}</code></div>
              <div className="log-row"><span className="muted">{t("Client")}</span><code>{token.clientName}</code></div>
              <div className="log-row"><span className="muted">{t("Bereiche")}</span><code>{token.scopes.join(" ")}</code></div>
              <div className="log-row"><span className="muted">{t("Ausgegeben")}</span><small>{formatMoment(token.createdAt)}</small></div>
              <p className="muted">{t(AUTH_CONSENTS_TOKEN_REVOKE_KEEPS_CONSENT)}</p>
              <div className="log-row">
                <button className="secondary-button" onClick={() => void revoke("oauth-tokens", token.id, t("Das Token konnte nicht widerrufen werden."))} disabled={saving}>
                  <StableLabel current={saving ? t("Wird widerrufen…") : t("Jetzt widerrufen")} variants={tAll("Wird widerrufen…", "Jetzt widerrufen")}/>
                </button>
                <button className="plain-button" onClick={() => setRevokingToken(null)} disabled={saving}>{t("Abbrechen")}</button>
              </div>
            </div>}
          </div>)}
        </div>)}
      </div>)}

      {data.consentsTruncated && <p className="risk medium">{t(AUTH_OAUTH_GRANT_LIST_TRUNCATED)}</p>}
      {data.tokensTruncated && <p className="risk medium">{t(AUTH_CONSENTS_TOKENS_TRUNCATED)}</p>}
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("WIDERRUF")}</span><h3>{t("Was ein Widerruf jeweils zurücknimmt")}</h3></div><Trash2 size={18}/></div>
      <p className="muted">{t(AUTH_CONSENTS_THREE_REVOCATIONS)}</p>
      <p className="muted">{t(AUTH_CONSENTS_TOKEN_REVOKE_IS_A_DELETE)}</p>
      <p className="muted">{t(AUTH_CONSENTS_TOKEN_REVOKE_KEEPS_CONSENT)}</p>
      <p className="muted">{t(AUTH_OAUTH_REVOCATION_KEEPS_THE_ROW)}</p>
      <p className="muted">{t(AUTH_CONSENTS_TOKEN_REVOKE_TRACE)}</p>
      <p className="risk medium">{t(AUTH_OAUTH_NO_SELF_SERVICE_REVOCATION)}</p>
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("AUSGEGEBENE TOKEN")}</span><h3>{t("Was in der Tokenliste steht")}</h3></div><KeyRound size={18}/></div>
      <p className="muted">{t(AUTH_CONSENTS_TOKENS_WHAT)}</p>
      <p className="muted">{t(AUTH_CONSENTS_TOKENS_EXPIRED_SHOWN)}</p>
      <p className="risk medium">{t(AUTH_CONSENTS_NO_USAGE)}</p>
      <div className="log-row">
        <span>{t("Token ohne Zustimmung")}</span>
        <small>{formatNumber(data.tokens.filter((token) => token.consentId === null).length)}</small>
      </div>
      <small className="muted">{t("Solche Zeilen stammen aus der Zeit vor Migration 0064 und gelten ohnehin nicht mehr.")}</small>
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("ZUSTIMMUNGEN")}</span><h3>{t("Wann zwei Zustimmungen dieselbe sind")}</h3></div><ShieldCheck size={18}/></div>
      <p className="muted">{t(AUTH_OAUTH_CONSENT_EXACT_SCOPES)}</p>
      <p className="muted">{t(AUTH_OAUTH_CONSENT_SAME_TWICE)}</p>
      <p className="muted">{t(AUTH_CONSENTS_SEE_OAUTH_SERVER)}</p>
      <div className="log-row">
        <span>{t("Hinterlegte Clients")}</span>
        <small>{formatNumber(data.clients.length)}</small>
      </div>
    </article>
  </div>;
}
