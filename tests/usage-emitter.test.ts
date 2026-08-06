import { describe, expect, it } from "vitest";
import { DisabledUsageEmitter, ServiceUsageEmitter } from "@/lib/server/usage/emitter";
import { UsageError } from "@/lib/server/usage/service";
import type { PublicUsageDecision, UsagePrincipal, UsageScope } from "@/lib/server/usage/model";

const scope: UsageScope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  environment: "development",
};

type Recorded = {
  principal: UsagePrincipal;
  input: { metric: string; source: string; quantity: number | string | bigint; idempotencyKey: string };
};

function service(outcome: Partial<PublicUsageDecision> | Error, sink: Recorded[] = []) {
  return {
    calls: sink,
    async record(principal: UsagePrincipal, _scope: UsageScope, input: Recorded["input"]) {
      sink.push({ principal, input });
      if (outcome instanceof Error) throw outcome;
      return { accepted: true, ...outcome } as PublicUsageDecision;
    },
  };
}

describe("ServiceUsageEmitter", () => {
  it("admits what the ledger accepted", async () => {
    const emitter = new ServiceUsageEmitter({ service: service({ accepted: true }), source: "compute" });
    await expect(emitter.admit(scope, { metric: "function_invocations", reference: "abc-1" }))
      .resolves.toEqual({ admitted: true, reason: null });
  });

  it("refuses when the ledger rejected the event", async () => {
    const emitter = new ServiceUsageEmitter({ service: service({ accepted: false }), source: "compute" });
    await expect(emitter.admit(scope, { metric: "function_invocations", reference: "abc-1" }))
      .resolves.toEqual({ admitted: false, reason: "quota_exceeded" });
  });

  it("builds the idempotency key from source, metric and reference", async () => {
    // Der Schluesselraum ist scope-weit, nicht metrikweit. Baut ein Aufrufer den
    // Schluessel selbst, koennen zwei Metriken sich gegenseitig deduplizieren.
    const calls: Recorded[] = [];
    const emitter = new ServiceUsageEmitter({
      service: service({ accepted: true }, calls), source: "project_queues",
    });
    await emitter.admit(scope, { metric: "queue_operations", reference: "message-7" });
    expect(calls[0].input.idempotencyKey).toBe("project_queues:queue_operations:message-7");
    expect(calls[0].input.source).toBe("project_queues");
  });

  it("meters with its own authority, never with the caller's", async () => {
    const calls: Recorded[] = [];
    const emitter = new ServiceUsageEmitter({ service: service({ accepted: true }, calls), source: "compute" });
    await emitter.admit(scope, { metric: "function_invocations", reference: "abc-1" });
    expect(calls[0].principal).toEqual({
      organizationId: scope.organizationId,
      actorRef: "system:usage-emitter:compute",
      subject: "system:usage-emitter:compute",
      role: "meter",
    });
  });

  it("lets the operation through when the measurement itself fails", async () => {
    // Eine Quota ist eine kaufmaennische Grenze. Ein Datenbankschluckauf darf
    // nicht jede Operation der Plattform abweisen.
    const emitter = new ServiceUsageEmitter({ service: service(new Error("down")), source: "compute" });
    await expect(emitter.admit(scope, { metric: "function_invocations", reference: "abc-1" }))
      .resolves.toEqual({ admitted: true, reason: "unavailable" });
  });

  it("can be told to fail closed instead", async () => {
    const emitter = new ServiceUsageEmitter({
      service: service(new Error("down")), source: "compute", onFailure: "reject",
    });
    await expect(emitter.admit(scope, { metric: "function_invocations", reference: "abc-1" }))
      .resolves.toEqual({ admitted: false, reason: "unavailable" });
  });

  it("refuses a reused key with different content regardless of the failure mode", async () => {
    // Kein Ausfall, sondern ein Aufrufer, der eine fremde Entscheidung fuer
    // sich beansprucht. Das scheitert immer geschlossen.
    const emitter = new ServiceUsageEmitter({
      service: service(new UsageError("USAGE_IDEMPOTENCY_CONFLICT")), source: "compute",
    });
    await expect(emitter.admit(scope, { metric: "function_invocations", reference: "abc-1" }))
      .resolves.toEqual({ admitted: false, reason: "conflict" });
  });

  it("never reaches the ledger with an unusable reference", async () => {
    const calls: Recorded[] = [];
    const emitter = new ServiceUsageEmitter({ service: service({ accepted: true }, calls), source: "compute" });
    await emitter.admit(scope, { metric: "function_invocations", reference: "not valid" });
    expect(calls).toHaveLength(0);
  });
});

describe("DisabledUsageEmitter", () => {
  it("admits everything", async () => {
    await expect(new DisabledUsageEmitter().admit())
      .resolves.toEqual({ admitted: true, reason: null });
  });
});
