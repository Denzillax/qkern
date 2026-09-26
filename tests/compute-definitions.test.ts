import { describe, expect, it } from "vitest";
import {
  ComputeDefinitionError,
  ComputeDefinitionService,
  type ComputeDefinitionRepository,
  type ComputeDefinitionScope,
  type CronDefinitionRecord,
  type FunctionDefinitionRecord,
  type WebhookDefinitionRecord,
} from "@/lib/server/compute/definitions";
import type { CronOccurrenceMessageRow } from "@/lib/server/compute/cron-occurrences";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";

const scope: ComputeDefinitionScope = {
  organizationId: "org-1", projectId: "project-1", environment: "development",
};

const admin: ProjectQueuePrincipal = {
  organizationId: "org-1", actorRef: "owner@qkern.test", role: "admin", subject: "user-1",
};

const cronId = "11111111-1111-4111-8111-111111111111";
const webhookId = "22222222-2222-4222-8222-222222222222";

function cronRecord(overrides: Partial<CronDefinitionRecord> = {}): CronDefinitionRecord {
  return Object.freeze({
    ...scope, id: cronId, name: "nightly-report", expression: "0 3 * * *",
    queue: "report_jobs", payload: {}, enabled: true, lastDispatchedAt: null,
    createdAt: "2026-08-05T00:00:00.000Z", ...overrides,
  });
}

function webhookRecord(overrides: Partial<WebhookDefinitionRecord> = {}): WebhookDefinitionRecord {
  return Object.freeze({
    ...scope, id: webhookId, name: "order-events",
    url: "https://receiver.example.com/hooks", eventTypes: Object.freeze(["order.created"]),
    signingSecretRef: "vault:webhook/orders", timeoutMs: 5_000, maxAttempts: 5, enabled: true,
    createdAt: "2026-08-05T00:00:00.000Z", ...overrides,
  });
}

const functionId = "33333333-3333-4333-8333-333333333333";
const pinnedImage =
  "registry.example.com/qkern/probe@sha256:" + "a".repeat(64);

function functionRecord(
  overrides: Partial<FunctionDefinitionRecord> = {},
): FunctionDefinitionRecord {
  return Object.freeze({
    ...scope, id: functionId, name: "resize-image", runtime: "nodejs24" as const,
    image: pinnedImage, entrypoint: "handler.mjs", timeoutMs: 30_000, memoryMiB: 128,
    maxConcurrency: 1, egressOrigins: Object.freeze([]), secretRefs: Object.freeze([]),
    enabled: true, createdAt: "2026-08-05T00:00:00.000Z", ...overrides,
  });
}

