import { recognisedByName } from "@/lib/server/errors/identity";
import type {
  ProjectAuthMfaEnrolmentCount,
  ProjectAuthMfaFactor,
  ProjectAuthRateCount,
  ProjectAuthOidcIdentity,
  ProjectAuthOneTimePurpose,
  ProjectAuthOneTimeToken,
  ProjectAuthPasskey,
  ProjectAuthPasskeyCount,
  ProjectAuthScope,
  ProjectAuthSession,
  ProjectAuthSessionSummary,
  ProjectAuthSettings,
  ProjectAuthUser,
} from "@/lib/server/project-auth/model";

import {
  DEFAULT_PROJECT_AUTH_RATE_LIMITS,
  type ProjectAuthRateLimitKind,
  type ProjectAuthRateLimits,
} from "@/lib/server/project-auth/rate-limits";

import {
  DEFAULT_PROJECT_AUTH_PASSWORD_PROTECTION,
  type ProjectAuthPasswordProtection,
} from "@/lib/server/project-auth/password-leaks";

import {
  DEFAULT_PROJECT_AUTH_HOOKS,
  type ProjectAuthHooks,
} from "@/lib/server/project-auth/hooks";

import type {
  ProjectAuthThirdPartyDefinition,
  ProjectAuthThirdPartyProvider,
} from "@/lib/server/project-auth/third-party";

import {
  projectAuthOAuthConsentCovers,
  type ProjectAuthOAuthClient,
  type ProjectAuthOAuthClientDefinition,
  type ProjectAuthOAuthCode,
  type ProjectAuthOAuthConsent,
  type ProjectAuthOAuthScope,
  type ProjectAuthOAuthToken,
} from "@/lib/server/project-auth/oauth";

export type ProjectAuthUserPatch = Partial<Pick<ProjectAuthUser,
  "passwordHash" | "status" | "emailVerifiedAt" | "userMetadata" | "appMetadata" | "updatedAt">>;

export type ProjectAuthRotationResult = "rotated" | "invalid" | "replayed";

export interface ProjectAuthRepository {
  findUserByEmail(scope: ProjectAuthScope, email: string): Promise<ProjectAuthUser | null>;
  findUserById(scope: ProjectAuthScope, userId: string): Promise<ProjectAuthUser | null>;
  listUsers(scope: ProjectAuthScope, limit: number, cursor?: string): Promise<ProjectAuthUser[]>;
  createUser(user: ProjectAuthUser): Promise<ProjectAuthUser>;
  updateUser(scope: ProjectAuthScope, userId: string, patch: ProjectAuthUserPatch): Promise<ProjectAuthUser | null>;

  createSession(session: ProjectAuthSession): Promise<ProjectAuthSession>;
  findSessionByRefreshHash(scope: ProjectAuthScope, tokenHash: string): Promise<ProjectAuthSession | null>;
  findActiveSessionById(scope: ProjectAuthScope, sessionId: string, now: Date): Promise<ProjectAuthSession | null>;
  rotateSession(
    scope: ProjectAuthScope,
    currentSessionId: string,
    next: ProjectAuthSession,
    now: Date,
  ): Promise<ProjectAuthRotationResult>;
  revokeSessionFamily(scope: ProjectAuthScope, familyId: string, now: Date, compromised: boolean): Promise<number>;
  revokeAllUserSessions(scope: ProjectAuthScope, userId: string, now: Date): Promise<number>;
  /**
   * Aktive Sitzungen eines Nutzers: nicht widerrufen, nicht kompromittiert,
   * nicht abgelaufen; neueste zuerst, hoechstens 100. Nie mit Token-Verifier.
   */
  listActiveSessions(scope: ProjectAuthScope, userId: string, now: Date): Promise<ProjectAuthSessionSummary[]>;

  createOneTimeToken(token: ProjectAuthOneTimeToken): Promise<ProjectAuthOneTimeToken>;
  findActiveOneTimeTokenScope(
    projectId: string,
    environment: ProjectAuthScope["environment"],
    tokenHash: string,
    purpose: ProjectAuthOneTimePurpose,
    now: Date,
  ): Promise<ProjectAuthScope | null>;
  consumeOneTimeToken(
    scope: ProjectAuthScope,
    tokenHash: string,
    purpose: ProjectAuthOneTimePurpose,
    now: Date,
  ): Promise<ProjectAuthOneTimeToken | null>;
  /**
   * Liest ein gueltiges kurzlebiges Token, ohne es zu verbrauchen (2.52).
   *
   * Gebraucht fuer den Einrichtungsschein des zweiten Faktors: Er oeffnet
   * zwei Aufrufe nacheinander (Geheimnis holen, Code bestaetigen) und darf
   * darum nicht schon beim ersten verfallen. Verbraucht wird er beim
   * gelungenen Bestaetigen, ueber `consumeOneTimeToken`.
   */
  findActiveOneTimeToken(
    scope: ProjectAuthScope,
    tokenHash: string,
    purpose: ProjectAuthOneTimePurpose,
    now: Date,
  ): Promise<ProjectAuthOneTimeToken | null>;

  /** Die Einstellungen der Umgebung, oder null, solange nie eine gesetzt wurde. */
  readSettings(scope: ProjectAuthScope): Promise<ProjectAuthSettings | null>;
  /** Setzt den Schalter und legt die Zeile an, falls es noch keine gibt. */
  writeMfaRequired(scope: ProjectAuthScope, required: boolean, now: Date): Promise<ProjectAuthSettings>;
  /**
   * Ersetzt die erlaubten Ruecksprungziele ganz (2.54) und legt die Zeile an,
   * falls es noch keine gibt. Ganz und nicht stueckweise, weil eine
   * halbgeschriebene Liste eine gueltige Liste waere — und eine leere Liste
   * hier "nicht verengt" bedeutet.
   */
  writeReturnTargets(
    scope: ProjectAuthScope,
    targets: readonly string[],
    now: Date,
  ): Promise<ProjectAuthSettings>;
  /**
   * Setzt alle drei Grenzen je Zeitfenster (2.56) und legt die Zeile an,
   * falls es noch keine gibt. Alle drei zusammen, weil ein Koerper mit nur
   * einer Art offen liesse, was mit den anderen geschehen soll.
   */
  writeRateLimits(
    scope: ProjectAuthScope,
    limits: ProjectAuthRateLimits,
    now: Date,
  ): Promise<ProjectAuthSettings>;
  /**
   * Setzt den Passwortschutz (2.53) und legt die Zeile an, falls es noch
   * keine gibt. Alle drei Werte zusammen, aus demselben Grund wie bei den
   * Grenzen: Ein Koerper mit nur einem Wert liesse offen, was mit den
   * anderen geschehen soll.
   */
  writePasswordProtection(
    scope: ProjectAuthScope,
    protection: ProjectAuthPasswordProtection,
    now: Date,
  ): Promise<ProjectAuthSettings>;
  /**
   * Setzt beide Auth-Hooks (2.77) und legt die Zeile an, falls es noch keine
   * gibt. Beide Punkte zusammen, aus demselben Grund wie bei den Grenzen und
   * beim Passwortschutz: Ein Koerper mit nur einem Punkt liesse offen, was mit
   * dem anderen geschehen soll.
   */
  writeAuthHooks(
    scope: ProjectAuthScope,
    hooks: ProjectAuthHooks,
    now: Date,
  ): Promise<ProjectAuthSettings>;
  /**
   * Zaehlt einen Versuch und gibt den Stand **nach** dem Hochzaehlen zurueck
   * (2.56).
   *
   * Der tragende Teil dieses Slices. Zwei Eigenschaften machen die Aussage:
   *
   * 1. Gezaehlt wird in der Datenbank, in **einer** Anweisung, die den Wert
   *    zurueckgibt. Zwei Instanzen, die gleichzeitig denselben Schluessel
   *    zaehlen, bekommen darum 1 und 2 und nie zweimal 1.
   * 2. `subjectHash` ist schon gehasht, wenn es hier ankommt. Diese Grenze
   *    sieht nie eine Adresse und nie eine Sitzungs-ID im Klartext.
   *
   * `windowStart` rechnet der Dienst aus, nicht die Datenbank: Beide
   * Instanzen sollen dieselbe Zeile treffen, und dafuer muss der Wert aus
   * derselben Formel kommen und nicht aus zwei `now()`-Aufrufen.
   */
  countRateLimitAttempt(
    scope: ProjectAuthScope,
    input: {
      kind: ProjectAuthRateLimitKind;
      subjectHash: string;
      windowStart: Date;
    },
  ): Promise<ProjectAuthRateCount>;
  /** Zaehlt App-Nutzer und bestaetigte Faktoren dieser Umgebung. */
  countMfaEnrolment(scope: ProjectAuthScope): Promise<ProjectAuthMfaEnrolmentCount>;

