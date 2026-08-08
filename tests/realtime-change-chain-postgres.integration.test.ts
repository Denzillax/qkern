import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GeneratedDataApiService } from "@/lib/server/data-plane/generated-api";
import { createPostgresPool } from "@/lib/server/db/pool";
import type { SqlPool } from "@/lib/server/db/sql";
import { RealtimeChangePoller } from "@/lib/server/realtime/change-poller";
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

/**
 * Die ganze Kette gegen echtes PostgreSQL: Trigger → Feed → Poller →
 * Sichtbarkeitsprüfung pro Abonnent → Zustellung.
 *
 * Die Teile waren einzeln zertifiziert, der Durchlauf als Ganzes nicht. Genau
 * an solchen Nahtstellen sind in den Releases 1.9 bis 1.13 die Fehler
 * aufgetreten, nicht in den Bausteinen selbst.
 *
 * Entscheidend ist der zweite Fall: Zwei Abonnenten desselben Kanals bekommen
 * unterschiedliche Teilmengen derselben Änderung — geprüft nicht gegen eine
 * Attrappe, sondern gegen eine echte RLS-Policy in einer echten Datenbank.
 */

const adminUrl = process.env.QKERN_TEST_ADMIN_DATABASE_URL;
const projectApiUrl = process.env.QKERN_TEST_PROJECT_API_DATABASE_URL;
const enabled = Boolean(adminUrl && projectApiUrl);

class Sink implements RealtimeSink {
  readonly messages: RealtimeServerMessage[] = [];
  constructor(private readonly accept = true) {}
  send(message: RealtimeServerMessage) {
    this.messages.push(structuredClone(message));
    return this.accept;
  }
  get changes() {
    return this.messages.filter((message) => message.type === "change");
  }
}

