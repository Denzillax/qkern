import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { containerMountTargets } from "./postgres-certification-harness.test";

const compose = fs.readFileSync(
  path.resolve(process.cwd(), "docker-compose.auth-certification.yml"),
  "utf8",
);
const dex = fs.readFileSync(path.resolve(process.cwd(), "tests/support/dex-config.yaml"), "utf8");
const runner = fs.readFileSync(path.resolve(process.cwd(), "scripts/auth-certification.mjs"), "utf8");
const integration = fs.readFileSync(
  path.resolve(process.cwd(), "tests/project-auth-provider.integration.test.ts"),
  "utf8",
);
const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
) as { scripts: Record<string, string> };

describe("Project Auth provider certification harness", () => {
  it("uses isolated, portless Mailpit and Dex services with fixed release tags", () => {
    expect(compose).toContain("name: qkern-auth-v13-certification");
    expect(compose).toContain("axllent/mailpit:v1.21.8");
    expect(compose).toContain("dexidp/dex:v2.41.1");
    expect(compose).not.toMatch(/^\s*ports:/m);
  });

  it("mounts sources read-only without nesting one mount inside another", () => {
    const targets = containerMountTargets(compose);
    expect(targets).toContain("/qkern-src");
    expect(targets).toContain("/etc/dex/config.yaml");

    for (const outer of targets) {
      for (const inner of targets) {
        if (outer === inner) continue;
        expect(
          inner.startsWith(`${outer.replace(/\/$/, "")}/`),
          `mount ${inner} must not be nested inside ${outer}`,
        ).toBe(false);
      }
    }
  });

  it("serves the provider over real TLS under a routable hostname", () => {
    // ProjectAuthOidcCatalog verlangt exaktes HTTPS und lehnt localhost sowie
    // IP-Adressen ab. Ein Stack, der diese Grenze umgeht, wuerde etwas anderes
    // zertifizieren als das Produkt.
    expect(dex).toContain("issuer: https://dex.qkern.test:5556/dex");
    expect(dex).toContain("tlsCert: /certs/dex.crt");
    expect(compose).toContain("- dex.qkern.test");
    expect(compose).toContain("NODE_EXTRA_CA_CERTS: /certs/oidc-bundle.crt");
    expect(compose).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/);
  });

  it("keeps the certified redirect URI identical to the one the service builds", () => {
    const callback = "/api/v1/projects/11111111-1111-4111-8111-111111111111"
      + "/environments/development/auth/oidc/certification/callback";
    expect(dex).toContain(callback);
    expect(integration).toContain('const PROJECT_ID = "11111111-1111-4111-8111-111111111111"');
  });

  it("proves delivery is the only path to an action token", () => {
    // Der entscheidende Unterschied zu den lokalen Tests: ohne
    // exposeDeliveryTokens gibt es keinen Abkuerzungspfad, das Token existiert
    // ausschliesslich in einer tatsaechlich zugestellten Nachricht.
    expect(integration).toContain("exposeDeliveryTokens: false");
    expect(integration).toContain("expect(signup.debugToken).toBeUndefined()");
    expect(integration).toContain("waitForMail");
  });

  it("requires an explicit provider E2E opt-in", () => {
    expect(compose).toContain('QKERN_TEST_PROJECT_AUTH_PROVIDER_E2E: "true"');
    expect(integration).toContain('QKERN_TEST_PROJECT_AUTH_PROVIDER_E2E === "true"');
    expect(integration).toContain("describe.runIf(enabled)");
  });

  it("starts the services before the run and cleans up after every attempt", () => {
    // Der Zertifikatsdienst ist ein Einmal-Dienst und endet planmaessig mit
    // Code 0. Mit --abort-on-container-exit haette das den ganzen Stack
    // abgebrochen, bevor ein einziger Test lief.
    // Auf die Argumentform pruefen: der Runner erklaert im Kommentar, warum er
    // diese Flags gerade nicht verwendet.
    expect(runner).not.toContain('"--abort-on-container-exit"');
    expect(runner).not.toContain('"--exit-code-from"');
    expect(runner).toContain('"up", "--detach", "--wait"');
    expect(runner).toContain('"run", "--rm", "--no-deps", "certification"');
    expect(runner).toContain('"down", "--volumes", "--remove-orphans"');
  });

  it("exposes direct and disposable-container certification commands", () => {
    expect(packageJson.scripts["test:auth:provider"]).toContain(
      "project-auth-provider.integration.test.ts",
    );
    expect(packageJson.scripts["test:auth:docker"]).toBe("node scripts/auth-certification.mjs");
  });
});
