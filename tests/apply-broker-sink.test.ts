import { createHmac } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApplyBrokerDeliveryError,
  ApplyBrokerSigningKeyFileProvider,
  SignedApplyBrokerSink,
  createSignedApplyBrokerSinkFromEnv,
  type ApplyBrokerSigningKeyProvider,
} from "@/lib/server/migrations/apply-broker-sink";
import type { MigrationApplyRequestedMessage } from "@/lib/server/migrations/outbox-publisher";
import { itOnPosix } from "./support/posix";

const EVENT_ID = "412cb46b-6313-4a74-8480-9d9e9e240e36";
const ORGANIZATION_ID = "0d9423d9-7437-4f66-898a-86275e6598fb";
const JOB_ID = "940cb242-32d6-41fd-b244-67d4913f7b91";
const SECRET = "0123456789abcdef0123456789abcdef";
const NOW = new Date("2026-07-20T08:00:00.000Z");
const message: MigrationApplyRequestedMessage = {
  eventId: EVENT_ID,
  eventType: "migration.apply.requested",
  organizationId: ORGANIZATION_ID,
  migrationJobId: JOB_ID,
};

function response(value: unknown, status = 200, contentType = "application/json"): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": contentType } });
}

function sink(fetchFn: typeof fetch, overrides: Partial<ConstructorParameters<typeof SignedApplyBrokerSink>[0]> = {}) {
  return new SignedApplyBrokerSink({
    endpoint: new URL("https://broker.service.internal/qkern/migrations"),
    allowedHosts: new Set(["broker.service.internal"]),
    signingKeyProvider: { getActiveSigningKey: () => ({ keyId: "apply-primary", secret: SECRET }) },
    production: true,
    fetchFn,
    now: () => NOW,
    ...overrides,
  });
}

afterEach(() => vi.useRealTimers());