describe.runIf(enabled)("Realtime change chain PostgreSQL certification", () => {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const schema = `chain_${suffix}`;
  const table = "items";
  const alice = randomUUID();
  const bob = randomUUID();
  const scope: RealtimeScope = {
    organizationId: randomUUID(), projectId: "chain-project", environment: "development",
  };

  let admin: SqlPool;
  let projectApi: SqlPool;
  let source: PostgresRealtimeChangeSource;
  let reader: GeneratedApiRealtimeChangeReader;

  const principal = (subject: string): RealtimePrincipal => ({
    organizationId: scope.organizationId,
    actorRef: `authenticated:${subject}`,
    role: "authenticated",
    subject,
  });

  function service() {
    let connection = 0;
    return new RealtimeService({
      eventLog: new MemoryRealtimeEventLog(20),
      authorization: new PrefixRealtimeAuthorization(),
      cursor: new RealtimeCursorCodec(Buffer.alloc(32, 4)),
      changeReader: reader,
      id: () => `chain-connection-${++connection}`,
    });
  }

  beforeAll(async () => {
    admin = createPostgresPool({ connectionString: adminUrl!, max: 2 });
    projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 4 });

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
    // **Kein** dauerhaftes `GRANT qkern_ledger_owner TO CURRENT_USER` mehr.
    //
    // Die Rolle ist clusterweit, und die Grenzpruefung des Migrationszaunes
    // verlangt einen Ledger-Eigentuemer **ohne jede** Mitgliedschaft. Ein
    // Grant hier machte jede Migration in jeder parallel laufenden Testdatei
    // unmoeglich — gefunden in Release 1.49, nachdem der Migrations-Prozess
    // lokal anwendete und im Zertifizierungslauf nicht.
    //
    // Gebraucht wurde der Grant, um Objekte im Namen des Eigentuemers
    // anzulegen. Der Zertifizierungs-Admin ist Superuser und darf das ohnehin.
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
    await admin.query(`CREATE POLICY chain_owner_isolation ON "${schema}".${table}
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

    const api = new GeneratedDataApiService(
      { resolveTarget: async () => ({ databaseInstanceRef: "managed:certification" }) } as never,
      { resolve: async () => ({
        pool: projectApi,
        expectedRole: "qkern_project_api_app",
        expectedDatabase: new URL(projectApiUrl!).pathname.slice(1),
        expectedLedgerOwner: "qkern",
      }) } as never,
    );
    reader = new GeneratedApiRealtimeChangeReader(api);
  });

  afterAll(async () => {
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await Promise.allSettled([admin?.end(), projectApi?.end()]);
  });

  /**
   * Erzeugt einen Poller und holt den Feed auf, **bevor** ein Abonnent
   * verbunden wird. Ein `changes:`-Kanal liefert bewusst keine Historie: Wer
   * spaeter abonniert, sieht ab dann. Wuerde der Test zuerst abonnieren, bekaeme
   * er die Aenderungen der vorigen Tests und pruefte etwas anderes als gemeint.
   */
  async function caughtUpPoller(instance: RealtimeService, overloaded: string[] = []) {
    const created = new RealtimeChangePoller({
      source,
      consumer: instance,
      scope,
      onOverloaded: (id) => overloaded.push(id),
      batchSize: 50,
    });
    await created.drain(50);
    return created;
  }

  it("carries a change from the trigger to a subscriber that may see it", async () => {
    const instance = service();
    const drained = await caughtUpPoller(instance);

    const sink = new Sink();
    const connection = instance.connect(scope, principal(alice), sink);
    await instance.subscribe(connection, "r1", `changes:${schema}.${table}`);

    const id = randomUUID();
    await admin.query(
      `INSERT INTO "${schema}".${table} (id, owner_id, label) VALUES ($1, $2, 'alice row')`,
      [id, alice],
    );
    await drained.drain();

    expect(sink.changes).toHaveLength(1);
    expect(sink.changes[0]).toMatchObject({
      channel: `changes:${schema}.${table}`,
      schema, table, operation: "insert",
      record: { id, owner_id: alice, label: "alice row" },
    });
  });

  it("gives two subscribers different subsets of the same change stream", async () => {
    // Der tragende Fall: keine Attrappe, sondern eine echte RLS-Policy.
    const instance = service();
    const drained = await caughtUpPoller(instance);

    const aliceSink = new Sink();
    const bobSink = new Sink();
    const aliceConnection = instance.connect(scope, principal(alice), aliceSink);
    const bobConnection = instance.connect(scope, principal(bob), bobSink);
    await instance.subscribe(aliceConnection, "r1", `changes:${schema}.${table}`);
    await instance.subscribe(bobConnection, "r2", `changes:${schema}.${table}`);

    await admin.query(
      `INSERT INTO "${schema}".${table} (id, owner_id, label)
       VALUES ($1, $2, 'for alice'), ($3, $4, 'for bob')`,
      [randomUUID(), alice, randomUUID(), bob],
    );
    await drained.drain();

    expect(aliceSink.changes).toHaveLength(1);
    expect(bobSink.changes).toHaveLength(1);
    expect(aliceSink.changes[0]).toMatchObject({ record: { owner_id: alice, label: "for alice" } });
    expect(bobSink.changes[0]).toMatchObject({ record: { owner_id: bob, label: "for bob" } });
    expect(JSON.stringify(aliceSink.changes)).not.toContain("for bob");
    expect(JSON.stringify(bobSink.changes)).not.toContain("for alice");
  });

  it("keeps order and delivers each change exactly once under a burst", async () => {
    const instance = service();
    const drained = await caughtUpPoller(instance);

    const sink = new Sink();
    const connection = instance.connect(scope, principal(alice), sink);
    await instance.subscribe(connection, "r1", `changes:${schema}.${table}`);

    const labels = Array.from({ length: 40 }, (_, index) => `burst-${String(index).padStart(3, "0")}`);
    for (const label of labels) {
      await admin.query(
        `INSERT INTO "${schema}".${table} (id, owner_id, label) VALUES ($1, $2, $3)`,
        [randomUUID(), alice, label],
      );
    }
    await drained.drain(20);

    const received = sink.changes.map((message) => {
      const record = (message as { record: Record<string, unknown> }).record;
      const label = record.label;
      if (typeof label !== "string") throw new Error("record.label is not a string");
      return label;
    });
    expect(received).toEqual(labels);
    expect(new Set(received).size).toBe(labels.length);
  });

  it("closes a subscriber that cannot keep up instead of skipping changes", async () => {
    const instance = service();
    const overloaded: string[] = [];
    const drained = await caughtUpPoller(instance, overloaded);

    const slow = new Sink(false);
    const connection = instance.connect(scope, principal(alice), slow);
    await instance.subscribe(connection, "r1", `changes:${schema}.${table}`);

    await admin.query(
      `INSERT INTO "${schema}".${table} (id, owner_id, label) VALUES ($1, $2, 'drop me')`,
      [randomUUID(), alice],
    );
    await drained.drain();

    expect(overloaded).toEqual([connection]);
    expect(slow.messages.some((message) =>
      message.type === "error" && message.code === "REALTIME_BACKPRESSURE")).toBe(true);
  });

  it("keeps every subscriber's subset correct with many subscribers at once", async () => {
    // Nebenlaeufigkeit ist hier der eigentliche Pruefpunkt: Die
    // Sichtbarkeitspruefung laeuft je Aenderung und je Abonnent, also
    // quadratisch. Ein gemeinsamer Fan-out waere schneller und genau deshalb
    // falsch -- dieser Fall haelt fest, dass die teure Variante auch unter
    // vielen Abonnenten korrekt bleibt.
    const instance = service();
    const drained = await caughtUpPoller(instance);

    const owners = Array.from({ length: 12 }, () => randomUUID());
    const sinks = new Map<string, Sink>();
    for (const owner of owners) {
      const sink = new Sink();
      sinks.set(owner, sink);
      const connection = instance.connect(scope, principal(owner), sink);
      await instance.subscribe(connection, `r-${owner}`, `changes:${schema}.${table}`);
    }

    // Jeder Eigentuemer bekommt drei Zeilen, geschrieben in durchmischter
    // Reihenfolge, damit die Zuordnung nicht zufaellig durch Sortierung stimmt.
    const written: Array<{ owner: string; label: string }> = [];
    for (let round = 0; round < 3; round += 1) {
      for (const owner of owners) {
        const label = `${owner.slice(0, 8)}-${round}`;
        written.push({ owner, label });
        await admin.query(
          `INSERT INTO "${schema}".${table} (id, owner_id, label) VALUES ($1, $2, $3)`,
          [randomUUID(), owner, label],
        );
      }
    }

    await drained.drain(50);

    for (const owner of owners) {
      const sink = sinks.get(owner)!;
      const received = sink.changes.map((message) => {
        const record = (message as { record: Record<string, unknown> }).record;
        return { owner: String(record.owner_id), label: String(record.label) };
      });
      const expected = written.filter((entry) => entry.owner === owner);

      // Genau die eigenen Zeilen, vollstaendig, in Schreibreihenfolge.
      expect(received).toEqual(expected);
      // Und keine fremde Zeile, auch nicht teilweise.
      expect(received.every((entry) => entry.owner === owner)).toBe(true);
    }

    const totalDelivered = owners.reduce(
      (sum, owner) => sum + sinks.get(owner)!.changes.length, 0,
    );
    expect(totalDelivered).toBe(written.length);
    // Die Laufzeit skaliert mit Abonnenten mal Aenderungen: 432 einzeln
    // RLS-gepruefte Lesevorgaenge. Unter voller Parallelitaet der Suite reicht
    // Vitests Standardgrenze von fuenf Sekunden nicht.
  }, 60_000);

  it("removes only changes older than the retention window", async () => {
    const before = await source.read(scope, 0, 500);
    expect(before.length).toBeGreaterThan(0);

    // Altersbasiert: in der Zukunft liegende Grenze entfernt alles, eine weit
    // zurueckliegende nichts. Nach Position zu loeschen waere im
    // Mehrinstanzbetrieb unsicher.
    expect(await source.prune(scope, new Date("2000-01-01T00:00:00.000Z"))).toBe(0);
    expect(await source.prune(scope, new Date(Date.now() + 60_000))).toBe(before.length);
    expect(await source.read(scope, 0, 500)).toEqual([]);
  });
});
