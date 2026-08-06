import { randomUUID } from "node:crypto";
import type { UsageScope, UsageSource } from "@/lib/server/usage/model";
import type { UsageEmitterPort } from "@/lib/server/usage/emitter";
import { createUsageEmitterFromEnv } from "@/lib/server/usage/runtime";

/**
 * Liegt bewusst **nicht** in `usage/http.ts`: Dort steht die HTTP-Fläche der
 * Usage-Projektion selbst. Hier steht die Messung, die alle anderen Module an
 * ihrer HTTP-Grenze anwenden. Zwei verschiedene Dinge mit demselben Wort.
 */

/** Trägt keinen Scope und keine Zahl: Die Antwort sagt nur, dass Schluss ist. */
export class UsageQuotaExceededError extends Error {
  constructor() {
    super("USAGE_QUOTA_EXCEEDED");
    this.name = "UsageQuotaExceededError";
  }
}

type GlobalUsageEmitters = typeof globalThis & {
  __qkernUsageApiEmitters?: Map<UsageSource, UsageEmitterPort>;
};

/** Ein Emitter je Quelle, einmal gebaut. */
export function apiRequestEmitter(source: UsageSource): UsageEmitterPort {
  const runtime = globalThis as GlobalUsageEmitters;
  runtime.__qkernUsageApiEmitters ??= new Map();
  const existing = runtime.__qkernUsageApiEmitters.get(source);
  if (existing) return existing;
  const created = createUsageEmitterFromEnv(source);
  runtime.__qkernUsageApiEmitters.set(source, created);
  return created;
}

/**
 * Zählt eine API-Anfrage und entscheidet, ob sie stattfinden darf.
 *
 * **Diese Metrik entsteht an der HTTP-Grenze, nicht in einem Dienst.** Eine
 * Route ruft mehrere Dienstmethoden; eine Messung je Methode wäre kein Ersatz,
 * sondern systematisch zu hoch. Gemessen wird deshalb dort, wo eine Anfrage
 * genau einmal ihren Scope bekommt: im Kontext-Resolver des jeweiligen Moduls.
 *
 * Der Aufruf steht am **Ende** des Resolvers. Eine Anfrage, die schon an der
 * Authentifizierung scheitert, hat keinen Scope, den man belasten könnte — und
 * einen fremden zu belasten wäre schlimmer, als sie nicht zu zählen.
 *
 * Anders als `database_row_reads` und `storage_egress_bytes` ist die Menge hier
 * **vorher** bekannt: genau eins. Deshalb darf und soll diese Metrik gaten;
 * `enforce` ist hier die sinnvolle Einstellung, nicht die unmögliche.
 */
export async function admitApiRequest(
  source: UsageSource,
  scope: UsageScope,
  emitter: UsageEmitterPort = apiRequestEmitter(source),
): Promise<void> {
  const admission = await emitter.admit(scope, {
    metric: "api_requests", reference: randomUUID(),
  });
  if (!admission.admitted) throw new UsageQuotaExceededError();
}
