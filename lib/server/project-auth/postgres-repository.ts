import { InvalidRecordError, mapPostgresError } from "@/lib/server/db/errors";
import type { SqlPool, SqlQueryable, SqlValue } from "@/lib/server/db/sql";
import type {
  ProjectAuthMfaEnrolmentCount,
  ProjectAuthMfaFactor,
  ProjectAuthOidcIdentity,
  ProjectAuthSamlAssertion,
  ProjectAuthOneTimePurpose,
  ProjectAuthOneTimeToken,
  ProjectAuthPasskey,
  ProjectAuthPasskeyCount,
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
import {
  PROJECT_AUTH_HOOK_FUNCTION_NAME,
  type ProjectAuthHooks,
} from "@/lib/server/project-auth/hooks";
import {
  isProjectAuthThirdPartyRole,
  PROJECT_AUTH_THIRD_PARTY_CLAIM_NAME,
  PROJECT_AUTH_THIRD_PARTY_NAME,
  type ProjectAuthThirdPartyDefinition,
  type ProjectAuthThirdPartyProvider,
} from "@/lib/server/project-auth/third-party";
import {
  isProjectAuthOAuthScope,
  PROJECT_AUTH_OAUTH_CHALLENGE,
  PROJECT_AUTH_OAUTH_CHALLENGE_METHOD,
  PROJECT_AUTH_OAUTH_CLIENT_NAME,
  type ProjectAuthOAuthClient,
  type ProjectAuthOAuthClientDefinition,
  type ProjectAuthOAuthCode,
  type ProjectAuthOAuthConsent,
  type ProjectAuthOAuthScope,
  type ProjectAuthOAuthToken,
} from "@/lib/server/project-auth/oauth";

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
   * Setzt beide Auth-Hooks (2.77), wieder als INSERT mit ON CONFLICT: Die Zeile
   * entsteht erst, wenn jemand etwas einstellt, und alles, was vorher in ihr
   * stand, bleibt unberuehrt, weil das UPDATE genau die sechs Spalten nennt,
   * um die es geht.
   *
   * `null` als Name ist hier eine Angabe und kein fehlender Wert: Sie heisst
   * "dieser Punkt ruft nichts". Darum wird sie geschrieben und nicht
   * uebersprungen, und darum kann ein Betreiber einen Hook durch dieselbe
   * Route wieder los werden, durch die er ihn eingetragen hat.
   */
  async writeAuthHooks(
    scope: ProjectAuthScope,
    hooks: ProjectAuthHooks,
    now: Date,
  ): Promise<ProjectAuthSettings> {
    const result = await query(this.pool, `INSERT INTO project_auth_settings
      (organization_id, project_id, environment,
       sign_in_hook_function, sign_in_hook_timeout_ms,
       access_token_hook_function, access_token_hook_timeout_ms, access_token_hook_claims,
       updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9)
      ON CONFLICT (organization_id, project_id, environment)
      DO UPDATE SET
        sign_in_hook_function = EXCLUDED.sign_in_hook_function,
        sign_in_hook_timeout_ms = EXCLUDED.sign_in_hook_timeout_ms,
        access_token_hook_function = EXCLUDED.access_token_hook_function,
        access_token_hook_timeout_ms = EXCLUDED.access_token_hook_timeout_ms,
        access_token_hook_claims = EXCLUDED.access_token_hook_claims,
        updated_at = EXCLUDED.updated_at
      RETURNING ${SETTINGS_COLUMNS}`, [
      ...scopeValues(scope),
      hooks.signIn.functionName, hooks.signIn.timeoutMs,
      hooks.accessTokenClaims.functionName, hooks.accessTokenClaims.timeoutMs,
      [...hooks.accessTokenClaims.claims],
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

  async createPasskey(passkey: ProjectAuthPasskey) {
    try {
      const result = await query(this.pool, `INSERT INTO project_auth_passkeys
        (id, organization_id, project_id, environment, auth_user_id, credential_id, public_key,
         algorithm, sign_count, user_verified, attestation_format, label, created_at, last_used_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING ${PASSKEY_COLUMNS}`, [
        passkey.id, passkey.organizationId, passkey.projectId, passkey.environment, passkey.userId,
        passkey.credentialId, passkey.publicKey, passkey.algorithm, passkey.signCount,
        passkey.userVerified, passkey.attestationFormat, passkey.label,
        passkey.createdAt, passkey.lastUsedAt,
      ]);
      return passkeyFromRow(result.rows[0]);
    } catch (error) {
      // Dieselbe Kennung zweimal in derselben Umgebung: Das ist kein Fehler des
      // Servers, sondern ein Geraet, das schon registriert ist.
      const postgres = error as PostgresError;
      if (postgres.code === "23505") throw new DuplicateProjectAuthIdentityError();
      throw error;
    }
  }

  async listPasskeys(scope: ProjectAuthScope, userId: string) {
    const result = await query(this.pool, `${PASSKEY_SELECT}
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND auth_user_id = $4
      ORDER BY created_at DESC, id DESC
      LIMIT 50`, [...scopeValues(scope), userId]);
    return result.rows.map(passkeyFromRow);
  }

  async findPasskeyByCredentialId(scope: ProjectAuthScope, credentialId: string) {
    const result = await query(this.pool, `${PASSKEY_SELECT}
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND credential_id = $4
      LIMIT 1`, [...scopeValues(scope), credentialId]);
    return result.rows[0] ? passkeyFromRow(result.rows[0]) : null;
  }

  async advancePasskeyCounter(
    scope: ProjectAuthScope,
    passkeyId: string,
    input: { fromSignCount: number; toSignCount: number; usedAt: Date },
  ) {
    // Der gelesene Stand steht im `WHERE`, und darum ist das hier eine
    // Bedingung und nicht bloss ein Schreibzugriff: Zwei gleichzeitige
    // Anmeldungen mit derselben Unterschrift treffen dieselbe Zeile, und genau
    // eine von beiden trifft sie mit dem Stand, den sie gelesen hat. Die andere
    // bekommt keine Zeile zurueck und wird abgewiesen.
    const result = await query(this.pool, `UPDATE project_auth_passkeys
      SET sign_count = $6, last_used_at = $7
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3
        AND id = $4 AND sign_count = $5
      RETURNING id`, [
      ...scopeValues(scope), passkeyId, input.fromSignCount, input.toSignCount, input.usedAt,
    ]);
    return result.rows.length === 1;
  }

  async deletePasskey(scope: ProjectAuthScope, userId: string, passkeyId: string) {
    // Der Nutzer steht im `WHERE` und nicht in einer Pruefung davor: Ein
    // Passkey eines fremden Nutzers soll nicht erst gelesen und dann abgelehnt
    // werden, sondern gar nicht getroffen.
    const result = await query(this.pool, `DELETE FROM project_auth_passkeys
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3
        AND auth_user_id = $4 AND id = $5
      RETURNING id`, [...scopeValues(scope), userId, passkeyId]);
    return result.rows.length === 1;
  }

  async countPasskeys(scope: ProjectAuthScope): Promise<ProjectAuthPasskeyCount> {
    const result = await query(this.pool, `SELECT
        (SELECT COUNT(*) FROM project_auth_users
          WHERE organization_id = $1 AND project_id = $2 AND environment = $3) AS users,
        (SELECT COUNT(*) FROM project_auth_passkeys
          WHERE organization_id = $1 AND project_id = $2 AND environment = $3) AS passkeys,
        (SELECT COUNT(DISTINCT auth_user_id) FROM project_auth_passkeys
          WHERE organization_id = $1 AND project_id = $2 AND environment = $3) AS users_with_passkey`,
    scopeValues(scope));
    const row = result.rows[0] ?? {};
    return {
      users: count(row.users, "user count"),
      passkeys: count(row.passkeys, "passkey count"),
      usersWithPasskey: count(row.users_with_passkey, "passkey user count"),
    };
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

  /**
   * Der Riegel gegen eine zweite Einreichung derselben Assertion (2.99).
   *
   * `ON CONFLICT DO NOTHING` und danach die Zeilenzahl: Kommen zwei
   * Einreichungen gleichzeitig an, gewinnt genau eine, weil die eindeutige
   * Bedingung aus 0070 entscheidet und nicht ein vorher gelesener Zustand.
   */
  async rememberSamlAssertion(assertion: ProjectAuthSamlAssertion): Promise<boolean> {
    try {
      const result = await this.pool.query(`INSERT INTO project_auth_saml_assertions
        (id, organization_id, project_id, environment, provider, assertion_id, used_at, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (organization_id, project_id, environment, provider, assertion_id) DO NOTHING`, [
        assertion.id, assertion.organizationId, assertion.projectId, assertion.environment,
        assertion.provider, assertion.assertionId, assertion.usedAt, assertion.expiresAt,
      ]);
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      throw mapPostgresError(error);
    }
  }

  async listThirdPartyProviders(scope: ProjectAuthScope): Promise<ProjectAuthThirdPartyProvider[]> {
    const result = await query(this.pool, `${THIRD_PARTY_SELECT}
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3
      ORDER BY name ASC`, scopeValues(scope));
    return result.rows.map(thirdPartyFromRow);
  }

  async findThirdPartyProviderByIssuer(
    scope: ProjectAuthScope,
    issuer: string,
  ): Promise<ProjectAuthThirdPartyProvider | null> {
    const result = await query(this.pool, `${THIRD_PARTY_SELECT}
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND issuer = $4
      LIMIT 1`, [...scopeValues(scope), issuer]);
    return result.rows[0] ? thirdPartyFromRow(result.rows[0]) : null;
  }

  async createThirdPartyProvider(
    scope: ProjectAuthScope,
    provider: ProjectAuthThirdPartyDefinition & { id: string },
    now: Date,
  ): Promise<ProjectAuthThirdPartyProvider> {
    try {
      const result = await this.pool.query(`INSERT INTO project_auth_third_party_providers
        (id, organization_id, project_id, environment, name, issuer, jwks_uri, audiences,
         subject_claim, role_claim, default_role, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9,$10,$11,$12)
        RETURNING ${THIRD_PARTY_COLUMNS}`, [
        provider.id, ...scopeValues(scope), provider.name, provider.issuer, provider.jwksUri,
        [...provider.audiences], provider.subjectClaim, provider.roleClaim, provider.defaultRole, now,
      ]);
      return thirdPartyFromRow(result.rows[0]);
    } catch (error) {
      const pg = error as PostgresError;
      // Beide UNIQUE-Bedingungen aus 0061 bedeuten dasselbe fuer den Aufrufer:
      // Dieser Anbieter steht in dieser Umgebung schon. Der Name der Bedingung
      // sagte ihm, welche der beiden es war, und das ist eine Auskunft ueber die
      // Tabelle und nicht ueber seine Eingabe.
      if (pg.code === "23505" && [
        "project_auth_third_party_providers_organization_id_project_id_e_key",
        "project_auth_third_party_providers_organization_id_project_i_key1",
      ].includes(pg.constraint ?? "")) {
        throw new DuplicateProjectAuthIdentityError();
      }
      if (pg.code === "23505") throw new DuplicateProjectAuthIdentityError();
      throw mapPostgresError(error);
    }
  }

  async deleteThirdPartyProvider(scope: ProjectAuthScope, providerId: string): Promise<boolean> {
    const result = await query(this.pool, `DELETE FROM project_auth_third_party_providers
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND id = $4`,
    [...scopeValues(scope), providerId]);
    return (result.rowCount ?? 0) > 0;
  }

  /* ---------------------------------------------------------------- *
   * OAuth-Server (2.82)
   * ---------------------------------------------------------------- */

  async listOAuthClients(scope: ProjectAuthScope): Promise<ProjectAuthOAuthClient[]> {
    const result = await query(this.pool, `${OAUTH_CLIENT_SELECT}
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3
      ORDER BY name ASC`, scopeValues(scope));
    return result.rows.map(oauthClientFromRow);
  }

  async findOAuthClientByName(scope: ProjectAuthScope, name: string): Promise<ProjectAuthOAuthClient | null> {
    const result = await query(this.pool, `${OAUTH_CLIENT_SELECT}
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND name = $4
      LIMIT 1`, [...scopeValues(scope), name]);
    return result.rows[0] ? oauthClientFromRow(result.rows[0]) : null;
  }

  async createOAuthClient(
    scope: ProjectAuthScope,
    client: ProjectAuthOAuthClientDefinition & { id: string },
    now: Date,
  ): Promise<ProjectAuthOAuthClient> {
    try {
      const result = await this.pool.query(`INSERT INTO project_auth_oauth_clients
        (id, organization_id, project_id, environment, name, redirect_uris, scopes, created_at)
        VALUES ($1,$2,$3,$4,$5,$6::text[],$7::text[],$8)
        RETURNING ${OAUTH_CLIENT_COLUMNS}`, [
        client.id, ...scopeValues(scope), client.name,
        [...client.redirectUris], [...client.scopes], now,
      ]);
      return oauthClientFromRow(result.rows[0]);
    } catch (error) {
      const pg = error as PostgresError;
      // Ein Name je Umgebung, und die eine UNIQUE-Bedingung aus 0062 bedeutet
      // fuer den Aufrufer genau eines: Dieser Client steht hier schon.
      if (pg.code === "23505") throw new DuplicateProjectAuthIdentityError();
      throw mapPostgresError(error);
    }
  }

  async deleteOAuthClient(scope: ProjectAuthScope, clientId: string): Promise<boolean> {
    const result = await query(this.pool, `DELETE FROM project_auth_oauth_clients
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND id = $4`,
    [...scopeValues(scope), clientId]);
    return (result.rowCount ?? 0) > 0;
  }

  /* ---------------------------------------------------------------- *
   * Die Zustimmung als Zeile (2.92)
   * ---------------------------------------------------------------- */

  /**
   * Die Zustimmungen dieser Umgebung, je mit Client und E-Mail-Adresse.
   *
   * Zwei INNER JOIN, und beide sagen etwas: Eine Zustimmung ohne Client und eine
   * ohne Nutzer gibt es in dieser Datenbank nicht (beide Fremdschluessel
   * loeschen mit), und ein LEFT JOIN wuerde eine Zeile mit leerem Namen zeigen,
   * wo in Wahrheit eine kaputte Datenbank stuende.
   *
   * Die Ordnung steht in der Abfrage und nicht beim Aufrufer: die juengste
   * zuerst, bei gleichem Zeitpunkt nach der Kennung. Eine Liste ohne
   * festgelegte Ordnung waere in der Console jedes Mal eine andere.
   */
  async listOAuthConsents(
    scope: ProjectAuthScope,
    limit: number,
  ): Promise<Array<ProjectAuthOAuthConsent & { clientName: string; email: string }>> {
    const result = await query(this.pool, `SELECT ${OAUTH_CONSENT_COLUMNS.split(", ")
      .map((column) => `k.${column}`).join(", ")}, c.name AS client_name, u.email AS email
      FROM project_auth_oauth_consents k
      JOIN project_auth_oauth_clients c ON c.id = k.client_id
      JOIN project_auth_users u ON u.id = k.auth_user_id
      WHERE k.organization_id = $1 AND k.project_id = $2 AND k.environment = $3
      ORDER BY k.granted_at DESC, k.id ASC
      LIMIT $4`, [...scopeValues(scope), Math.max(0, Math.trunc(limit))]);
    return result.rows.map((row) => {
      const clientName = String(row.client_name);
      if (!PROJECT_AUTH_OAUTH_CLIENT_NAME.test(clientName)) {
        throw new InvalidRecordError("Invalid project auth oauth client.");
      }
      return { ...oauthConsentFromRow(row), clientName, email: String(row.email) };
    });
  }

  async findOAuthConsent(
    scope: ProjectAuthScope,
    clientId: string,
    userId: string,
    scopes: ProjectAuthOAuthScope[],
  ): Promise<ProjectAuthOAuthConsent | null> {
    // Gleichheit auf dem ganzen Feld und kein Vergleich auf Teilmengen. Die
    // Bereiche stehen geordnet in der Zeile, also ist `=` hier genau die Frage
    // aus `projectAuthOAuthConsentCovers`, nur in SQL. `revoked_at IS NULL`
    // gehoert dazu: Eine widerrufene Zustimmung ist keine.
    const result = await query(this.pool, `SELECT ${OAUTH_CONSENT_COLUMNS}
      FROM project_auth_oauth_consents
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3
        AND client_id = $4 AND auth_user_id = $5 AND scopes = $6::text[]
        AND revoked_at IS NULL
      LIMIT 1`, [...scopeValues(scope), clientId, userId, [...scopes]]);
    return result.rows[0] ? oauthConsentFromRow(result.rows[0]) : null;
  }

  async findOAuthConsentById(
    scope: ProjectAuthScope,
    consentId: string,
  ): Promise<ProjectAuthOAuthConsent | null> {
    const result = await query(this.pool, `SELECT ${OAUTH_CONSENT_COLUMNS}
      FROM project_auth_oauth_consents
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND id = $4
      LIMIT 1`, [...scopeValues(scope), consentId]);
    return result.rows[0] ? oauthConsentFromRow(result.rows[0]) : null;
  }

  async createOAuthConsent(
    scope: ProjectAuthScope,
    consent: {
      id: string; clientId: string; userId: string;
      scopes: ProjectAuthOAuthScope[]; grantedAt: Date;
    },
  ): Promise<ProjectAuthOAuthConsent> {
    try {
      const result = await this.pool.query(`INSERT INTO project_auth_oauth_consents
        (id, organization_id, project_id, environment, client_id, auth_user_id,
         scopes, granted_at, revoked_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,NULL)
        RETURNING ${OAUTH_CONSENT_COLUMNS}`, [
        consent.id, ...scopeValues(scope), consent.clientId, consent.userId,
        [...consent.scopes], consent.grantedAt,
      ]);
      return oauthConsentFromRow(result.rows[0]);
    } catch (error) {
      const pg = error as PostgresError;
      // Der Teilindex aus 0064: Es gibt diese Zustimmung schon, und sie gilt.
      // Der Dienst liest sie danach und gibt dieselbe Zeile zurueck, statt eine
      // zweite anzulegen.
      if (pg.code === "23505") throw new DuplicateProjectAuthIdentityError();
      throw mapPostgresError(error);
    }
  }

  /**
   * Der Widerruf, und er ist ein UPDATE auf genau einer Spalte.
   *
   * `revoked_at IS NULL` steht in der Bedingung und nicht im Dienst: Zwei
   * gleichzeitige Widerrufe sollen nicht beide gelingen und dabei zwei
   * verschiedene Zeitpunkte schreiben. Die zweite Anfrage findet keine Zeile
   * mehr und bekommt `null`, also dieselbe Antwort wie bei einer Kennung, die
   * es nicht gibt. Das ist hier richtig: Beide Male ist nichts zu tun.
   */
  async revokeOAuthConsent(
    scope: ProjectAuthScope,
    consentId: string,
    now: Date,
  ): Promise<ProjectAuthOAuthConsent | null> {
    const result = await query(this.pool, `UPDATE project_auth_oauth_consents
      SET revoked_at = $5
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3
        AND id = $4 AND revoked_at IS NULL
      RETURNING ${OAUTH_CONSENT_COLUMNS}`, [...scopeValues(scope), consentId, now]);
    return result.rows[0] ? oauthConsentFromRow(result.rows[0]) : null;
  }

  async createOAuthCode(
    scope: ProjectAuthScope,
    code: {
      id: string; clientId: string; userId: string; consentId: string; redirectUri: string;
      scopes: ProjectAuthOAuthScope[]; codeHash: string; codeChallenge: string;
      createdAt: Date; expiresAt: Date;
    },
  ): Promise<ProjectAuthOAuthCode> {
    try {
      const result = await this.pool.query(`INSERT INTO project_auth_oauth_codes
        (id, organization_id, project_id, environment, client_id, auth_user_id, consent_id,
         redirect_uri, scopes, code_hash, code_challenge, code_challenge_method,
         created_at, expires_at, consumed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10,$11,$12,$13,$14,NULL)
        RETURNING ${OAUTH_CODE_COLUMNS}`, [
        code.id, ...scopeValues(scope), code.clientId, code.userId, code.consentId,
        code.redirectUri,
        [...code.scopes], code.codeHash, code.codeChallenge,
        PROJECT_AUTH_OAUTH_CHALLENGE_METHOD, code.createdAt, code.expiresAt,
      ]);
      return oauthCodeFromRow(result.rows[0]);
    } catch (error) {
      const pg = error as PostgresError;
      if (pg.code === "23505") throw new DuplicateProjectAuthIdentityError();
      throw mapPostgresError(error);
    }
  }

  /**
   * Finden und verbrauchen in **einer** Anweisung.
   *
   * `consumed_at IS NULL` ist die Bedingung, die das zweite Einloesen abweist,
   * und sie steht in derselben Anweisung wie das Setzen des Vermerks. Zwei
   * gleichzeitige Anfragen mit demselben Code sehen darum nicht beide eine freie
   * Zeile: Die zweite findet keine mehr, weil die erste dieselbe Zeile in
   * derselben Anweisung gesperrt und veraendert hat.
   *
   * `expires_at > $5` gehoert dazu und nicht in den Dienst: Ein Code, der
   * abgelaufen ist, soll nicht als verbraucht markiert werden, sonst waere im
   * Nachhinein nicht mehr zu sehen, ob er benutzt oder nur alt wurde.
   */
  async consumeOAuthCode(
    scope: ProjectAuthScope,
    codeHash: string,
    now: Date,
  ): Promise<ProjectAuthOAuthCode | null> {
    const result = await query(this.pool, `UPDATE project_auth_oauth_codes SET consumed_at = $5
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3
        AND code_hash = $4 AND consumed_at IS NULL AND expires_at > $5
      RETURNING ${OAUTH_CODE_COLUMNS}`, [...scopeValues(scope), codeHash, now]);
    return result.rows[0] ? oauthCodeFromRow(result.rows[0]) : null;
  }

  async createOAuthToken(
    scope: ProjectAuthScope,
    token: {
      id: string; clientId: string; userId: string; codeId: string; consentId: string;
      tokenHash: string; scopes: ProjectAuthOAuthScope[]; createdAt: Date; expiresAt: Date;
    },
  ): Promise<ProjectAuthOAuthToken> {
    try {
      const result = await this.pool.query(`INSERT INTO project_auth_oauth_tokens
        (id, organization_id, project_id, environment, client_id, auth_user_id, code_id,
         consent_id, token_hash, scopes, created_at, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[],$11,$12)
        RETURNING ${OAUTH_TOKEN_COLUMNS}`, [
        token.id, ...scopeValues(scope), token.clientId, token.userId, token.codeId,
        token.consentId, token.tokenHash, [...token.scopes], token.createdAt, token.expiresAt,
      ]);
      return oauthTokenFromRow(result.rows[0]);
    } catch (error) {
      const pg = error as PostgresError;
      // Die Eindeutigkeit von `code_id`: Aus einem Code entsteht genau ein
      // Token, auch dann, wenn ein zweiter Weg den Verbrauchsvermerk vergisst.
      if (pg.code === "23505") throw new DuplicateProjectAuthIdentityError();
      throw mapPostgresError(error);
    }
  }

  /* ---------------------------------------------------------------- *
   * Der Widerruf eines einzelnen Tokens (2.93)
   * ---------------------------------------------------------------- */

  /**
   * Die ausgegebenen Token dieser Umgebung, je mit Client und Adresse.
   *
   * `token_hash` steht **nicht** in der Auswahl, und das ist keine
   * Sparsamkeit: Die Liste geht an eine Console, und was dort nicht hin muss,
   * soll die Datenbank gar nicht erst herausgeben.
   *
   * Zwei INNER JOIN, wie bei den Zustimmungen: Ein Token ohne Client und eines
   * ohne Nutzer gibt es in dieser Datenbank nicht.
   */
  async listOAuthTokens(
    scope: ProjectAuthScope,
    limit: number,
  ): Promise<Array<ProjectAuthOAuthToken & { clientName: string; email: string }>> {
    const result = await query(this.pool, `SELECT ${OAUTH_TOKEN_COLUMNS.split(", ")
      .map((column) => `t.${column}`).join(", ")}, c.name AS client_name, u.email AS email
      FROM project_auth_oauth_tokens t
      JOIN project_auth_oauth_clients c ON c.id = t.client_id
      JOIN project_auth_users u ON u.id = t.auth_user_id
      WHERE t.organization_id = $1 AND t.project_id = $2 AND t.environment = $3
      ORDER BY t.created_at DESC, t.id ASC
      LIMIT $4`, [...scopeValues(scope), Math.max(0, Math.trunc(limit))]);
    return result.rows.map((row) => {
      const clientName = String(row.client_name);
      if (!PROJECT_AUTH_OAUTH_CLIENT_NAME.test(clientName)) {
        throw new InvalidRecordError("Invalid project auth oauth client.");
      }
      return { ...oauthTokenFromRow(row), clientName, email: String(row.email) };
    });
  }

  /**
   * Der Widerruf genau eines Tokens, und er ist ein DELETE.
   *
   * Der Unterschied zur Zustimmung steht in dieser einen Anweisung: Dort ein
   * UPDATE auf einer Spalte, hier eine Zeile weniger. Ein Token gilt, weil
   * seine Zeile existiert (0062), also braucht dieser Widerruf keine zweite
   * Spalte und keine zusaetzliche Bedingung im heissen Weg; eine vergessene
   * Bedingung waere ein Widerruf, der nicht wirkt.
   *
   * Der Code dahinter bleibt stehen und bleibt verbraucht. Aus ihm entsteht
   * darum auch nach dem Widerruf kein zweites Token: `consumed_at` ist
   * gesetzt, und `consumeOAuthCode` findet ihn nicht mehr.
   *
   * `RETURNING` und nicht `rowCount`, weil der Dienst den Nutzer und die
   * Bereiche fuer die Audit-Zeile braucht und sie danach nicht mehr lesen
   * koennte.
   */
  async revokeOAuthToken(
    scope: ProjectAuthScope,
    tokenId: string,
  ): Promise<ProjectAuthOAuthToken | null> {
    const result = await query(this.pool, `DELETE FROM project_auth_oauth_tokens
      WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND id = $4
      RETURNING ${OAUTH_TOKEN_COLUMNS}`, [...scopeValues(scope), tokenId]);
    return result.rows[0] ? oauthTokenFromRow(result.rows[0]) : null;
  }

  async findOAuthTokenByHash(
    scope: ProjectAuthScope,
    tokenHash: string,
  ): Promise<{
    token: ProjectAuthOAuthToken;
    clientName: string;
    consent: ProjectAuthOAuthConsent | null;
  } | null> {
    // Der Name des Clients kommt mitgelesen und nicht in einer zweiten Abfrage:
    // Der heisse Weg soll eine Abfrage kosten und nicht zwei, und der INNER JOIN
    // sagt zugleich die Zusage, dass ein Token ohne Client nichts ist.
    //
    // Die Zustimmung kommt im selben Zug (2.92), und dieser JOIN ist ein LEFT
    // JOIN, obwohl der andere ein INNER ist. Der Unterschied ist die Aussage:
    // Ein Token ohne Client kann es nicht geben, ein Token ohne Zustimmung
    // schon, naemlich eines aus der Zeit vor Migration 0064. Ein INNER JOIN
    // liesse es als "unbekannt" durchfallen, und der Dienst koennte nicht mehr
    // sagen, dass hier eine Zustimmung fehlt statt ein Token.
    const result = await query(this.pool, `SELECT ${OAUTH_TOKEN_COLUMNS.split(", ")
      .map((column) => `t.${column}`).join(", ")}, c.name AS client_name,
      ${OAUTH_CONSENT_COLUMNS.split(", ").map((column) => `k.${column} AS zustimmung_${column}`).join(", ")}
      FROM project_auth_oauth_tokens t
      JOIN project_auth_oauth_clients c ON c.id = t.client_id
      LEFT JOIN project_auth_oauth_consents k ON k.id = t.consent_id
      WHERE t.organization_id = $1 AND t.project_id = $2 AND t.environment = $3 AND t.token_hash = $4
      LIMIT 1`, [...scopeValues(scope), tokenHash]);
    const row = result.rows[0];
    if (!row) return null;
    const clientName = String(row.client_name);
    if (!PROJECT_AUTH_OAUTH_CLIENT_NAME.test(clientName)) {
      throw new InvalidRecordError("Invalid project auth oauth client.");
    }
    // Die Spalten der Zustimmung tragen ein eigenes Praefix, weil das Token
    // selbst schon eine Spalte `consent_id` hat: Zwei gleich benannte Spalten in
    // einer Antwort haetten am Ende eine gewonnen, und welche, entschiede der
    // Treiber.
    const consent = row.zustimmung_id === null || row.zustimmung_id === undefined ? null
      : oauthConsentFromRow({
        id: row.zustimmung_id, client_id: row.zustimmung_client_id,
        auth_user_id: row.zustimmung_auth_user_id, scopes: row.zustimmung_scopes,
        granted_at: row.zustimmung_granted_at, revoked_at: row.zustimmung_revoked_at,
      });
    return { token: oauthTokenFromRow(row), clientName, consent };
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
  leaked_password_check, password_min_length, leaked_password_notice,
  sign_in_hook_function, sign_in_hook_timeout_ms,
  access_token_hook_function, access_token_hook_timeout_ms, access_token_hook_claims, updated_at`;
const SETTINGS_SELECT = `SELECT ${SETTINGS_COLUMNS} FROM project_auth_settings`;
const MFA_COLUMNS = `id, organization_id, project_id, environment, auth_user_id, encrypted_secret,
  recovery_code_hashes, created_at, verified_at`;
const MFA_SELECT = `SELECT ${MFA_COLUMNS} FROM project_auth_mfa_factors`;
const PASSKEY_COLUMNS = `id, organization_id, project_id, environment, auth_user_id, credential_id,
  public_key, algorithm, sign_count, user_verified, attestation_format, label, created_at, last_used_at`;
const PASSKEY_SELECT = `SELECT ${PASSKEY_COLUMNS} FROM project_auth_passkeys`;
const OIDC_COLUMNS = `id, organization_id, project_id, environment, auth_user_id, provider, subject,
  created_at, last_sign_in_at`;
const OIDC_SELECT = `SELECT ${OIDC_COLUMNS} FROM project_auth_oidc_identities`;
const THIRD_PARTY_COLUMNS = `id, name, issuer, jwks_uri, audiences, subject_claim, role_claim,
  default_role, created_at`;
const THIRD_PARTY_SELECT = `SELECT ${THIRD_PARTY_COLUMNS} FROM project_auth_third_party_providers`;

const OAUTH_CLIENT_COLUMNS = `id, name, redirect_uris, scopes, created_at`;
const OAUTH_CLIENT_SELECT = `SELECT ${OAUTH_CLIENT_COLUMNS} FROM project_auth_oauth_clients`;
// Die Pruefsumme des Codes steht absichtlich nicht in der Liste: Wer die Zeile
// schon hat, braucht sie nicht, und was nicht gelesen wird, kann nicht in ein
// Protokoll geraten.
const OAUTH_CODE_COLUMNS = `id, client_id, auth_user_id, consent_id, redirect_uri, scopes,
  code_challenge, code_challenge_method, created_at, expires_at, consumed_at`;
// Dasselbe hier, und aus demselben Grund: kein `token_hash`.
const OAUTH_TOKEN_COLUMNS = `id, client_id, auth_user_id, consent_id, scopes, created_at, expires_at`;
const OAUTH_CONSENT_COLUMNS = `id, client_id, auth_user_id, scopes, granted_at, revoked_at`;

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

/** Eine ganze Zahl, die auch negativ sein darf. `count` verlangt sie positiv. */
function integerValue(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new InvalidRecordError(`Invalid project auth ${name}.`);
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
    hooks: {
      signIn: {
        functionName: hookFunctionName(row.sign_in_hook_function, "sign-in hook"),
        timeoutMs: boundedInteger(row.sign_in_hook_timeout_ms, "sign-in hook timeout"),
      },
      accessTokenClaims: {
        functionName: hookFunctionName(row.access_token_hook_function, "access token hook"),
        timeoutMs: boundedInteger(row.access_token_hook_timeout_ms, "access token hook timeout"),
        claims: stringArray(row.access_token_hook_claims, "access token hook claims"),
      },
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

/**
 * Der Name einer Hook-Function aus der Zeile, oder `null`.
 *
 * `null` ist hier eine Angabe ("dieser Punkt ruft nichts") und kein Fehler.
 * Alles andere muss ein Name sein, den der Aufrufdienst kennen koennte; eine
 * leere Zeichenkette oder ein Name mit einem Zeichen, das der Aufrufdienst
 * abweisen wuerde, ist eine unbrauchbare Zeile und kein aufrufbarer Hook. Sie
 * faellt als Fehler auf, statt bei jeder Anmeldung still zu einem
 * `COMPUTE_NOT_FOUND` zu fuehren, das die Anmeldung geschlossen scheitern
 * laesst, ohne zu sagen, warum.
 */
function hookFunctionName(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !PROJECT_AUTH_HOOK_FUNCTION_NAME.test(value)) {
    throw new InvalidRecordError(`Invalid project auth ${label}.`);
  }
  return value;
}

/**
 * Ein fremder Anbieter aus der Zeile (2.80).
 *
 * Geprueft wird hier noch einmal, was die CHECK-Bedingungen aus 0061 schon
 * pruefen: Name, Anspruchsnamen, Rolle. Das ist kein Misstrauen gegen die
 * Datenbank, sondern die Regel dieses Moduls: Eine Zeile, die aus einer
 * aelteren Migration oder aus einem Handeingriff kommt, soll hier als
 * unbrauchbare Zeile auffallen und nicht als Anbieter weiterlaufen.
 *
 * Der wichtigste Teil ist die Rolle. Eine Zeile mit `default_role =
 * 'service_role'` waere ein Anbieter, dessen Token jede Policy umgeht. Sie
 * kaeme durch den CHECK nicht herein, und wenn sie doch je hereinkaeme, ist sie
 * hier ein Fehler und keine stille Hochstufung.
 */
function thirdPartyFromRow(row: Row): ProjectAuthThirdPartyProvider {
  const name = String(row.name);
  const subjectClaim = String(row.subject_claim);
  const roleClaim = row.role_claim === null || row.role_claim === undefined ? null : String(row.role_claim);
  if (!PROJECT_AUTH_THIRD_PARTY_NAME.test(name) ||
      !PROJECT_AUTH_THIRD_PARTY_CLAIM_NAME.test(subjectClaim) ||
      (roleClaim !== null && !PROJECT_AUTH_THIRD_PARTY_CLAIM_NAME.test(roleClaim)) ||
      !isProjectAuthThirdPartyRole(row.default_role)) {
    throw new InvalidRecordError("Invalid project auth third party provider.");
  }
  const audiences = stringArray(row.audiences, "third party audiences");
  if (audiences.length < 1) throw new InvalidRecordError("Invalid project auth third party provider.");
  return {
    id: String(row.id), name, issuer: String(row.issuer), jwksUri: String(row.jwks_uri),
    audiences, subjectClaim, roleClaim, defaultRole: row.default_role,
    createdAt: timestamp(row.created_at, "third party provider creation"),
  };
}

/**
 * Ein OAuth-Client aus der Zeile (2.82).
 *
 * Geprueft wird hier noch einmal, was die CHECK-Bedingungen aus 0062 schon
 * pruefen: der Name, die Ruecksprungziele, die Bereiche. Dieselbe Regel wie bei
 * den fremden Anbietern: Eine Zeile aus einem Handeingriff soll hier als
 * unbrauchbare Zeile auffallen und nicht als Client weiterlaufen.
 *
 * Der wichtigste Teil sind die Bereiche. Ein Wert, der nicht in
 * `PROJECT_AUTH_OAUTH_SCOPES` steht, waere eine Erlaubnis, die niemand
 * beschrieben hat, und sie soll nicht stillschweigend mitlaufen.
 */
function oauthClientFromRow(row: Row): ProjectAuthOAuthClient {
  const name = String(row.name);
  const redirectUris = stringArray(row.redirect_uris, "oauth redirect uris");
  const scopes = stringArray(row.scopes, "oauth scopes");
  if (!PROJECT_AUTH_OAUTH_CLIENT_NAME.test(name) || redirectUris.length < 1 || scopes.length < 1 ||
      !scopes.every(isProjectAuthOAuthScope)) {
    throw new InvalidRecordError("Invalid project auth oauth client.");
  }
  return {
    id: String(row.id), name, redirectUris, scopes,
    createdAt: timestamp(row.created_at, "oauth client creation"),
  };
}

function oauthCodeFromRow(row: Row): ProjectAuthOAuthCode {
  const scopes = stringArray(row.scopes, "oauth code scopes");
  const codeChallenge = String(row.code_challenge);
  // Das Verfahren wird gelesen und geprueft, obwohl die Spalte nur einen Wert
  // zulaesst. Genau darum: Eine Zeile, die trotzdem etwas anderes traegt, ist
  // eine Zeile aus einer Datenbank, die nicht die ist, fuer die dieser Code
  // geschrieben wurde, und dann ist Abbrechen richtig.
  if (!scopes.every(isProjectAuthOAuthScope) || scopes.length < 1 ||
      !PROJECT_AUTH_OAUTH_CHALLENGE.test(codeChallenge) ||
      String(row.code_challenge_method) !== PROJECT_AUTH_OAUTH_CHALLENGE_METHOD) {
    throw new InvalidRecordError("Invalid project auth oauth code.");
  }
  return {
    id: String(row.id), clientId: String(row.client_id), userId: String(row.auth_user_id),
    consentId: row.consent_id === null || row.consent_id === undefined ? null : String(row.consent_id),
    redirectUri: String(row.redirect_uri), scopes, codeChallenge,
    createdAt: timestamp(row.created_at, "oauth code creation"),
    expiresAt: timestamp(row.expires_at, "oauth code expiry"),
    consumedAt: row.consumed_at === null || row.consumed_at === undefined
      ? null : timestamp(row.consumed_at, "oauth code consumption"),
  };
}

function oauthTokenFromRow(row: Row): ProjectAuthOAuthToken {
  const scopes = stringArray(row.scopes, "oauth token scopes");
  if (!scopes.every(isProjectAuthOAuthScope) || scopes.length < 1) {
    throw new InvalidRecordError("Invalid project auth oauth token.");
  }
  return {
    id: String(row.id), clientId: String(row.client_id), userId: String(row.auth_user_id),
    consentId: row.consent_id === null || row.consent_id === undefined ? null : String(row.consent_id),
    scopes,
    createdAt: timestamp(row.created_at, "oauth token creation"),
    expiresAt: timestamp(row.expires_at, "oauth token expiry"),
  };
}

/**
 * Eine Zustimmung aus der Zeile (2.92).
 *
 * Geprueft wird hier noch einmal, was der CHECK aus 0064 schon prueft: dass die
 * Bereiche welche sind, die es gibt. Dieselbe Regel wie beim Client: Eine Zeile
 * aus einem Handeingriff soll hier als unbrauchbare Zeile auffallen und nicht
 * als Erlaubnis weiterlaufen, denn eine Erlaubnis, die niemand beschrieben hat,
 * ist die schlechteste Art von Erlaubnis.
 */
function oauthConsentFromRow(row: Row): ProjectAuthOAuthConsent {
  const scopes = stringArray(row.scopes, "oauth consent scopes");
  if (!scopes.every(isProjectAuthOAuthScope) || scopes.length < 1) {
    throw new InvalidRecordError("Invalid project auth oauth consent.");
  }
  return {
    id: String(row.id), clientId: String(row.client_id), userId: String(row.auth_user_id), scopes,
    grantedAt: timestamp(row.granted_at, "oauth consent grant"),
    revokedAt: row.revoked_at === null || row.revoked_at === undefined
      ? null : timestamp(row.revoked_at, "oauth consent revocation"),
  };
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

function passkeyFromRow(row: Row): ProjectAuthPasskey {
  return {
    id: String(row.id), organizationId: String(row.organization_id), projectId: String(row.project_id),
    environment: row.environment as ProjectAuthScope["environment"], userId: String(row.auth_user_id),
    credentialId: String(row.credential_id), publicKey: String(row.public_key),
    // `algorithm` ist eine negative ganze Zahl (die Zaehlung von COSE), und
    // `sign_count` ist bigint und kommt darum als Zeichenkette aus dem Treiber.
    // Beide werden geprueft und nicht geglaubt: Ein NaN in einem Zaehler faellt
    // sonst erst beim Vergleich auf, und dann faellt er nach oben offen.
    algorithm: integerValue(row.algorithm, "passkey algorithm"),
    signCount: count(row.sign_count, "passkey sign count"),
    userVerified: row.user_verified === true,
    attestationFormat: String(row.attestation_format), label: String(row.label),
    createdAt: timestamp(row.created_at, "passkey creation"),
    lastUsedAt: optionalTimestamp(row.last_used_at, "passkey usage"),
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
