import { describe, expect, it, vi } from "vitest";
import type { CronDefinition } from "@/lib/server/compute/model";
import { CronDispatcher, nextCronOccurrence } from "@/lib/server/compute/cron";

const definition: CronDefinition = {
  organizationId: "org-compute", projectId: "project-compute", environment: "development",
  id: "cron-id", name: "hourly_sync", expression: "*/15 * * * *", queue: "jobs",
  payload: { task: "sync" }, enabled: true,
};

describe("Compute cron boundary", () => {
  it("computes deterministic UTC interval and daily occurrences", () => {
    expect(nextCronOccurrence("*/15 * * * *", new Date("2026-08-04T12:07:30Z")).toISOString())
      .toBe("2026-08-04T12:15:00.000Z");
    expect(nextCronOccurrence("30 2 * * *", new Date("2026-08-04T03:00:00Z")).toISOString())
      .toBe("2026-08-05T02:30:00.000Z");
    expect(() => nextCronOccurrence("* * * * *", new Date())).toThrow("Unsupported cron");
  });

  it("dispatches one deterministic queue dedupe key for an exact occurrence", async () => {
    const enqueue = vi.fn(async () => ({ id: "message-id", deduplicated: false }));
    const scheduledAt = new Date("2026-08-04T12:15:00.000Z");
    await expect(new CronDispatcher({ enqueue } as never).dispatch(definition, scheduledAt, {
      organizationId: definition.organizationId, actorRef: "service:cron", role: "service_role", subject: "cron",
    })).resolves.toEqual({ status: "dispatched", messageId: "message-id", scheduledAt: scheduledAt.toISOString() });
    const call = enqueue.mock.calls[0] as unknown as [unknown, unknown, unknown, Record<string, unknown>];
    expect(call[3]).toMatchObject({
      dedupeKey: `cron:${definition.id}:${scheduledAt.toISOString()}`,
      scheduledAt: scheduledAt.toISOString(),
    });
  });

  it("rejects a non-occurrence and a cross-tenant scheduler", async () => {
    const dispatcher = new CronDispatcher({ enqueue: vi.fn() } as never);
    const principal = { organizationId: definition.organizationId, actorRef: "service:cron", role: "service_role" as const, subject: "cron" };
    await expect(dispatcher.dispatch(definition, new Date("2026-08-04T12:16:00Z"), principal)).rejects.toThrow("not authorized");
    await expect(dispatcher.dispatch(definition, new Date("2026-08-04T12:15:00Z"), {
      ...principal, organizationId: "org-other",
    })).rejects.toThrow("not authorized");
  });
});
