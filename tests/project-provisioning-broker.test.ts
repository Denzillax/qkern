import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  SignedProjectProvisioningBrokerAdapter,
  createSignedProjectProvisioningBrokerFromEnv,
} from "@/lib/server/provisioning/broker-adapter";
import {
  PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256,
  type ProjectDatabaseProvisioningRequest,
  type ProvisionedProjectDatabaseBinding,
} from "@/lib/server/provisioning/worker";

const NOW = new Date("2026-07-20T08:00:00.000Z");
const SECRET = "0123456789abcdef0123456789abcdef";
const request: ProjectDatabaseProvisioningRequest = {
  provisioningJobId: "940cb242-32d6-41fd-b244-67d4913f7b91",
  organizationId: "0d9423d9-7437-4f66-898a-86275e6598fb",
  projectId: "9730b448-7fd0-4c4f-9553-33220752bdf6",
  environment: "production",
  region: "eu-central-1",
  bootstrapContractSha256: PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256,
};
const binding: ProvisionedProjectDatabaseBinding = {
  databaseInstanceRef: "managed:database-1", vaultStaticRole: "project-database-1",
  host: "db.customer.example", port: 5432, expectedRole: "qkern_project_migrator",
  expectedDatabase: "project_database", expectedLedgerOwner: "qkern_ledger_owner",
  serverCertificateSha256: "ab".repeat(32),
  bootstrapContractSha256: PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256,
};

function adapter(fetchFn: typeof fetch) {
  return new SignedProjectProvisioningBrokerAdapter({
    endpoint: new URL("https://provisioner.service.internal/qkern/projects"),
    allowedHosts: new Set(["provisioner.service.internal"]),
    signingKeyProvider: { getActiveSigningKey: () => ({ keyId: "primary", secret: SECRET }) },
    production: true,
    fetchFn,
    now: () => NOW,
  });
}

describe("signed project provisioning broker", () => {
  it("signs an exact reference-only request and validates the response job", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      expect(input.toString()).toBe("https://provisioner.service.internal/qkern/projects");
      const body = String(init?.body);
      const headers = new Headers(init?.headers);
      const timestamp = Math.floor(NOW.getTime() / 1_000).toString();
      expect(JSON.parse(body)).toEqual(request);
      expect(body).not.toMatch(/password|credential|databaseUrl/i);
      expect(headers.get("user-agent")).toBe("QKERN-Provisioner/0.23");
      expect(headers.get("idempotency-key")).toBe(request.provisioningJobId);
      expect(headers.get("x-qkern-signature")).toBe(
        `v1=${createHmac("sha256", SECRET).update(`${timestamp}.${body}`).digest("hex")}`,
      );
      return Response.json({ status: "ready", provisioningJobId: request.provisioningJobId, binding });
    });
    await expect(adapter(fetchFn).provision(request, {})).resolves.toEqual(binding);
  });

  it("rejects mismatched jobs, extra response fields, bootstrap drift and oversized bodies", async () => {
    const cases = [
      { status: "ready", provisioningJobId: crypto.randomUUID(), binding },
      { status: "ready", provisioningJobId: request.provisioningJobId, binding, secret: "leak" },
      { status: "ready", provisioningJobId: request.provisioningJobId,
        binding: { ...binding, bootstrapContractSha256: "cd".repeat(32) } },
    ];
    for (const response of cases) {
      await expect(adapter(vi.fn<typeof fetch>(async () => Response.json(response))).provision(request, {}))
        .rejects.toMatchObject({ failureCode: expect.stringMatching(/INVALID_BINDING|BOOTSTRAP_UNVERIFIED/) });
    }
    await expect(adapter(vi.fn<typeof fetch>(async () => new Response("x".repeat(16_385), {
      headers: { "content-type": "application/json" },
    }))).provision(request, {})).rejects.toMatchObject({ failureCode: "INVALID_BINDING" });
  });

  it("enforces exact production HTTPS hosts and forbids inline production keys", () => {
    const base = {
      allowedHosts: new Set(["provisioner.service.internal"]),
      signingKeyProvider: { getActiveSigningKey: () => ({ keyId: "primary", secret: SECRET }) },
      production: true,
    };
    for (const endpoint of [
      "http://provisioner.service.internal/qkern", "https://127.0.0.1/qkern",
      "https://attacker.invalid/qkern", "https://user:pass@provisioner.service.internal/qkern",
    ]) {
      expect(() => new SignedProjectProvisioningBrokerAdapter({ ...base, endpoint: new URL(endpoint) })).toThrow();
    }
    expect(() => createSignedProjectProvisioningBrokerFromEnv({
      NODE_ENV: "production",
      QKERN_PROVISIONING_BROKER_URL: "https://provisioner.service.internal/qkern",
      QKERN_PROVISIONING_BROKER_ALLOWED_HOSTS: "provisioner.service.internal",
      QKERN_PROVISIONING_BROKER_HMAC_KEY_ID: "primary",
      QKERN_PROVISIONING_BROKER_HMAC_SECRET: SECRET,
    })).toThrow("project provisioning broker configuration is invalid");
  });
});
