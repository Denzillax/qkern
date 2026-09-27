import { InvalidRecordError, mapPostgresError } from "@/lib/server/db/errors";
import type { SqlPool, SqlQueryable, SqlValue } from "@/lib/server/db/sql";
import type {
  ProjectAuthMfaEnrolmentCount,
  ProjectAuthMfaFactor,
  ProjectAuthOidcIdentity,
  ProjectAuthOneTimePurpose,
  ProjectAuthOneTimeToken,
  ProjectAuthRateCount,
  ProjectAuthScope,
  ProjectAuthSession,
  ProjectAuthSessionSummary,
  ProjectAuthSettings,
  ProjectAuthUser,
} from "@/lib/server/project-auth/model";
import {
  DuplicateProjectAuthIdentityError,
  type ProjectAuthRepository,
  type ProjectAuthRotationResult,
  type ProjectAuthUserPatch,
} from "@/lib/server/project-auth/repository";
import {
  isProjectAuthRateLimitKind,
  type ProjectAuthRateLimitKind,
  type ProjectAuthRateLimits,
} from "@/lib/server/project-auth/rate-limits";
import {
  isProjectAuthPasswordNotice,
  type ProjectAuthPasswordProtection,
} from "@/lib/server/project-auth/password-leaks";

type Row = Record<string, unknown>;
type PostgresError = Error & { code?: string; constraint?: string };

export class PostgresProjectAuthRepository implements ProjectAuthRepository {
  constructor(private readonly pool: SqlPool) {}

  async findUserByEmail(scope: ProjectAuthScope, email: string) {
    const result = await query(this.pool, `${USER_SELECT}
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND email = $4
      LIMIT 1`, [...scopeValues(scope), email]);
    return result.rows[0] ? userFromRow(result.rows[0]) : null;
  }

  async findUserById(scope: ProjectAuthScope, userId: string) {
    const result = await query(this.pool, `${USER_SELECT}
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND id = $4
      LIMIT 1`, [...scopeValues(scope), userId]);
    return result.rows[0] ? userFromRow(result.rows[0]) : null;
  }

  async listUsers(scope: ProjectAuthScope, limit: number, cursor?: string) {
    const result = await query(this.pool, `${USER_SELECT}
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3
        AND ($4::uuid IS NULL OR id > $4::uuid)
      ORDER BY id ASC
      LIMIT $5`, [...scopeValues(scope), cursor ?? null, limit]);
    return result.rows.map(userFromRow);
  }

  async createUser(user: ProjectAuthUser) {
    try {
      const result = await this.pool.query(`${INSERT_USER} RETURNING ${USER_COLUMNS}`, [
        user.id, user.organizationId, user.projectId, user.environment, user.email, user.passwordHash,
        user.status, user.emailVerifiedAt, user.userMetadata, user.appMetadata, user.createdAt, user.updatedAt,
      ]);
      return userFromRow(result.rows[0]);
    } catch (error) {
      const pg = error as PostgresError;
      if (pg.code === "23505" && ["project_auth_users_scope_email_key", "project_auth_users_pkey"].includes(pg.constraint ?? "")) {
        throw new DuplicateProjectAuthIdentityError();
      }
      throw mapPostgresError(error);
    }
  }

