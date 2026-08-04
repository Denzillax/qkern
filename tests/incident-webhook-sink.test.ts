import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createSignedIncidentWebhookSinkFromEnv,
  IncidentWebhookDeliveryError,
  SignedIncidentWebhookSink,
  StaticIncidentWebhookSigningKeyProvider,
} from "@/lib/server/migrations/incident-webhook-sink";
import type { MigrationIncidentOpenedMessage } from "@/lib/server/migrations/incident-outbox-publisher";

const EVENT_ID = "04df979a-f6a8-4fc8-b3e0-d4a0f3ef6e9e";
const SECRET = "0123456789abcdef0123456789abcdef";
const KEY_ID = "pager-primary-2026-07";
const NOW = new Date("2026-07-19T16:00:00.000Z");
const message: MigrationIncidentOpenedMessage = Object.freeze({
  eventId: EVENT_ID,
  eventType: "migration.incident.opened",
  organizationId: "0d9423d9-7437-4f66-898a-86275e6598fb",
  incidentId: "555e3763-c1ce-424f-b18c-2c0218db6841",
  migrationJobId: "e4028d07-86bb-41f4-8805-fe53e98de6c0",
  projectId: "10cc2537-d651-4e5d-a5d8-10e577ac9383",
  environment: "production",
  changeSetId: "6b5a0808-fc89-4a92-9f62-c993628b03de",
  incidentKind: "migration_outcome_unresolved",
  incidentSeverity: "critical",
  incidentCreatedAt: "2026-07-19T15:59:00.000Z",
});

