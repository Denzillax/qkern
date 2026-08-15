import { ConfigurationError } from "@/lib/server/db/errors";
import { getPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";
import {
  DisabledUsageEmitter,
  ServiceUsageEmitter,
  type UsageEmitterPort,
} from "@/lib/server/usage/emitter";
import type { UsageSource } from "@/lib/server/usage/model";
import { PostgresUsageRepository } from "@/lib/server/usage/postgres-repository";
import { MemoryUsageRepository, type UsageRepository } from "@/lib/server/usage/repository";
import { UsageError, UsageService } from "@/lib/server/usage/service";
import {
  BillingService,
  MemoryBillingRateCardRepository,
  type BillingRateCardRepository,
} from "@/lib/server/usage/billing";
import {
  PostgresBillingInvoiceReader,
  PostgresBillingRateCardRepository,
} from "@/lib/server/usage/billing-postgres-repository";

export function createUsageServiceFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: { repository?: UsageRepository } = {},
) {
  if (env.QKERN_USAGE_METERING_ENABLED !== "true") throw new UsageError("USAGE_METERING_DISABLED");
  const repository = dependencies.repository ?? (runtimeModeFromEnv(env) === "postgres"
    ? new PostgresUsageRepository(new PostgresControlPlane(getPostgresPool(env)))
    : new MemoryUsageRepository());
  if (env.NODE_ENV === "production" && repository.durability !== "durable") {
    throw new ConfigurationError("Production Usage Metering requires the durable PostgreSQL repository.");
  }
  return new UsageService({ repository, controlPlane: controlPlaneService });
}

/**
 * Baut den Emitter eines Produktmoduls.
 *
 * Zwei getrennte Ausfallsemantiken, und die Trennung ist Absicht: Eine falsch
 * konfigurierte Messung wird **hier** abgewiesen, beim Start, sodass niemand
 * unbemerkt ohne Zähler läuft. Ein Ausfall **im Betrieb** lässt die Operation
 * dagegen durch, weil eine kaufmännische Grenze keine Plattform anhalten soll.
 * Wer das anders will, setzt `QKERN_USAGE_EMITTER_ON_FAILURE=reject`.
 */
export function createUsageEmitterFromEnv(
  source: UsageSource,
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: { repository?: UsageRepository } = {},
): UsageEmitterPort {
  if (env.QKERN_USAGE_METERING_ENABLED !== "true") return new DisabledUsageEmitter();
  const onFailure = env.QKERN_USAGE_EMITTER_ON_FAILURE ?? "admit";
  if (onFailure !== "admit" && onFailure !== "reject") {
    throw new ConfigurationError("QKERN_USAGE_EMITTER_ON_FAILURE must be admit or reject.");
  }
  return new ServiceUsageEmitter({
    service: createUsageServiceFromEnv(env, dependencies),
    source,
    onFailure,
  });
}

type GlobalUsage = typeof globalThis & { __qkernUsageService?: UsageService };

export function getUsageService() {
  const runtime = globalThis as GlobalUsage;
  runtime.__qkernUsageService ??= createUsageServiceFromEnv();
  return runtime.__qkernUsageService;
}

/**
 * Baut den Billing-Dienst — hinter demselben Schalter wie das Metering.
 *
 * Preise ohne Zaehler waeren eine Projektion aus nichts; wer misst, darf
 * bepreisen, wer nicht misst, bekommt hier dieselbe Abweisung wie dort.
 */
export function createBillingServiceFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: {
    rateCards?: BillingRateCardRepository;
    usage?: UsageRepository;
  } = {},
) {
  if (env.QKERN_USAGE_METERING_ENABLED !== "true") throw new UsageError("USAGE_METERING_DISABLED");
  const postgres = runtimeModeFromEnv(env) === "postgres";
  const usage = dependencies.usage ?? (postgres
    ? new PostgresUsageRepository(new PostgresControlPlane(getPostgresPool(env)))
    : new MemoryUsageRepository());
  const rateCards = dependencies.rateCards ?? (postgres
    ? new PostgresBillingRateCardRepository(new PostgresControlPlane(getPostgresPool(env)))
    : new MemoryBillingRateCardRepository());
  if (env.NODE_ENV === "production" && !postgres) {
    throw new ConfigurationError("Production billing requires the durable PostgreSQL repositories.");
  }
  const invoices = postgres
    ? new PostgresBillingInvoiceReader(new PostgresControlPlane(getPostgresPool(env)))
    : undefined;
  return new BillingService({ rateCards, usage, invoices, controlPlane: controlPlaneService });
}

type GlobalBilling = typeof globalThis & { __qkernBillingService?: BillingService };

export function getBillingService() {
  const runtime = globalThis as GlobalBilling;
  runtime.__qkernBillingService ??= createBillingServiceFromEnv();
  return runtime.__qkernBillingService;
}