  /**
   * Die Passkeys dieser Umgebung (2.79).
   *
   * `findPasskeyByCredentialId` sucht ohne Nutzer, weil die Anmeldung den
   * Nutzer erst aus der Kennung erfaehrt: Der Browser sagt vorher nicht, wer
   * kommt, und der Server soll es auch nicht raten muessen.
   *
   * `advancePasskeyCounter` schreibt den Zaehlerstand und den Zeitpunkt der
   * letzten Benutzung, und nur nach vorn: Das `WHERE` verlangt den Stand, den
   * der Aufrufer gelesen hat. Zwei gleichzeitige Anmeldungen mit derselben
   * Unterschrift kommen damit genau einmal durch, und ein Zaehler kann nicht
   * durch einen Nachzuegler zurueckfallen.
   */
  createPasskey(passkey: ProjectAuthPasskey): Promise<ProjectAuthPasskey>;
  listPasskeys(scope: ProjectAuthScope, userId: string): Promise<ProjectAuthPasskey[]>;
  findPasskeyByCredentialId(
    scope: ProjectAuthScope,
    credentialId: string,
  ): Promise<ProjectAuthPasskey | null>;
  advancePasskeyCounter(
    scope: ProjectAuthScope,
    passkeyId: string,
    input: { fromSignCount: number; toSignCount: number; usedAt: Date },
  ): Promise<boolean>;
  deletePasskey(scope: ProjectAuthScope, userId: string, passkeyId: string): Promise<boolean>;
  /** Zaehlt App-Nutzer, Passkeys und Nutzer mit mindestens einem Passkey (2.79). */
  countPasskeys(scope: ProjectAuthScope): Promise<ProjectAuthPasskeyCount>;

  getMfaFactor(scope: ProjectAuthScope, userId: string): Promise<ProjectAuthMfaFactor | null>;
  upsertMfaFactor(factor: ProjectAuthMfaFactor): Promise<ProjectAuthMfaFactor>;
  consumeRecoveryCode(scope: ProjectAuthScope, userId: string, codeHash: string): Promise<boolean>;

  findOidcIdentity(
    scope: ProjectAuthScope,
    provider: string,
    subject: string,
  ): Promise<ProjectAuthOidcIdentity | null>;
  createOidcIdentity(identity: ProjectAuthOidcIdentity): Promise<ProjectAuthOidcIdentity>;

  /**
   * Die hinterlegten fremden Anbieter dieser Umgebung (2.80), nach Namen
   * geordnet: gleiche Zeilen, gleiche Reihenfolge.
   */
  listThirdPartyProviders(scope: ProjectAuthScope): Promise<ProjectAuthThirdPartyProvider[]>;
  /**
   * Der Anbieter zu einem Aussteller, oder `null`.
   *
   * Der Lesepfad im heissen Weg: Eine Anfrage mit fremdem Token nennt ihren
   * Aussteller im Token, und genau ein Eintrag je Umgebung darf ihn tragen (die
   * UNIQUE-Bedingung aus 0061 sorgt dafuer). Gesucht wird ueber den Aussteller
   * und nicht ueber den Namen des Anbieters, weil das Token den Namen nicht
   * kennt: Der Name ist eine Beschriftung von QKERN und keine Zusage des
   * Ausstellers.
   */
  findThirdPartyProviderByIssuer(
    scope: ProjectAuthScope,
    issuer: string,
  ): Promise<ProjectAuthThirdPartyProvider | null>;
  /**
   * Legt einen Anbieter an. Es gibt bewusst kein Gegenstueck zum Aendern:
   * Warum, steht in Migration 0061.
   */
  createThirdPartyProvider(
    scope: ProjectAuthScope,
    provider: ProjectAuthThirdPartyDefinition & { id: string },
    now: Date,
  ): Promise<ProjectAuthThirdPartyProvider>;
  /** Entfernt einen Anbieter. `false` heisst: in dieser Umgebung gab es ihn nicht. */
  deleteThirdPartyProvider(scope: ProjectAuthScope, providerId: string): Promise<boolean>;

  /* -------------------------------------------------------------- *
   * OAuth-Server (2.82)
   * -------------------------------------------------------------- */

  /** Die hinterlegten OAuth-Clients dieser Umgebung, nach Namen geordnet. */
  listOAuthClients(scope: ProjectAuthScope): Promise<ProjectAuthOAuthClient[]>;
  /**
   * Der Client zu einem Namen, oder `null`.
   *
   * Gesucht wird ueber den Namen und nicht ueber die Kennung, weil der Name die
   * Kennung ist: Eine Anwendung schickt `client_id`, und das ist der Name, den
   * die Console vergeben hat. Eine zweite, zufaellige Kennung daneben waere ein
   * zweiter Bezeichner fuer dieselbe Sache, und die Console muesste erklaeren,
   * welchen der Entwickler in seine Anwendung schreibt.
   */
  findOAuthClientByName(scope: ProjectAuthScope, name: string): Promise<ProjectAuthOAuthClient | null>;
  /** Legt einen Client an. Es gibt bewusst kein Gegenstueck zum Aendern (Migration 0062). */
  createOAuthClient(
    scope: ProjectAuthScope,
    client: ProjectAuthOAuthClientDefinition & { id: string },
    now: Date,
  ): Promise<ProjectAuthOAuthClient>;
  /**
   * Entfernt einen Client. `false` heisst: in dieser Umgebung gab es ihn nicht.
   *
   * Mit dem Client fallen seine Codes und seine ausgegebenen Token, ueber
   * ON DELETE CASCADE. Das ist der Widerruf dieser Flaeche.
   */
  deleteOAuthClient(scope: ProjectAuthScope, clientId: string): Promise<boolean>;

  /* -------------------------------------------------------------- *
   * Die Zustimmung als Zeile (2.92)
   * -------------------------------------------------------------- */