function sink(fetchFn: typeof fetch): SignedIncidentWebhookSink {
  return new SignedIncidentWebhookSink({
    endpoint: new URL("https://pager.example.com/qkern/incidents"),
    allowedHosts: new Set(["pager.example.com"]),
    signingKeyProvider: new StaticIncidentWebhookSigningKeyProvider({ keyId: KEY_ID, secret: SECRET }),
    timeoutMs: 1_000,
    production: true,
    fetchFn,
    now: () => NOW,
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

describe("signed incident webhook sink", () => {
  it("sends a deterministic reference-only HMAC request and accepts only the same event id", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      expect(input.toString()).toBe("https://pager.example.com/qkern/incidents");
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      expect(init?.cache).toBe("no-store");
      const body = String(init?.body);
      const headers = new Headers(init?.headers);
      const timestamp = Math.floor(NOW.getTime() / 1_000).toString();
      const signature = createHmac("sha256", SECRET).update(`${timestamp}.${body}`, "utf8").digest("hex");

      expect(JSON.parse(body)).toEqual(message);
      expect(body).not.toMatch(/sql|database|credential|acknowledgedBy|rawError/i);
      expect(headers.get("idempotency-key")).toBe(EVENT_ID);
      expect(headers.get("user-agent")).toBe("QKERN-Incident-Publisher/0.21");
      expect(headers.get("x-qkern-event-id")).toBe(EVENT_ID);
      expect(headers.get("x-qkern-timestamp")).toBe(timestamp);
      expect(headers.get("x-qkern-signature")).toBe(`v1=${signature}`);
      expect(headers.get("x-qkern-signature-key-id")).toBe(KEY_ID);
      expect(headers.get("x-qkern-signature")).not.toContain(SECRET);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return jsonResponse({ status: "ack", eventId: EVENT_ID }, 202);
    });

    await expect(sink(fetchFn).publish(message, {})).resolves.toEqual({ status: "ack", eventId: EVENT_ID });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("resolves a fresh signing key for every delivery and keeps key id and signature atomic", async () => {
    const rotatedSecret = "abcdef0123456789abcdef0123456789";
    const signingKeyProvider = {
      getActiveSigningKey: vi.fn()
        .mockResolvedValueOnce({ keyId: "pager-key-a", secret: SECRET })
        .mockResolvedValueOnce({ keyId: "pager-key-b", secret: rotatedSecret }),
    };
    const requests: Array<{ body: string; headers: Headers }> = [];
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      requests.push({ body: String(init?.body), headers: new Headers(init?.headers) });
      return jsonResponse({ status: "ack", eventId: EVENT_ID });
    });
    const rotatingSink = new SignedIncidentWebhookSink({
      endpoint: new URL("https://pager.example.com/qkern/incidents"),
      allowedHosts: new Set(["pager.example.com"]),
      signingKeyProvider,
      timeoutMs: 1_000,
      production: true,
      fetchFn,
      now: () => NOW,
    });

    await rotatingSink.publish(message, {});
    await rotatingSink.publish(message, {});

    expect(signingKeyProvider.getActiveSigningKey).toHaveBeenCalledTimes(2);
    expect(requests).toHaveLength(2);
    for (const [index, expected] of [
      { keyId: "pager-key-a", secret: SECRET },
      { keyId: "pager-key-b", secret: rotatedSecret },
    ].entries()) {
      const timestamp = requests[index].headers.get("x-qkern-timestamp");
      const signature = createHmac("sha256", expected.secret)
        .update(`${timestamp}.${requests[index].body}`, "utf8")
        .digest("hex");
      expect(requests[index].headers.get("x-qkern-signature-key-id")).toBe(expected.keyId);
      expect(requests[index].headers.get("x-qkern-signature")).toBe(`v1=${signature}`);
    }
  });

  it("fails before transport and redacts unavailable or invalid provider keys", async () => {
    const canary = "vault://tenant/secret-provider-canary";
    const fetchFn = vi.fn<typeof fetch>();
    const providers = [
      { getActiveSigningKey: async () => { throw new Error(canary); } },
      { getActiveSigningKey: async () => ({ keyId: canary, secret: SECRET }) },
      { getActiveSigningKey: async () => ({ keyId: KEY_ID, secret: `${canary}\0${"x".repeat(32)}` }) },
    ];

    for (const signingKeyProvider of providers) {
      const deliverySink = new SignedIncidentWebhookSink({
        endpoint: new URL("https://pager.example.com/qkern/incidents"),
        allowedHosts: new Set(["pager.example.com"]),
        signingKeyProvider,
        production: true,
        fetchFn,
        now: () => NOW,
      });
      const error = await deliverySink.publish(message, {}).catch((value: unknown) => value);
      expect(error).toMatchObject({
        code: "SIGNING_KEY_UNAVAILABLE",
        failureCode: "SIGNING_KEY_UNAVAILABLE",
      });
      expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(canary);
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("fails closed on a mismatched, extended, non-JSON or oversized acknowledgement", async () => {
    const cases: Array<{ response: Response; code: string; failureCode: string }> = [
      { response: jsonResponse({ status: "ack", eventId: "different" }), code: "INVALID_ACK", failureCode: "INVALID_ACK" },
      { response: jsonResponse({ status: "ack", eventId: EVENT_ID, detail: "extra" }), code: "INVALID_ACK", failureCode: "INVALID_ACK" },
      { response: new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }), code: "RESPONSE_REJECTED", failureCode: "DESTINATION_REJECTED" },
      { response: jsonResponse({ status: "ack", eventId: EVENT_ID, padding: "x".repeat(5_000) }), code: "RESPONSE_TOO_LARGE", failureCode: "INVALID_ACK" },
    ];

    for (const testCase of cases) {
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(testCase.response);
      await expect(sink(fetchFn).publish(message, {})).rejects.toMatchObject({
        code: testCase.code,
        failureCode: testCase.failureCode,
      });
    }
  });

  it("redacts endpoint, response and transport diagnostics from every surfaced error", async () => {
    const endpointCanary = "pager-secret.example.test";
    const responseCanary = "internal-ticket-secret";
    const transportCanary = "postgres://admin:secret@internal/database";
    const rejected = new Response(responseCanary, {
      status: 503,
      headers: { "content-type": "application/json" },
    });
    const responseError = await sink(vi.fn<typeof fetch>().mockResolvedValue(rejected))
      .publish(message, {}).catch((error: unknown) => error);
    const transportError = await sink(vi.fn<typeof fetch>().mockRejectedValue(new Error(transportCanary)))
      .publish(message, {}).catch((error: unknown) => error);

    expect(responseError).toBeInstanceOf(IncidentWebhookDeliveryError);
    expect(transportError).toBeInstanceOf(IncidentWebhookDeliveryError);
    const serialized = `${String(responseError)} ${JSON.stringify(responseError)} ${String(transportError)}`;
    expect(serialized).not.toContain(endpointCanary);
    expect(serialized).not.toContain(responseCanary);
    expect(serialized).not.toContain(transportCanary);
    expect(serialized).not.toContain(SECRET);
  });

  it("distinguishes caller cancellation from a bounded transport timeout", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchFn = vi.fn<typeof fetch>();
    await expect(sink(fetchFn).publish(message, { signal: controller.signal }))
      .rejects.toMatchObject({ code: "ABORTED" });
    expect(fetchFn).not.toHaveBeenCalled();

    vi.useFakeTimers();
    try {
      const hangingFetch = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("transport aborted")), { once: true });
      }));
      const timedSink = new SignedIncidentWebhookSink({
        endpoint: new URL("https://pager.example.com/qkern/incidents"),
        allowedHosts: new Set(["pager.example.com"]),
        signingKeyProvider: new StaticIncidentWebhookSigningKeyProvider({ keyId: KEY_ID, secret: SECRET }),
        timeoutMs: 100,
        production: true,
        fetchFn: hangingFetch,
        now: () => NOW,
      });
      const result = timedSink.publish(message, {}).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(100);
      await expect(result).resolves.toMatchObject({ code: "TIMEOUT", failureCode: "DELIVERY_TIMEOUT" });

      const providerFetch = vi.fn<typeof fetch>();
      const providerSink = new SignedIncidentWebhookSink({
        endpoint: new URL("https://pager.example.com/qkern/incidents"),
        allowedHosts: new Set(["pager.example.com"]),
        signingKeyProvider: { getActiveSigningKey: () => new Promise(() => undefined) },
        timeoutMs: 100,
        production: true,
        fetchFn: providerFetch,
        now: () => NOW,
      });
      const providerResult = providerSink.publish(message, {}).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(100);
      await expect(providerResult).resolves.toMatchObject({
        code: "TIMEOUT",
        failureCode: "DELIVERY_TIMEOUT",
      });
      expect(providerFetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("incident webhook configuration and host", () => {
  const baseEnv = {
    NODE_ENV: "production",
    QKERN_INCIDENT_WEBHOOK_URL: "https://pager.example.com/qkern/incidents",
    QKERN_INCIDENT_WEBHOOK_ALLOWED_HOSTS: "pager.example.com",
    QKERN_INCIDENT_WEBHOOK_HMAC_KEY_ID: KEY_ID,
    QKERN_INCIDENT_WEBHOOK_HMAC_SECRET: SECRET,
    QKERN_INCIDENT_WEBHOOK_TIMEOUT_MS: "5000",
  };

  it("accepts an exact public HTTPS host and rejects SSRF-prone endpoint shapes", () => {
    expect(createSignedIncidentWebhookSinkFromEnv(baseEnv)).toBeInstanceOf(SignedIncidentWebhookSink);
    const invalid = [
      { ...baseEnv, QKERN_INCIDENT_WEBHOOK_URL: "http://pager.example.com/qkern/incidents" },
      { ...baseEnv, QKERN_INCIDENT_WEBHOOK_URL: "https://user:secret@pager.example.com/qkern/incidents" },
      { ...baseEnv, QKERN_INCIDENT_WEBHOOK_URL: "https://pager.example.com/qkern/incidents?token=secret" },
      { ...baseEnv, QKERN_INCIDENT_WEBHOOK_URL: "https://pager.example.com/qkern/incidents#fragment" },
      { ...baseEnv, QKERN_INCIDENT_WEBHOOK_URL: "https://different.example.com/qkern/incidents" },
      { ...baseEnv, QKERN_INCIDENT_WEBHOOK_URL: "https://pager.example.com:8443/qkern/incidents" },
      { ...baseEnv, QKERN_INCIDENT_WEBHOOK_URL: "https://127.0.0.1/qkern/incidents", QKERN_INCIDENT_WEBHOOK_ALLOWED_HOSTS: "127.0.0.1" },
      { ...baseEnv, QKERN_INCIDENT_WEBHOOK_URL: "https://tickets.internal/qkern/incidents", QKERN_INCIDENT_WEBHOOK_ALLOWED_HOSTS: "tickets.internal" },
      { ...baseEnv, QKERN_INCIDENT_WEBHOOK_ALLOWED_HOSTS: "*.example.com" },
      { ...baseEnv, QKERN_INCIDENT_WEBHOOK_HMAC_KEY_ID: undefined },
      { ...baseEnv, QKERN_INCIDENT_WEBHOOK_HMAC_KEY_ID: "pager key with spaces" },
      { ...baseEnv, QKERN_INCIDENT_WEBHOOK_HMAC_SECRET: "short" },
      { ...baseEnv, QKERN_INCIDENT_WEBHOOK_TIMEOUT_MS: "NaN" },
    ];
    for (const env of invalid) expect(() => createSignedIncidentWebhookSinkFromEnv(env)).toThrow();
  });

  it("accepts one injected rotation provider and rejects ambiguous mixed key authority", () => {
    const signingKeyProvider = new StaticIncidentWebhookSigningKeyProvider({ keyId: KEY_ID, secret: SECRET });
    expect(createSignedIncidentWebhookSinkFromEnv({
      ...baseEnv,
      QKERN_INCIDENT_WEBHOOK_HMAC_KEY_ID: undefined,
      QKERN_INCIDENT_WEBHOOK_HMAC_SECRET: undefined,
    }, { signingKeyProvider })).toBeInstanceOf(SignedIncidentWebhookSink);
    expect(() => createSignedIncidentWebhookSinkFromEnv(baseEnv, { signingKeyProvider })).toThrow(
      /cannot be combined/i,
    );
  });

  it("allows an explicitly listed HTTP localhost endpoint only outside production", () => {
    expect(createSignedIncidentWebhookSinkFromEnv({
      ...baseEnv,
      NODE_ENV: "development",
      QKERN_INCIDENT_WEBHOOK_URL: "http://localhost:8080/qkern/incidents",
      QKERN_INCIDENT_WEBHOOK_ALLOWED_HOSTS: "localhost",
    })).toBeInstanceOf(SignedIncidentWebhookSink);
  });

  it("ships a dedicated fail-closed host without logging configuration details", () => {
    const source = readFileSync(new URL("../workers/incident-outbox-runtime.ts", import.meta.url), "utf8");
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(source).toContain("createMigrationIncidentWebhookPublisherFromEnv(process.env");
    expect(source).toContain("SIGINT");
    expect(source).toContain("SIGTERM");
    expect(source).not.toMatch(/console\.(info|error).*QKERN_INCIDENT_WEBHOOK/i);
    expect(packageJson.scripts["publisher:incidents"]).toContain("workers/incident-outbox-runtime.ts");
  });
});
