import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const compose = fs.readFileSync(
  path.resolve(process.cwd(), "docker-compose.certification.yml"),
  "utf8",
);
const runner = fs.readFileSync(
  path.resolve(process.cwd(), "scripts/postgres-certification.mjs"),
  "utf8",
);
const integration = fs.readFileSync(
  path.resolve(process.cwd(), "tests/postgres-incident-recovery.integration.test.ts"),
  "utf8",
);
const storageIntegration = fs.readFileSync(
  path.resolve(process.cwd(), "tests/project-storage-postgres.integration.test.ts"),
  "utf8",
);
const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
) as { scripts: Record<string, string> };

describe("PostgreSQL certification harness", () => {
  it("uses an isolated ephemeral database stack without host database ports", () => {
    expect(compose).toContain("name: qkern-v023-certification");
    expect(compose).toContain("image: postgres:17-alpine");
    expect(compose).toContain("tmpfs:");
    expect(compose).toContain("/var/lib/postgresql/data");
    expect(compose).not.toMatch(/^\s*ports:/m);
    expect(compose).toContain("./db/migrations:/docker-entrypoint-initdb.d:ro");
    expect(compose).toContain(".:/workspace/qkern:ro");
    expect(compose).toContain("qkern_worker_app");
    expect(compose).toContain("pg_has_role(current_user, 'qkern_worker', 'MEMBER')");
  });

  it("requires an explicit create/drop opt-in and every least-privilege login", () => {
    expect(compose).toContain('QKERN_TEST_ALLOW_DATABASE_CREATE_DROP: "true"');
    expect(compose).toContain("QKERN_TEST_ADMIN_DATABASE_URL:");
    expect(compose).toContain("QKERN_TEST_RUNTIME_DATABASE_URL:");
    expect(compose).toContain("QKERN_TEST_AUTH_DATABASE_URL:");
    expect(compose).toContain("QKERN_TEST_WORKER_DATABASE_URL:");
    expect(compose).toContain("QKERN_TEST_PROVISIONER_DATABASE_URL:");
    expect(integration).toContain('QKERN_TEST_ALLOW_DATABASE_CREATE_DROP === "true"');
    expect(integration).toContain("describe.runIf(enabled)");
  });

  it("upgrades through 0017 before executing 0018 against real PostgreSQL", () => {
    expect(integration).toContain(
      'applyMigrationsThrough(owner, "0017_migration_incident_verified_resolution.sql")',
    );
    expect(integration).toContain(
      'applyMigration(owner, "0018_migration_incident_delivery_recovery_generation.sql")',
    );
    expect(integration).toContain("expected_retry_cycle");
    expect(integration).toContain("same failure code returns in a later generation");
    expect(integration).toContain("command-first lock");
    expect(integration).toContain("worker-verified applied state");
  });

  it("uses a bounded generated database name and cleans the stack on every run", () => {
    expect(integration).toContain("Unsafe certification database identifier");
    expect(integration).toContain("CREATE DATABASE");
    expect(integration).toContain("DROP DATABASE IF EXISTS");
    expect(runner).toContain('"--abort-on-container-exit"');
    expect(runner).toContain('"--exit-code-from"');
    expect(runner).toContain('"down", "--volumes", "--remove-orphans"');
  });

  it("includes the Project Storage quota, completion, expiry and lifecycle race matrix", () => {
    expect(storageIntegration).toContain("serializes concurrent quota reservations without overbooking");
    expect(storageIntegration).toContain("commits concurrent completion replays exactly once");
    expect(storageIntegration).toContain("cleans the provider object when expiry wins a slow completion");
    expect(storageIntegration).toContain("releases used quota once when delete and lifecycle expiration race");
    expect(storageIntegration).toContain("Promise.allSettled");
  });

  it("exposes direct and disposable-container certification commands", () => {
    expect(packageJson.scripts["test:postgres"]).toContain(
      "postgres-incident-recovery.integration.test.ts",
    );
    expect(packageJson.scripts["test:postgres"]).toContain(
      "project-auth-postgres.integration.test.ts",
    );
    expect(packageJson.scripts["test:postgres"]).toContain(
      "project-storage-postgres.integration.test.ts",
    );
    expect(packageJson.scripts["test:postgres:docker"]).toBe(
      "node scripts/postgres-certification.mjs",
    );
  });
});