  async updateUser(scope: ProjectAuthScope, userId: string, patch: ProjectAuthUserPatch) {
    const assignments: string[] = [];
    const values: SqlValue[] = [...scopeValues(scope), userId];
    const add = (column: string, value: SqlValue) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };
    if ("passwordHash" in patch) add("password_hash", patch.passwordHash ?? null);
    if (patch.status !== undefined) add("status", patch.status);
    if ("emailVerifiedAt" in patch) add("email_verified_at", patch.emailVerifiedAt ?? null);
    if (patch.userMetadata !== undefined) add("user_metadata", patch.userMetadata);
    if (patch.appMetadata !== undefined) add("app_metadata", patch.appMetadata);
    if (patch.updatedAt !== undefined) add("updated_at", patch.updatedAt);
    if (assignments.length === 0) return this.findUserById(scope, userId);
    const result = await query(this.pool, `UPDATE project_auth_users SET ${assignments.join(", ")}
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND id = $4
      RETURNING ${USER_COLUMNS}`, values);
    return result.rows[0] ? userFromRow(result.rows[0]) : null;
  }

  async createSession(session: ProjectAuthSession) {
    const result = await query(this.pool, `${INSERT_SESSION} RETURNING ${SESSION_COLUMNS}`, sessionValues(session));
    return sessionFromRow(result.rows[0]);
  }

  async findSessionByRefreshHash(scope: ProjectAuthScope, tokenHash: string) {
    const result = await query(this.pool, `${SESSION_SELECT}
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND refresh_token_hash = $4
      LIMIT 1`, [...scopeValues(scope), tokenHash]);
    return result.rows[0] ? sessionFromRow(result.rows[0]) : null;
  }

  async findActiveSessionById(scope: ProjectAuthScope, sessionId: string, now: Date) {
    const result = await query(this.pool, `${SESSION_SELECT}
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND id = $4
        AND revoked_at IS NULL AND compromised_at IS NULL AND expires_at > $5
      LIMIT 1`, [...scopeValues(scope), sessionId, now]);
    return result.rows[0] ? sessionFromRow(result.rows[0]) : null;
  }

  async rotateSession(
    scope: ProjectAuthScope,
    currentSessionId: string,
    next: ProjectAuthSession,
    now: Date,
  ): Promise<ProjectAuthRotationResult> {
    const client = await this.pool.connect();
    let started = false;
    try {
      await client.query("BEGIN");
      started = true;
      const currentResult = await client.query(`${SESSION_SELECT}
        WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND id = $4
        FOR UPDATE`, [...scopeValues(scope), currentSessionId]);
      const current = currentResult.rows[0] ? sessionFromRow(currentResult.rows[0]) : null;
      if (!current || current.expiresAt.getTime() <= now.getTime() || !sameSessionLineage(current, next)) {
        await client.query("ROLLBACK");
        started = false;
        return "invalid";
      }
      if (current.revokedAt || current.replacedBySessionId || current.compromisedAt) {
        await client.query(`UPDATE project_auth_sessions
          SET revoked_at = coalesce(revoked_at, $5), compromised_at = coalesce(compromised_at, $5)
          WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND family_id = $4`,
        [...scopeValues(scope), current.familyId, now]);
        await client.query("COMMIT");
        started = false;
        return "replayed";
      }
      await client.query(INSERT_SESSION, sessionValues(next));
      await client.query(`UPDATE project_auth_sessions
        SET revoked_at = $5, replaced_by_session_id = $6
        WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND id = $4`,
      [...scopeValues(scope), current.id, now, next.id]);
      await client.query("COMMIT");
      started = false;
      return "rotated";
    } catch (error) {
      if (started) await client.query("ROLLBACK").catch(() => undefined);
      throw mapPostgresError(error);
    } finally {
      client.release();
    }
  }

  async revokeSessionFamily(scope: ProjectAuthScope, familyId: string, now: Date, compromised: boolean) {
    const result = await query(this.pool, `UPDATE project_auth_sessions
      SET revoked_at = coalesce(revoked_at, $5),
          compromised_at = CASE WHEN $6 THEN coalesce(compromised_at, $5) ELSE compromised_at END
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND family_id = $4`,
    [...scopeValues(scope), familyId, now, compromised]);
    return result.rowCount ?? 0;
  }

  async revokeAllUserSessions(scope: ProjectAuthScope, userId: string, now: Date) {
    const result = await query(this.pool, `UPDATE project_auth_sessions SET revoked_at = coalesce(revoked_at, $5)
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND auth_user_id = $4
        AND revoked_at IS NULL`, [...scopeValues(scope), userId, now]);
    return result.rowCount ?? 0;
  }

  async listActiveSessions(scope: ProjectAuthScope, userId: string, now: Date) {
    // Die Spaltenliste nennt refresh_token_hash absichtlich nicht: der
    // Verifier soll gar nicht erst aus der Datenbank herauskommen.
    const result = await query(this.pool, `SELECT id, family_id, assurance, created_at, expires_at,
        replaced_by_session_id
      FROM project_auth_sessions
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND auth_user_id = $4
        AND revoked_at IS NULL AND compromised_at IS NULL AND expires_at > $5
      ORDER BY created_at DESC, id DESC
      LIMIT 100`, [...scopeValues(scope), userId, now]);
    return result.rows.map(sessionSummaryFromRow);
  }

  async createOneTimeToken(token: ProjectAuthOneTimeToken) {
    const result = await query(this.pool, `INSERT INTO project_auth_one_time_tokens
      (id, organization_id, project_id, environment, auth_user_id, purpose, token_hash,
       metadata, created_at, expires_at, consumed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING ${ONE_TIME_COLUMNS}`, [
      token.id, token.organizationId, token.projectId, token.environment, token.userId, token.purpose,
      token.tokenHash, token.metadata, token.createdAt, token.expiresAt, token.consumedAt,
    ]);
    return oneTimeFromRow(result.rows[0]);
  }

  async findActiveOneTimeTokenScope(
    projectId: string,
    environment: ProjectAuthScope["environment"],
    tokenHash: string,
    purpose: ProjectAuthOneTimePurpose,
    now: Date,
  ) {
    const result = await query(this.pool, `SELECT organization_id
      FROM project_auth_one_time_tokens
      WHERE project_id = $1 AND environment = $2 AND token_hash = $3 AND purpose = $4
        AND consumed_at IS NULL AND expires_at > $5
      LIMIT 1`, [projectId, environment, tokenHash, purpose, now]);
    return result.rows[0]
      ? { organizationId: String(result.rows[0].organization_id), projectId, environment }
      : null;
  }

  async consumeOneTimeToken(
    scope: ProjectAuthScope,
    tokenHash: string,
    purpose: ProjectAuthOneTimePurpose,
    now: Date,
  ) {
    const result = await query(this.pool, `UPDATE project_auth_one_time_tokens SET consumed_at = $6
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3
        AND token_hash = $4 AND purpose = $5 AND consumed_at IS NULL AND expires_at > $6
      RETURNING ${ONE_TIME_COLUMNS}`, [...scopeValues(scope), tokenHash, purpose, now]);
    return result.rows[0] ? oneTimeFromRow(result.rows[0]) : null;
  }

  async findActiveOneTimeToken(
    scope: ProjectAuthScope,
    tokenHash: string,
    purpose: ProjectAuthOneTimePurpose,
    now: Date,
  ) {
    const result = await query(this.pool, `SELECT ${ONE_TIME_COLUMNS}
      FROM project_auth_one_time_tokens
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3
        AND token_hash = $4 AND purpose = $5 AND consumed_at IS NULL AND expires_at > $6
      LIMIT 1`, [...scopeValues(scope), tokenHash, purpose, now]);
    return result.rows[0] ? oneTimeFromRow(result.rows[0]) : null;
  }

  async readSettings(scope: ProjectAuthScope): Promise<ProjectAuthSettings | null> {
    const result = await query(this.pool, `${SETTINGS_SELECT}
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3
      LIMIT 1`, scopeValues(scope));
    return result.rows[0] ? settingsFromRow(result.rows[0]) : null;
  }

  async writeMfaRequired(scope: ProjectAuthScope, required: boolean, now: Date): Promise<ProjectAuthSettings> {
    const result = await query(this.pool, `INSERT INTO project_auth_settings
      (organization_id, project_id, environment, mfa_required, updated_at)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (organization_id, project_id, environment)
      DO UPDATE SET mfa_required = EXCLUDED.mfa_required, updated_at = EXCLUDED.updated_at
      RETURNING ${SETTINGS_COLUMNS}`, [...scopeValues(scope), required, now]);
    return settingsFromRow(result.rows[0]);
  }

  /**
   * Ersetzt die Liste der Ruecksprungziele ganz (2.54). Ein INSERT mit
   * ON CONFLICT, wie beim Schalter: Die Zeile entsteht erst, wenn jemand
   * etwas einstellt, und der Schalter bleibt dabei unberuehrt, weil das
   * UPDATE genau zwei Spalten nennt.
   */
  async writeReturnTargets(
    scope: ProjectAuthScope,
    targets: readonly string[],
    now: Date,
  ): Promise<ProjectAuthSettings> {
    const result = await query(this.pool, `INSERT INTO project_auth_settings
      (organization_id, project_id, environment, redirect_allow_list, updated_at)
      VALUES ($1,$2,$3,$4::text[],$5)
      ON CONFLICT (organization_id, project_id, environment)
      DO UPDATE SET redirect_allow_list = EXCLUDED.redirect_allow_list, updated_at = EXCLUDED.updated_at
      RETURNING ${SETTINGS_COLUMNS}`, [...scopeValues(scope), [...targets], now]);
    return settingsFromRow(result.rows[0]);
  }

  /**
   * Setzt alle sechs Zahlen auf einmal (2.56), wieder als INSERT mit
   * ON CONFLICT: Die Zeile entsteht erst, wenn jemand etwas einstellt, und
   * der Schalter aus 2.52 und die Liste aus 2.54 bleiben unberuehrt, weil das
   * UPDATE genau die sieben Spalten nennt, um die es geht.
   */
  async writeRateLimits(
    scope: ProjectAuthScope,
    limits: ProjectAuthRateLimits,
    now: Date,
  ): Promise<ProjectAuthSettings> {
    const result = await query(this.pool, `INSERT INTO project_auth_settings
      (organization_id, project_id, environment,
       sign_in_max, sign_in_window_seconds, mail_max, mail_window_seconds,
       refresh_max, refresh_window_seconds, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (organization_id, project_id, environment)
      DO UPDATE SET
        sign_in_max = EXCLUDED.sign_in_max,
        sign_in_window_seconds = EXCLUDED.sign_in_window_seconds,
        mail_max = EXCLUDED.mail_max,
        mail_window_seconds = EXCLUDED.mail_window_seconds,
        refresh_max = EXCLUDED.refresh_max,
        refresh_window_seconds = EXCLUDED.refresh_window_seconds,
        updated_at = EXCLUDED.updated_at
      RETURNING ${SETTINGS_COLUMNS}`, [
      ...scopeValues(scope),
      limits.sign_in.max, limits.sign_in.windowSeconds,
      limits.mail.max, limits.mail.windowSeconds,
      limits.refresh.max, limits.refresh.windowSeconds,
      now,
    ]);
    return settingsFromRow(result.rows[0]);
  }

  /**
   * Setzt den Passwortschutz (2.53), wieder als INSERT mit ON CONFLICT: Die
   * Zeile entsteht erst, wenn jemand etwas einstellt, und der Schalter aus
   * 2.52, die Liste aus 2.54 und die Grenzen aus 2.56 bleiben unberuehrt,
   * weil das UPDATE genau die vier Spalten nennt, um die es geht.
   *
   * Die Leckliste steht hier nicht und kommt hier nie an. Was in die Zeile
   * geht, sind ein Schalter, eine Zahl und ein Wort.
   */
  async writePasswordProtection(
    scope: ProjectAuthScope,
    protection: ProjectAuthPasswordProtection,
    now: Date,
  ): Promise<ProjectAuthSettings> {
    const result = await query(this.pool, `INSERT INTO project_auth_settings
      (organization_id, project_id, environment,
       leaked_password_check, password_min_length, leaked_password_notice, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (organization_id, project_id, environment)
      DO UPDATE SET
        leaked_password_check = EXCLUDED.leaked_password_check,
        password_min_length = EXCLUDED.password_min_length,
        leaked_password_notice = EXCLUDED.leaked_password_notice,
        updated_at = EXCLUDED.updated_at
      RETURNING ${SETTINGS_COLUMNS}`, [
      ...scopeValues(scope),
      protection.leakedPasswordCheck, protection.minLength, protection.notice,
      now,
    ]);
    return settingsFromRow(result.rows[0]);
  }

  /**
   * Der Zaehler (2.56), und er ist mit Absicht eine einzige Anweisung.
   *
   * Der DELETE im CTE raeumt die abgelaufenen Fenster **desselben**
   * Schluessels weg, das INSERT ... ON CONFLICT DO UPDATE zaehlt das aktuelle
   * hoch, und das RETURNING gibt den Stand danach zurueck. Beides in einer
   * Anweisung heisst: eine Transaktion, eine Sperre je Schluessel, kein
   * Aufraeumprozess und kein Zeitpunkt, an dem zwei Instanzen einen Versuch
   * verlieren koennten. Geloescht werden nur Zeilen mit einem aelteren
   * Fensteranfang; die eingefuegte Zeile ist nie darunter.
   */
  async countRateLimitAttempt(
    scope: ProjectAuthScope,
    input: { kind: ProjectAuthRateLimitKind; subjectHash: string; windowStart: Date },
  ): Promise<ProjectAuthRateCount> {
    const result = await query(this.pool, `WITH expired AS (
        DELETE FROM project_auth_rate_counters
         WHERE organization_id = $1 AND project_id = $2 AND environment = $3
           AND kind = $4 AND subject_hash = $5 AND window_start < $6
      )
      INSERT INTO project_auth_rate_counters
        (organization_id, project_id, environment, kind, subject_hash, window_start, attempts)
      VALUES ($1,$2,$3,$4,$5,$6,1)
      ON CONFLICT (organization_id, project_id, environment, kind, subject_hash, window_start)
      DO UPDATE SET attempts = project_auth_rate_counters.attempts + 1
      RETURNING kind, attempts, window_start`,
    [...scopeValues(scope), input.kind, input.subjectHash, input.windowStart]);
    return rateCountFromRow(result.rows[0]);
  }

  async countMfaEnrolment(scope: ProjectAuthScope): Promise<ProjectAuthMfaEnrolmentCount> {
    // Beide Zahlen in einer Abfrage und in der Datenbank gezaehlt: Die
    // Console soll keine Nutzerliste laden muessen, um eine Zahl zu zeigen.
    const result = await query(this.pool, `SELECT
        (SELECT COUNT(*) FROM project_auth_users
          WHERE organization_id = $1 AND project_id = $2 AND environment = $3) AS users,
        (SELECT COUNT(*) FROM project_auth_mfa_factors
          WHERE organization_id = $1 AND project_id = $2 AND environment = $3
            AND verified_at IS NOT NULL) AS enrolled`, scopeValues(scope));
    const row = result.rows[0] ?? {};
    return { users: count(row.users, "user count"), enrolled: count(row.enrolled, "enrolment count") };
  }

  async getMfaFactor(scope: ProjectAuthScope, userId: string) {
    const result = await query(this.pool, `${MFA_SELECT}
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND auth_user_id = $4
      LIMIT 1`, [...scopeValues(scope), userId]);
    return result.rows[0] ? mfaFromRow(result.rows[0]) : null;
  }

  async upsertMfaFactor(factor: ProjectAuthMfaFactor) {
    const result = await query(this.pool, `INSERT INTO project_auth_mfa_factors
      (id, organization_id, project_id, environment, auth_user_id, encrypted_secret,
       recovery_code_hashes, created_at, verified_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (organization_id, project_id, environment, auth_user_id)
      DO UPDATE SET encrypted_secret = EXCLUDED.encrypted_secret,
                    recovery_code_hashes = EXCLUDED.recovery_code_hashes,
                    verified_at = EXCLUDED.verified_at
      RETURNING ${MFA_COLUMNS}`, [
      factor.id, factor.organizationId, factor.projectId, factor.environment, factor.userId,
      // `recovery_code_hashes` ist jsonb. Ein JavaScript-Feld macht der Treiber
      // zu einem Postgres-Feld (`{a,b}`), und das ist kein gueltiges JSON: die
      // Einrichtung scheiterte damit an der echten Datenbank. Erst der Fall
      // (2.52) hat das gezeigt, weil kein anderer Fall diesen Weg ging.
      factor.encryptedSecret, JSON.stringify(factor.recoveryCodeHashes),
      factor.createdAt, factor.verifiedAt,
    ]);
    return mfaFromRow(result.rows[0]);
  }

  async consumeRecoveryCode(scope: ProjectAuthScope, userId: string, codeHash: string) {
    const client = await this.pool.connect();
    let started = false;
    try {
      await client.query("BEGIN");
      started = true;
      const result = await client.query(`${MFA_SELECT}
        WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND auth_user_id = $4
        FOR UPDATE`, [...scopeValues(scope), userId]);
      const factor = result.rows[0] ? mfaFromRow(result.rows[0]) : null;
      const index = factor?.recoveryCodeHashes.indexOf(codeHash) ?? -1;
      if (!factor?.verifiedAt || index < 0) {
        await client.query("ROLLBACK");
        started = false;
        return false;
      }
      factor.recoveryCodeHashes.splice(index, 1);
      await client.query(`UPDATE project_auth_mfa_factors SET recovery_code_hashes = $5
        WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND auth_user_id = $4`,
      // Auch hier jsonb: dasselbe Feld, derselbe Fehler, dieselbe Behebung.
      [...scopeValues(scope), userId, JSON.stringify(factor.recoveryCodeHashes)]);
      await client.query("COMMIT");
      started = false;
      return true;
    } catch (error) {
      if (started) await client.query("ROLLBACK").catch(() => undefined);
      throw mapPostgresError(error);
    } finally {
      client.release();
    }
  }

  async findOidcIdentity(scope: ProjectAuthScope, provider: string, subject: string) {
    const result = await query(this.pool, `${OIDC_SELECT}
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3
        AND provider = $4 AND subject = $5 LIMIT 1`, [...scopeValues(scope), provider, subject]);
    return result.rows[0] ? oidcFromRow(result.rows[0]) : null;
  }

  async createOidcIdentity(identity: ProjectAuthOidcIdentity) {
    try {
      const result = await this.pool.query(`INSERT INTO project_auth_oidc_identities
        (id, organization_id, project_id, environment, auth_user_id, provider, subject, created_at, last_sign_in_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING ${OIDC_COLUMNS}`, [
        identity.id, identity.organizationId, identity.projectId, identity.environment, identity.userId,
        identity.provider, identity.subject, identity.createdAt, identity.lastSignInAt,
      ]);
      return oidcFromRow(result.rows[0]);
    } catch (error) {
      const pg = error as PostgresError;
      if (pg.code === "23505" && pg.constraint === "project_auth_oidc_identity_key") {
        throw new DuplicateProjectAuthIdentityError();
      }
      throw mapPostgresError(error);
    }
  }
}

