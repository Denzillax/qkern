import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { withTenantTransaction } from "@/lib/server/db/transaction";
import { BillingService } from "@/lib/server/usage/billing";
import { PostgresBillingRateCardRepository } from "@/lib/server/usage/billing-postgres-repository";
import { PostgresUsageRepository } from "@/lib/server/usage/postgres-repository";
import { UsageService } from "@/lib/server/usage/service";
import type { UsagePrincipal } from "@/lib/server/usage/model";
import type { SqlPool } from "@/lib/server/db/sql";

/**
 * Preisblatt und Monatsprojektion gegen echtes PostgreSQL — Sprosse 1 der
 * Paritätsleiter (`docs/PARITAET.md`).
 *
 * Die Kette ist die echte: Nutzung wird über den **Usage-Dienst** verbucht,
 * nicht als Zeile eingespielt; die Projektion multipliziert mit dem Preisblatt
 * aus Migration 0039; alles läuft durch die Laufzeitrolle und deren RLS.
 */

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = Boolean(ownerUrl && runtimeUrl);

describe.runIf(enabled)("Billing rate card PostgreSQL certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const foreignOrganizationId = randomUUID();
  const projectId = randomUUID();
  const scope = { organizationId, projectId, environment: "development" as const };
  const operator: UsagePrincipal = {
    organizationId, actorRef: "system:billing", subject: controlUser, role: "operator",
  };
  const meter: UsagePrincipal = {
    organizationId, actorRef: "system:meter", subject: "meter", role: "meter",
  };
  const reader: UsagePrincipal = {
    organizationId, actorRef: "billing-reader@qkern.test", subject: controlUser, role: "reader",
  };

  let owner: SqlPool;
  let runtime: SqlPool;
  let billing: BillingService;
  let usage: UsageService;

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    await owner.query(`INSERT INTO users (id,email,password_hash,status)
      VALUES ($1,$2,'$argon2id$integration-only','active')`,
    [controlUser, `billing-${controlUser}@qkern.test`]);
    for (const [id, slug] of [[organizationId, "billing"], [foreignOrganizationId, "billing-foreign"]] as const) {
      await owner.query(`INSERT INTO organizations (id,name,slug,created_by)
        VALUES ($1,'Billing',$2,$3)`, [id, `${slug}-${id}`, controlUser]);
    }
    await owner.query(`INSERT INTO projects (id,organization_id,name,slug,region,status,created_by)
      VALUES ($1,$2,'Billing',$3,'test','ready',$4)`,
    [projectId, organizationId, `billing-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id,project_id,environment,database_instance_ref)
      VALUES ($1,$2,'development',$3)`, [organizationId, projectId, `managed:${projectId}`]);

    runtime = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: runtimeUrl!, max: 4 }), "runtime");
    const controlPlane = new PostgresControlPlane(runtime);
    const usageRepository = new PostgresUsageRepository(controlPlane);
    usage = new UsageService({ repository: usageRepository });
    billing = new BillingService({
      rateCards: new PostgresBillingRateCardRepository(controlPlane),
      usage: usageRepository,
    });
  }, 120_000);

  afterAll(async () => {
    await Promise.allSettled([runtime?.end(), owner?.end()]);
  });

  it("projects real usage against the effective rate card", async () => {
    // Nutzung entsteht ueber den echten Dienst — mit Idempotenzschluessel und
    // verifier-only Ablage, wie im Betrieb.
    for (const [key, quantity] of [["billing-a", 700], ["billing-b", 300]] as const) {
      const decision = await usage.record(meter, scope, {
        metric: "queue_operations", source: "project_queues", quantity,
        idempotencyKey: key,
      });
      expect(decision.accepted).toBe(true);
    }
    await billing.setRate(operator, {
      metric: "queue_operations", unitPriceMicros: 250n, currency: "CHF", effectiveFrom: "2026-01-01",
    });

    const projection = await billing.readBillingProjection(reader, scope);
    expect(projection.kind).toBe("projection");
    const line = projection.lines.find((entry) => entry.metric === "queue_operations")!;
    expect(line.used).toBe("1000");
    // 1000 × 250 Mikro = 0.25 CHF.
    expect(line.amountMicros).toBe("250000");
    expect(line.amount).toBe("0.250000");
    expect(projection.currency).toBe("CHF");
    expect(projection.unpricedMetrics).toContain("api_requests");
  });

  it("lets the newest effective price win, in the database's ordering", async () => {
    await billing.setRate(operator, {
      metric: "queue_operations", unitPriceMicros: 400n, currency: "CHF", effectiveFrom: "2026-08-01",
    });
    const projection = await billing.readBillingProjection(reader, scope);
    const line = projection.lines.find((entry) => entry.metric === "queue_operations")!;
    // Der Preis vom 1. August schlaegt den vom 1. Januar: 1000 × 400 Mikro.
    expect(line.unitPriceMicros).toBe("400");
    expect(line.amountMicros).toBe("400000");
  });

  it("hides a foreign organization's rate card", async () => {
    const foreign = await withTenantTransaction(
      runtime, { organizationId: foreignOrganizationId, actorRef: "system:billing" },
      (transaction) => transaction.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM billing_rate_cards"),
    );
    // RLS: In der fremden Organisation ist das Preisblatt leer — nicht bloss
    // gefiltert, sondern nicht vorhanden.
    expect(foreign.rows[0]?.n).toBe(0);
  });

  it("refuses to rewrite a price through the runtime role", async () => {
    // Append-only: weder UPDATE noch DELETE sind der Laufzeit erteilt, und es
    // gibt keine Policy dafuer. Ein Preis, der rueckwirkend umgeschrieben
    // werden kann, taugt nicht als Grundlage einer Abrechnung.
    await expect(withTenantTransaction(
      runtime, { organizationId, actorRef: "system:billing" },
      (transaction) => transaction.query(
        "UPDATE billing_rate_cards SET unit_price_micros = 1 WHERE organization_id = $1",
        [organizationId]),
    )).rejects.toThrow();
    await expect(withTenantTransaction(
      runtime, { organizationId, actorRef: "system:billing" },
      (transaction) => transaction.query(
        "DELETE FROM billing_rate_cards WHERE organization_id = $1", [organizationId]),
    )).rejects.toThrow();
  });
});
