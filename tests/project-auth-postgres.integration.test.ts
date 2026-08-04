import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import type { SqlPool } from "@/lib/server/db/sql";
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
    if (owner) await owner.query("DELETE FROM users WHERE id = $1", [controlUser]);
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
});
