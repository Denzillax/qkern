import { ConfigurationError } from "@/lib/server/db/errors";
import { getWorkerPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import {
  BillingInvoicePeriodError,
  BillingInvoiceRun,
  closedPeriodWindow,
  type BillingInvoiceLogEvent,
} from "@/lib/server/usage/invoice-run";
import type { RuntimeProbeObserver } from "@/lib/server/operations/runtime-probe";
import type { SqlPool } from "@/lib/server/db/sql";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUNNER = /^[a-z0-9][a-z0-9._:-]{0,199}$/i;

/**
 * Baut den Rechnungslauf aus der Umgebung — fuer `npm run worker:billing-invoices`.
 *
 * Alles, was ohne Datenbank pruefbar ist, steht vor dem ersten Pool. Dazu
 * gehoert die Periode: Ein Lauf, der eine offene Periode fakturieren soll,
 * scheitert **hier**, an seiner Konfigurationsgrenze — nicht irgendwo in einer
 * Runde, deren Log niemand liest.
 */
export function createBillingInvoiceRunFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: {
    pool?: SqlPool;
    logger?: { log(event: BillingInvoiceLogEvent): void };
    probe?: RuntimeProbeObserver;
    now?: () => Date;
  } = {},
): BillingInvoiceRun {
  if (env.QKERN_BILLING_INVOICES_ENABLED !== "true") {
    throw new ConfigurationError("Set QKERN_BILLING_INVOICES_ENABLED=true explicitly.");
  }
  const organizationId = env.QKERN_BILLING_ORGANIZATION_ID?.trim() ?? "";
  if (!UUID.test(organizationId)) {
    throw new ConfigurationError("QKERN_BILLING_ORGANIZATION_ID must be a UUID.");
  }
  const runnerId = env.QKERN_BILLING_RUNNER_ID?.trim() || "billing-invoice-runner";
  if (!RUNNER.test(runnerId)) {
    throw new ConfigurationError("QKERN_BILLING_RUNNER_ID must be a bounded reference.");
  }
  const period = env.QKERN_BILLING_PERIOD?.trim() || undefined;
  try {
    closedPeriodWindow(period, dependencies.now?.() ?? new Date());
  } catch (error) {
    if (error instanceof BillingInvoicePeriodError) throw new ConfigurationError(error.message);
    throw error;
  }
  const idleRaw = env.QKERN_BILLING_IDLE_MS?.trim();
  const idleDelayMs = idleRaw === undefined || idleRaw === "" ? 3_600_000 : Number(idleRaw);
  if (!Number.isInteger(idleDelayMs) || idleDelayMs < 10 || idleDelayMs > 86_400_000) {
    throw new ConfigurationError("QKERN_BILLING_IDLE_MS must be an integer between 10 and 86400000.");
  }
  const pool = dependencies.pool ?? getWorkerPostgresPool(env);
  return new BillingInvoiceRun(new PostgresControlPlane(pool), {
    organizationId,
    runnerId,
    period,
    idleDelayMs,
    logger: dependencies.logger,
    probe: dependencies.probe,
    now: dependencies.now,
  });
}
