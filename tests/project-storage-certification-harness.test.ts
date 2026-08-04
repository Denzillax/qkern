import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
  it("uses isolated, portless MinIO and ClamAV services with fixed release tags", () => {
    expect(compose).toContain("name: qkern-storage-v140a2-certification");
    expect(compose).toContain("minio/minio:RELEASE.2025-09-07T16-13-09Z");
    expect(compose).toContain("clamav/clamav:1.4.5");
    expect(compose).not.toMatch(/^\s*ports:/m);
    expect(compose).toContain(".:/workspace/qkern:ro");
  });

  it("requires an explicit provider E2E opt-in and private service names", () => {
    expect(compose).toContain('QKERN_TEST_STORAGE_PROVIDER_E2E: "true"');
    expect(compose).toContain("QKERN_TEST_STORAGE_S3_ENDPOINT: http://minio:9000");
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

  it("exposes direct and disposable-container certification commands", () => {
    expect(packageJson.scripts["test:storage:provider"]).toContain(
      "project-storage-provider.integration.test.ts",
    );
    expect(packageJson.scripts["test:storage:docker"]).toBe(
      "node scripts/storage-certification.mjs",
    );
  });
});
