import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";
import { RealtimeCursorCodec } from "@/lib/server/realtime/cursor";
import { PostgresRealtimeEventBus, type ListenConnection } from "@/lib/server/realtime/event-bus";
import type {
  RealtimePrincipal,
  RealtimeScope,
  RealtimeServerMessage,
  RealtimeSink,
} from "@/lib/server/realtime/model";
import { PrefixRealtimeAuthorization } from "@/lib/server/realtime/policy";
import { PostgresRealtimePresenceStore } from "@/lib/server/realtime/postgres-presence-store";
import { PostgresRealtimeEventLog } from "@/lib/server/realtime/postgres-repository";
import { RealtimeRetentionRuntime } from "@/lib/server/realtime/retention-runtime";
import { RealtimeService } from "@/lib/server/realtime/service";

/**
 * Realtime gegen echtes PostgreSQL mit zwei Instanzen.
 *
 * Jede Instanz besitzt einen eigenen Verbindungspool, einen eigenen
 * `LISTEN`-Kanal und eine eigene Dienstinstanz. Zustellung zwischen ihnen kann
 * ausschließlich über die Datenbank erfolgen — es gibt keinen gemeinsamen
 * Speicher, über den ein Ereignis sonst gelangen könnte.
 *
 * Ehrliche Grenze: Beide Instanzen laufen im selben Betriebssystemprozess.
 * Dieser Nachweis zeigt Zustellung, Reihenfolge, Persistenz und Tenant-Grenze
 * über getrennte Verbindungen. Er zeigt **nicht**, dass ein Prozessabsturz oder
 * ein Netzwerkausfall sauber verarbeitet wird.
 */

// `pg` wird wie in lib/server/db/pool.ts ueber createRequire geladen: das
// Projekt verzichtet bewusst auf @types/pg und beschreibt stattdessen genau die
// Teilmenge, die es benoetigt.
type PgClient = ListenConnection & { connect(): Promise<void> };
const requirePg = createRequire(import.meta.url);
const { Client } = requirePg("pg") as {
  Client: new (config: { connectionString: string }) => PgClient;
};

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = Boolean(ownerUrl && runtimeUrl);

class Sink implements RealtimeSink {
  readonly messages: RealtimeServerMessage[] = [];
  send(message: RealtimeServerMessage) { this.messages.push(structuredClone(message)); return true; }
}

