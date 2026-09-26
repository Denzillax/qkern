import { recognisedByName } from "@/lib/server/errors/identity";
import type {
  ProjectAuthMfaEnrolmentCount,
  ProjectAuthMfaFactor,
  ProjectAuthOidcIdentity,
  ProjectAuthOneTimePurpose,
  ProjectAuthOneTimeToken,
  ProjectAuthScope,
  ProjectAuthSession,
  ProjectAuthSessionSummary,
  ProjectAuthSettings,
  ProjectAuthUser,
} from "@/lib/server/project-auth/model";

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
      updatedAt: new Date(now),
    };
    this.settings.set(scopeKey(scope), stored);
    return cloneProjectAuthSettings(stored);
  }

  async writeReturnTargets(scope: ProjectAuthScope, targets: readonly string[], now: Date) {
    const previous = this.settings.get(scopeKey(scope));
    const stored: ProjectAuthSettings = {
      ...scope, mfaRequired: previous?.mfaRequired ?? false,
      returnTargets: [...targets], updatedAt: new Date(now),
    };
    this.settings.set(scopeKey(scope), stored);
    return cloneProjectAuthSettings(stored);
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
    updatedAt: new Date(settings.updatedAt),
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
