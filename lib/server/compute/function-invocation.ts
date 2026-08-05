import { randomUUID } from "node:crypto";
import {
  ComputeDefinitionError,
  type ComputeDefinitionRepository,
  type ComputeDefinitionScope,
  type FunctionDefinitionRecord,
} from "@/lib/server/compute/definitions";
import { FunctionInvocationError, type FunctionInvoker } from "@/lib/server/compute/functions";
import type { FunctionInvocationResult } from "@/lib/server/compute/model";
import type { ProjectQueueJson, ProjectQueuePrincipal } from "@/lib/server/project-queues/model";

const NAME = /^[a-z][a-z0-9_-]{2,62}$/;

export type FunctionInvocationServiceOptions = {
  repository: Pick<ComputeDefinitionRepository, "findFunctionByName">;
  invoker: Pick<FunctionInvoker, "invoke">;
  now?: () => Date;
  id?: () => string;
};

/**
 * Löst eine Function auf und führt sie aus.
 *
 * Bis Release 1.22 gab es die Sandbox, aber keinen Weg zu ihr: Sie war eine
 * Bibliothek, die niemand aufruft. Genau dieses Muster hat der Sprint schon
 * dreimal gefunden.
 *
 * **Die Definition wird bei jedem Aufruf frisch gelesen.** Ein zwischengespei-
 * chertes Bild würde nach einem Abschalten weiterlaufen, und ein Betreiber, der
 * eine Function stoppt, will sie gestoppt haben.
 *
 * Aufrufen darf ein Service-Projektschlüssel oder ein Administrator. **Kein
 * anonymer und kein Endnutzer-Aufruf**: Eine Function läuft mit der Autorität
 * des Projekts, nicht mit der ihres Aufrufers, und eine Policy je Function, die
 * das sicher unterscheiden könnte, gibt es noch nicht.
 */
export class FunctionInvocationService {
  private readonly now: () => Date;
  private readonly id: () => string;

  constructor(private readonly options: FunctionInvocationServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? (() => randomUUID());
  }

  async invoke(
    principal: ProjectQueuePrincipal,
    scope: ComputeDefinitionScope,
    name: string,
    payload: ProjectQueueJson,
  ): Promise<FunctionInvocationResult> {
    if (!["service_role", "admin"].includes(principal.role) ||
        principal.organizationId !== scope.organizationId) {
      throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    }
    if (!NAME.test(name)) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");

    const record = await this.options.repository.findFunctionByName(principal, scope, name);
    if (!record) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");

    return await this.options.invoker.invoke(toDefinition(record), Object.freeze({
      id: this.id(),
      functionId: record.id,
      payload,
      requestedAt: this.now().toISOString(),
    }));
  }
}

function toDefinition(record: FunctionDefinitionRecord) {
  return Object.freeze({
    organizationId: record.organizationId,
    projectId: record.projectId,
    environment: record.environment,
    id: record.id,
    name: record.name,
    runtime: record.runtime,
    image: record.image,
    entrypoint: record.entrypoint,
    timeoutMs: record.timeoutMs,
    memoryMiB: record.memoryMiB,
    maxConcurrency: record.maxConcurrency,
    egressOrigins: Object.freeze([...record.egressOrigins]),
    secretRefs: Object.freeze([...record.secretRefs]),
  });
}

/** Auf einen HTTP-Status abbildbarer Fehlercode ohne Innenansicht. */
export function functionInvocationStatus(error: unknown): number {
  if (error instanceof ComputeDefinitionError) return 404;
  if (error instanceof FunctionInvocationError) {
    switch (error.code) {
      case "FUNCTION_INVALID": return 422;
      case "FUNCTION_TIMEOUT": return 504;
      case "FUNCTION_SANDBOX_FAILED": return 502;
    }
  }
  return 500;
}
