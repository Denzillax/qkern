import { recognisedByName } from "@/lib/server/errors/identity";
import type { SqlQueryable } from "@/lib/server/db/sql";
import type {
  UsageDecisionRecord,
  UsageEventInput,
  UsageMetric,
  UsagePrincipal,
  UsageQuotaPolicy,
  UsageScope,
  UsageSeriesBucket,
  UsageSeriesRecord,
  UsageWindowRecord,
} from "@/lib/server/usage/model";
import { USAGE_METRIC_DEFINITIONS } from "@/lib/server/usage/model";

export class UsageRepositoryConflictError extends Error {
  constructor(readonly code: "USAGE_IDEMPOTENCY_CONFLICT" | "USAGE_POLICY_CONFLICT") {
    super(code); this.name = "UsageRepositoryConflictError";
  }
}
recognisedByName(UsageRepositoryConflictError, "UsageRepositoryConflictError");

/**
 * Ein Ereignis samt seiner Cursor-Marke.
 *
 * `recordedAtText` traegt die Textform der Datenbank, nicht die des Clients.
 * `Date.toISOString()` kann nur Millisekunden; `recorded_at` speichert
 * Mikrosekunden. Ein abgeschnittener Cursor liesse die letzte Zeile jeder Seite
 * erneut durch — die Seiten ueberlappten sich, statt aneinanderzustossen.
 * Deshalb reicht der Adapter seine eigene Darstellung durch und vergleicht
 * gegen genau sie.
 */
export type UsageExportRecord = UsageDecisionRecord & { recordedAtText: string };

export interface UsageRepository {
  readonly durability: "ephemeral" | "durable";
  /**
   * Verbucht ein Ereignis.
   *
   * `transaction` ist die **laufende** Transaktion der gemessenen Operation.
   * Wird sie übergeben, entsteht die Buchung darin: keine Nachricht ohne ihre
   * Zählung, keine Zählung ohne ihre Nachricht. Ohne sie öffnet der Adapter
   * eine eigene — dann liegt zwischen Messung und Operation ein Fenster, in dem
   * ein Absturz zu viel zählt.
   */
  consume(
    principal: UsagePrincipal,
    event: UsageEventInput,
    transaction?: SqlQueryable,
  ): Promise<UsageDecisionRecord>;
  readWindow(
    principal: UsagePrincipal,
    scope: UsageScope,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<UsageWindowRecord[]>;
  /**
   * Liest Ereignisse eines Fensters seitenweise, in stabiler Ordnung.
   *
   * `after` ist der zuletzt gelesene Schlüssel, kein Offset. Ein Offset
   * verschiebt sich, sobald nebenher geschrieben wird — und in diese Tabelle
   * wird laufend geschrieben.
   *
   * Optional, weil der Memory-Port ihn nicht braucht: Exportiert wird, was
   * dauerhaft liegt.
   */
  listEvents?(
    principal: UsagePrincipal,
    scope: UsageScope,
    input: {
      windowStart: Date;
      windowEnd: Date;
      after: { recordedAt: string; id: string } | null;
      limit: number;
    },
  ): Promise<UsageExportRecord[]>;
  /**
   * Aggregiert die Ereignisse eines Fensters zu Eimern (2.45).
   *
   * Gerechnet wird **in der Datenbank**: `date_trunc`, `GROUP BY`, `ORDER BY`.
   * Zeilen nach JavaScript zu holen und dort zu summieren waere auf einem
   * belebten Projekt eine Ladung von Hunderttausenden Zeilen fuer ein Bild mit
   * 48 Balken.
   *
   * Zurueck kommen nur Eimer, in denen wirklich etwas passiert ist. Die leeren
   * fuellt der Dienst auf, nicht die Datenbank — siehe `UsageService.readSeries`.
   *
   * Optional, aus demselben Grund wie `listEvents`: Der Memory-Port kann das
   * nicht, und ein Ersatz aus dem Speicher waere eine andere Rechnung als die,
   * die er vorgibt zu sein.
   */
  readSeries?(
    principal: UsagePrincipal,
    scope: UsageScope,
    input: {
      metric: UsageMetric;
      bucket: UsageSeriesBucket;
      from: Date;
      to: Date;
      limit: number;
    },
  ): Promise<UsageSeriesRecord[]>;
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

  /**
   * `transaction` wird bewusst ignoriert: Dieser Port hat keine. Er bleibt
   * damit ein Entwicklungs- und Testport — für Produktion war er ohnehin nie
   * zugelassen.
   */
  consume(principal: UsagePrincipal, event: UsageEventInput, _transaction?: SqlQueryable) {
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
