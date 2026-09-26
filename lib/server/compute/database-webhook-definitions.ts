import {
  DatabaseWebhookError,
  validateDatabaseWebhook,
  type DatabaseWebhookDraft,
  type DatabaseWebhookInput,
  type DatabaseWebhookRecord,
} from "@/lib/console/database-webhooks";
import {
  ComputeDefinitionError,
  type ComputeDefinitionScope,
} from "@/lib/server/compute/definitions";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";

/**
 * Die Verwaltungsflaeche der Datenbank-Webhooks (2.50).
 *
 * Der Dienst legt **zwei** Zeilen an: die ausgehende Webhook-Definition aus
 * 0032 und die Kopplung aus 0048. Er tut das nicht nacheinander ueber zwei
 * Aufrufe, sondern in einem Repository-Aufruf, der beides in einer Transaktion
 * schreibt. Eine Definition ohne Kopplung waere ein Webhook, den niemand
 * ausloest und den diese Flaeche nicht mehr findet; eine Kopplung ohne
 * Definition gibt es wegen des Fremdschluessels nicht.
 *
 * Geloescht wird in diesem Slice nicht. Abschalten geht, und es ist der
 * richtige erste Schritt: Es haelt die Zustellungen an, ohne etwas zu
 * verlieren. Loeschen wuerde ueber den Fremdschluessel die wartenden
 * Zustellungen mitnehmen, und dieser Verlust braucht eine eigene, bewusste
 * Flaeche — so wie beim ausgehenden Webhook, wo er zwei Schritte kostet.
 *
 * `signingSecretRef` ist durchgaengig eine Referenz. Es gibt in diesem Dienst
 * keinen Parameter, kein Feld und keine Rueckgabe fuer einen Geheimniswert.
 */

export interface DatabaseWebhookRepository {
  list(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope):
    Promise<DatabaseWebhookRecord[]>;
  get(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string):
    Promise<DatabaseWebhookRecord | null>;
  /** Legt Definition und Kopplung in einer Transaktion an. */
  create(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    draft: DatabaseWebhookDraft): Promise<DatabaseWebhookRecord>;
  setEnabled(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string,
    enabled: boolean): Promise<DatabaseWebhookRecord | null>;
}

export type DatabaseWebhookServiceOptions = {
  repository: DatabaseWebhookRepository;
  maxPerScope?: number;
};

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class DatabaseWebhookService {
  private readonly maxPerScope: number;

  constructor(private readonly options: DatabaseWebhookServiceOptions) {
    const limit = options.maxPerScope ?? 25;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT");
    }
    this.maxPerScope = limit;
  }

  async list(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope) {
    this.assertScope(principal, scope);
    return await this.options.repository.list(principal, scope);
  }

  async get(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string) {
    this.assertScope(principal, scope);
    this.assertId(id);
    const record = await this.options.repository.get(principal, scope, id);
    if (!record) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    return record;
  }

  /**
   * Legt einen Datenbank-Webhook an.
   *
   * Geprueft wird mit **demselben** reinen Modul, das die Ansicht schon vor dem
   * Absenden anwendet. Die Ansicht kann damit den Grund einer Ablehnung zeigen,
   * ohne zu raten, und die Route bleibt trotzdem die Stelle, die entscheidet.
   */
  async create(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    input: DatabaseWebhookInput): Promise<DatabaseWebhookRecord> {
    this.assertScope(principal, scope);
    let draft: DatabaseWebhookDraft;
    try {
      draft = validateDatabaseWebhook(input);
    } catch (cause) {
      if (cause instanceof DatabaseWebhookError) {
        throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT", { cause });
      }
      throw cause;
    }

    const existing = await this.options.repository.list(principal, scope);
    if (existing.length >= this.maxPerScope) throw new ComputeDefinitionError("COMPUTE_CONFLICT");

    return await this.options.repository.create(principal, scope, draft);
  }

  /**
   * Schaltet an oder ab. Der Schalter sitzt auf der Webhook-Definition, nicht
   * auf der Kopplung: Ein abgeschalteter Webhook holt keine Zustellungen mehr,
   * und wartende bleiben stehen, statt ihre Versuche zu verbrennen. Diese Regel
   * steht seit 1.19 in der Outbox und gilt hier unveraendert.
   */
  async setEnabled(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    id: string, enabled: boolean) {
    this.assertScope(principal, scope);
    this.assertId(id);
    if (typeof enabled !== "boolean") throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT");
    const record = await this.options.repository.setEnabled(principal, scope, id, enabled);
    if (!record) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    return record;
  }

  /**
   * Nur Administratoren, und nur in der eigenen Organisation. Zweite
   * Verteidigungslinie hinter RLS, nicht die erste — wie im Definitionsdienst.
   */
  private assertScope(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope) {
    if (principal.role !== "admin" || principal.organizationId !== scope.organizationId) {
      throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    }
  }

  private assertId(id: string) {
    if (typeof id !== "string" || !ID.test(id)) {
      throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    }
  }
}