/** Wartet, bis die Bedingung hält, statt auf eine feste Zeitspanne zu setzen. */
async function until(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition was not reached in time");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe.runIf(enabled)("Realtime PostgreSQL certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const scope: RealtimeScope = { organizationId, projectId, environment: "development" };
  const cursor = new RealtimeCursorCodec(Buffer.alloc(32, 5));

  let owner: SqlPool;
  const pools: SqlPool[] = [];
  const buses: PostgresRealtimeEventBus[] = [];

  const principal = (subject: string): RealtimePrincipal => ({
    organizationId, actorRef: `authenticated:${subject}`, role: "authenticated", subject,
  });

  /** Baut eine eigenstaendige Instanz: eigener Pool, eigener Bus, eigener Dienst. */
  async function instance(name: string, options: {
    presenceLeaseMs?: number;
    clock?: { now: Date };
  } = {}) {
    const pool = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: runtimeUrl!, max: 4 }), "runtime",
    );
    pools.push(pool);

    const bus = new PostgresRealtimeEventBus({
      origin: name,
      connect: async (): Promise<ListenConnection> => {
        const client = new Client({ connectionString: runtimeUrl! });
        await client.connect();
        return client;
      },
    });
    buses.push(bus);

    const controlPlane = new PostgresControlPlane(pool);
    const service = new RealtimeService({
      eventLog: new PostgresRealtimeEventLog(controlPlane),
      // Presence liegt seit 0077 in der Datenbank. Derselbe Pool, dieselbe
      // tenantgebundene Transaktion, dieselbe Rolle wie beim Log.
      presence: new PostgresRealtimePresenceStore(controlPlane),
      eventBus: bus,
      instanceId: name,
      authorization: new PrefixRealtimeAuthorization(),
      cursor,
      ...(options.presenceLeaseMs ? { presenceLeaseMs: options.presenceLeaseMs } : {}),
      // Die Uhr des Falls, nicht die der Wand: Eine Pacht, die man nicht
      // ablaufen lassen kann, ist keine.
      ...(options.clock ? { now: () => new Date(options.clock!.now) } : {}),
    });
    await bus.subscribe(
      (reference) => { void service.deliverRemote(reference); },
      (reference) => { void service.deliverRemotePresence(reference); },
    );
    return service;
  }

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [controlUser, `realtime-owner-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Realtime Integration', $2, $3)`,
    [organizationId, `realtime-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Realtime', $3, 'test', 'ready', $4)`,
    [projectId, organizationId, `realtime-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [organizationId, projectId, `managed:${projectId}`]);
  });

  afterAll(async () => {
    // Nichts wird geloescht: der Zertifizierungsstack ist ein Wegwerfcontainer,
    // und jede Ausfuehrung verwendet frische Bezeichner.
    await Promise.allSettled(buses.map((bus) => bus.close()));
    await Promise.allSettled([...pools.map((pool) => pool.end()), owner?.end()]);
  });

  it("delivers a broadcast to a subscriber on a second instance through PostgreSQL", async () => {
    const a = await instance(`a-${randomUUID().slice(0, 8)}`);
    const b = await instance(`b-${randomUUID().slice(0, 8)}`);
    const channel = `public:cross-${randomUUID().slice(0, 8)}`;

    const publisherSink = new Sink();
    const publisher = a.connect(scope, principal("publisher"), publisherSink);
    const readerSink = new Sink();
    const reader = b.connect(scope, principal("reader"), readerSink);

    await a.subscribe(publisher, "r1", channel);
    await b.subscribe(reader, "r2", channel);
    await a.broadcast(publisher, "r3", channel, "message", { text: "across" });

    await until(() => readerSink.messages.some((message) => message.type === "broadcast"));
    const received = readerSink.messages.filter((message) => message.type === "broadcast");
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ channel, event: "message", replay: false });
  });

  it("assigns one global sequence per channel across instances", async () => {
    const a = await instance(`a-${randomUUID().slice(0, 8)}`);
    const b = await instance(`b-${randomUUID().slice(0, 8)}`);
    const channel = `public:seq-${randomUUID().slice(0, 8)}`;

    const first = a.connect(scope, principal("first"), new Sink());
    const second = b.connect(scope, principal("second"), new Sink());
    await a.subscribe(first, "r1", channel);
    await b.subscribe(second, "r2", channel);

    // Beide Instanzen schreiben gleichzeitig. Die Sequenz darf sich nicht
    // wiederholen und keine Luecke lassen, sonst waere die Reihenfolge zwischen
    // Instanzen nicht definiert.
    await Promise.all([
      a.broadcast(first, "r3", channel, "tick", { from: "a" }),
      b.broadcast(second, "r4", channel, "tick", { from: "b" }),
      a.broadcast(first, "r5", channel, "tick", { from: "a" }),
      b.broadcast(second, "r6", channel, "tick", { from: "b" }),
    ]);

    const stored = await owner.query<{ sequence: string }>(
      `SELECT sequence FROM realtime_events
        WHERE organization_id=$1 AND project_id=$2 AND environment='development' AND channel=$3
        ORDER BY sequence`,
      [organizationId, projectId, channel],
    );
    expect(stored.rows.map((row) => Number(row.sequence))).toEqual([1, 2, 3, 4]);
  });

  it("keeps events after a restart of every instance", async () => {
    const a = await instance(`a-${randomUUID().slice(0, 8)}`);
    const channel = `public:durable-${randomUUID().slice(0, 8)}`;
    const publisher = a.connect(scope, principal("publisher"), new Sink());
    await a.subscribe(publisher, "r1", channel);
    await a.broadcast(publisher, "r2", channel, "message", { kept: true });

    // Ein frischer Dienst mit frischem Pool entspricht einem Neustart.
    const restarted = await instance(`restart-${randomUUID().slice(0, 8)}`);
    const readerSink = new Sink();
    const reader = restarted.connect(scope, principal("reader"), readerSink);
    await restarted.subscribe(reader, "r3", channel, cursor.encode(scope, channel, 0));

    const replayed = readerSink.messages.filter((message) => message.type === "broadcast");
    expect(replayed).toHaveLength(1);
    expect(replayed[0]).toMatchObject({ replay: true });
  });

  it("keeps the event log invisible to a different organization", async () => {
    const a = await instance(`a-${randomUUID().slice(0, 8)}`);
    const channel = `public:tenant-${randomUUID().slice(0, 8)}`;
    const publisher = a.connect(scope, principal("publisher"), new Sink());
    await a.subscribe(publisher, "r1", channel);
    await a.broadcast(publisher, "r2", channel, "message", { secret: true });

    const foreign = new PostgresRealtimeEventLog(
      new PostgresControlPlane(pools[pools.length - 1]),
    );
    const seen = await foreign.replay(
      { ...scope, organizationId: randomUUID() }, channel, 0, 10,
    );
    expect(seen.events).toEqual([]);
    expect(seen.latestSequence).toBe(0);
  });

  it("merges the presence of two instances and keeps it across a restart of the one that wrote it", async () => {
    // Presence lag bis zu diesem Slice in einer Map je Verbindung. Ein Abonnent
    // der zweiten Instanz erfuhr von den Abonnenten der ersten nichts, und ein
    // Neustart loeschte alles. Beides steht hier gegen echtes PostgreSQL.
    const a = await instance(`pres-a-${randomUUID().slice(0, 8)}`);
    const b = await instance(`pres-b-${randomUUID().slice(0, 8)}`);
    const channel = `public:presence-${randomUUID().slice(0, 8)}`;

    const aliceSink = new Sink();
    const alice = a.connect(scope, principal("alice"), aliceSink);
    await a.subscribe(alice, "r1", channel);
    await a.trackPresence(alice, "r2", channel, { seat: 1 });

    // Der Schnappschuss der zweiten Instanz traegt den Abonnenten der ersten.
    const bobSink = new Sink();
    const bob = b.connect(scope, principal("bob"), bobSink);
    await b.subscribe(bob, "r3", channel);
    const snapshot = bobSink.messages.filter((message) => message.type === "presence");
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({ channel, leaves: [] });
    expect(snapshot[0].type === "presence" && snapshot[0].joins.map((entry) => entry.state))
      .toEqual([{ seat: 1 }]);

    // Und der Beitritt in der zweiten erreicht die erste ueber `LISTEN`/`NOTIFY`.
    await b.trackPresence(bob, "r4", channel, { seat: 2 });
    await until(() => aliceSink.messages.some((message) => message.type === "presence"
      && message.joins.some((entry) => JSON.stringify(entry.state) === '{"seat":2}')));

    // Die Zeile liegt in der Tabelle, mit Pacht und ohne Subjekt im Klartext.
    const rows = await owner.query<{ presence_key: string; state: unknown; expires_at: Date }>(
      `SELECT presence_key, state, expires_at FROM realtime_presence
        WHERE organization_id=$1 AND project_id=$2 AND environment='development' AND channel=$3
        ORDER BY presence_key`,
      [organizationId, projectId, channel]);
    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows) {
      expect(row.presence_key.startsWith("qk_presence_")).toBe(true);
      expect(JSON.stringify(row)).not.toContain("alice");
      expect(JSON.stringify(row)).not.toContain("bob");
    }

    // Ein frischer Dienst mit frischem Pool entspricht einem Neustart. Er sieht
    // beide Eintraege, obwohl er keine der Verbindungen haelt.
    const restarted = await instance(`pres-r-${randomUUID().slice(0, 8)}`);
    const lateSink = new Sink();
    const late = restarted.connect(scope, principal("late"), lateSink);
    await restarted.subscribe(late, "r5", channel);
    const seen = lateSink.messages.filter((message) => message.type === "presence");
    expect(seen[0]?.type === "presence" && seen[0].joins).toHaveLength(2);
  });

  it("lets the presence of a connection that vanished without a goodbye expire, reports the leave and removes the row a grace later", async () => {
    // **Die Frage, die dauerhafte Presence stellt.** Ein Eintrag, der ewig
    // bliebe, zeigte Leute an, die nicht da sind, und das ist schlimmer als keine
    // Presence.
    const leaseMs = 30_000;
    const clock = { now: new Date() };
    const ghostInstance = await instance(`ghost-${randomUUID().slice(0, 8)}`, {
      presenceLeaseMs: leaseMs, clock,
    });
    const watcherInstance = await instance(`watch-${randomUUID().slice(0, 8)}`, {
      presenceLeaseMs: leaseMs, clock,
    });
    const channel = `public:ghost-${randomUUID().slice(0, 8)}`;

    const ghost = ghostInstance.connect(scope, principal("ghost"), new Sink());
    await ghostInstance.subscribe(ghost, "r1", channel);
    await ghostInstance.trackPresence(ghost, "r2", channel, { online: true });

    const watcherSink = new Sink();
    const watcher = watcherInstance.connect(scope, principal("watcher"), watcherSink);
    await watcherInstance.subscribe(watcher, "r3", channel);
    expect(watcherSink.messages.filter((message) => message.type === "presence")).toHaveLength(1);

    // Die Instanz, die die Verbindung hielt, antwortet nicht mehr. Nur die Uhr
    // laeuft weiter -- es gibt kein `disconnect`, denn das waere eine Abmeldung.
    clock.now = new Date(clock.now.getTime() + leaseMs + 5_000);

    // Der Takt der ueberlebenden Instanz sammelt die Waise ein.
    await watcherInstance.sweepPresence();
    const leave = watcherSink.messages.filter((message) => message.type === "presence").at(-1);
    expect(leave?.type === "presence" && leave.joins).toEqual([]);
    expect(leave?.type === "presence" && leave.leaves).toHaveLength(1);

    // Die Zeile steht noch -- und zaehlt trotzdem fuer niemanden. Zwei Stufen,
    // und beide noetig: Ohne die erste gaebe es ein Fenster, in dem Abwesende als
    // anwesend gelten, ohne die zweite lebte die Tabelle von Waisen.
    const before = await owner.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM realtime_presence
        WHERE organization_id=$1 AND channel=$2`, [organizationId, channel]);
    expect(Number(before.rows[0].count)).toBe(1);

    const presenceStore = new PostgresRealtimePresenceStore(
      new PostgresControlPlane(pools[pools.length - 1]),
    );
    const sweep = () => new RealtimeRetentionRuntime({
      eventLog: { async prune() { return 0; } },
      presence: presenceStore,
      scopes: [scope],
      eventRetentionMs: 60_000,
      changeRetentionMs: 60_000,
      presenceRetentionMs: 600_000,
      now: () => new Date(clock.now),
    }).runOnce();

    // Innerhalb der Frist bleibt sie liegen.
    await expect(sweep()).resolves.toMatchObject({ presence: 0 });
    // Eine Frist spaeter ist sie weg. Gezaehlt wird mindestens eine, weil der
    // Aufraeumer je Scope arbeitet und die Eintraege der anderen Faelle dieser
    // Datei im selben Scope liegen; welche Zeile verschwunden ist, sagt die
    // Zaehlung je Kanal darunter.
    clock.now = new Date(clock.now.getTime() + 600_000);
    const swept = await sweep();
    expect(swept.presence).toBeGreaterThanOrEqual(1);

    const after = await owner.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM realtime_presence
        WHERE organization_id=$1 AND channel=$2`, [organizationId, channel]);
    expect(Number(after.rows[0].count)).toBe(0);
  });

  it("refuses to change a stored event", async () => {
    const a = await instance(`a-${randomUUID().slice(0, 8)}`);
    const channel = `public:immutable-${randomUUID().slice(0, 8)}`;
    const publisher = a.connect(scope, principal("publisher"), new Sink());
    await a.subscribe(publisher, "r1", channel);
    await a.broadcast(publisher, "r2", channel, "message", { original: true });

    await expect(owner.query(
      `UPDATE realtime_events SET event='tampered'
        WHERE organization_id=$1 AND channel=$2`, [organizationId, channel],
    )).rejects.toMatchObject({ message: expect.stringContaining("append-only") });
  });
});

/**
 * Aufbewahrung gegen echtes PostgreSQL.
 *
 * Der `prune`-Pfad existiert seit Release 1.11 und hatte bis 1.36 **keinen
 * Aufrufer**. Der Log wuchs damit unbegrenzt. Gemessen wird hier nicht der
 * Pfad, sondern seine Wirkung: Was alt ist, verschwindet; was jung ist und was
 * einem anderen Tenant gehoert, bleibt.
 */
describe.runIf(enabled)("Realtime retention PostgreSQL certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const otherOrganizationId = randomUUID();
  const otherProjectId = randomUUID();
  const scope: RealtimeScope = { organizationId, projectId, environment: "development" };

  let owner: SqlPool;
  let runtimePool: SqlPool;
  let eventLog: PostgresRealtimeEventLog;

  async function project(organization: string, project: string, label: string) {
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [organization, label, `${label}-${organization}`, controlUser]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, $3, $4, 'test', 'ready', $5)`,
    [project, organization, label, `${label}-${project}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [organization, project, `managed:${project}`]);
  }

  async function event(organization: string, project: string, sequence: number, ageDays: number) {
    await owner.query(`INSERT INTO realtime_events
      (organization_id, project_id, environment, channel, sequence, event, payload, actor_role, created_at)
      VALUES ($1,$2,'development','retention',$3,'probe','{}','service_role', now() - ($4 || ' days')::interval)`,
    [organization, project, sequence, String(ageDays)]);
  }

  async function remaining(organization: string, project: string) {
    const result = await owner.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM realtime_events
        WHERE organization_id=$1 AND project_id=$2`, [organization, project],
    );
    return Number(result.rows[0].count);
  }

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    runtimePool = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: runtimeUrl!, max: 4 }), "runtime",
    );
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [controlUser, `retention-owner-${controlUser}@qkern.test`]);
    await project(organizationId, projectId, "Retention");
    await project(otherOrganizationId, otherProjectId, "Retention Other");
    eventLog = new PostgresRealtimeEventLog(new PostgresControlPlane(runtimePool));
  });

  afterAll(async () => {
    await Promise.allSettled([owner?.end(), runtimePool?.end()]);
  });

  it("removes what is old and keeps what is not", async () => {
    await event(organizationId, projectId, 1, 30);
    await event(organizationId, projectId, 2, 10);
    await event(organizationId, projectId, 3, 1);

    const runtime = new RealtimeRetentionRuntime({
      eventLog,
      scopes: [scope],
      eventRetentionMs: 7 * 86_400_000,
      changeRetentionMs: 86_400_000,
    });
    await expect(runtime.runOnce()).resolves.toMatchObject({ events: 2 });
    expect(await remaining(organizationId, projectId)).toBe(1);
  });

  it("never reaches into another tenant", async () => {
    // Die Runtime-Rolle sieht durch RLS nur die eigene Organisation. Ein
    // Aufraeumer, der das nicht einhaelt, waere ein Cross-Tenant-Loeschen.
    await event(otherOrganizationId, otherProjectId, 1, 30);

    const runtime = new RealtimeRetentionRuntime({
      eventLog,
      scopes: [scope],
      eventRetentionMs: 60_000,
      changeRetentionMs: 60_000,
    });
    await runtime.runOnce();
    expect(await remaining(otherOrganizationId, otherProjectId)).toBe(1);
  });
});
