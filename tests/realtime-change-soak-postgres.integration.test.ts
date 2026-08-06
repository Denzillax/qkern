import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GeneratedDataApiService } from "@/lib/server/data-plane/generated-api";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";
import { RealtimeChangePoller } from "@/lib/server/realtime/change-poller";
import { RealtimeChangePollerRuntime } from "@/lib/server/realtime/change-poller-runtime";
import { GeneratedApiRealtimeChangeReader } from "@/lib/server/realtime/change-reader";
import { RealtimeCursorCodec } from "@/lib/server/realtime/cursor";
import type {
  RealtimePrincipal,
  RealtimeScope,
  RealtimeServerMessage,
  RealtimeSink,
} from "@/lib/server/realtime/model";
import { PrefixRealtimeAuthorization } from "@/lib/server/realtime/policy";
import {
  PostgresRealtimeChangeSource,
  type ProjectConnection,
} from "@/lib/server/realtime/postgres-change-source";
import { MemoryRealtimeEventLog } from "@/lib/server/realtime/repository";
import { RealtimeService } from "@/lib/server/realtime/service";
import { BufferedUsageEmitter } from "@/lib/server/usage/buffered-emitter";
import { ServiceUsageEmitter } from "@/lib/server/usage/emitter";
import { PostgresUsageRepository } from "@/lib/server/usage/postgres-repository";
import { UsageService } from "@/lib/server/usage/service";

/**
 * Soak-Lauf mit **laufendem** Poller und anhaltendem Schreiber.
 *
 * Alle bisherigen Kettenfälle rufen `drain` explizit auf und messen deshalb
 * keine Zustelllatenz: Diese wird vom Pollintervall dominiert, das der Aufrufer
 * bestimmt. Hier läuft stattdessen `RealtimeChangePollerRuntime` mit einem
 * echten Intervall, während ein Schreiber über mehrere Sekunden Zeilen anlegt.
 *
 * Gemessen wird die Zeit von der bestätigten `INSERT`-Anweisung bis zur
 * Zustellung an den Abonnenten. Die Schranken prüfen **Stillstandsfreiheit**,
 * nicht ein Leistungsversprechen: Die NFR-Zielwerte aus `docs/QA.md` gelten für
 * Broadcast in einer definierten Region, nicht für CDC-Polling in einem
 * Container auf einem Entwicklungsrechner.
 */

const adminUrl = process.env.QKERN_TEST_ADMIN_DATABASE_URL;
const projectApiUrl = process.env.QKERN_TEST_PROJECT_API_DATABASE_URL;
const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = Boolean(adminUrl && projectApiUrl && ownerUrl && runtimeUrl);

const WRITE_COUNT = 120;
const IDLE_INTERVAL_MS = 100;
/**
 * Bewusst klein. Der Betrieb bündelt zu 500; hier soll der Schreibvorgang
 * mehrfach **während** der Messung stattfinden. Sonst liefe der Soak-Lauf mit
 * eingeschaltetem Emitter und ohne je eine Buchung zu machen — und hätte über
 * genau die Frage nichts ausgesagt, für die er hier steht.
 */
const USAGE_FLUSH_AT = 25;

class TimingSink implements RealtimeSink {
  readonly arrivals = new Map<string, number>();
  readonly order: string[] = [];
  send(message: RealtimeServerMessage) {
    if (message.type === "change") {
      const label = message.record.label;
      if (typeof label === "string") {
        this.arrivals.set(label, Date.now());
        this.order.push(label);
      }
    }
    return true;
  }
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)];
}

