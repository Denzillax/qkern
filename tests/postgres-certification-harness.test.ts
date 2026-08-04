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
const init = fs.readFileSync(
  path.resolve(process.cwd(), "db/docker/000-certification-init.sh"),
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

/**
 * Collects every container-side mount target from the `volumes:` blocks of a
 * Compose file. Only entries directly below a `volumes:` key are considered, so
 * list items of `command:` or other sequences are never mistaken for mounts.
 */
export function containerMountTargets(composeFile: string): string[] {
  const targets: string[] = [];
  let volumesIndent: number | null = null;

  for (const rawLine of composeFile.split(/\r?\n/)) {
    if (rawLine.trim() === "" || rawLine.trim().startsWith("#")) {
      continue;
    }

    const indent = rawLine.length - rawLine.trimStart().length;

    if (volumesIndent !== null && indent <= volumesIndent) {
      volumesIndent = null;
    }

    if (/^\s*volumes:\s*$/.test(rawLine)) {
      volumesIndent = indent;
      continue;
    }

    if (volumesIndent === null) {
      continue;
    }

    const item = /^\s*-\s+(.+?)\s*$/.exec(rawLine);
    if (!item) {
      continue;
    }

    // Named-volume declarations at the top level have no colon-separated target.
    const parts = item[1].replace(/^["']|["']$/g, "").split(":");
    if (parts.length < 2) {
      continue;
    }

    targets.push(parts[1]);
  }

  return targets;
}

describe("PostgreSQL certification harness", () => {
  it("uses an isolated ephemeral database stack without host database ports", () => {
    expect(compose).toContain("name: qkern-v023-certification");
    expect(compose).toContain("image: postgres:17-alpine");
    expect(compose).toContain("tmpfs:");
    expect(compose).toContain("/var/lib/postgresql/data");
    expect(compose).not.toMatch(/^\s*ports:/m);
    expect(compose).toContain("qkern_worker_app");
    expect(compose).toContain("pg_has_role(current_user, 'qkern_worker', 'MEMBER')");
  });

  it("mounts sources read-only without nesting one mount inside another", () => {
    // A mount whose target lies inside another mount target forces the runtime
    // to create a mountpoint in an already read-only bind. Docker Desktop and
    // WSL2 reject that with "make mountpoint: read-only file system", which
    // previously prevented the stack from starting at all.
    const targets = containerMountTargets(compose);

    expect(targets).toContain("/qkern/db");
    expect(targets).toContain("/qkern-src");
    expect(targets).toContain("/docker-entrypoint-initdb.d/000-certification-init.sh");

    for (const outer of targets) {
      for (const inner of targets) {
        if (outer === inner) {
          continue;
        }
        expect(
          inner.startsWith(`${outer.replace(/\/$/, "")}/`),
          `mount ${inner} must not be nested inside ${outer}`,
        ).toBe(false);
      }
    }
  });

  it("keeps every host source mount read-only", () => {
    const mountLines = compose
      .split(/\r?\n/)
      .filter((line) => /^\s*-\s+\.[^:]*:/.test(line));

    expect(mountLines.length).toBeGreaterThan(0);
    for (const line of mountLines) {
      expect(line.trimEnd().endsWith(":ro"), `${line.trim()} must be read-only`).toBe(true);
    }
  });

  it("applies every migration and the runtime logins from a single init entrypoint", () => {
    expect(init).toContain('readonly MIGRATIONS_DIR="${SOURCE_ROOT}/migrations"');
    expect(init).toContain("--set ON_ERROR_STOP=1");
    expect(init).toContain('bash "$RUNTIME_LOGIN_SCRIPT"');
    // A silently empty migration directory would produce a green but meaningless
    // certification run.
    expect(init).toContain('if [[ "$applied" -eq 0 ]]; then');
  });

  it("copies the working tree into a writable directory instead of mounting over it", () => {
    expect(compose).toContain("tar -C /qkern-src");
    expect(compose).toContain("--exclude=./node_modules");
    expect(compose).toContain("npm ci --ignore-scripts");
    expect(compose).toContain("npm run test:postgres");
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
