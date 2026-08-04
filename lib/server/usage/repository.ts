import type {
  UsageDecisionRecord,
  UsageEventInput,
  UsageMetric,
  UsagePrincipal,
  UsageQuotaPolicy,
  UsageScope,
  UsageWindowRecord,
} from "@/lib/server/usage/model";
import { USAGE_METRIC_DEFINITIONS } from "@/lib/server/usage/model";

export class UsageRepositoryConflictError extends Error {
  constructor(readonly code: "USAGE_IDEMPOTENCY_CONFLICT" | "USAGE_POLICY_CONFLICT") {
    super(code); this.name = "UsageRepositoryConflictError";
  }
}

export interface UsageRepository {
  readonly durability: "ephemeral" | "durable";
  consume(principal: UsagePrincipal, event: UsageEventInput): Promise<UsageDecisionRecord>;
  readWindow(
    principal: UsagePrincipal,
    scope: UsageScope,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<UsageWindowRecord[]>;
  setPolicy(
    principal: UsagePrincipal,
    policy: Omit<UsageQuotaPolicy, "revision" | "createdAt" | "updatedAt">,
    expectedRevision: number | null,
    now: Date,
  ): Promise<UsageQuotaPolicy>;
}

export class MemoryUsageRepository implements UsageRepository {
  readonly durability = "ephemeral" as const;
  private readonly events = new Map<string, UsageDecisionRecord>();
  private readonly counters = new Map<string, bigint>();
  private readonly policies = new Map<string, UsageQuotaPolicy>();
  private readonly locks = new Map<string, Promise<void>>();

  consume(principal: UsagePrincipal, event: UsageEventInput) {
    const eventKey = `${scopeKey(event)}:${event.eventKeyHash}`;
    return this.exclusive(`event:${eventKey}`, async () => {
      const existing = this.events.get(eventKey);
      if (existing) {
        if (existing.eventFingerprint !== event.eventFingerprint) {
          throw new UsageRepositoryConflictError("USAGE_IDEMPOTENCY_CONFLICT");
        }
        return cloneDecision({ ...existing, deduplicated: true });
      }
      const counterKey = windowKey(event, event.metric, event.windowStart);
      return this.exclusive(`counter:${counterKey}`, async () => {
        const policy = this.policies.get(policyKey(event, event.metric)) ?? null;
        const used = this.counters.get(counterKey) ?? 0n;
        const proposed = used + event.quantity;
        const accepted = !policy || policy.mode === "observe" || proposed <= policy.limit;
        const resultingQuantity = accepted ? proposed : used;
        if (accepted) this.counters.set(counterKey, resultingQuantity);
        const decision: UsageDecisionRecord = {
          ...cloneEvent(event),
          accepted,
          rejectionCode: accepted ? null : "QUOTA_EXCEEDED",
          resultingQuantity,
          limitAtDecision: policy?.limit ?? null,
          modeAtDecision: policy?.mode ?? "unlimited",
          quotaRevision: policy?.revision ?? null,
          recordedAt: new Date(),
          deduplicated: false,
        };
        this.events.set(eventKey, cloneDecision(decision));
        return cloneDecision(decision);
      });
    });
  }

  async readWindow(
    principal: UsagePrincipal,
    scope: UsageScope,
    windowStart: Date,
    _windowEnd: Date,
  ) {
    if (principal.organizationId !== scope.organizationId) return [];
    return (Object.keys(USAGE_METRIC_DEFINITIONS) as UsageMetric[]).map((metric) => ({
      metric,
      quantity: this.counters.get(windowKey(scope, metric, windowStart)) ?? 0n,
      policy: clonePolicy(this.policies.get(policyKey(scope, metric)) ?? null),
    }));
  }

  setPolicy(
    principal: UsagePrincipal,
    input: Omit<UsageQuotaPolicy, "revision" | "createdAt" | "updatedAt">,
    expectedRevision: number | null,
    now: Date,
  ) {
    return this.exclusive(`policy:${policyKey(input, input.metric)}`, async () => {
      const key = policyKey(input, input.metric);
      const current = this.policies.get(key);
      if ((current && expectedRevision !== current.revision) || (!current && expectedRevision !== null)) {
        throw new UsageRepositoryConflictError("USAGE_POLICY_CONFLICT");
      }
      const policy: UsageQuotaPolicy = {
        ...input,
        revision: (current?.revision ?? 0) + 1,
        createdAt: current?.createdAt ?? new Date(now),
        updatedAt: new Date(now),
      };
      this.policies.set(key, clonePolicy(policy)!);
      return clonePolicy(policy)!;
    });
  }

  private async exclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = prior.then(() => current);
    this.locks.set(key, queued);
    await prior;
    try { return await task(); }
    finally {
      release();
      if (this.locks.get(key) === queued) this.locks.delete(key);
    }
  }
}

function scopeKey(scope: UsageScope) {
  return `${scope.organizationId}:${scope.projectId}:${scope.environment}`;
}
function policyKey(scope: UsageScope, metric: UsageMetric) { return `${scopeKey(scope)}:${metric}`; }
function windowKey(scope: UsageScope, metric: UsageMetric, start: Date) {
  return `${scopeKey(scope)}:${metric}:${start.toISOString()}`;
}
function clonePolicy(policy: UsageQuotaPolicy | null) {
  return policy ? { ...policy, createdAt: new Date(policy.createdAt), updatedAt: new Date(policy.updatedAt) } : null;
}
function cloneEvent(event: UsageEventInput): UsageEventInput {
  return { ...event, observedAt: new Date(event.observedAt), windowStart: new Date(event.windowStart), windowEnd: new Date(event.windowEnd) };
}
function cloneDecision(decision: UsageDecisionRecord): UsageDecisionRecord {
  return {
    ...decision,
    observedAt: new Date(decision.observedAt),
    windowStart: new Date(decision.windowStart),
    windowEnd: new Date(decision.windowEnd),
    recordedAt: new Date(decision.recordedAt),
  };
}