const USER_COLUMNS = `id, organization_id, project_id, environment, email, password_hash, status,
  email_verified_at, user_metadata, app_metadata, created_at, updated_at`;
const USER_SELECT = `SELECT ${USER_COLUMNS} FROM project_auth_users`;
const INSERT_USER = `INSERT INTO project_auth_users
  (id, organization_id, project_id, environment, email, password_hash, status,
   email_verified_at, user_metadata, app_metadata, created_at, updated_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`;

const SESSION_COLUMNS = `id, organization_id, project_id, environment, auth_user_id, family_id,
  refresh_token_hash, assurance, created_at, expires_at, revoked_at, replaced_by_session_id, compromised_at`;
const SESSION_SELECT = `SELECT ${SESSION_COLUMNS} FROM project_auth_sessions`;
const INSERT_SESSION = `INSERT INTO project_auth_sessions
  (id, organization_id, project_id, environment, auth_user_id, family_id, refresh_token_hash,
   assurance, created_at, expires_at, revoked_at, replaced_by_session_id, compromised_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`;

const ONE_TIME_COLUMNS = `id, organization_id, project_id, environment, auth_user_id, purpose,
  token_hash, metadata, created_at, expires_at, consumed_at`;
const SETTINGS_COLUMNS = `organization_id, project_id, environment, mfa_required, redirect_allow_list,
  sign_in_max, sign_in_window_seconds, mail_max, mail_window_seconds,
  refresh_max, refresh_window_seconds,
  leaked_password_check, password_min_length, leaked_password_notice, updated_at`;
