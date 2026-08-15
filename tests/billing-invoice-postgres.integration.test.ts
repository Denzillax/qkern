import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { BillingService } from "@/lib/server/usage/billing";
import { PostgresBillingRateCardRepository } from "@/lib/server/usage/billing-postgres-repository";
import type { UsagePrincipal } from "@/lib/server/usage/model";
import type { SqlPool } from "@/lib/server/db/sql";

/**
 * Der Rechnungslauf als **Prozess** — der achte mit Arbeitsnachweis.
 *
 * Gemessen wird die Wirkung: Aus echten Monatszaehlern und dem echten
 * Preisblatt entsteht eine Rechnung mit Posten in der Datenbank, geschrieben
 * vom ausgelieferten Prozess mit der Worker-Rolle. Ein zweiter Lauf laesst sie
 * unangetastet, und ein Lauf ueber die offene Periode kommt gar nicht erst an
 * seine Runde: Er scheitert an der Konfigurationsgrenze.
 */

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const workerUrl = process.env.QKERN_TEST_WORKER_DATABASE_URL;
const enabled = Boolean(ownerUrl && runtimeUrl && workerUrl);

/** Ein abgeschlossener Monat, fest statt relativ: Juli 2026. */
const PERIOD = "2026-07";
const WINDOW_START = "2026-07-01T00:00:00.000Z";

