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

  it("bounds an uncooperative delivery transport", async () => {
    const deliverer = new WebhookDeliverer({
      async sign() { return { keyId: "key", signature: "A".repeat(43) }; },
    }, { async send() { return await new Promise(() => undefined); } });
    await expect(deliverer.deliver(definition, delivery)).rejects.toMatchObject({ code: "WEBHOOK_TIMEOUT" });
  });
});