const SETTINGS_SELECT = `SELECT ${SETTINGS_COLUMNS} FROM project_auth_settings`;
const MFA_COLUMNS = `id, organization_id, project_id, environment, auth_user_id, encrypted_secret,
  recovery_code_hashes, created_at, verified_at`;
const MFA_SELECT = `SELECT ${MFA_COLUMNS} FROM project_auth_mfa_factors`;
const OIDC_COLUMNS = `id, organization_id, project_id, environment, auth_user_id, provider, subject,
  created_at, last_sign_in_at`;
const OIDC_SELECT = `SELECT ${OIDC_COLUMNS} FROM project_auth_oidc_identities`;

function sessionValues(session: ProjectAuthSession): SqlValue[] {
  return [session.id, session.organizationId, session.projectId, session.environment, session.userId,
    session.familyId, session.refreshTokenHash, session.assurance, session.createdAt, session.expiresAt,
    session.revokedAt, session.replacedBySessionId, session.compromisedAt];
}

function scopeValues(scope: ProjectAuthScope): SqlValue[] {
  return [scope.organizationId, scope.projectId, scope.environment];
}

function sameSessionLineage(current: ProjectAuthSession, next: ProjectAuthSession): boolean {
  return current.organizationId === next.organizationId && current.projectId === next.projectId &&
    current.environment === next.environment && current.userId === next.userId && current.familyId === next.familyId;
}

