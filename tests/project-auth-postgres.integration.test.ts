import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import type { SqlPool } from "@/lib/server/db/sql";
import { withTenantTransaction } from "@/lib/server/db/transaction";
import { PostgresProjectAuthAuditSink } from "@/lib/server/project-auth/audit-postgres";
import { ProjectAuthSecretProtector, ProjectAuthTotp } from "@/lib/server/project-auth/mfa";
import { ProjectAuthOidcCatalog, ProjectAuthOidcClient } from "@/lib/server/project-auth/oidc";
import { PostgresProjectAuthRepository } from "@/lib/server/project-auth/postgres-repository";
import { NoopDevelopmentProjectAuthDelivery, ProjectAuthService } from "@/lib/server/project-auth/service";
import { ProjectAuthTokenService } from "@/lib/server/project-auth/tokens";

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const authUrl = process.env.QKERN_TEST_AUTH_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = Boolean(ownerUrl && authUrl && runtimeUrl);

class FastHasher implements PasswordHasher {
  readonly dummyHash = "fast:dummy";
  async hash(password: string) { return `fast:${createHash("sha256").update(password).digest("hex")}`; }
  async verify(password: string, hash: string) { return hash === await this.hash(password); }
}

describe.runIf(enabled)("Project Auth PostgreSQL certification", () => {
  let owner: SqlPool;
  let auth: SqlPool;
  let runtime: SqlPool;
  let service: ProjectAuthService;
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const scope = { organizationId, projectId, environment: "development" as const };

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    auth = verifyDatabaseBoundary(createPostgresPool({ connectionString: authUrl!, max: 2 }), "auth");
    runtime = verifyDatabaseBoundary(createPostgresPool({ connectionString: runtimeUrl!, max: 2 }), "runtime");
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [controlUser, `project-auth-owner-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Project Auth Integration', $2, $3)`,
    [organizationId, `project-auth-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Project Auth', $3, 'test', 'ready', $4)`,
    [projectId, organizationId, `project-auth-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [organizationId, projectId, `managed:${projectId}`]);
    const { privateKey } = generateKeyPairSync("ed25519");
    service = new ProjectAuthService({
      repository: new PostgresProjectAuthRepository(auth), passwords: new FastHasher(),
      rateLimiter: new InMemoryRateLimiter(),
      tokens: new ProjectAuthTokenService({ kid: "postgres-test", privateKey }, "https://qkern.test"),
      mfa: new ProjectAuthTotp(), secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 9)),
      delivery: new NoopDevelopmentProjectAuthDelivery(), oidcCatalog: new ProjectAuthOidcCatalog([]),
      oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
      callbackBaseUrl: "https://qkern.test", allowedRedirectOrigins: new Set(["https://app.test"]),
      exposeDeliveryTokens: true,
    });
  });

  afterAll(async () => {
    // The organization must go first: organizations.created_by deliberately
    // restricts deleting its owner, while everything below it cascades.
    if (owner) {
      await owner.query("DELETE FROM audit_logs WHERE organization_id = $1", [organizationId]);
      await owner.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
      await owner.query("DELETE FROM users WHERE id = $1", [controlUser]);
    }
    await Promise.all([owner?.end(), auth?.end(), runtime?.end()]);
  });

  it("persists app users only through the auth role and keeps runtime access closed", async () => {
    const signup = await service.signUp(scope, {
      email: `app-user-${randomUUID()}@qkern.test`, password: "a sufficiently long password",
      redirectTo: "https://app.test/callback", rateLimitKey: randomUUID(),
    });
    expect(signup.debugToken).toMatch(/^qk_verify_/);
    const session = await service.consumeEmailToken(scope, {
      token: signup.debugToken!, purpose: "email_verification",
    });
    expect(session).not.toHaveProperty("mfaRequired");
    await expect(runtime.query("SELECT id FROM project_auth_users LIMIT 1")).rejects.toBeTruthy();
  });

  it("rotates refresh rows atomically and revokes the whole family on replay", async () => {
    const signup = await service.signUp(scope, {
      email: `replay-${randomUUID()}@qkern.test`, password: "a sufficiently long password",
      redirectTo: "https://app.test/callback", rateLimitKey: randomUUID(),
    });
    const initial = await service.consumeEmailToken(scope, {
      token: signup.debugToken!, purpose: "email_verification",
    });
    if ("mfaRequired" in initial) throw new Error("unexpected MFA");
    const rotated = await service.refresh(scope, initial.refreshToken);
    await expect(service.refresh(scope, initial.refreshToken)).rejects.toMatchObject({ code: "TOKEN_REPLAYED" });
    await expect(service.verifyAccess(scope, rotated.accessToken)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("lists active sessions and revokes one family or all of one user in PostgreSQL (2.34)", async () => {
    const password = "a sufficiently long password";
    async function verifiedUser(prefix: string) {
      const email = `${prefix}-${randomUUID()}@qkern.test`;
      const signup = await service.signUp(scope, {
        email, password, redirectTo: "https://app.test/callback", rateLimitKey: randomUUID(),
      });
      const session = await service.consumeEmailToken(scope, { token: signup.debugToken!, purpose: "email_verification" });
      if ("mfaRequired" in session) throw new Error("unexpected MFA");
      return { email, session };
    }
    const target = await verifiedUser("sessions");
    const bystander = await verifiedUser("sessions-bystander");
    const second = await service.passwordSignIn(scope, { email: target.email, password, rateLimitKey: randomUUID() });
    if ("mfaRequired" in second) throw new Error("unexpected MFA");
    const userId = (await service.verifyAccess(scope, target.session.accessToken)).user.id;
    // Die erste Anmeldung rotiert einmal: die alte Zeile ist ersetzt und
    // widerrufen, nur die neue zaehlt als aktiv.
    const rotated = await service.refresh(scope, target.session.refreshToken);
    const rotatedSession = (await service.verifyAccess(scope, rotated.accessToken)).session;

    const listed = await service.listSessions(scope, userId);
    expect(listed.sessions).toHaveLength(2);
    expect(listed.sessions.map((entry) => entry.id)).toContain(rotatedSession.id);
    expect(JSON.stringify(listed)).not.toMatch(/refreshTokenHash|qk_refresh_/);

    expect(await service.revokeSession(scope, userId, rotatedSession.id)).toEqual({ revoked: 1 });
    expect((await service.listSessions(scope, userId)).sessions).toHaveLength(1);
    // Ein widerrufenes Refresh Token laeuft in die Replay-Pruefung der Rotation.
    await expect(service.refresh(scope, rotated.refreshToken)).rejects.toMatchObject({ code: "TOKEN_REPLAYED" });
    await expect(service.verifyAccess(scope, rotated.accessToken)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    // Die andere Familie lebt weiter: ihr Refresh Token rotiert normal.
    const secondRotated = await service.refresh(scope, second.refreshToken);
    expect(secondRotated.refreshToken).toMatch(/^qk_refresh_/);

    expect(await service.revokeAllSessions(scope, userId)).toEqual({ revoked: 1 });
    expect((await service.listSessions(scope, userId)).sessions).toEqual([]);
    await expect(service.refresh(scope, secondRotated.refreshToken)).rejects.toMatchObject({ code: "TOKEN_REPLAYED" });

    const bystanderId = (await service.verifyAccess(scope, bystander.session.accessToken)).user.id;
    expect((await service.listSessions(scope, bystanderId)).sessions).toHaveLength(1);
    await expect(service.refresh(scope, bystander.session.refreshToken)).resolves.toMatchObject({ tokenType: "Bearer" });
    await expect(service.listSessions({ ...scope, projectId: randomUUID() }, userId))
      .rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("records auth events through the auth role into the intact platform audit chain (2.35)", async () => {
    // Eine eigene Organisation: audit_logs ist append-only, der Aufraeumschritt
    // oben koennte sie nicht mehr loeschen. Rest bleibt im Wegwerf-Stack,
    // wie bei den anderen Suiten mit Audit-Eintraegen.
    const auditOrganization = randomUUID();
    const auditProject = randomUUID();
    const auditScope = { organizationId: auditOrganization, projectId: auditProject, environment: "development" as const };
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Project Auth Audit', $2, $3)`, [auditOrganization, `project-auth-audit-${auditOrganization}`, controlUser]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Project Auth Audit', $3, 'test', 'ready', $4)`,
    [auditProject, auditOrganization, `project-auth-audit-${auditProject}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [auditOrganization, auditProject, `managed:${auditProject}`]);
    const { privateKey } = generateKeyPairSync("ed25519");
    const audited = new ProjectAuthService({
      repository: new PostgresProjectAuthRepository(auth), passwords: new FastHasher(),
      rateLimiter: new InMemoryRateLimiter(), audit: new PostgresProjectAuthAuditSink(auth),
      tokens: new ProjectAuthTokenService({ kid: "postgres-audit", privateKey }, "https://qkern.test"),
      mfa: new ProjectAuthTotp(), secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 8)),
      delivery: new NoopDevelopmentProjectAuthDelivery(), oidcCatalog: new ProjectAuthOidcCatalog([]),
      oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
      callbackBaseUrl: "https://qkern.test", allowedRedirectOrigins: new Set(["https://app.test"]),
      exposeDeliveryTokens: true,
    });
    const errors = vi.spyOn(console, "error");
    const email = `audit-${randomUUID()}@qkern.test`;
    const password = "a sufficiently long password";
    const signup = await audited.signUp(auditScope, {
      email, password, redirectTo: "https://app.test/callback", rateLimitKey: randomUUID(),
    });
    const session = await audited.consumeEmailToken(auditScope, { token: signup.debugToken!, purpose: "email_verification" });
    if ("mfaRequired" in session) throw new Error("unexpected MFA");
    const userId = (await audited.verifyAccess(auditScope, session.accessToken)).user.id;
    await expect(audited.passwordSignIn(auditScope, {
      email: `unknown-${randomUUID()}@qkern.test`, password, rateLimitKey: randomUUID(),
    })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(await audited.revokeAllSessions(auditScope, userId, { id: controlUser })).toEqual({ revoked: 1 });
    // Kein Ereignis ist still verloren gegangen: der Sink hat nie geworfen.
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();

    const page = await audited.listAuditEvents(auditScope, 10);
    expect(page.events.map((event) => event.action)).toEqual([
      "project_auth.sessions.revoked_all", "project_auth.login.failed",
      "project_auth.login.succeeded", "project_auth.signup.succeeded",
    ]);
    expect(page.events[0]).toMatchObject({ actorType: "admin", actorRef: controlUser, resourceRef: `project_auth_user:${userId}` });
    expect(page.events[1]).toMatchObject({ actorRef: "anonymous", metadata: { method: "password", reason: "invalid_credentials" } });
    expect(page.events[2]).toMatchObject({ actorRef: `project_auth_user:${userId}`, metadata: { method: "email_verification" } });
    const cursorPage = await audited.listAuditEvents(auditScope, 2, page.events[1].id);
    expect(cursorPage.events.map((event) => event.action))
      .toEqual(["project_auth.login.succeeded", "project_auth.signup.succeeded"]);

    const rows = await owner.query(`SELECT actor_type, actor_ref, action, resource_ref, status, redacted_metadata
      FROM audit_logs WHERE organization_id = $1`, [auditOrganization]);
    expect(rows.rows).toHaveLength(4);
    const serialized = JSON.stringify(rows.rows);
    expect(serialized).not.toContain("@");
    expect(serialized).not.toMatch(/qk_(refresh|verify|magic|reset|challenge)_/);
    expect(serialized).not.toContain(session.refreshToken);

    // Die Kette neu rechnen, wie auditChainIntact im Backup-Drill: jeder
    // entry_hash stimmt, und jeder previous_hash zeigt auf den Vorgaenger.
    const chain = await owner.query<{ ok: boolean; linked: boolean }>(`
      WITH ordered AS (
        SELECT *, lag(entry_hash) OVER (PARTITION BY organization_id ORDER BY created_at, id) AS expected_previous
        FROM audit_logs WHERE organization_id = $1
      )
      SELECT bool_and(entry_hash = encode(digest(jsonb_build_object(
               'id', id, 'organization_id', organization_id, 'project_id', project_id, 'environment', environment,
               'actor_type', actor_type, 'actor_ref', actor_ref, 'action', action, 'resource_ref', resource_ref,
               'status', status, 'redacted_metadata', redacted_metadata, 'previous_hash', previous_hash, 'created_at', created_at
             )::text, 'sha256'), 'hex')) AS ok,
             bool_and(previous_hash IS NOT DISTINCT FROM expected_previous) AS linked
      FROM ordered`, [auditOrganization]);
    expect(chain.rows[0]).toEqual({ ok: true, linked: true });

    // Ein anderer Scope sieht nichts, und die Auth-Rolle liest unter einer
    // anderen Organisation keine dieser Zeilen (RLS aus 0002).
    expect((await audited.listAuditEvents({ ...auditScope, projectId }, 10)).events).toEqual([]);
    const leaked = await withTenantTransaction(auth, { organizationId, readOnly: true }, (transaction) =>
      transaction.query<{ count: number }>("SELECT count(*)::int AS count FROM audit_logs WHERE organization_id = $1", [auditOrganization]));
    expect(leaked.rows[0].count).toBe(0);
  });
});