  /**
   * Die Zustimmungen dieser Umgebung, die geltenden und die widerrufenen, je
   * mit der E-Mail-Adresse des Nutzers, der zugestimmt hat.
   *
   * Geordnet nach Zeitpunkt, die juengste zuerst, und bei gleichem Zeitpunkt
   * nach der Kennung: Eine Liste ohne festgelegte Ordnung waere in der Console
   * jedes Mal eine andere, und ein Test darauf pruefte die Laune der Datenbank.
   *
   * `limit` ist ein Rand und keine Seitennavigation. Der Aufrufer fragt eines
   * mehr an, als er zeigen will, und sagt dann auf der Seite, dass die Liste
   * abgeschnitten ist; eine Liste, die stillschweigend endet, waere die
   * unehrlichste Form von Vollstaendigkeit.
   */
  listOAuthConsents(
    scope: ProjectAuthScope,
    limit: number,
  ): Promise<Array<ProjectAuthOAuthConsent & { clientName: string; email: string }>>;
  /**
   * Die geltende Zustimmung dieses Nutzers fuer diesen Client mit **genau**
   * diesen Bereichen, oder `null`.
   *
   * Genau, nicht mindestens: Der Grund steht bei
   * `projectAuthOAuthConsentCovers` in `oauth.ts`.
   */
  findOAuthConsent(
    scope: ProjectAuthScope,
    clientId: string,
    userId: string,
    scopes: ProjectAuthOAuthScope[],
  ): Promise<ProjectAuthOAuthConsent | null>;
  /**
   * Die Zustimmung zu einer Kennung, gleich ob sie noch gilt, oder `null`.
   *
   * Der Weg beim Einloesen: Der Code nennt seine Zustimmung, und gefragt wird
   * genau nach ihr. Nicht noch einmal nach Nutzer, Client und Bereichen, denn
   * das faende nach einem Widerruf und einer neuen Zustimmung eine **andere**
   * Zeile, und der Code haengte an der falschen.
   */
  findOAuthConsentById(
    scope: ProjectAuthScope,
    consentId: string,
  ): Promise<ProjectAuthOAuthConsent | null>;
  /** Legt eine Zustimmung an. */
  createOAuthConsent(
    scope: ProjectAuthScope,
    consent: {
      id: string;
      clientId: string;
      userId: string;
      scopes: ProjectAuthOAuthScope[];
      grantedAt: Date;
    },
  ): Promise<ProjectAuthOAuthConsent>;
  /**
   * Widerruft eine Zustimmung. `null` heisst: Es gab sie in dieser Umgebung
   * nicht, oder sie war schon widerrufen.
   *
   * Die Zeile bleibt stehen, sie bekommt nur ihr zweites Datum. Die Tabelle aus
   * 0064 hat fuer diese Rolle gar kein DELETE, also ist das hier keine
   * Hoeflichkeit, sondern das Einzige, was geht.
   */
  revokeOAuthConsent(
    scope: ProjectAuthScope,
    consentId: string,
    now: Date,
  ): Promise<ProjectAuthOAuthConsent | null>;

  /** Legt einen Code an. Der Code selbst kommt nie hierher, nur seine Pruefsumme. */
  createOAuthCode(
    scope: ProjectAuthScope,
    code: {
      id: string;
      clientId: string;
      userId: string;
      consentId: string;
      redirectUri: string;
      scopes: ProjectAuthOAuthScope[];
      codeHash: string;
      codeChallenge: string;
      createdAt: Date;
      expiresAt: Date;
    },
  ): Promise<ProjectAuthOAuthCode>;
  /**
   * Verbraucht einen Code und gibt ihn zurueck, oder `null`.
   *
   * **Beides in einer Anweisung**, und das ist die Zusage: Gefunden wird nur ein
   * Code, der noch nicht verbraucht und noch nicht abgelaufen ist, und dieselbe
   * Anweisung setzt den Verbrauchsvermerk. Zwei Anfragen mit demselben Code
   * bekommen darum nicht beide eine Zeile, auch nicht, wenn sie gleichzeitig
   * kommen. Ein Lesen und ein spaeteres Schreiben haetten dieses Fenster.
   */
  consumeOAuthCode(
    scope: ProjectAuthScope,
    codeHash: string,
    now: Date,
  ): Promise<ProjectAuthOAuthCode | null>;

  /**
   * Die ausgegebenen Token dieser Umgebung, je mit Client und E-Mail-Adresse
   * (2.93).
   *
   * Ohne die Pruefsumme und ohne das Token selbst: Die Liste ist da, damit ein
   * Betreiber sieht, was gerade offen ist, und nicht, damit jemand daraus eine
   * Anfrage baut.
   *
   * Dieselbe Ordnung und derselbe Rand wie bei den Zustimmungen: das juengste
   * zuerst, bei gleichem Zeitpunkt nach der Kennung, und der Aufrufer fragt
   * eines mehr an, als er zeigt.
   */
  listOAuthTokens(
    scope: ProjectAuthScope,
    limit: number,
  ): Promise<Array<ProjectAuthOAuthToken & { clientName: string; email: string }>>;
  /**
   * Widerruft genau ein Token (2.93). `null` heisst: Es gab es in dieser
   * Umgebung nicht.
   *
   * **Hier ist Widerruf wirklich Loeschen**, und das ist der Unterschied zur
   * Zustimmung. Ein Token gilt, weil eine Zeile existiert (0062); faellt die
   * Zeile, gilt es nicht mehr, und es braucht dafuer keine zweite Spalte und
   * keine zusaetzliche Pruefung im heissen Weg. Was von diesem Token bleibt,
   * ist die Zustimmung, an der es hing, und die Audit-Zeile des Widerrufs.
   *
   * Das Recht dazu liegt seit 0063 bei `qkern_auth`, weil der Aufraeumer
   * abgelaufene Zeilen entfernt. Eine neue Migration braucht dieser Widerruf
   * darum nicht.
   */
  revokeOAuthToken(
    scope: ProjectAuthScope,
    tokenId: string,
  ): Promise<ProjectAuthOAuthToken | null>;

  /** Legt ein ausgegebenes Token an. `code_id` ist eindeutig (Migration 0062). */
  createOAuthToken(
    scope: ProjectAuthScope,
    token: {
      id: string;
      clientId: string;
      userId: string;
      codeId: string;
      consentId: string;
      tokenHash: string;
      scopes: ProjectAuthOAuthScope[];
      createdAt: Date;
      expiresAt: Date;
    },
  ): Promise<ProjectAuthOAuthToken>;
  /**
   * Das Token zu einer Pruefsumme, samt Client und Nutzer, oder `null`.
   *
   * Der Lesepfad im heissen Weg. Die Frist wird hier **nicht** geprueft: Ob ein
   * Token abgelaufen ist, entscheidet der Dienst an seiner Uhr, damit ein Test
   * die Uhr stellen kann und nicht die Datenbank.
   */
  findOAuthTokenByHash(
    scope: ProjectAuthScope,
    tokenHash: string,
  ): Promise<{
    token: ProjectAuthOAuthToken;
    clientName: string;
    /**
     * Die Zustimmung hinter diesem Token, mitgelesen und nicht in einer zweiten
     * Abfrage (2.92). `null` heisst: Es gibt keine, also ist das Token eines aus
     * der Zeit vor Migration 0064.
     */
    consent: ProjectAuthOAuthConsent | null;
  } | null>;
}

export class DuplicateProjectAuthIdentityError extends Error {
  constructor() {
    super("DUPLICATE_PROJECT_AUTH_IDENTITY");
    this.name = "DuplicateProjectAuthIdentityError";
  }
}
recognisedByName(DuplicateProjectAuthIdentityError, "DuplicateProjectAuthIdentityError");