async function query(database: SqlQueryable, text: string, values: readonly SqlValue[]) {
  try { return await database.query(text, values); } catch (error) { throw mapPostgresError(error); }
}

function timestamp(value: unknown, name: string): Date {
  const parsed = value instanceof Date ? new Date(value) : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new InvalidRecordError(`Invalid project auth ${name}.`);
  return parsed;
}

function optionalTimestamp(value: unknown, name: string): Date | null {
  return value === null || value === undefined ? null : timestamp(value, name);
}

function count(value: unknown, name: string): number {
  // PostgreSQL liefert COUNT(*) als bigint, und der Treiber reicht bigint als
  // Zeichenkette weiter. Number(...) ohne Pruefung machte aus einem
  // unerwarteten Wert stillschweigend NaN.
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new InvalidRecordError(`Invalid project auth ${name}.`);
  return parsed;
}

function jsonObject(value: unknown, name: string): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvalidRecordError(`Invalid project auth ${name}.`);
  }
  return { ...(parsed as Record<string, unknown>) };
}

function stringArray(value: unknown, name: string): string[] {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
    throw new InvalidRecordError(`Invalid project auth ${name}.`);
  }
  return [...parsed];
}

function userFromRow(row: Row): ProjectAuthUser {
  if (!row || !["active", "disabled"].includes(String(row.status))) {
    throw new InvalidRecordError("Invalid project auth user.");
  }
  return {
    id: String(row.id), organizationId: String(row.organization_id), projectId: String(row.project_id),
    environment: row.environment as ProjectAuthScope["environment"], email: String(row.email),
    passwordHash: row.password_hash === null ? null : String(row.password_hash),
    status: row.status as ProjectAuthUser["status"],
    emailVerifiedAt: optionalTimestamp(row.email_verified_at, "email verification"),
    userMetadata: jsonObject(row.user_metadata, "user metadata"),
    appMetadata: jsonObject(row.app_metadata, "app metadata"),
    createdAt: timestamp(row.created_at, "user creation"), updatedAt: timestamp(row.updated_at, "user update"),
  };
}

