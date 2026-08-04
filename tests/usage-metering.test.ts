import { describe, expect, it } from "vitest";
import type { UsagePrincipal } from "@/lib/server/usage/model";
import { MemoryUsageRepository } from "@/lib/server/usage/repository";
import { UsageService } from "@/lib/server/usage/service";

const now = new Date("2026-08-04T12:00:00.000Z");
const scope = { organizationId: "org-usage", projectId: "project-usage", environment: "development" as const };
const meter: UsagePrincipal = {
  organizationId: scope.organizationId, actorRef: "meter:project-queues", subject: "meter-project-queues", role: "meter",
};
const operator: UsagePrincipal = {
  organizationId: scope.organizationId, actorRef: "operator:plans", subject: "operator-plans", role: "operator",
};
const reader: UsagePrincipal = {
  organizationId: scope.organizationId, actorRef: "owner@qkern.test", subject: "owner-usage", role: "reader",
};

function setup() {
  let sequence = 0;
  const repository = new MemoryUsageRepository();
  const service = new UsageService({
    repository,
    now: () => new Date(now),
    id: () => `usage-event-${++sequence}`,
  });
  return { repository, service };
}

describe("usage metering and quotas", () => {
  it("deduplicates the same verifier without storing or double-counting the raw key", async () => {
    const { service } = setup();
    const first = await service.record(meter, scope, {
      metric: "queue_operations", source: "project_queues", quantity: 3, idempotencyKey: "queue-job-0001",
    });
    const replay = await service.record(meter, scope, {
      metric: "queue_operations", source: "project_queues", quantity: 3, idempotencyKey: "queue-job-0001",
    });
    expect(first).toMatchObject({ accepted: true, deduplicated: false, used: "3", mode: "unlimited" });
    expect(replay).toMatchObject({ accepted: true, deduplicated: true, used: "3" });
    const projection = await service.readProjection(reader, scope);
    expect(projection.metrics.find((item) => item.metric === "queue_operations")?.used).toBe("3");
    expect(JSON.stringify(projection)).not.toContain("queue-job-0001");
  });

  it("rejects one idempotency key reused for a different event fingerprint", async () => {
    const { service } = setup();
    await service.record(meter, scope, {
      metric: "queue_operations", source: "project_queues", quantity: 1, idempotencyKey: "queue-job-0002",
    });
    await expect(service.record(meter, scope, {
      metric: "queue_operations", source: "project_queues", quantity: 2, idempotencyKey: "queue-job-0002",
    })).rejects.toMatchObject({ code: "USAGE_IDEMPOTENCY_CONFLICT" });
  });

  it("enforces a hard quota atomically and keeps a denied replay stable", async () => {
    const { service } = setup();
    await service.setQuota(operator, scope, {
      metric: "queue_operations", limit: 5, mode: "enforce", expectedRevision: null,
    });
    await expect(service.record(meter, scope, {
      metric: "queue_operations", source: "project_queues", quantity: 4, idempotencyKey: "queue-job-0003",
    })).resolves.toMatchObject({ accepted: true, used: "4", remaining: "1" });
    const denied = await service.record(meter, scope, {
      metric: "queue_operations", source: "project_queues", quantity: 2, idempotencyKey: "queue-job-0004",
    });
    const replay = await service.record(meter, scope, {
      metric: "queue_operations", source: "project_queues", quantity: 2, idempotencyKey: "queue-job-0004",
    });
    expect(denied).toMatchObject({ accepted: false, used: "4", rejectionCode: "QUOTA_EXCEEDED" });
    expect(replay).toMatchObject({ accepted: false, deduplicated: true, used: "4" });
  });

  it("serializes concurrent consumption so an enforce limit cannot be overspent", async () => {
    const { service } = setup();
    await service.setQuota(operator, scope, {
      metric: "queue_operations", limit: "10", mode: "enforce", expectedRevision: null,
    });
    const decisions = await Promise.all([
      service.record(meter, scope, {
        metric: "queue_operations", source: "project_queues", quantity: 6, idempotencyKey: "queue-race-left",
      }),
      service.record(meter, scope, {
        metric: "queue_operations", source: "project_queues", quantity: 6, idempotencyKey: "queue-race-right",
      }),
    ]);
    expect(decisions.filter((item) => item.accepted)).toHaveLength(1);
    expect(decisions.filter((item) => !item.accepted)).toHaveLength(1);
    expect((await service.readProjection(reader, scope)).metrics
      .find((item) => item.metric === "queue_operations")?.used).toBe("6");
  });

  it("keeps observe mode non-blocking while projecting exceeded usage", async () => {
    const { service } = setup();
    await service.setQuota(operator, scope, {
      metric: "queue_operations", limit: 5, mode: "observe", expectedRevision: null,
    });
    const decision = await service.record(meter, scope, {
      metric: "queue_operations", source: "project_queues", quantity: 6, idempotencyKey: "queue-observe-1",
    });
    expect(decision).toMatchObject({ accepted: true, used: "6", status: "exceeded", mode: "observe" });
  });

  it("rejects incompatible sources, cross-tenant readers and invalid periods", async () => {
    const { service } = setup();
    await expect(service.record(meter, scope, {
      metric: "storage_egress_bytes", source: "project_queues", quantity: 1, idempotencyKey: "wrong-source-01",
    })).rejects.toMatchObject({ code: "USAGE_INVALID_INPUT" });
    await expect(service.readProjection({ ...reader, organizationId: "other-org" }, scope))
      .rejects.toMatchObject({ code: "USAGE_ACCESS_DENIED" });
    await expect(service.readProjection(reader, scope, { period: "2026-09" }))
      .rejects.toMatchObject({ code: "USAGE_INVALID_INPUT" });
  });

  it("uses optimistic revisions so operators cannot silently overwrite a newer quota", async () => {
    const { service } = setup();
    const created = await service.setQuota(operator, scope, {
      metric: "api_requests", limit: 100, mode: "observe", expectedRevision: null,
    });
    expect(created.revision).toBe(1);
    const updated = await service.setQuota(operator, scope, {
      metric: "api_requests", limit: 200, mode: "enforce", expectedRevision: 1,
    });
    expect(updated).toMatchObject({ revision: 2, limit: "200", mode: "enforce" });
    await expect(service.setQuota(operator, scope, {
      metric: "api_requests", limit: 300, mode: "enforce", expectedRevision: 1,
    })).rejects.toMatchObject({ code: "USAGE_POLICY_CONFLICT" });
  });
});
