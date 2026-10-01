import { describe, expect, it, vi } from "vitest";
import type { WebhookDefinition, WebhookDelivery } from "@/lib/server/compute/model";
import { WebhookDeliverer } from "@/lib/server/compute/webhooks";

const definition: WebhookDefinition = {
  organizationId: "org-compute", projectId: "project-compute", environment: "development",
  id: "webhook-id", name: "order_events", url: "https://hooks.example.com/qkern",
  eventTypes: ["order.created"], signingSecretRef: "vault/webhooks/orders", timeoutMs: 100,
};
const delivery: WebhookDelivery = {
  id: "delivery-id", webhookId: definition.id, eventType: "order.created",
  occurredAt: "2026-08-04T12:00:00.000Z", payload: { orderId: "order-1" },
};

describe("Compute webhook boundary", () => {
  it("signs a canonical body through a secret-reference port and requires exact acknowledgement", async () => {
    const sign = vi.fn(async () => ({ keyId: "key-1", signature: "A".repeat(43) }));
    const send = vi.fn(async (request) => {
      expect(request.redirect).toBe("error");
      expect(request.url).toBe(definition.url);
      expect(request.headers["x-qkern-signature"]).not.toContain(definition.signingSecretRef);
      expect(request.body).toContain("order-1");
      return { status: 204, acknowledgementId: delivery.id };
    });
    await expect(new WebhookDeliverer({ sign }, { send }).deliver(definition, delivery))
      .resolves.toEqual({ status: "delivered", deliveryId: delivery.id });
    expect(sign).toHaveBeenCalledWith(definition.signingSecretRef, expect.stringContaining("order.created"));
  });

  it("rejects private destinations, URL queries and mismatched acknowledgements", async () => {
    const deliverer = new WebhookDeliverer({
      async sign() { return { keyId: "key", signature: "A".repeat(43) }; },
    }, {
      async send() { return { status: 200, acknowledgementId: "wrong" }; },
    });
    await expect(deliverer.deliver({ ...definition, url: "https://127.0.0.1/hook" }, delivery))
      .rejects.toMatchObject({ code: "WEBHOOK_INVALID" });
    await expect(deliverer.deliver({ ...definition, url: "https://hooks.example.com/hook?token=secret" }, delivery))
      .rejects.toMatchObject({ code: "WEBHOOK_INVALID" });
    await expect(deliverer.deliver(definition, delivery))
      .rejects.toMatchObject({ code: "WEBHOOK_REJECTED" });
  });

  it("carries the triggering trace as traceparent, keeps it out of the signature and sends none without an anchor", async () => {
    const anchor = { traceId: "0af7651916cd43dd8448eb211c80319c", parentSpanId: "b7ad6b7169203331" };
    const signed: string[] = [];
    const sign = vi.fn(async (_ref: string, canonical: string) => {
      signed.push(canonical);
      return { keyId: "key-1", signature: "A".repeat(43) };
    });
    let headers: Record<string, string> = {};
    const send = vi.fn(async (request: { headers: Record<string, string> }) => {
      headers = request.headers;
      return { status: 200, acknowledgementId: delivery.id };
    });
    const deliverer = new WebhookDeliverer({ sign }, { send });

    await deliverer.deliver(definition, { ...delivery, trace: anchor });
    expect(headers.traceparent)
      .toBe("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01");
    // **Nicht** signiert. Ein Proxy, der Tracing-Koepfe anfasst, wuerde sonst
    // die Signatur brechen und ein echtes Ereignis bekaeme 401.
    expect(signed[0]).not.toContain("traceparent");
    expect(signed[0]).not.toContain(anchor.traceId);

    // Ohne Anschluss fehlt die Kopfzeile ganz: keine leere, keine Nullspur.
    await deliverer.deliver(definition, delivery);
    expect(Object.keys(headers)).not.toContain("traceparent");
    await deliverer.deliver(definition, { ...delivery, trace: null });
    expect(Object.keys(headers)).not.toContain("traceparent");
  });

  it("bounds an uncooperative delivery transport", async () => {
    const deliverer = new WebhookDeliverer({
      async sign() { return { keyId: "key", signature: "A".repeat(43) }; },
    }, { async send() { return await new Promise(() => undefined); } });
    await expect(deliverer.deliver(definition, delivery)).rejects.toMatchObject({ code: "WEBHOOK_TIMEOUT" });
  });
});