function sessionFromRow(row: Row): ProjectAuthSession {
  if (!row || !["aal1", "aal2"].includes(String(row.assurance))) {
    throw new InvalidRecordError("Invalid project auth session.");
  }
  return {
    id: String(row.id), organizationId: String(row.organization_id), projectId: String(row.project_id),
    environment: row.environment as ProjectAuthScope["environment"], userId: String(row.auth_user_id),
    familyId: String(row.family_id), refreshTokenHash: String(row.refresh_token_hash),
    assurance: row.assurance as ProjectAuthSession["assurance"],
    createdAt: timestamp(row.created_at, "session creation"), expiresAt: timestamp(row.expires_at, "session expiry"),
    revokedAt: optionalTimestamp(row.revoked_at, "session revocation"),
    replacedBySessionId: row.replaced_by_session_id === null ? null : String(row.replaced_by_session_id),
    compromisedAt: optionalTimestamp(row.compromised_at, "session compromise"),
  };
}

function sessionSummaryFromRow(row: Row): ProjectAuthSessionSummary {
  if (!row || !["aal1", "aal2"].includes(String(row.assurance))) {
    throw new InvalidRecordError("Invalid project auth session.");
  }
  return {
    id: String(row.id), familyId: String(row.family_id),
    assurance: row.assurance as ProjectAuthSessionSummary["assurance"],
    createdAt: timestamp(row.created_at, "session creation"), expiresAt: timestamp(row.expires_at, "session expiry"),
    replacedBySessionId: row.replaced_by_session_id === null ? null : String(row.replaced_by_session_id),
  };
}

