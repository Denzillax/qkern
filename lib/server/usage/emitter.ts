import type { UsageMetric, UsagePrincipal, UsageScope, UsageSource } from "@/lib/server/usage/model";
import { UsageError, type UsageService } from "@/lib/server/usage/service";

const REFERENCE = /^[A-Za-z0-9._:-]{1,64}$/;

export type UsageAdmission = Readonly<{
  admitted: boolean;
  /**
   * Warum nicht. `null`, wenn zugelassen.
   *
   * `unavailable` ist ausdrücklich etwas anderes als `quota_exceeded`: Das eine
   * ist eine Entscheidung, das andere ihr Ausbleiben. Wer beides gleich benennt,
   * kann später nicht mehr unterscheiden, ob ein Betreiber sein Limit erreicht
   * hat oder ob die Messung ausgefallen war.
   */
  reason: "quota_exceeded" | "conflict" | "unavailable" | null;
}>;

export type UsageMeasurement = Readonly<{
  metric: UsageMetric;
  /**
   * Stabile Kennung der gemessenen Operation — die Nachrichten-ID, die
   * Aufruf-ID. Aus ihr baut der Emitter den Idempotenzschlüssel; derselbe
   * Wert zählt nie zweimal.
   */
  reference: string;
  quantity?: number;
  observedAt?: Date;
}>;

export interface UsageEmitterPort {
  /**
   * Meldet eine Operation und gibt zurück, ob sie stattfinden darf.
   *
   * **Eine Methode, nicht zwei.** Eine getrennte `measure`-Methode ohne Antwort
   * hätte einen zweiten Codepfad ergeben, den ein Aufrufer versehentlich
   * nehmen kann — und ein hartes Limit, das an einer Stelle greift und an einer
   * anderen nicht, wäre schlimmer als gar keines. Wer nicht gaten will,
   * ignoriert die Antwort sichtbar.
   */
  admit(scope: UsageScope, input: UsageMeasurement): Promise<UsageAdmission>;
}

/** Lässt alles durch und misst nichts. Der Zustand, wenn Metering aus ist. */
export class DisabledUsageEmitter implements UsageEmitterPort {
  async admit(): Promise<UsageAdmission> {
    return ADMITTED;
  }
}

export type ServiceUsageEmitterOptions = {
  service: Pick<UsageService, "record">;
  source: UsageSource;
  /**
   * Was gilt, wenn die Messung selbst scheitert — nicht, wenn sie ablehnt.
   *
   * Voreinstellung `admit`. Eine Quota ist eine kaufmännische Grenze, keine
   * Sicherheitsgrenze: Der Schaden eines kurz nicht gezählten Aufrufs ist
   * begrenzt und nachträglich abgleichbar, der Schaden einer Plattform, die bei
   * jedem Datenbankschluckauf jede Operation abweist, ist es nicht. Wer die
   * andere Wahl braucht, stellt sie ausdrücklich um.
   */
  onFailure?: "admit" | "reject";
  actorRef?: string;
};

/**
 * Der vertrauenswürdige Emitter, den Usage Metering seit Alpha 1 voraussetzt.
 *
 * Bis Release 1.28 gab es ihn nicht. Ledger, Quota-Entscheidung und Projektion
 * waren gebaut und gegen echtes PostgreSQL zertifiziert — und zeigten trotzdem
 * null, weil keine Produktoperation je ein Ereignis meldete. Dasselbe Muster
 * hat dieser Sprint schon beim Realtime-Poller, beim Event-Log, bei der
 * Webhook-Outbox und bei der Functions-Sandbox gefunden.
 *
 * Der Emitter besitzt den `meter`-Principal. Ein Produktmodul, das sich seinen
 * eigenen bauen dürfte, könnte in einen fremden Scope schreiben; hier kommt der
 * Scope aus dem Aufruf und die Autorität aus dem Emitter.
 *
 * Er baut auch den Idempotenzschlüssel selbst. Der Schlüsselraum ist
 * **scope-weit**, nicht metrikweit: Zwei Module, die dieselbe Kennung als
 * Schlüssel benutzen, würden sich gegenseitig deduplizieren.
 */
export class ServiceUsageEmitter implements UsageEmitterPort {
  private readonly onFailure: "admit" | "reject";
  private readonly actorRef: string;

  constructor(private readonly options: ServiceUsageEmitterOptions) {
    this.onFailure = options.onFailure ?? "admit";
    this.actorRef = options.actorRef ?? `system:usage-emitter:${options.source}`;
  }

  async admit(scope: UsageScope, input: UsageMeasurement): Promise<UsageAdmission> {
    if (!REFERENCE.test(input.reference)) return this.unavailable();
    try {
      const decision = await this.options.service.record(this.principal(scope), scope, {
        metric: input.metric,
        source: this.options.source,
        quantity: input.quantity ?? 1,
        idempotencyKey: `${this.options.source}:${input.metric}:${input.reference}`,
        observedAt: input.observedAt,
      });
      if (decision.accepted) return ADMITTED;
      return Object.freeze({ admitted: false, reason: "quota_exceeded" as const });
    } catch (error) {
      // Derselbe Schlüssel mit verändertem Inhalt scheitert geschlossen, und
      // zwar unabhängig von `onFailure`: Das ist kein Ausfall, sondern ein
      // Aufrufer, der eine fremde Entscheidung für sich beansprucht.
      if (error instanceof UsageError && error.code === "USAGE_IDEMPOTENCY_CONFLICT") {
        return Object.freeze({ admitted: false, reason: "conflict" as const });
      }
      return this.unavailable();
    }
  }

  private unavailable(): UsageAdmission {
    return Object.freeze({ admitted: this.onFailure === "admit", reason: "unavailable" as const });
  }

  private principal(scope: UsageScope): UsagePrincipal {
    return {
      organizationId: scope.organizationId,
      actorRef: this.actorRef,
      subject: this.actorRef,
      role: "meter",
    };
  }
}

const ADMITTED: UsageAdmission = Object.freeze({ admitted: true, reason: null });
