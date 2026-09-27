import { recognisedByName } from "@/lib/server/errors/identity";
import type {
  ProjectAuthMfaEnrolmentCount,
  ProjectAuthMfaFactor,
  ProjectAuthRateCount,
  ProjectAuthOidcIdentity,
  ProjectAuthOneTimePurpose,
  ProjectAuthOneTimeToken,
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
  private readonly oidcIdentities = new Map<string, ProjectAuthOidcIdentity>();
  private readonly settings = new Map<string, ProjectAuthSettings>();
  private readonly rateCounters = new Map<string, number>();
  /** Je Eintrag der Scope daneben, weil ein Anbieter keine Scope-Felder traegt. */
  private readonly thirdParty = new Map<string, { scope: ProjectAuthScope; provider: ProjectAuthThirdPartyProvider }>();

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

function cloneOidcIdentity(identity: ProjectAuthOidcIdentity): ProjectAuthOidcIdentity {
  return { ...identity, createdAt: new Date(identity.createdAt), lastSignInAt: new Date(identity.lastSignInAt) };
}

function cloneThirdPartyProvider(provider: ProjectAuthThirdPartyProvider): ProjectAuthThirdPartyProvider {
  return { ...provider, audiences: [...provider.audiences], createdAt: new Date(provider.createdAt) };
}