function harness(options: {
  cron?: CronDefinitionRecord[];
  webhooks?: WebhookDefinitionRecord[];
  functions?: FunctionDefinitionRecord[];
  queues?: string[];
  occurrences?: { dedupeWindowSeconds: number | null; messages: CronOccurrenceMessageRow[] };
  now?: () => Date;
} = {}) {
  const calls: Array<{ method: string; payload?: unknown }> = [];
  const cron = options.cron ?? [];
  const webhooks = options.webhooks ?? [];
  const functions = options.functions ?? [];

  const repository: ComputeDefinitionRepository = {
    async deployFunction(_principal, _scope, id, image) {
      calls.push({ method: "deployFunction", payload: { id, image } });
      return 1;
    },
    async listFunctionDeployments() { return []; },
    async recordFunctionInvocation() {},
    async listFunctionInvocations() { return []; },
    async listCron() { return cron; },
    async createCron(_principal, _scope, input) {
      calls.push({ method: "createCron", payload: input });
      return cronRecord({ ...input, lastDispatchedAt: null });
    },
    async getCron(_principal, _scope, id) { return cron.find((entry) => entry.id === id) ?? null; },
    async setCronEnabled(_principal, _scope, id, enabled) {
      calls.push({ method: "setCronEnabled", payload: { id, enabled } });
      const found = cron.find((entry) => entry.id === id);
      return found ? cronRecord({ ...found, enabled }) : null;
    },
    async deleteCron(_principal, _scope, id) {
      calls.push({ method: "deleteCron", payload: id });
      return cron.some((entry) => entry.id === id);
    },
    async listWebhooks() { return webhooks; },
    async createWebhook(_principal, _scope, input) {
      calls.push({ method: "createWebhook", payload: input });
      return webhookRecord(input);
    },
    async getWebhook(_principal, _scope, id) {
      return webhooks.find((entry) => entry.id === id) ?? null;
    },
    async setWebhookEnabled(_principal, _scope, id, enabled) {
      calls.push({ method: "setWebhookEnabled", payload: { id, enabled } });
      const found = webhooks.find((entry) => entry.id === id);
      return found ? webhookRecord({ ...found, enabled }) : null;
    },
    async deleteWebhook(_principal, _scope, id) {
      calls.push({ method: "deleteWebhook", payload: id });
      return webhooks.some((entry) => entry.id === id);
    },
    async listCronOccurrenceMessages(_principal, _scope, queue, hashes) {
      calls.push({ method: "listCronOccurrenceMessages", payload: { queue, hashes } });
      return options.occurrences ?? { dedupeWindowSeconds: null, messages: [] };
    },
    async listDeliveries() { return []; },
    async listFunctions() { return functions; },
    async createFunction(_principal, _scope, input) {
      calls.push({ method: "createFunction", payload: input });
      return functionRecord(input);
    },
    async getFunction(_principal, _scope, id) {
      return functions.find((entry) => entry.id === id) ?? null;
    },
    async findFunctionByName(_principal, _scope, name) {
      return functions.find((entry) => entry.name === name && entry.enabled) ?? null;
    },
    async setFunctionEnabled(_principal, _scope, id, enabled) {
      calls.push({ method: "setFunctionEnabled", payload: { id, enabled } });
      const found = functions.find((entry) => entry.id === id);
      return found ? functionRecord({ ...found, enabled }) : null;
    },
    async deleteFunction(_principal, _scope, id) {
      calls.push({ method: "deleteFunction", payload: id });
      return functions.some((entry) => entry.id === id);
    },
  };

  const service = new ComputeDefinitionService({
    repository,
    ...(options.queues ? { queues: { async queueNames() { return options.queues!; } } } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  return { service, calls, repository };
}

describe("ComputeDefinitionService — cron", () => {
  it("creates a definition whose expression the scheduler can actually parse", async () => {
    const { service, calls } = harness({ queues: ["report_jobs"] });
    await service.createCron(admin, scope, {
      name: "nightly-report", expression: "0 3 * * *", queue: "report_jobs",
    });
    expect(calls[0]?.payload).toMatchObject({ expression: "0 3 * * *", enabled: true });
  });

  it("refuses an expression the scheduler would not understand", async () => {
    // Derselbe Parser wie im Scheduler. Ein Ausdruck, den er abweist, darf gar
    // nicht erst entstehen — sonst scheitert er spaeter bei jedem Vorkommen.
    const { service } = harness({ queues: ["report_jobs"] });
    // "0 3 * * 1" (montags) stand hier bis 1.86 als unlesbar — seit der
    // vollen Grammatik ist es gueltig; an seine Stelle tritt eine Stunde 24.
    for (const expression of ["0 24 * * *", "*/0 * * * *", "not a cron", "0 3 * *"]) {
      await expect(service.createCron(admin, scope, {
        name: "nightly-report", expression, queue: "report_jobs",
      })).rejects.toBeInstanceOf(ComputeDefinitionError);
    }
  });

  it("refuses a target queue that does not exist", async () => {
    // Sonst entstuende ein Zeitplan, der bei jedem Vorkommen scheitert und
    // dabei aussieht, als liefe er.
    const { service } = harness({ queues: ["other_jobs"] });
    await expect(service.createCron(admin, scope, {
      name: "nightly-report", expression: "*/5 * * * *", queue: "report_jobs",
    })).rejects.toBeInstanceOf(ComputeDefinitionError);
  });

  it("refuses a payload beyond the column limit", async () => {
    const { service } = harness({ queues: ["report_jobs"] });
    await expect(service.createCron(admin, scope, {
      name: "nightly-report", expression: "*/5 * * * *", queue: "report_jobs",
      payload: { blob: "x".repeat(70_000) },
    })).rejects.toBeInstanceOf(ComputeDefinitionError);
  });

  it("enables and disables without touching anything else", async () => {
    const { service, calls } = harness({ cron: [cronRecord()] });
    const updated = await service.setCronEnabled(admin, scope, cronId, false);
    expect(updated.enabled).toBe(false);
    expect(calls[0]).toEqual({ method: "setCronEnabled", payload: { id: cronId, enabled: false } });
  });

  it("reports an unknown definition as not found, never as a server error", async () => {
    const { service } = harness();
    await expect(service.getCron(admin, scope, cronId)).rejects.toMatchObject({
      code: "COMPUTE_NOT_FOUND",
    });
    await expect(service.deleteCron(admin, scope, cronId)).rejects.toMatchObject({
      code: "COMPUTE_NOT_FOUND",
    });
  });

  it("treats a malformed id as not found instead of asking the database", async () => {
    const { service, calls } = harness();
    await expect(service.getCron(admin, scope, "'; DROP TABLE --")).rejects.toMatchObject({
      code: "COMPUTE_NOT_FOUND",
    });
    expect(calls).toHaveLength(0);
  });
});

describe("ComputeDefinitionService — webhooks", () => {
  it("creates a definition with a reference, never a secret", async () => {
    const { service, calls } = harness();
    await service.createWebhook(admin, scope, {
      name: "order-events", url: "https://receiver.example.com/hooks",
      eventTypes: ["order.created", "order.created"], signingSecretRef: "vault:webhook/orders",
    });
    // Doppelte Ereignistypen werden zusammengefasst, nicht abgewiesen.
    expect(calls[0]?.payload).toMatchObject({
      eventTypes: ["order.created"], timeoutMs: 5_000, maxAttempts: 5,
    });
  });

  it("refuses exactly the targets the deliverer would reject", async () => {
    // Fielen beide Regeln auseinander, entstuende ein Webhook, den der Betrieb
    // bei jedem Versuch stumm abweist — und das saehe aus wie ein defekter
    // Empfaenger statt wie eine abgelehnte Eingabe.
    const { service } = harness();
    for (const url of [
      "http://receiver.example.com/hooks",
      "https://receiver.example.com/hooks?token=x",
      "https://receiver.example.com/hooks#fragment",
      "https://user:pass@receiver.example.com/hooks",
      "https://127.0.0.1/hooks",
      "https://receiver.internal/hooks",
      "https://receiver.example.com:8443/hooks",
    ]) {
      await expect(service.createWebhook(admin, scope, {
        name: "order-events", url, eventTypes: ["order.created"],
        signingSecretRef: "vault:webhook/orders",
      })).rejects.toBeInstanceOf(ComputeDefinitionError);
    }
  });

  it("refuses a definition without a plausible secret reference", async () => {
    const { service } = harness();
    await expect(service.createWebhook(admin, scope, {
      name: "order-events", url: "https://receiver.example.com/hooks",
      eventTypes: ["order.created"], signingSecretRef: "x",
    })).rejects.toBeInstanceOf(ComputeDefinitionError);
  });

  it("refuses to delete a webhook that is still enabled", async () => {
    // Loeschen entfernt ueber den Fremdschluessel auch alle wartenden
    // Zustellungen. Der Umweg ueber das Abschalten macht daraus zwei bewusste
    // Schritte.
    const { service, calls } = harness({ webhooks: [webhookRecord({ enabled: true })] });
    await expect(service.deleteWebhook(admin, scope, webhookId)).rejects.toMatchObject({
      code: "COMPUTE_PRECONDITION_FAILED",
    });
    expect(calls).toHaveLength(0);
  });

  it("deletes a webhook once it is disabled", async () => {
    const { service, calls } = harness({ webhooks: [webhookRecord({ enabled: false })] });
    await service.deleteWebhook(admin, scope, webhookId);
    expect(calls).toEqual([{ method: "deleteWebhook", payload: webhookId }]);
  });

  it("refuses to list deliveries of a webhook that does not exist", async () => {
    const { service } = harness();
    await expect(service.listDeliveries(admin, scope, webhookId)).rejects.toMatchObject({
      code: "COMPUTE_NOT_FOUND",
    });
  });

  it("bounds the delivery limit", async () => {
    const { service } = harness({ webhooks: [webhookRecord()] });
    await expect(service.listDeliveries(admin, scope, webhookId, 5_000))
      .rejects.toBeInstanceOf(ComputeDefinitionError);
  });
});

describe("ComputeDefinitionService — functions", () => {
  it("creates a definition the invoker would also accept", async () => {
    const { service, calls } = harness();
    await service.createFunction(admin, scope, {
      name: "resize-image", image: pinnedImage, entrypoint: "handler.mjs",
    });
    expect(calls[0]?.payload).toMatchObject({
      image: pinnedImage, timeoutMs: 30_000, memoryMiB: 128, maxConcurrency: 1,
    });
  });

  it("refuses exactly what validateFunctionDefinition refuses", async () => {
    // Derselbe Validator, den der Aufruf anwendet. Eine Definition, die der
    // Betrieb spaeter abweist, darf gar nicht erst entstehen.
    const { service } = harness();
    const base = { name: "resize-image", image: pinnedImage, entrypoint: "handler.mjs" };
    for (const override of [
      { image: "registry.example.com/qkern/probe:latest" },
      { memoryMiB: 8 },
      { timeoutMs: 10 },
      { maxConcurrency: 500 },
      { egressOrigins: ["http://api.example.com"] },
      { egressOrigins: ["https://127.0.0.1"] },
      { secretRefs: ["!"] },
      { entrypoint: "../escape" },
    ]) {
      await expect(service.createFunction(admin, scope, { ...base, ...override }))
        .rejects.toBeInstanceOf(ComputeDefinitionError);
    }
  });

  it("enables and disables without touching anything else", async () => {
    const { service, calls } = harness({ functions: [functionRecord()] });
    const updated = await service.setFunctionEnabled(admin, scope, functionId, false);
    expect(updated.enabled).toBe(false);
    expect(updated.image).toBe(pinnedImage);
    expect(calls[0]).toEqual({
      method: "setFunctionEnabled", payload: { id: functionId, enabled: false },
    });
  });

  it("reports an unknown function as not found", async () => {
    const { service } = harness();
    await expect(service.getFunction(admin, scope, functionId))
      .rejects.toMatchObject({ code: "COMPUTE_NOT_FOUND" });
  });
});

describe("ComputeDefinitionService — authority", () => {
  it("hides everything from a non-admin principal", async () => {
    const { service } = harness({ cron: [cronRecord()] });
    const serviceRole: ProjectQueuePrincipal = { ...admin, role: "service_role" };
    await expect(service.listCron(serviceRole, scope)).rejects.toMatchObject({
      code: "COMPUTE_NOT_FOUND",
    });
  });

  it("hides a scope that belongs to another organization", async () => {
    // 404 statt 403: Wer nicht darf, soll nicht erfahren, dass es die Ressource
    // gibt.
    const { service } = harness();
    await expect(service.listWebhooks(admin, { ...scope, organizationId: "org-2" }))
      .rejects.toMatchObject({ code: "COMPUTE_NOT_FOUND" });
  });

  it("refuses to exceed the per-scope definition limit", async () => {
    const existing = Array.from({ length: 3 }, (_value, index) =>
      cronRecord({ id: `${index}`, name: `job-${index}` }));
    const base = harness({ cron: existing, queues: ["report_jobs"] });
    const limited = new ComputeDefinitionService({
      repository: {
        ...base.repository,
        async createCron() { throw new Error("must not be reached"); },
      },
      queues: { async queueNames() { return ["report_jobs"]; } },
      maxCronPerScope: 3,
    });
    await expect(limited.createCron(admin, scope, {
      name: "job-4", expression: "*/5 * * * *", queue: "report_jobs",
    })).rejects.toMatchObject({ code: "COMPUTE_CONFLICT" });
  });
});