describe.runIf(enabled)("Realtime change soak PostgreSQL certification", () => {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const schema = `soak_${suffix}`;
  const table = "items";
  const owner = randomUUID();
  const controlUser = randomUUID();
  const scope: RealtimeScope = {
    organizationId: randomUUID(), projectId: randomUUID(), environment: "development",
  };

  let admin: SqlPool;
  let projectApi: SqlPool;
  let control: SqlPool;
  let runtime: SqlPool;
  let usage: BufferedUsageEmitter;
  let source: PostgresRealtimeChangeSource;
  let reader: GeneratedApiRealtimeChangeReader;

  const principal = (subject: string): RealtimePrincipal => ({
    organizationId: scope.organizationId,
    actorRef: `authenticated:${subject}`,
    role: "authenticated",
    subject,
  });

  beforeAll(async () => {
    admin = createPostgresPool({ connectionString: adminUrl!, max: 3 });
    projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 6 });
    control = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    runtime = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: runtimeUrl!, max: 4 }), "runtime",
    );

    // Der Zähler hängt an einem echten Projekt: usage_counters trägt einen
    // zusammengesetzten Fremdschlüssel.
    await control.query(`INSERT INTO users (id,email,password_hash,status)
      VALUES ($1,$2,'$argon2id$integration-only','active')`,
    [controlUser, `soak-owner-${controlUser}@qkern.test`]);
    await control.query(`INSERT INTO organizations (id,name,slug,created_by)
      VALUES ($1,'Realtime Soak',$2,$3)`,
    [scope.organizationId, `soak-${scope.organizationId}`, controlUser]);
    await control.query(`INSERT INTO projects (id,organization_id,name,slug,region,status,created_by)
      VALUES ($1,$2,'Soak',$3,'test','ready',$4)`,
    [scope.projectId, scope.organizationId, `soak-${scope.projectId}`, controlUser]);
    await control.query(`INSERT INTO project_environments
      (organization_id,project_id,environment,database_instance_ref)
      VALUES ($1,$2,'development',$3)`,
    [scope.organizationId, scope.projectId, `managed:${scope.projectId}`]);

    usage = new BufferedUsageEmitter({
      inner: new ServiceUsageEmitter({
        service: new UsageService({ repository: new PostgresUsageRepository(new PostgresControlPlane(runtime)) }),
        source: "realtime",
      }),
      flushAtQuantity: USAGE_FLUSH_AT,
    });

    // IF NOT EXISTS vor CREATE ROLE ist nicht atomar: parallele Testdateien
    // laufen sonst in pg_authid_rolname_index. Der Ausnahmezweig ist der
    // idiomatische Weg und braucht keine Absprache zwischen den Dateien.
    await admin.query(`DO $$
      BEGIN
        CREATE ROLE qkern_ledger_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
          NOREPLICATION NOBYPASSRLS;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;`);
    await admin.query("CREATE SCHEMA IF NOT EXISTS qkern_internal AUTHORIZATION qkern_ledger_owner")
      .catch((error: unknown) => {
        // Auch CREATE SCHEMA IF NOT EXISTS kann parallel auf pg_namespace
        // kollidieren.
        if (!String(error).includes("duplicate key value")) throw error;
      });
    await admin.query("GRANT qkern_ledger_owner TO CURRENT_USER");
    await admin.query(await readFile(
      path.resolve(process.cwd(), "db/project/0003_qkern_change_feed.sql"), "utf8",
    )).catch((error: unknown) => {
      // Vitest fuehrt Testdateien parallel aus; mehrere koennen den Feed
      // gleichzeitig anlegen. "already exists" und der Duplikatsfehler auf
      // pg_type bedeuten dasselbe: jemand war schneller.
      const message = String(error);
      if (!message.includes("already exists")
        && !message.includes("duplicate key value")) throw error;
    });
    // Unabhaengig davon, wer ihn angelegt hat: ohne Feed ist der Test wertlos.
    const feedPresent = await admin.query<{ present: string | null }>(
      "SELECT to_regclass('qkern_internal.change_feed')::text AS present",
    );
    if (!feedPresent.rows[0]?.present) throw new Error("change feed was not created");

    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`CREATE TABLE "${schema}".${table} (
      id uuid PRIMARY KEY, owner_id text NOT NULL, label text NOT NULL
    )`);
    await admin.query(`ALTER TABLE "${schema}".${table} ENABLE ROW LEVEL SECURITY`);
    await admin.query(`CREATE POLICY soak_owner_isolation ON "${schema}".${table}
      USING (owner_id = current_setting('request.jwt.claim.sub', true))`);
    await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO qkern_project_api_app`);
    await admin.query(`GRANT SELECT ON "${schema}".${table} TO qkern_project_api_app`);
    await admin.query(`CREATE TRIGGER ${table}_capture
      AFTER INSERT OR UPDATE OR DELETE ON "${schema}".${table}
      FOR EACH ROW EXECUTE FUNCTION qkern_internal.capture_change()`);

    const connection: ProjectConnection = {
      withProject: async (_scope, work) => work({
        query: async (text, values) => projectApi.query(text, values as never) as never,
      }),
    };
    source = new PostgresRealtimeChangeSource(connection);
    reader = new GeneratedApiRealtimeChangeReader(
      new GeneratedDataApiService(
        { resolveTarget: async () => ({ databaseInstanceRef: "managed:certification" }) } as never,
        { resolve: async () => ({
          pool: projectApi,
          expectedRole: "qkern_project_api_app",
          expectedDatabase: new URL(projectApiUrl!).pathname.slice(1),
          expectedLedgerOwner: "qkern",
        }) } as never,
      ),
    );
  });

  afterAll(async () => {
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await Promise.allSettled([admin?.end(), projectApi?.end(), control?.end(), runtime?.end()]);
  });

  it("delivers every change of a sustained writer without loss, gap or stall", async () => {
    const service = new RealtimeService({
      eventLog: new MemoryRealtimeEventLog(20),
      authorization: new PrefixRealtimeAuthorization(),
      cursor: new RealtimeCursorCodec(Buffer.alloc(32, 6)),
      changeReader: reader,
      usage,
      id: () => `soak-connection-${randomUUID().slice(0, 8)}`,
    });

    const poller = new RealtimeChangePoller({ source, consumer: service, scope, batchSize: 50 });
    await poller.drain(50);

    const sink = new TimingSink();
    const connection = service.connect(scope, principal(owner), sink);
    await service.subscribe(connection, "soak", `changes:${schema}.${table}`);

    const overloaded: string[] = [];
    const loopPoller = new RealtimeChangePoller({
      source, consumer: service, scope, batchSize: 50,
      startPosition: poller.currentPosition,
      onOverloaded: (id) => overloaded.push(id),
    });
    const failures: unknown[] = [];
    const runtime = new RealtimeChangePollerRuntime({
      poller: loopPoller,
      idleIntervalMs: IDLE_INTERVAL_MS,
      errorIntervalMs: 500,
      onError: (error) => failures.push(error),
    });
    const loop = runtime.run();

    // Anhaltender Schreiber: kleine Pausen, damit der Poller mehrfach leer
    // laeuft und die Wartezeit wirklich in die Messung eingeht.
    const written: string[] = [];
    const sentAt = new Map<string, number>();
    for (let index = 0; index < WRITE_COUNT; index += 1) {
      const label = `soak-${String(index).padStart(4, "0")}`;
      await admin.query(
        `INSERT INTO "${schema}".${table} (id, owner_id, label) VALUES ($1, $2, $3)`,
        [randomUUID(), owner, label],
      );
      sentAt.set(label, Date.now());
      written.push(label);
      if (index % 10 === 9) await new Promise((resolve) => setTimeout(resolve, 40));
    }

    const deadline = Date.now() + 30_000;
    while (sink.order.length < written.length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    runtime.stop();
    await loop;

    const latencies = written
      .filter((label) => sink.arrivals.has(label))
      .map((label) => sink.arrivals.get(label)! - sentAt.get(label)!);

    // Vollstaendigkeit und Reihenfolge sind die harten Zusicherungen.
    expect(sink.order).toEqual(written);
    expect(overloaded).toEqual([]);
    expect(failures).toEqual([]);

    // Stillstandsfreiheit: kein Ereignis darf beliebig lange haengen. Die
    // Schranken sind bewusst grosszuegig und kein Leistungsversprechen.
    const p95 = percentile(latencies, 0.95);
    const worst = Math.max(...latencies);
    console.error(
      `soak: ${latencies.length} Aenderungen, p50 ${percentile(latencies, 0.5)} ms, `
      + `p95 ${p95} ms, max ${worst} ms`,
    );
    expect(p95).toBeLessThan(5_000);
    expect(worst).toBeLessThan(15_000);

    // Der Lauf lief mit **eingeschaltetem** Emitter, und der Schwellwert war
    // klein genug, dass währenddessen mehrfach geschrieben wurde. Die Schranken
    // oben gelten also für den gemessenen Pfad, nicht für einen ohne Messung.
    await usage.stop();
    const counted = await control.query<{ quantity: string }>(
      `SELECT quantity FROM usage_counters
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3
          AND metric='realtime_messages'`,
      [scope.organizationId, scope.projectId, scope.environment],
    );
    expect(counted.rows[0]?.quantity).toBe(String(sink.order.length));
    const bookings = await control.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM usage_events
        WHERE organization_id=$1 AND project_id=$2 AND metric='realtime_messages'`,
      [scope.organizationId, scope.projectId],
    );
    // Gebündelt heisst gebündelt: deutlich weniger Buchungen als Nachrichten.
    console.error(`soak: ${bookings.rows[0].count} Buchungen fuer ${sink.order.length} Nachrichten`);
    expect(Number(bookings.rows[0].count)).toBeLessThan(sink.order.length / 5);
  }, 90_000);
});