function oneTimeFromRow(row: Row): ProjectAuthOneTimeToken {
  return {
    id: String(row.id), organizationId: String(row.organization_id), projectId: String(row.project_id),
    environment: row.environment as ProjectAuthScope["environment"],
    userId: row.auth_user_id === null ? null : String(row.auth_user_id),
    purpose: row.purpose as ProjectAuthOneTimePurpose, tokenHash: String(row.token_hash),
    metadata: jsonObject(row.metadata, "one-time metadata"),
    createdAt: timestamp(row.created_at, "token creation"), expiresAt: timestamp(row.expires_at, "token expiry"),
    consumedAt: optionalTimestamp(row.consumed_at, "token consumption"),
  };
}

function settingsFromRow(row: Row): ProjectAuthSettings {
  if (!row || typeof row.mfa_required !== "boolean" ||
      typeof row.leaked_password_check !== "boolean" ||
      !isProjectAuthPasswordNotice(row.leaked_password_notice)) {
    throw new InvalidRecordError("Invalid project auth settings.");
  }
  return {
    organizationId: String(row.organization_id), projectId: String(row.project_id),
    environment: row.environment as ProjectAuthScope["environment"],
    mfaRequired: row.mfa_required,
    returnTargets: stringArray(row.redirect_allow_list, "return targets"),
    rateLimits: {
      sign_in: {
        max: boundedInteger(row.sign_in_max, "sign-in limit"),
        windowSeconds: boundedInteger(row.sign_in_window_seconds, "sign-in window"),
      },
      mail: {
        max: boundedInteger(row.mail_max, "mail limit"),
        windowSeconds: boundedInteger(row.mail_window_seconds, "mail window"),
      },
      refresh: {
        max: boundedInteger(row.refresh_max, "refresh limit"),
        windowSeconds: boundedInteger(row.refresh_window_seconds, "refresh window"),
      },
    },
    passwordProtection: {
      leakedPasswordCheck: row.leaked_password_check,
      minLength: boundedInteger(row.password_min_length, "password minimum length"),
      notice: row.leaked_password_notice,
    },
    updatedAt: timestamp(row.updated_at, "settings update"),
  };
}