export class MemoryProjectAuthRepository implements ProjectAuthRepository {
  private readonly users = new Map<string, ProjectAuthUser>();
  private readonly sessions = new Map<string, ProjectAuthSession>();
  private readonly oneTimeTokens = new Map<string, ProjectAuthOneTimeToken>();
  private readonly mfaFactors = new Map<string, ProjectAuthMfaFactor>();
  private readonly passkeys = new Map<string, ProjectAuthPasskey>();
  private readonly oidcIdentities = new Map<string, ProjectAuthOidcIdentity>();
  private readonly settings = new Map<string, ProjectAuthSettings>();
  private readonly rateCounters = new Map<string, number>();
  /** Je Eintrag der Scope daneben, weil ein Anbieter keine Scope-Felder traegt. */
  private readonly thirdParty = new Map<string, { scope: ProjectAuthScope; provider: ProjectAuthThirdPartyProvider }>();
  /** Die OAuth-Clients (2.82), je Eintrag der Scope daneben, wie bei den fremden Anbietern. */
  private readonly oauthClients = new Map<string, { scope: ProjectAuthScope; client: ProjectAuthOAuthClient }>();
  /** Die Zustimmungen (2.92), je Eintrag der Scope daneben, wie die Clients. */
  private readonly oauthConsents =
    new Map<string, { scope: ProjectAuthScope; consent: ProjectAuthOAuthConsent }>();
  /** Die Codes, geschluesselt ueber ihre Pruefsumme: derselbe Zugriffsweg wie in der Datenbank. */
  private readonly oauthCodes = new Map<string, { scope: ProjectAuthScope; code: ProjectAuthOAuthCode }>();
  /** Die ausgegebenen Token, ebenfalls ueber ihre Pruefsumme, mit dem Code daneben. */
  private readonly oauthTokens =
    new Map<string, { scope: ProjectAuthScope; codeId: string; token: ProjectAuthOAuthToken }>();

  async findUserByEmail(scope: ProjectAuthScope, email: string) {
    const user = [...this.users.values()].find((candidate) => sameScope(candidate, scope) && candidate.email === email);
    return user ? cloneUser(user) : null;
  }

  async findUserById(scope: ProjectAuthScope, userId: string) {
    const user = this.users.get(userId);
    return user && sameScope(user, scope) ? cloneUser(user) : null;
  }

