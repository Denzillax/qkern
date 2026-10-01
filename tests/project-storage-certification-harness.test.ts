import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { containerMountTargets } from "./postgres-certification-harness.test";

const compose = fs.readFileSync(
  path.resolve(process.cwd(), "docker-compose.storage-certification.yml"),
  "utf8",
);
const runner = fs.readFileSync(
  path.resolve(process.cwd(), "scripts/storage-certification.mjs"),
  "utf8",
);
const integration = fs.readFileSync(
  path.resolve(process.cwd(), "tests/project-storage-provider.integration.test.ts"),
  "utf8",
);
const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
) as { scripts: Record<string, string> };

describe("Project Storage provider certification harness", () => {
  it("uses isolated, portless versitygw and ClamAV services with fixed release tags", () => {
    expect(compose).toContain("name: qkern-storage-v140a2-certification");
    // Seit 2.14 versitygw statt MinIO: minio/minio ist von Docker Hub verschwunden.
    expect(compose).toContain("versity/versitygw:v1.8.0");
    expect(compose).not.toMatch(/image:\s*minio\/minio/);
    expect(compose).toContain("clamav/clamav:1.4.5");
    expect(compose).not.toMatch(/^\s*ports:/m);
    expect(compose).toContain(".:/qkern-src:ro");
  });

  it("waits for a real ClamAV socket instead of a mere container start", () => {
    // freshclam downloads the signature database on first start. Without a
    // healthcheck the scanner path fails for a reason that has nothing to do
    // with the product under certification.
    expect(compose).toContain('test: ["CMD", "clamdcheck.sh"]');
    expect(compose).toContain("start_period: 300s");
    expect(compose).toMatch(/clamav:\s*\n\s*condition: service_healthy/);
  });

  it("mounts sources read-only without nesting one mount inside another", () => {
    const targets = containerMountTargets(compose);

    expect(targets).toContain("/qkern-src");
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

  it("requires an explicit provider E2E opt-in and private service names", () => {
    expect(compose).toContain('QKERN_TEST_STORAGE_PROVIDER_E2E: "true"');
    expect(compose).toContain("QKERN_TEST_STORAGE_S3_ENDPOINT: http://127.0.0.1:7070");
    expect(compose).toContain('network_mode: "service:minio"');
    expect(compose).toContain("QKERN_TEST_STORAGE_CLAMAV_HOST: clamav");
    expect(integration).toContain('QKERN_TEST_STORAGE_PROVIDER_E2E === "true"');
    expect(integration).toContain("describe.runIf(enabled)");
  });

  it("certifies clean download and infected-object deletion", () => {
    expect(integration).toContain('expect(object.status).toBe("clean")');
    expect(integration).toContain("EICAR-STANDARD-ANTIVIRUS-TEST-FILE");
    expect(integration).toContain('code: "STORAGE_OBJECT_INFECTED"');
    expect(integration).toContain("resolves.toBeNull()");
  });

  it("cleans containers and volumes after every attempted run", () => {
    expect(runner).toContain('"--abort-on-container-exit"');
    expect(runner).toContain('"--exit-code-from"');
    expect(runner).toContain('"down", "--volumes", "--remove-orphans"');
  });

  it("lets a parallel slice name its own stack, and keeps the archived name without one", () => {
    // Wie im PostgreSQL-Laeufer: `up` und `down` muessen denselben Projektnamen
    // tragen, sonst raeumt ein Lauf den Stack eines anderen Schnitts ab oder
    // laesst seinen eigenen stehen.
    expect(runner).toContain("process.env.COMPOSE_PROJECT_NAME?.trim() ||");
    expect(runner).toContain('"qkern-storage-v140a2-certification"');
    expect([...runner.matchAll(/process\.env\.COMPOSE_PROJECT_NAME/g)]).toHaveLength(1);
    expect([...runner.matchAll(/\.\.\.compose,/g)].length).toBeGreaterThanOrEqual(1);
  });

  it("exposes direct and disposable-container certification commands", () => {
    expect(packageJson.scripts["test:storage:provider"]).toContain(
      "project-storage-provider.integration.test.ts",
    );
    expect(packageJson.scripts["test:storage:docker"]).toBe(
      "node scripts/storage-certification.mjs",
    );
  });
});
