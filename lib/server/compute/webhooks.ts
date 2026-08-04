import type { WebhookDefinition, WebhookDelivery } from "@/lib/server/compute/model";
import { unsafeHostname, validateJson } from "@/lib/server/compute/functions";

export interface WebhookSignerPort {
  sign(secretRef: string, canonicalPayload: string): Promise<{ keyId: string; signature: string }>;
}

export interface WebhookTransportPort {
  send(request: Readonly<{
    url: string;
    method: "POST";
    headers: Readonly<Record<string, string>>;
    body: string;
    redirect: "error";
  }>, options: { signal: AbortSignal }): Promise<{ status: number; acknowledgementId: string | null }>;
}

export class WebhookDeliveryError extends Error {
  constructor(readonly code: "WEBHOOK_INVALID" | "WEBHOOK_TIMEOUT" | "WEBHOOK_REJECTED" | "WEBHOOK_SIGNING_FAILED") {
    super(code); this.name = "WebhookDeliveryError";
  }
}

export class WebhookDeliverer {
  constructor(private readonly signer: WebhookSignerPort, private readonly transport: WebhookTransportPort) {}

  async deliver(definition: WebhookDefinition, delivery: WebhookDelivery, signal?: AbortSignal) {
    if (signal?.aborted) throw new WebhookDeliveryError("WEBHOOK_TIMEOUT");
    const payload = validateWebhook(definition, delivery);
    const body = JSON.stringify({
      id: delivery.id, eventType: delivery.eventType, occurredAt: delivery.occurredAt,
      data: payload,
    });
    const timestamp = String(Math.floor(Date.parse(delivery.occurredAt) / 1_000));
    let signed: { keyId: string; signature: string };
    try { signed = await this.signer.sign(definition.signingSecretRef, `${timestamp}.${body}`); }
    catch { throw new WebhookDeliveryError("WEBHOOK_SIGNING_FAILED"); }
    if (!/^[A-Za-z0-9._:-]{1,64}$/.test(signed.keyId) || !/^[A-Za-z0-9_-]{43,128}$/.test(signed.signature)) {
      throw new WebhookDeliveryError("WEBHOOK_SIGNING_FAILED");
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), definition.timeoutMs);
    try {
      const response = await Promise.race([
        Promise.resolve().then(() => this.transport.send(Object.freeze({
          url: definition.url,
          method: "POST" as const,
          redirect: "error" as const,
          headers: Object.freeze({
            "content-type": "application/json",
            "x-qkern-delivery-id": delivery.id,
            "x-qkern-event": delivery.eventType,
            "x-qkern-timestamp": timestamp,
            "x-qkern-signature": `v1=${signed.signature};key=${signed.keyId}`,
          }),
          body,
        }), { signal: controller.signal })).catch(() => {
          throw new WebhookDeliveryError(controller.signal.aborted ? "WEBHOOK_TIMEOUT" : "WEBHOOK_REJECTED");
        }),
        new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () =>
          reject(new WebhookDeliveryError("WEBHOOK_TIMEOUT")), { once: true })),
      ]);
      if (response.status < 200 || response.status > 299 || response.acknowledgementId !== delivery.id) {
        throw new WebhookDeliveryError("WEBHOOK_REJECTED");
      }
      return Object.freeze({ status: "delivered" as const, deliveryId: delivery.id });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}

function validateWebhook(definition: WebhookDefinition, delivery: WebhookDelivery) {
  try {
    const url = new URL(definition.url);
    if (url.protocol !== "https:" || url.port && url.port !== "443" || url.username || url.password ||
        url.pathname.length > 1_024 || url.search || url.hash || unsafeHostname(url.hostname)) throw new Error("invalid");
  } catch { throw new WebhookDeliveryError("WEBHOOK_INVALID"); }
  if (!/^[a-z][a-z0-9_-]{2,62}$/.test(definition.name) ||
      !/^[A-Za-z][A-Za-z0-9_./:-]{2,127}$/.test(definition.signingSecretRef) ||
      !Number.isSafeInteger(definition.timeoutMs) || definition.timeoutMs < 100 || definition.timeoutMs > 30_000 ||
      definition.eventTypes.length < 1 || definition.eventTypes.length > 20 ||
      !definition.eventTypes.includes(delivery.eventType) || definition.id !== delivery.webhookId ||
      !/^[a-z][a-z0-9._:-]{2,127}$/.test(delivery.eventType) || !Number.isFinite(Date.parse(delivery.occurredAt))) {
    throw new WebhookDeliveryError("WEBHOOK_INVALID");
  }
  try { return validateJson(delivery.payload, 64 * 1024); }
  catch { throw new WebhookDeliveryError("WEBHOOK_INVALID"); }
}