/**
 * Eine Zahl aus der Datenbank ist erst dann eine Zahl, wenn sie eine ist. Der
 * Treiber gibt `integer` als `number` zurueck, aber eine Zeile aus einer
 * aelteren Migration oder aus einer Fehlerspalte koennte alles Moegliche
 * tragen; eine unbrauchbare Zahl als Grenze waere schlimmer als ein Fehler.
 */
function boundedInteger(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidRecordError(`Invalid project auth ${label}.`);
  }
  return parsed;
}

function rateCountFromRow(row: Row): ProjectAuthRateCount {
  if (!row || !isProjectAuthRateLimitKind(row.kind)) {
    throw new InvalidRecordError("Invalid project auth rate counter.");
  }
  return {
    kind: row.kind,
    attempts: boundedInteger(row.attempts, "rate counter"),
    windowStart: timestamp(row.window_start, "rate window"),
  };
}

function mfaFromRow(row: Row): ProjectAuthMfaFactor {
  return {
    id: String(row.id), organizationId: String(row.organization_id), projectId: String(row.project_id),
    environment: row.environment as ProjectAuthScope["environment"], userId: String(row.auth_user_id),
    encryptedSecret: String(row.encrypted_secret), recoveryCodeHashes: stringArray(row.recovery_code_hashes, "recovery codes"),
    createdAt: timestamp(row.created_at, "MFA creation"), verifiedAt: optionalTimestamp(row.verified_at, "MFA verification"),
  };
}

function oidcFromRow(row: Row): ProjectAuthOidcIdentity {
  return {
    id: String(row.id), organizationId: String(row.organization_id), projectId: String(row.project_id),
    environment: row.environment as ProjectAuthScope["environment"], userId: String(row.auth_user_id),
    provider: String(row.provider), subject: String(row.subject),
    createdAt: timestamp(row.created_at, "OIDC identity creation"),
    lastSignInAt: timestamp(row.last_sign_in_at, "OIDC sign-in"),
  };
}