  async listUsers(scope: ProjectAuthScope, limit: number, cursor?: string) {
    return [...this.users.values()]
      .filter((user) => sameScope(user, scope) && (!cursor || user.id > cursor))
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, limit)
      .map(cloneUser);
  }

  async createUser(user: ProjectAuthUser) {
    if (this.users.has(user.id) || [...this.users.values()].some((candidate) =>
      sameScope(candidate, user) && candidate.email === user.email)) {
      throw new DuplicateProjectAuthIdentityError();
    }
    const stored = cloneUser(user);
    this.users.set(stored.id, stored);
    return cloneUser(stored);
  }

  async updateUser(scope: ProjectAuthScope, userId: string, patch: ProjectAuthUserPatch) {
    const user = this.users.get(userId);
    if (!user || !sameScope(user, scope)) return null;
    const updated = cloneUser({ ...user, ...patch });
    this.users.set(userId, updated);
    return cloneUser(updated);
  }

  async createSession(session: ProjectAuthSession) {
    if (this.sessions.has(session.id) || [...this.sessions.values()].some((entry) =>
      entry.refreshTokenHash === session.refreshTokenHash)) {
      throw new Error("DUPLICATE_PROJECT_AUTH_SESSION");
    }
    const stored = cloneSession(session);
    this.sessions.set(stored.id, stored);
    return cloneSession(stored);
  }

  async findSessionByRefreshHash(scope: ProjectAuthScope, tokenHash: string) {
    const session = [...this.sessions.values()].find((candidate) =>
      sameScope(candidate, scope) && candidate.refreshTokenHash === tokenHash);
    return session ? cloneSession(session) : null;
  }

  async findActiveSessionById(scope: ProjectAuthScope, sessionId: string, now: Date) {
    const session = this.sessions.get(sessionId);
    if (!session || !sameScope(session, scope) || session.revokedAt || session.compromisedAt ||
        session.expiresAt.getTime() <= now.getTime()) return null;
    return cloneSession(session);
  }

  async rotateSession(
    scope: ProjectAuthScope,
    currentSessionId: string,
    next: ProjectAuthSession,
    now: Date,
  ): Promise<ProjectAuthRotationResult> {
    const current = this.sessions.get(currentSessionId);
    if (!current || !sameScope(current, scope) || !sameScope(next, scope) ||
        current.userId !== next.userId || current.familyId !== next.familyId ||
        current.expiresAt.getTime() <= now.getTime()) return "invalid";
    if (current.revokedAt || current.replacedBySessionId || current.compromisedAt) {
      await this.revokeSessionFamily(scope, current.familyId, now, true);
      return "replayed";
    }
    current.revokedAt = new Date(now);
    current.replacedBySessionId = next.id;
    await this.createSession(next);
    return "rotated";
  }

  async revokeSessionFamily(scope: ProjectAuthScope, familyId: string, now: Date, compromised: boolean) {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (sameScope(session, scope) && session.familyId === familyId) {
        session.revokedAt ??= new Date(now);
        if (compromised) session.compromisedAt ??= new Date(now);
        count += 1;
      }
    }
    return count;
  }

  async revokeAllUserSessions(scope: ProjectAuthScope, userId: string, now: Date) {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (sameScope(session, scope) && session.userId === userId && !session.revokedAt) {
        session.revokedAt = new Date(now);
        count += 1;
      }
    }
    return count;
  }

  async listActiveSessions(scope: ProjectAuthScope, userId: string, now: Date) {
    return [...this.sessions.values()]
      .filter((session) => sameScope(session, scope) && session.userId === userId && !session.revokedAt &&
        !session.compromisedAt && session.expiresAt.getTime() > now.getTime())
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id))
      .slice(0, 100)
      .map(sessionSummary);
  }

  async createOneTimeToken(token: ProjectAuthOneTimeToken) {
    if (this.oneTimeTokens.has(token.tokenHash)) throw new Error("DUPLICATE_PROJECT_AUTH_TOKEN");
    const stored = cloneOneTimeToken(token);
    this.oneTimeTokens.set(stored.tokenHash, stored);
    return cloneOneTimeToken(stored);
  }

  async findActiveOneTimeTokenScope(
    projectId: string,
    environment: ProjectAuthScope["environment"],
    tokenHash: string,
    purpose: ProjectAuthOneTimePurpose,
    now: Date,
  ) {
    const token = this.oneTimeTokens.get(tokenHash);
    if (!token || token.projectId !== projectId || token.environment !== environment ||
        token.purpose !== purpose || token.consumedAt || token.expiresAt.getTime() <= now.getTime()) return null;
    return { organizationId: token.organizationId, projectId, environment };
  }

  async consumeOneTimeToken(
    scope: ProjectAuthScope,
    tokenHash: string,
    purpose: ProjectAuthOneTimePurpose,
    now: Date,
  ) {
    const token = this.oneTimeTokens.get(tokenHash);
    if (!token || !sameScope(token, scope) || token.purpose !== purpose || token.consumedAt ||
        token.expiresAt.getTime() <= now.getTime()) return null;
    token.consumedAt = new Date(now);
    return cloneOneTimeToken(token);
  }

  async findActiveOneTimeToken(
    scope: ProjectAuthScope,
    tokenHash: string,
    purpose: ProjectAuthOneTimePurpose,
    now: Date,
  ) {
    const token = this.oneTimeTokens.get(tokenHash);
    if (!token || !sameScope(token, scope) || token.purpose !== purpose || token.consumedAt ||
        token.expiresAt.getTime() <= now.getTime()) return null;
    return cloneOneTimeToken(token);
  }

  async readSettings(scope: ProjectAuthScope) {
    const stored = this.settings.get(scopeKey(scope));
    return stored ? cloneProjectAuthSettings(stored) : null;
  }

  async writeMfaRequired(scope: ProjectAuthScope, required: boolean, now: Date) {
    const previous = this.settings.get(scopeKey(scope));
    const stored: ProjectAuthSettings = {
      ...scope, mfaRequired: required,
      // Die eine Einstellung fasst die andere nicht an; in PostgreSQL macht
      // das ein UPDATE auf genau eine Spalte, hier der uebernommene Wert.
      returnTargets: [...(previous?.returnTargets ?? [])],
      rateLimits: cloneRateLimits(previous?.rateLimits ?? DEFAULT_PROJECT_AUTH_RATE_LIMITS),
      passwordProtection: { ...(previous?.passwordProtection ?? DEFAULT_PROJECT_AUTH_PASSWORD_PROTECTION) },
      hooks: cloneHooks(previous?.hooks ?? DEFAULT_PROJECT_AUTH_HOOKS),
      updatedAt: new Date(now),
    };
    this.settings.set(scopeKey(scope), stored);
    return cloneProjectAuthSettings(stored);
  }

  async writeReturnTargets(scope: ProjectAuthScope, targets: readonly string[], now: Date) {
    const previous = this.settings.get(scopeKey(scope));
    const stored: ProjectAuthSettings = {
      ...scope, mfaRequired: previous?.mfaRequired ?? false,
      returnTargets: [...targets],
      rateLimits: cloneRateLimits(previous?.rateLimits ?? DEFAULT_PROJECT_AUTH_RATE_LIMITS),
      passwordProtection: { ...(previous?.passwordProtection ?? DEFAULT_PROJECT_AUTH_PASSWORD_PROTECTION) },
      hooks: cloneHooks(previous?.hooks ?? DEFAULT_PROJECT_AUTH_HOOKS),
      updatedAt: new Date(now),
    };
    this.settings.set(scopeKey(scope), stored);
    return cloneProjectAuthSettings(stored);
  }

  async writeRateLimits(scope: ProjectAuthScope, limits: ProjectAuthRateLimits, now: Date) {
    const previous = this.settings.get(scopeKey(scope));
    const stored: ProjectAuthSettings = {
      ...scope, mfaRequired: previous?.mfaRequired ?? false,
      returnTargets: [...(previous?.returnTargets ?? [])],
      rateLimits: cloneRateLimits(limits),
      passwordProtection: { ...(previous?.passwordProtection ?? DEFAULT_PROJECT_AUTH_PASSWORD_PROTECTION) },
      hooks: cloneHooks(previous?.hooks ?? DEFAULT_PROJECT_AUTH_HOOKS),
      updatedAt: new Date(now),
    };
    this.settings.set(scopeKey(scope), stored);
    return cloneProjectAuthSettings(stored);
  }

  async writePasswordProtection(
    scope: ProjectAuthScope,
    protection: ProjectAuthPasswordProtection,
    now: Date,
  ) {
    const previous = this.settings.get(scopeKey(scope));
    const stored: ProjectAuthSettings = {
      ...scope, mfaRequired: previous?.mfaRequired ?? false,
      returnTargets: [...(previous?.returnTargets ?? [])],
      rateLimits: cloneRateLimits(previous?.rateLimits ?? DEFAULT_PROJECT_AUTH_RATE_LIMITS),
      passwordProtection: { ...protection },
      hooks: cloneHooks(previous?.hooks ?? DEFAULT_PROJECT_AUTH_HOOKS),
      updatedAt: new Date(now),
    };
    this.settings.set(scopeKey(scope), stored);
    return cloneProjectAuthSettings(stored);
  }

  async writeAuthHooks(scope: ProjectAuthScope, hooks: ProjectAuthHooks, now: Date) {
    const previous = this.settings.get(scopeKey(scope));
    const stored: ProjectAuthSettings = {
      ...scope, mfaRequired: previous?.mfaRequired ?? false,
      returnTargets: [...(previous?.returnTargets ?? [])],
      rateLimits: cloneRateLimits(previous?.rateLimits ?? DEFAULT_PROJECT_AUTH_RATE_LIMITS),
      passwordProtection: { ...(previous?.passwordProtection ?? DEFAULT_PROJECT_AUTH_PASSWORD_PROTECTION) },
      hooks: cloneHooks(hooks),
      updatedAt: new Date(now),
    };
    this.settings.set(scopeKey(scope), stored);
    return cloneProjectAuthSettings(stored);
  }

  /**
   * Dieselbe Rechnung wie PostgreSQL, nur im Speicher: eine Zeile je
   * (Scope, Art, Schluessel, Fensteranfang), und abgelaufene Fenster
   * desselben Schluessels fallen dabei weg.
   *
   * Was diese Fassung **nicht** kann, ist der Punkt des ganzen Slices: Sie
   * gilt nur in diesem Prozess. Zwei Instanzen teilen sie nicht. Fuer
   * Entwicklung und Tests ist sie richtig, fuer den Betrieb nicht — dort
   * zaehlt PostgreSQL, und der Fall "(2.56)" belegt es mit zwei
   * Dienstinstanzen an einer Datenbank.
   */
  async countRateLimitAttempt(
    scope: ProjectAuthScope,
    input: { kind: ProjectAuthRateLimitKind; subjectHash: string; windowStart: Date },
  ) {
    const prefix = `${scopeKey(scope)}\0${input.kind}\0${input.subjectHash}\0`;
    for (const key of [...this.rateCounters.keys()]) {
      if (key.startsWith(prefix) && key !== `${prefix}${input.windowStart.toISOString()}`) {
        this.rateCounters.delete(key);
      }
    }
    const key = `${prefix}${input.windowStart.toISOString()}`;
    const attempts = (this.rateCounters.get(key) ?? 0) + 1;
    this.rateCounters.set(key, attempts);
    return { kind: input.kind, attempts, windowStart: new Date(input.windowStart) };
  }

  async countMfaEnrolment(scope: ProjectAuthScope) {
    const users = [...this.users.values()].filter((user) => sameScope(user, scope));
    const enrolled = users.filter((user) => {
      const factor = this.mfaFactors.get(user.id);
      return Boolean(factor && sameScope(factor, scope) && factor.verifiedAt);
    });
    return { users: users.length, enrolled: enrolled.length };
  }

  async createPasskey(passkey: ProjectAuthPasskey) {
    const existing = [...this.passkeys.values()].some((candidate) =>
      sameScope(candidate, passkey) && candidate.credentialId === passkey.credentialId);
    if (existing || this.passkeys.has(passkey.id)) throw new DuplicateProjectAuthIdentityError();
    const stored = clonePasskey(passkey);
    this.passkeys.set(stored.id, stored);
    return clonePasskey(stored);
  }

  async listPasskeys(scope: ProjectAuthScope, userId: string) {
    return [...this.passkeys.values()]
      .filter((passkey) => sameScope(passkey, scope) && passkey.userId === userId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() ||
        right.id.localeCompare(left.id))
      .slice(0, 50)
      .map(clonePasskey);
  }

  async findPasskeyByCredentialId(scope: ProjectAuthScope, credentialId: string) {
    const passkey = [...this.passkeys.values()].find((candidate) =>
      sameScope(candidate, scope) && candidate.credentialId === credentialId);
    return passkey ? clonePasskey(passkey) : null;
  }

  async advancePasskeyCounter(
    scope: ProjectAuthScope,
    passkeyId: string,
    input: { fromSignCount: number; toSignCount: number; usedAt: Date },
  ) {
    const passkey = this.passkeys.get(passkeyId);
    // Dieselbe Bedingung wie das `WHERE` in PostgreSQL: der gelesene Stand muss
    // noch stehen. Ohne sie waere der Speicherbetrieb nachsichtiger als der
    // echte, und ein Fall gegen den Speicher sagte nichts ueber den Betrieb.
    if (!passkey || !sameScope(passkey, scope) || passkey.signCount !== input.fromSignCount) return false;
    passkey.signCount = input.toSignCount;
    passkey.lastUsedAt = new Date(input.usedAt);
    return true;
  }

  async deletePasskey(scope: ProjectAuthScope, userId: string, passkeyId: string) {
    const passkey = this.passkeys.get(passkeyId);
    if (!passkey || !sameScope(passkey, scope) || passkey.userId !== userId) return false;
    this.passkeys.delete(passkeyId);
    return true;
  }

  async countPasskeys(scope: ProjectAuthScope) {
    const users = [...this.users.values()].filter((user) => sameScope(user, scope));
    const passkeys = [...this.passkeys.values()].filter((passkey) => sameScope(passkey, scope));
    return {
      users: users.length,
      passkeys: passkeys.length,
      usersWithPasskey: new Set(passkeys.map((passkey) => passkey.userId)).size,
    };
  }

  async getMfaFactor(scope: ProjectAuthScope, userId: string) {
    const factor = this.mfaFactors.get(userId);
    return factor && sameScope(factor, scope) ? cloneMfaFactor(factor) : null;
  }

  async upsertMfaFactor(factor: ProjectAuthMfaFactor) {
    const stored = cloneMfaFactor(factor);
    this.mfaFactors.set(factor.userId, stored);
    return cloneMfaFactor(stored);
  }

  async consumeRecoveryCode(scope: ProjectAuthScope, userId: string, codeHash: string) {
    const factor = this.mfaFactors.get(userId);
    if (!factor || !sameScope(factor, scope) || !factor.verifiedAt) return false;
    const index = factor.recoveryCodeHashes.indexOf(codeHash);
    if (index < 0) return false;
    factor.recoveryCodeHashes.splice(index, 1);
    return true;
  }

  async findOidcIdentity(scope: ProjectAuthScope, provider: string, subject: string) {
    const identity = this.oidcIdentities.get(oidcKey(scope, provider, subject));
    return identity ? cloneOidcIdentity(identity) : null;
  }

  async createOidcIdentity(identity: ProjectAuthOidcIdentity) {
    const key = oidcKey(identity, identity.provider, identity.subject);
    if (this.oidcIdentities.has(key)) throw new DuplicateProjectAuthIdentityError();
    const stored = cloneOidcIdentity(identity);
    this.oidcIdentities.set(key, stored);
    return cloneOidcIdentity(stored);
  }

  async listThirdPartyProviders(scope: ProjectAuthScope) {
    return [...this.thirdParty.values()]
      .filter((entry) => sameScope(entry.scope, scope))
      .map((entry) => cloneThirdPartyProvider(entry.provider))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async findThirdPartyProviderByIssuer(scope: ProjectAuthScope, issuer: string) {
    const entry = [...this.thirdParty.values()].find((candidate) =>
      sameScope(candidate.scope, scope) && candidate.provider.issuer === issuer);
    return entry ? cloneThirdPartyProvider(entry.provider) : null;
  }

  async createThirdPartyProvider(
    scope: ProjectAuthScope,
    provider: ProjectAuthThirdPartyDefinition & { id: string },
    now: Date,
  ) {
    // Dieselben zwei Bedingungen wie in PostgreSQL: ein Name je Umgebung, ein
    // Aussteller je Umgebung. Diese Fassung ist nicht die Wahrheit im Betrieb,
    // aber sie soll dieselbe Antwort geben, sonst weicht ein Test hier von der
    // Datenbank ab.
    const clash = [...this.thirdParty.values()].some((candidate) =>
      sameScope(candidate.scope, scope) &&
      (candidate.provider.name === provider.name || candidate.provider.issuer === provider.issuer));
    if (clash) throw new DuplicateProjectAuthIdentityError();
    const stored: ProjectAuthThirdPartyProvider = {
      id: provider.id, name: provider.name, issuer: provider.issuer, jwksUri: provider.jwksUri,
      audiences: [...provider.audiences], subjectClaim: provider.subjectClaim,
      roleClaim: provider.roleClaim, defaultRole: provider.defaultRole, createdAt: new Date(now),
    };
    this.thirdParty.set(provider.id, { scope: { ...scope }, provider: stored });
    return cloneThirdPartyProvider(stored);
  }

  async deleteThirdPartyProvider(scope: ProjectAuthScope, providerId: string) {
    const entry = this.thirdParty.get(providerId);
    if (!entry || !sameScope(entry.scope, scope)) return false;
    this.thirdParty.delete(providerId);
    return true;
  }

  /* ---------------------------------------------------------------- *
   * OAuth-Server (2.82)
   * ---------------------------------------------------------------- */

  async listOAuthClients(scope: ProjectAuthScope) {
    return [...this.oauthClients.values()]
      .filter((entry) => sameScope(entry.scope, scope))
      .map((entry) => cloneOAuthClient(entry.client))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async findOAuthClientByName(scope: ProjectAuthScope, name: string) {
    const entry = [...this.oauthClients.values()].find((candidate) =>
      sameScope(candidate.scope, scope) && candidate.client.name === name);
    return entry ? cloneOAuthClient(entry.client) : null;
  }

  async createOAuthClient(
    scope: ProjectAuthScope,
    client: ProjectAuthOAuthClientDefinition & { id: string },
    now: Date,
  ) {
    // Dieselbe Bedingung wie in PostgreSQL: ein Name je Umgebung. Diese Fassung
    // ist nicht die Wahrheit im Betrieb, aber sie soll dieselbe Antwort geben,
    // sonst weicht ein Test hier von der Datenbank ab.
    const clash = [...this.oauthClients.values()].some((candidate) =>
      sameScope(candidate.scope, scope) && candidate.client.name === client.name);
    if (clash) throw new DuplicateProjectAuthIdentityError();
    const stored: ProjectAuthOAuthClient = {
      id: client.id, name: client.name,
      redirectUris: [...client.redirectUris], scopes: [...client.scopes],
      createdAt: new Date(now),
    };
    this.oauthClients.set(client.id, { scope: { ...scope }, client: stored });
    return cloneOAuthClient(stored);
  }

  async deleteOAuthClient(scope: ProjectAuthScope, clientId: string) {
    const entry = this.oauthClients.get(clientId);
    if (!entry || !sameScope(entry.scope, scope)) return false;
    this.oauthClients.delete(clientId);
    // Was in PostgreSQL ON DELETE CASCADE tut, steht hier von Hand. Ohne diese
    // zwei Zeilen wuerde diese Fassung einen Widerruf vortaeuschen, den die
    // Datenbank wirklich leistet, und ein Test gegen sie waere wertlos.
    for (const [key, code] of this.oauthCodes) {
      if (code.code.clientId === clientId) this.oauthCodes.delete(key);
    }
    for (const [key, token] of this.oauthTokens) {
      if (token.token.clientId === clientId) this.oauthTokens.delete(key);
    }
    // Und die Zustimmungen dieses Clients, ebenfalls ueber ON DELETE CASCADE
    // (0064). Das ist der Unterschied zum Widerruf, den die Seite nennt:
    // Widerruf behaelt die Zeile, Entfernen des Clients nimmt sie mit.
    for (const [key, consent] of this.oauthConsents) {
      if (consent.consent.clientId === clientId) this.oauthConsents.delete(key);
    }
    return true;
  }

  /* ---------------------------------------------------------------- *
   * Die Zustimmung als Zeile (2.92)
   * ---------------------------------------------------------------- */

  async listOAuthConsents(scope: ProjectAuthScope, limit: number) {
    return [...this.oauthConsents.values()]
      .filter((entry) => sameScope(entry.scope, scope))
      // Dieselbe Ordnung wie in der Datenbank: der Zeitpunkt zuerst, die
      // Kennung als Entscheidung bei gleichem Zeitpunkt. Ohne den zweiten
      // Schluessel haengt die Reihenfolge zweier Zeilen aus derselben
      // Millisekunde an der Laune der Sortierung.
      .sort((left, right) => right.consent.grantedAt.getTime() - left.consent.grantedAt.getTime() ||
        left.consent.id.localeCompare(right.consent.id))
      .slice(0, Math.max(0, limit))
      .flatMap((entry) => {
        const client = this.oauthClients.get(entry.consent.clientId);
        const user = this.users.get(entry.consent.userId);
        // Ohne Client oder ohne Nutzer gibt es die Zeile in der Datenbank gar
        // nicht mehr (beide Fremdschluessel loeschen mit). Hier faellt sie
        // darum aus der Liste, statt mit einem erfundenen Namen zu erscheinen.
        if (!client || !user) return [];
        return [{
          ...cloneOAuthConsent(entry.consent), clientName: client.client.name, email: user.email,
        }];
      });
  }

  async findOAuthConsent(
    scope: ProjectAuthScope,
    clientId: string,
    userId: string,
    scopes: ProjectAuthOAuthScope[],
  ) {
    const entry = [...this.oauthConsents.values()].find((candidate) =>
      sameScope(candidate.scope, scope) && candidate.consent.clientId === clientId &&
      candidate.consent.userId === userId && candidate.consent.revokedAt === null &&
      projectAuthOAuthConsentCovers(candidate.consent, scopes));
    return entry ? cloneOAuthConsent(entry.consent) : null;
  }

  async findOAuthConsentById(scope: ProjectAuthScope, consentId: string) {
    const entry = this.oauthConsents.get(consentId);
    if (!entry || !sameScope(entry.scope, scope)) return null;
    return cloneOAuthConsent(entry.consent);
  }

  async createOAuthConsent(
    scope: ProjectAuthScope,
    consent: {
      id: string; clientId: string; userId: string;
      scopes: ProjectAuthOAuthScope[]; grantedAt: Date;
    },
  ) {
    // Der Teilindex aus 0064, hier von Hand: eine geltende Zustimmung je
    // Nutzer, Client und Bereichsmenge. Diese Fassung ist nicht die Wahrheit im
    // Betrieb, aber sie soll dieselbe Antwort geben.
    const clash = [...this.oauthConsents.values()].some((candidate) =>
      sameScope(candidate.scope, scope) && candidate.consent.clientId === consent.clientId &&
      candidate.consent.userId === consent.userId && candidate.consent.revokedAt === null &&
      projectAuthOAuthConsentCovers(candidate.consent, consent.scopes));
    if (clash) throw new DuplicateProjectAuthIdentityError();
    const stored: ProjectAuthOAuthConsent = {
      id: consent.id, clientId: consent.clientId, userId: consent.userId,
      scopes: [...consent.scopes], grantedAt: new Date(consent.grantedAt), revokedAt: null,
    };
    this.oauthConsents.set(consent.id, { scope: { ...scope }, consent: stored });
    return cloneOAuthConsent(stored);
  }

  async revokeOAuthConsent(scope: ProjectAuthScope, consentId: string, now: Date) {
    const entry = this.oauthConsents.get(consentId);
    if (!entry || !sameScope(entry.scope, scope)) return null;
    // Nur in eine Richtung, wie der Waechter in 0064: Eine schon widerrufene
    // Zustimmung laesst sich nicht noch einmal widerrufen und erst recht nicht
    // wieder oeffnen.
    if (entry.consent.revokedAt !== null) return null;
    entry.consent.revokedAt = new Date(now);
    return cloneOAuthConsent(entry.consent);
  }

  async createOAuthCode(
    scope: ProjectAuthScope,
    code: {
      id: string; clientId: string; userId: string; consentId: string; redirectUri: string;
      scopes: ProjectAuthOAuthScope[]; codeHash: string; codeChallenge: string;
      createdAt: Date; expiresAt: Date;
    },
  ) {
    if (this.oauthCodes.has(code.codeHash)) throw new DuplicateProjectAuthIdentityError();
    const stored: ProjectAuthOAuthCode = {
      id: code.id, clientId: code.clientId, userId: code.userId, consentId: code.consentId,
      redirectUri: code.redirectUri,
      scopes: [...code.scopes], codeChallenge: code.codeChallenge,
      createdAt: new Date(code.createdAt), expiresAt: new Date(code.expiresAt), consumedAt: null,
    };
    this.oauthCodes.set(code.codeHash, { scope: { ...scope }, code: stored });
    return cloneOAuthCode(stored);
  }

  async consumeOAuthCode(scope: ProjectAuthScope, codeHash: string, now: Date) {
    const entry = this.oauthCodes.get(codeHash);
    if (!entry || !sameScope(entry.scope, scope)) return null;
    if (entry.code.consumedAt !== null || entry.code.expiresAt <= now) return null;
    entry.code.consumedAt = new Date(now);
    return cloneOAuthCode(entry.code);
  }

  async createOAuthToken(
    scope: ProjectAuthScope,
    token: {
      id: string; clientId: string; userId: string; codeId: string; consentId: string;
      tokenHash: string; scopes: ProjectAuthOAuthScope[]; createdAt: Date; expiresAt: Date;
    },
  ) {
    // Die Eindeutigkeit von `code_id` aus 0062, hier von Hand: Aus einem Code
    // entsteht genau ein Token.
    const clash = [...this.oauthTokens.values()].some((candidate) =>
      candidate.codeId === token.codeId);
    if (clash || this.oauthTokens.has(token.tokenHash)) throw new DuplicateProjectAuthIdentityError();
    const stored: ProjectAuthOAuthToken = {
      id: token.id, clientId: token.clientId, userId: token.userId, consentId: token.consentId,
      scopes: [...token.scopes],
      createdAt: new Date(token.createdAt), expiresAt: new Date(token.expiresAt),
    };
    this.oauthTokens.set(token.tokenHash, { scope: { ...scope }, codeId: token.codeId, token: stored });
    return cloneOAuthToken(stored);
  }

  async listOAuthTokens(scope: ProjectAuthScope, limit: number) {
    return [...this.oauthTokens.values()]
      .filter((entry) => sameScope(entry.scope, scope))
      .sort((left, right) => right.token.createdAt.getTime() - left.token.createdAt.getTime() ||
        left.token.id.localeCompare(right.token.id))
      .slice(0, Math.max(0, Math.trunc(limit)))
      .map((entry) => {
        const client = this.oauthClients.get(entry.token.clientId);
        const user = this.users.get(entry.token.userId);
        if (!client || !user) throw new Error("Invalid project auth oauth token.");
        return { ...cloneOAuthToken(entry.token), clientName: client.client.name, email: user.email };
      });
  }

  async revokeOAuthToken(scope: ProjectAuthScope, tokenId: string) {
    for (const [key, entry] of this.oauthTokens) {
      if (!sameScope(entry.scope, scope) || entry.token.id !== tokenId) continue;
      // Wirklich weg, wie in der Datenbank: Ein Token gilt, weil eine Zeile
      // existiert.
      this.oauthTokens.delete(key);
      return cloneOAuthToken(entry.token);
    }
    return null;
  }

  async findOAuthTokenByHash(scope: ProjectAuthScope, tokenHash: string) {
    const entry = this.oauthTokens.get(tokenHash);
    if (!entry || !sameScope(entry.scope, scope)) return null;
    const client = this.oauthClients.get(entry.token.clientId);
    if (!client) return null;
    // Die Zustimmung kommt mit, so wie der Name des Clients: Der heisse Weg
    // soll eine Auskunft sein und nicht drei, und der Dienst soll den Widerruf
    // nicht in einer zweiten Frage nachholen muessen.
    const consent = entry.token.consentId === null
      ? null : this.oauthConsents.get(entry.token.consentId) ?? null;
    return {
      token: cloneOAuthToken(entry.token),
      clientName: client.client.name,
      consent: consent ? cloneOAuthConsent(consent.consent) : null,
    };
  }
}

function sameScope(left: ProjectAuthScope, right: ProjectAuthScope): boolean {
  return left.organizationId === right.organizationId && left.projectId === right.projectId &&
    left.environment === right.environment;
}

function scopeKey(scope: ProjectAuthScope): string {
  return [scope.organizationId, scope.projectId, scope.environment].join("\0");
}

function oidcKey(scope: ProjectAuthScope, provider: string, subject: string): string {
  return [scope.organizationId, scope.projectId, scope.environment, provider, subject].join("\0");
}

function cloneUser(user: ProjectAuthUser): ProjectAuthUser {
  return {
    ...user,
    emailVerifiedAt: user.emailVerifiedAt ? new Date(user.emailVerifiedAt) : null,
    createdAt: new Date(user.createdAt),
    updatedAt: new Date(user.updatedAt),
    userMetadata: { ...user.userMetadata },
    appMetadata: { ...user.appMetadata },
  };
}

function cloneSession(session: ProjectAuthSession): ProjectAuthSession {
  return {
    ...session,
    createdAt: new Date(session.createdAt), expiresAt: new Date(session.expiresAt),
    revokedAt: session.revokedAt ? new Date(session.revokedAt) : null,
    compromisedAt: session.compromisedAt ? new Date(session.compromisedAt) : null,
  };
}

function sessionSummary(session: ProjectAuthSession): ProjectAuthSessionSummary {
  return {
    id: session.id, familyId: session.familyId, assurance: session.assurance,
    createdAt: new Date(session.createdAt), expiresAt: new Date(session.expiresAt),
    replacedBySessionId: session.replacedBySessionId,
  };
}

/** Eine eigene Kopie, damit ein Aufrufer die gespeicherte Liste nicht veraendert. */
function cloneProjectAuthSettings(settings: ProjectAuthSettings): ProjectAuthSettings {
  return {
    ...settings,
    returnTargets: [...settings.returnTargets],
    rateLimits: cloneRateLimits(settings.rateLimits),
    passwordProtection: { ...settings.passwordProtection },
    hooks: cloneHooks(settings.hooks),
    updatedAt: new Date(settings.updatedAt),
  };
}

function cloneHooks(hooks: ProjectAuthHooks): ProjectAuthHooks {
  return {
    signIn: { ...hooks.signIn },
    accessTokenClaims: { ...hooks.accessTokenClaims, claims: [...hooks.accessTokenClaims.claims] },
  };
}

function cloneRateLimits(limits: ProjectAuthRateLimits): ProjectAuthRateLimits {
  return {
    sign_in: { ...limits.sign_in },
    mail: { ...limits.mail },
    refresh: { ...limits.refresh },
  };
}

function cloneOneTimeToken(token: ProjectAuthOneTimeToken): ProjectAuthOneTimeToken {
  return {
    ...token,
    metadata: { ...token.metadata },
    createdAt: new Date(token.createdAt), expiresAt: new Date(token.expiresAt),
    consumedAt: token.consumedAt ? new Date(token.consumedAt) : null,
  };
}

function cloneMfaFactor(factor: ProjectAuthMfaFactor): ProjectAuthMfaFactor {
  return {
    ...factor,
    recoveryCodeHashes: [...factor.recoveryCodeHashes],
    createdAt: new Date(factor.createdAt),
    verifiedAt: factor.verifiedAt ? new Date(factor.verifiedAt) : null,
  };
}

function clonePasskey(passkey: ProjectAuthPasskey): ProjectAuthPasskey {
  return {
    ...passkey,
    createdAt: new Date(passkey.createdAt),
    lastUsedAt: passkey.lastUsedAt ? new Date(passkey.lastUsedAt) : null,
  };
}

function cloneOidcIdentity(identity: ProjectAuthOidcIdentity): ProjectAuthOidcIdentity {
  return { ...identity, createdAt: new Date(identity.createdAt), lastSignInAt: new Date(identity.lastSignInAt) };
}

function cloneThirdPartyProvider(provider: ProjectAuthThirdPartyProvider): ProjectAuthThirdPartyProvider {
  return { ...provider, audiences: [...provider.audiences], createdAt: new Date(provider.createdAt) };
}

function cloneOAuthClient(client: ProjectAuthOAuthClient): ProjectAuthOAuthClient {
  return {
    ...client, redirectUris: [...client.redirectUris], scopes: [...client.scopes],
    createdAt: new Date(client.createdAt),
  };
}

function cloneOAuthConsent(consent: ProjectAuthOAuthConsent): ProjectAuthOAuthConsent {
  return {
    ...consent, scopes: [...consent.scopes], grantedAt: new Date(consent.grantedAt),
    revokedAt: consent.revokedAt === null ? null : new Date(consent.revokedAt),
  };
}

function cloneOAuthCode(code: ProjectAuthOAuthCode): ProjectAuthOAuthCode {
  return {
    ...code, scopes: [...code.scopes], createdAt: new Date(code.createdAt),
    expiresAt: new Date(code.expiresAt),
    consumedAt: code.consumedAt === null ? null : new Date(code.consumedAt),
  };
}

function cloneOAuthToken(token: ProjectAuthOAuthToken): ProjectAuthOAuthToken {
  return {
    ...token, scopes: [...token.scopes], createdAt: new Date(token.createdAt),
    expiresAt: new Date(token.expiresAt),
  };
}