describe("signed migration apply broker sink", () => {
  it("sends a deterministic reference-only signature and accepts only the same event id", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      expect(input.toString()).toBe("https://broker.service.internal/qkern/migrations");
      expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
      const body = String(init?.body);
      const headers = new Headers(init?.headers);
      const timestamp = Math.floor(NOW.getTime() / 1_000).toString(10);
      const signature = createHmac("sha256", SECRET).update(`${timestamp}.${body}`).digest("hex");
      expect(JSON.parse(body)).toEqual(message);
      expect(body).not.toMatch(/sql|databaseUrl|credential|secret/i);
      expect(headers.get("user-agent")).toBe("QKERN-Apply-Publisher/0.22");
      expect(headers.get("idempotency-key")).toBe(EVENT_ID);
      expect(headers.get("x-qkern-event-id")).toBe(EVENT_ID);
      expect(headers.get("x-qkern-timestamp")).toBe(timestamp);
      expect(headers.get("x-qkern-signature-key-id")).toBe("apply-primary");
      expect(headers.get("x-qkern-signature")).toBe(`v1=${signature}`);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return response({ status: "ack", eventId: EVENT_ID }, 202);
    });
    await expect(sink(fetchFn).publish(message, {})).resolves.toEqual({ status: "ack", eventId: EVENT_ID });
  });

  it("resolves a fresh key for every delivery and keeps key id/signature atomic", async () => {
    const provider: ApplyBrokerSigningKeyProvider = {
      getActiveSigningKey: vi.fn()
        .mockResolvedValueOnce({ keyId: "key-a", secret: SECRET })
        .mockResolvedValueOnce({ keyId: "key-b", secret: "abcdef0123456789abcdef0123456789" }),
    };
    const requests: Headers[] = [];
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      requests.push(new Headers(init?.headers));
      return response({ status: "ack", eventId: EVENT_ID });
    });
    const rotating = sink(fetchFn, { signingKeyProvider: provider });
    await rotating.publish(message, {});
    await rotating.publish(message, {});
    expect(provider.getActiveSigningKey).toHaveBeenCalledTimes(2);
    expect(requests.map((headers) => headers.get("x-qkern-signature-key-id"))).toEqual(["key-a", "key-b"]);
    expect(requests[0].get("x-qkern-signature")).not.toBe(requests[1].get("x-qkern-signature"));
  });

  it("fails before network access when signing keys are missing, malformed or secret-poisoned", async () => {
    for (const value of [
      Promise.reject(new Error("vault://apply-super-secret")),
      Promise.resolve({ keyId: "bad key id", secret: SECRET }),
      Promise.resolve({ keyId: "key", secret: "too-short" }),
    ]) {
      const fetchFn = vi.fn<typeof fetch>();
      const error = await sink(fetchFn, {
        signingKeyProvider: { getActiveSigningKey: () => value as Promise<{ keyId: string; secret: string }> },
      }).publish(message, {}).catch((caught) => caught);
      expect(error).toMatchObject({ code: "SIGNING_KEY_UNAVAILABLE", failureCode: "SIGNING_KEY_UNAVAILABLE" });
      expect(Object.prototype.hasOwnProperty.call(error, "cause")).toBe(false);
      expect(String(error)).not.toContain("apply-super-secret");
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  it("bounds key lookup and network access with one timeout", async () => {
    vi.useFakeTimers();
    const timedOut = sink(vi.fn<typeof fetch>(), {
      timeoutMs: 100,
      signingKeyProvider: { getActiveSigningKey: () => new Promise(() => undefined) },
    }).publish(message, {});
    const assertion = expect(timedOut).rejects.toMatchObject({ code: "TIMEOUT", failureCode: "DELIVERY_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("distinguishes external abort from timeout without retaining transport errors", async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("postgres://secret")), { once: true });
    }));
    const pending = sink(fetchFn).publish(message, { signal: controller.signal });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    controller.abort();
    const error = await pending.catch((caught) => caught);
    expect(error).toMatchObject({ code: "ABORTED", failureCode: "PUBLISH_FAILED" });
    expect(String(error)).not.toContain("secret");
  });

  it("classifies rejected destinations separately from malformed acknowledgements", async () => {
    const rejected = sink(vi.fn<typeof fetch>(async () => response({ error: "private" }, 503)));
    await expect(rejected.publish(message, {})).rejects.toMatchObject({
      code: "RESPONSE_REJECTED",
      failureCode: "DESTINATION_REJECTED",
    });
    for (const ack of [
      { status: "ack", eventId: crypto.randomUUID() },
      { status: "ack", eventId: EVENT_ID, extra: true },
      { status: "accepted", eventId: EVENT_ID },
    ]) {
      await expect(sink(vi.fn<typeof fetch>(async () => response(ack))).publish(message, {}))
        .rejects.toMatchObject({ code: "INVALID_ACK", failureCode: "INVALID_ACK" });
    }
  });

  it("rejects oversized or non-JSON acknowledgements", async () => {
    await expect(sink(vi.fn<typeof fetch>(async () => new Response("x".repeat(4_097), {
      headers: { "content-type": "application/json" },
    }))).publish(message, {})).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
    await expect(sink(vi.fn<typeof fetch>(async () => response({ status: "ack", eventId: EVENT_ID }, 200, "text/plain")))
      .publish(message, {})).rejects.toMatchObject({ code: "RESPONSE_REJECTED" });
  });

  it("enforces exact HTTPS production endpoints and an exact host allowlist", () => {
    const base = {
      allowedHosts: new Set(["broker.service.internal"]),
      signingKeyProvider: { getActiveSigningKey: () => ({ keyId: "key", secret: SECRET }) },
      production: true,
    };
    for (const endpoint of [
      "http://broker.service.internal/qkern",
      "https://broker.service.internal:8443/qkern",
      "https://user:pass@broker.service.internal/qkern",
      "https://broker.service.internal/qkern?token=secret",
      "https://attacker.invalid/qkern",
      "https://127.0.0.1/qkern",
    ]) {
      expect(() => new SignedApplyBrokerSink({ ...base, endpoint: new URL(endpoint) })).toThrow();
    }
    expect(() => new SignedApplyBrokerSink({ ...base, endpoint: new URL("https://broker.service.internal/qkern") }))
      .not.toThrow();
  });

  it("forbids environment secrets in production and rejects mixed key authority", () => {
    const env = {
      NODE_ENV: "production",
      QKERN_APPLY_BROKER_URL: "https://broker.service.internal/qkern",
      QKERN_APPLY_BROKER_ALLOWED_HOSTS: "broker.service.internal",
    };
    const provider = { getActiveSigningKey: () => ({ keyId: "key", secret: SECRET }) };
    expect(createSignedApplyBrokerSinkFromEnv(env, { signingKeyProvider: provider })).toBeInstanceOf(
      SignedApplyBrokerSink,
    );
    expect(() => createSignedApplyBrokerSinkFromEnv({
      ...env,
      QKERN_APPLY_BROKER_HMAC_KEY_ID: "inline",
      QKERN_APPLY_BROKER_HMAC_SECRET: SECRET,
    })).toThrow("Invalid apply broker configuration");
    expect(() => createSignedApplyBrokerSinkFromEnv({
      ...env,
      QKERN_APPLY_BROKER_SIGNING_KEY_FILE: "/run/qkern/key.json",
    }, { signingKeyProvider: provider })).toThrow("Invalid apply broker configuration");
  });
});

describe("apply broker signing key file provider", () => {
  itOnPosix("rereads private key material for rotation and rejects group- or world-accessible files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "qkern-apply-key-"));
    const path = join(directory, "signing-key.json");
    try {
      await writeFile(path, JSON.stringify({ keyId: "key-a", secret: SECRET }), { mode: 0o600 });
      const provider = new ApplyBrokerSigningKeyFileProvider(path, { production: true });
      await expect(provider.getActiveSigningKey({ signal: new AbortController().signal }))
        .resolves.toEqual({ keyId: "key-a", secret: SECRET });
      await writeFile(path, JSON.stringify({
        keyId: "key-b",
        secret: "abcdef0123456789abcdef0123456789",
      }), { mode: 0o600 });
      await expect(provider.getActiveSigningKey({ signal: new AbortController().signal }))
        .resolves.toMatchObject({ keyId: "key-b" });
      await chmod(path, 0o640);
      await expect(provider.getActiveSigningKey({ signal: new AbortController().signal }))
        .rejects.toBeInstanceOf(ApplyBrokerDeliveryError);
      await chmod(path, 0o604);
      await expect(provider.getActiveSigningKey({ signal: new AbortController().signal }))
        .rejects.toBeInstanceOf(ApplyBrokerDeliveryError);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