describe.runIf(enabled)("Billing invoice process PostgreSQL certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const operator: UsagePrincipal = {
    organizationId, actorRef: "system:billing", subject: controlUser, role: "operator",
  };

  let owner: SqlPool;
  let runtime: SqlPool;

  function invoiceProcess(period: string) {
    const child = spawn(process.execPath, ["--import", "tsx", "workers/billing-invoice-runtime.mts"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        QKERN_BILLING_INVOICES_ENABLED: "true",
        QKERN_BILLING_ORGANIZATION_ID: organizationId,
        QKERN_BILLING_RUNNER_ID: "certification-billing-1",
        QKERN_BILLING_PERIOD: period,
        QKERN_BILLING_IDLE_MS: "60000",
        QKERN_WORKER_DATABASE_URL: workerUrl!,
      },
    });
    let noise = "";
    child.stderr.on("data", (chunk: Buffer) => { noise += chunk.toString(); });
    child.stdout.on("data", (chunk: Buffer) => { noise += chunk.toString(); });
    return { child, output: () => noise };
  }

  /** Wartet, bis die Prozessausgabe ein Ereignis nennt — nicht auf einen Moment. */
  async function waitFor(output: () => string, marker: string, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !output().includes(marker)) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(output(), `Prozessausgabe: ${output().slice(-800)}`).toContain(marker);
  }

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    await owner.query(`INSERT INTO users (id,email,password_hash,status)
      VALUES ($1,$2,'$argon2id$integration-only','active')`,
    [controlUser, `invoice-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id,name,slug,created_by)
      VALUES ($1,'Invoice',$2,$3)`, [organizationId, `invoice-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id,organization_id,name,slug,region,status,created_by)
      VALUES ($1,$2,'Invoice',$3,'test','ready',$4)`,
    [projectId, organizationId, `invoice-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id,project_id,environment,database_instance_ref)
      VALUES ($1,$2,'development',$3)`, [organizationId, projectId, `managed:${projectId}`]);

    // Zaehler fuer den Juli — als Eigentuemer eingelegt, weil der Usage-Dienst
    // in das laufende Fenster schreibt und der Juli abgeschlossen ist. Der
    // Schreibweg der Zaehler selbst ist seit 1.29 eigens zertifiziert; Gegenstand
    // hier ist der Rechnungslauf.
    for (const [metric, quantity] of [["queue_operations", 1000], ["storage_egress_bytes", 2_000_000_000]] as const) {
      await owner.query(`INSERT INTO usage_counters
        (organization_id,project_id,environment,metric,window_start,window_end,quantity)
        VALUES ($1,$2,'development',$3,$4::timestamptz,$4::timestamptz + interval '1 month',$5)`,
      [organizationId, projectId, metric, WINDOW_START, quantity]);
    }

    // Preise ueber den echten Dienst mit der Laufzeitrolle, wirksam vor dem
    // Fensterende — plus ein spaeterer Preis, der fuer den Juli nichts gilt.
    runtime = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: runtimeUrl!, max: 2 }), "runtime");
    const billing = new BillingService({
      rateCards: new PostgresBillingRateCardRepository(new PostgresControlPlane(runtime)),
      usage: { readWindow: async () => [] },
    });
    await billing.setRate(operator, {
      metric: "queue_operations", unitPriceMicros: 250n, currency: "CHF", effectiveFrom: "2026-01-01",
    });
    await billing.setRate(operator, {
      metric: "storage_egress_bytes", unitPriceMicros: 90_000n, perUnits: 1_000_000_000n,
      currency: "CHF", effectiveFrom: "2026-01-01",
    });
    await billing.setRate(operator, {
      metric: "queue_operations", unitPriceMicros: 999n, currency: "CHF", effectiveFrom: "2026-08-01",
    });
  }, 120_000);

  afterAll(async () => {
    await Promise.allSettled([runtime?.end(), owner?.end()]);
  });

  it("issues the closed month's invoice from the shipped process", async () => {
    const { child, output } = invoiceProcess(PERIOD);
    try {
      await waitFor(output, "billing.invoice.run_completed");
    } finally {
      child.kill();
    }
    expect(output()).toContain('"event":"billing.invoice.issued"');

    const invoice = await owner.query<{
      id: string; currency: string; total_micros: string; unpriced_metrics: string[];
    }>(
      `SELECT id, currency, total_micros::text AS total_micros, unpriced_metrics
       FROM billing_invoices
       WHERE organization_id=$1 AND project_id=$2 AND environment='development'
         AND period_start=$3::date`,
      [organizationId, projectId, "2026-07-01"]);
    expect(invoice.rows).toHaveLength(1);
    // 1000 × 250 Mikro plus 2e9 Bytes × 90000 Mikro je 1e9 = 250000 + 180000.
    expect(invoice.rows[0]?.total_micros).toBe("430000");
    expect(invoice.rows[0]?.currency).toBe("CHF");
    expect(invoice.rows[0]?.unpriced_metrics).toEqual([]);

    const lines = await owner.query<{ metric: string; amount_micros: string; unit_price_micros: string }>(
      `SELECT metric, amount_micros::text AS amount_micros, unit_price_micros::text AS unit_price_micros
       FROM billing_invoice_lines WHERE invoice_id=$1 ORDER BY metric`,
      [invoice.rows[0]!.id]);
    expect(lines.rows.map((row) => [row.metric, row.amount_micros])).toEqual([
      ["queue_operations", "250000"],
      ["storage_egress_bytes", "180000"],
    ]);
    // Der Preis vom 1. August gilt fuer den Juli nicht: 250, nicht 999.
    expect(lines.rows.find((row) => row.metric === "queue_operations")?.unit_price_micros).toBe("250");
  }, 120_000);

  it("leaves the issued invoice untouched on a second run", async () => {
    const { child, output } = invoiceProcess(PERIOD);
    try {
      await waitFor(output, "billing.invoice.run_completed");
    } finally {
      child.kill();
    }
    expect(output()).toContain('"event":"billing.invoice.exists"');
    expect(output()).not.toContain('"event":"billing.invoice.issued"');

    const count = await owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM billing_invoices WHERE organization_id=$1`,
      [organizationId]);
    expect(count.rows[0]?.n).toBe(1);
  }, 120_000);

  it("refuses an open period at its configuration boundary", async () => {
    const openPeriod = new Date().toISOString().slice(0, 7);
    const { child, output } = invoiceProcess(openPeriod);
    const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
    expect(exitCode).not.toBe(0);
    expect(output()).toContain("failed its secure startup or runtime boundary");
    // Nichts wurde fakturiert — der Lauf kam nie an eine Runde.
    const count = await owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM billing_invoices
       WHERE organization_id=$1 AND period_start=$2::date`,
      [organizationId, `${openPeriod}-01`]);
    expect(count.rows[0]?.n).toBe(0);
  }, 120_000);
});
