import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CronDispatcher, cronOccurrenceDedupeKey } from "@/lib/server/compute/cron";
import { PostgresCronRepository } from "@/lib/server/compute/cron-postgres-repository";
import { CronScheduler } from "@/lib/server/compute/cron-scheduler";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import { PostgresProjectQueueRepository } from "@/lib/server/project-queues/postgres-repository";
import { ProjectQueueService, projectQueueDedupeKeyHash } from "@/lib/server/project-queues/service";

/**
 * Cron gegen echtes PostgreSQL, bis in die Queue hinein.
 *
 * Der Nachweis fährt die ganze Kette: persistierte Definition → Scheduler →
 * Dispatcher → Queue. Entscheidend ist der Fall, in dem zwei Scheduler
 * dasselbe Vorkommen auslösen: Es darf genau eine Nachricht entstehen, und
 * zwar ohne Lease — allein über den Occurrence-Dedupe-Key der Queue.
 */

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = Boolean(ownerUrl && runtimeUrl);

describe.runIf(enabled)("Cron PostgreSQL certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const scope = { organizationId, projectId, environment: "development" as const };
  const admin: ProjectQueuePrincipal = {
    organizationId, actorRef: "cron-owner@qkern.test", role: "admin", subject: controlUser,
  };
  const service: ProjectQueuePrincipal = {
    organizationId, actorRef: "service-role:cron", role: "service_role", subject: "cron",
  };

  let owner: SqlPool;
  const pools: SqlPool[] = [];

  function instance() {
    const pool = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: runtimeUrl!, max: 4 }), "runtime",
    );
    pools.push(pool);
    const plane = new PostgresControlPlane(pool);
    const queues = new ProjectQueueService({
      repository: new PostgresProjectQueueRepository(plane),
    });
    return {
      queues,
      repository: new PostgresCronRepository(plane),
      dispatcher: new CronDispatcher(queues),
    };
  }

  async function defineCron(
    queue: string, expression: string, lastDispatchedAt: Date | null, timeZone?: string,
  ) {
    const id = randomUUID();
    // Ohne Zeitzone wie jede Definition von vor 2.66: Die Spalte bekommt den
    // Vorgabewert der Migration 0066, und der Fall prueft damit auch den.
    await owner.query(
      timeZone === undefined
        ? `INSERT INTO project_cron_definitions
             (id, organization_id, project_id, environment, name, expression, queue, payload,
              last_dispatched_at)
           VALUES ($1,$2,$3,'development',$4,$5,$6,$7,$8)`
        : `INSERT INTO project_cron_definitions
             (id, organization_id, project_id, environment, name, expression, queue, payload,
              last_dispatched_at, time_zone)
           VALUES ($1,$2,$3,'development',$4,$5,$6,$7,$8,$9)`,
      [id, organizationId, projectId, `cron-${id.slice(0, 8)}`, expression, queue,
        { task: "run" }, lastDispatchedAt, ...(timeZone === undefined ? [] : [timeZone])],
    );
    return id;
  }

  async function messageCount(queue: string) {
    const messages = await owner.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM project_queue_messages
        WHERE organization_id=$1 AND queue_id=(SELECT id FROM project_queues
          WHERE organization_id=$1 AND name=$2)`,
      [organizationId, queue],
    );
    return messages.rows[0]?.count ?? 0;
  }

  async function progressOf(id: string) {
    const progress = await owner.query<{ last_dispatched_at: Date; time_zone: string }>(
      "SELECT last_dispatched_at, time_zone FROM project_cron_definitions WHERE id=$1", [id],
    );
    return {
      lastDispatchedAt: new Date(progress.rows[0].last_dispatched_at).toISOString(),
      timeZone: progress.rows[0].time_zone,
    };
  }

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [controlUser, `cron-owner-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Cron Integration', $2, $3)`,
    [organizationId, `cron-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Cron', $3, 'test', 'ready', $4)`,
    [projectId, organizationId, `cron-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [organizationId, projectId, `managed:${projectId}`]);
  });

  afterAll(async () => {
    await Promise.allSettled([...pools.map((pool) => pool.end()), owner?.end()]);
  });

  it("dispatches a due occurrence into the queue and advances the progress", async () => {
    const node = instance();
    const queue = `cron-jobs-${randomUUID().slice(0, 8)}`;
    await node.queues.createQueue(admin, scope, { name: queue, dedupeWindowSeconds: 3600 });

    const boundary = new Date("2026-08-04T12:05:00.000Z");
    const id = await defineCron(queue, "*/5 * * * *", new Date("2026-08-04T12:00:00.000Z"));

    const scheduler = new CronScheduler({
      repository: node.repository, dispatcher: node.dispatcher,
      now: () => new Date("2026-08-04T12:06:00.000Z"),
    });
    const result = await scheduler.run(service, scope);
    expect(result.dispatched).toBeGreaterThanOrEqual(1);

    const progress = await owner.query<{ last_dispatched_at: Date }>(
      "SELECT last_dispatched_at FROM project_cron_definitions WHERE id=$1", [id],
    );
    expect(new Date(progress.rows[0].last_dispatched_at).toISOString())
      .toBe(boundary.toISOString());

    const messages = await owner.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM project_queue_messages
        WHERE organization_id=$1 AND queue_id=(SELECT id FROM project_queues
          WHERE organization_id=$1 AND name=$2)`,
      [organizationId, queue],
    );
    expect(messages.rows[0]?.count).toBe(1);
  });

  /**
   * Die volle Cron-Grammatik (1.87) durch Scheduler, Datenbankfortschritt und
   * Queue: "0,30 6-8 * * 1-5" am Dienstag, 4. August 2026, Fortschritt 06:00,
   * jetzt 06:31 -> genau das 06:30-Vorkommen wird versendet, 07:00 noch nicht.
   * Die Mutationsprobe nimmt die Bereichsform `a-b` — dann ist der Ausdruck
   * unlesbar, und dieser Fall faellt zusammen mit seinem lokalen Zwilling.
   */
  it("dispatches a list-range-weekday expression through the real progress", async () => {
    const node = instance();
    const queue = `cron-grammar-${randomUUID().slice(0, 8)}`;
    await node.queues.createQueue(admin, scope, { name: queue, dedupeWindowSeconds: 3600 });
    const id = await defineCron(queue, "0,30 6-8 * * 1-5", new Date("2026-08-04T06:00:00.000Z"));
    const scheduler = new CronScheduler({
      repository: node.repository, dispatcher: node.dispatcher,
      now: () => new Date("2026-08-04T06:31:00.000Z"),
    });
    const result = await scheduler.run(service, scope);
    expect(result.dispatched).toBeGreaterThanOrEqual(1);
    const progress = await owner.query<{ last_dispatched_at: Date }>(
      "SELECT last_dispatched_at FROM project_cron_definitions WHERE id=$1", [id],
    );
    expect(new Date(progress.rows[0].last_dispatched_at).toISOString()).toBe("2026-08-04T06:30:00.000Z");
    const messages = await owner.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM project_queue_messages
        WHERE organization_id=$1 AND queue_id=(SELECT id FROM project_queues
          WHERE organization_id=$1 AND name=$2)`,
      [organizationId, queue],
    );
    expect(messages.rows[0]?.count).toBe(1);
  });

  /**
   * Namen und Kuerzel (2.66) durch Scheduler, Datenbankfortschritt und Queue.
   * "30 6 * * MON-FRI" am Montag, 3. August 2026, Fortschritt 06:00, jetzt
   * 06:31 -> genau das 06:30-Vorkommen; "30 6 * * SAT,SUN" mit Fortschritt
   * Sonntag 06:30 -> nichts, der naechste Termin ist Samstag; "@hourly" mit
   * Fortschritt 05:00 -> genau 06:00. Die Zeilen tragen dabei den Vorgabewert
   * `UTC`, denn sie wurden ohne Zeitzone angelegt, wie jede Definition von
   * vor 2.66. Die Mutationsprobe verschiebt jeden Wochentagsnamen um eins;
   * dann ist Montag kein Werktag mehr und zugleich ein Wochenendtag, und
   * dieser Fall faellt an beiden Plaenen, zusammen mit seinem lokalen Zwilling.
   */
  it("dispatches a weekday-name expression and an @ shortcut through the real progress", async () => {
    const node = instance();
    const queue = `cron-names-${randomUUID().slice(0, 8)}`;
    await node.queues.createQueue(admin, scope, { name: queue, dedupeWindowSeconds: 3600 });
    const weekdays = await defineCron(queue, "30 6 * * MON-FRI", new Date("2026-08-03T06:00:00.000Z"));
    const weekend = await defineCron(queue, "30 6 * * SAT,SUN", new Date("2026-08-02T06:30:00.000Z"));
    const hourly = await defineCron(queue, "@hourly", new Date("2026-08-03T05:00:00.000Z"));

    const scheduler = new CronScheduler({
      repository: node.repository, dispatcher: node.dispatcher,
      now: () => new Date("2026-08-03T06:31:00.000Z"),
    });
    const result = await scheduler.run(service, scope);
    expect(result.failed).toBe(0);
    expect(await progressOf(weekdays)).toEqual({ lastDispatchedAt: "2026-08-03T06:30:00.000Z", timeZone: "UTC" });
    expect(await progressOf(weekend)).toEqual({ lastDispatchedAt: "2026-08-02T06:30:00.000Z", timeZone: "UTC" });
    expect(await progressOf(hourly)).toEqual({ lastDispatchedAt: "2026-08-03T06:00:00.000Z", timeZone: "UTC" });
    // Zwei Nachrichten: 06:30 vom Werktagsplan, 06:00 vom Stundenplan.
    expect(await messageCount(queue)).toBe(2);
  });

  /**
   * Eine Zeitzone je Zeitplan (2.66) durch Scheduler, Datenbank und Queue, am
   * Tag des Sommerzeitbeginns. "30 2 * * *" in Europe/Berlin, Fortschritt am
   * 28. Maerz 2026 um 02:30 Berlin (01:30Z), jetzt 29. Maerz 01:05Z: Die 02:30
   * dieses Tages gibt es nicht, die Uhr springt um 01:00Z von 02:00 auf 03:00,
   * und genau in diesem Moment feuert der Plan. Der Dedupe-Schluessel in der
   * Queue traegt diesen UTC-Moment. Die Mutationsprobe laesst die Zeitzone
   * ungelesen; dann rechnet der Plan 02:30Z, das ist noch nicht faellig, und
   * der Fall faellt.
   */
  it("dispatches a zoned schedule through the real progress across the missing hour", async () => {
    const node = instance();
    const queue = `cron-zone-${randomUUID().slice(0, 8)}`;
    await node.queues.createQueue(admin, scope, { name: queue, dedupeWindowSeconds: 3600 });
    const id = await defineCron(queue, "30 2 * * *", new Date("2026-03-28T01:30:00.000Z"), "Europe/Berlin");

    const scheduler = new CronScheduler({
      repository: node.repository, dispatcher: node.dispatcher,
      now: () => new Date("2026-03-29T01:05:00.000Z"),
    });
    const result = await scheduler.run(service, scope);
    expect(result.failed).toBe(0);
    expect(result.dispatched).toBe(1);
    expect(await progressOf(id)).toEqual({ lastDispatchedAt: "2026-03-29T01:00:00.000Z", timeZone: "Europe/Berlin" });
    expect(await messageCount(queue)).toBe(1);

    // Die Nachricht ist ueber den Schluessel des UTC-Moments wiederzufinden.
    const verifier = projectQueueDedupeKeyHash(cronOccurrenceDedupeKey(id, new Date("2026-03-29T01:00:00.000Z")));
    const found = await owner.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM project_queue_messages
        WHERE organization_id=$1 AND dedupe_key_hash=$2`, [organizationId, verifier],
    );
    expect(found.rows[0]?.count).toBe(1);

    // Ein zweiter Lauf am naechsten Tag: 02:30 Sommerzeit ist 00:30Z, nicht 01:30Z.
    const nextDay = new CronScheduler({
      repository: node.repository, dispatcher: node.dispatcher,
      now: () => new Date("2026-03-30T00:31:00.000Z"),
    });
    expect((await nextDay.run(service, scope)).failed).toBe(0);
    expect((await progressOf(id)).lastDispatchedAt).toBe("2026-03-30T00:30:00.000Z");
    expect(await messageCount(queue)).toBe(2);
  });

  /**
   * Die Sonderformen (2.66, Schritt d) durch Scheduler, Datenbank und Queue:
   * "0 6 L * *" am 31. August 2026, Fortschritt am 31. Juli, jetzt 31. August
   * 06:01 -> genau das Vorkommen am Monatsletzten; "0 6 * * FRI#3" mit
   * Fortschritt am 17. Juli (dritter Freitag) -> der 21. August, also am 31.
   * laengst faellig und nachgeholt; "0 6 15W * *" mit Fortschritt am 15. Juli
   * (Mittwoch) -> der 14. August, denn der 15. ist ein Samstag.
   */
  it("dispatches L, # and W schedules through the real progress", async () => {
    const node = instance();
    const queue = `cron-special-${randomUUID().slice(0, 8)}`;
    await node.queues.createQueue(admin, scope, { name: queue, dedupeWindowSeconds: 3600 });
    const last = await defineCron(queue, "0 6 L * *", new Date("2026-07-31T06:00:00.000Z"));
    const third = await defineCron(queue, "0 6 * * FRI#3", new Date("2026-07-17T06:00:00.000Z"));
    const nearest = await defineCron(queue, "0 6 15W * *", new Date("2026-07-15T06:00:00.000Z"));

    const scheduler = new CronScheduler({
      repository: node.repository, dispatcher: node.dispatcher,
      now: () => new Date("2026-08-31T06:01:00.000Z"),
    });
    const result = await scheduler.run(service, scope);
    expect(result.failed).toBe(0);
    expect((await progressOf(last)).lastDispatchedAt).toBe("2026-08-31T06:00:00.000Z");
    expect((await progressOf(third)).lastDispatchedAt).toBe("2026-08-21T06:00:00.000Z");
    expect((await progressOf(nearest)).lastDispatchedAt).toBe("2026-08-14T06:00:00.000Z");
    expect(await messageCount(queue)).toBe(3);
  });

  it("produces exactly one message when two schedulers fire the same occurrence", async () => {
    // Der eigentliche Pruefpunkt: Einmaligkeit ohne Lease, allein ueber den
    // Occurrence-Dedupe-Key der Queue.
    const setup = instance();
    const queue = `cron-race-${randomUUID().slice(0, 8)}`;
    await setup.queues.createQueue(admin, scope, { name: queue, dedupeWindowSeconds: 3600 });
    await defineCron(queue, "*/5 * * * *", new Date("2026-08-04T12:00:00.000Z"));

    const schedulers = Array.from({ length: 4 }, () => {
      const node = instance();
      return new CronScheduler({
        repository: node.repository, dispatcher: node.dispatcher,
        onError: () => undefined,
        now: () => new Date("2026-08-04T12:06:00.000Z"),
      });
    });

    await Promise.all(schedulers.map((scheduler) => scheduler.run(service, scope)));

    const messages = await owner.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM project_queue_messages
        WHERE organization_id=$1 AND queue_id=(SELECT id FROM project_queues
          WHERE organization_id=$1 AND name=$2)`,
      [organizationId, queue],
    );
    expect(messages.rows[0]?.count).toBe(1);
  });

  it("refuses progress that moves backwards", async () => {
    // Ein Ruecksprung wuerde vergangene Vorkommen erneut ausloesen.
    const queue = `cron-back-${randomUUID().slice(0, 8)}`;
    const id = await defineCron(queue, "*/5 * * * *", new Date("2026-08-04T12:05:00.000Z"));

    await expect(owner.query(
      "UPDATE project_cron_definitions SET last_dispatched_at=$2 WHERE id=$1",
      [id, new Date("2026-08-04T11:00:00.000Z")],
    )).rejects.toMatchObject({ message: expect.stringContaining("must not move backwards") });
  });

  it("keeps the identity of a definition immutable", async () => {
    const queue = `cron-id-${randomUUID().slice(0, 8)}`;
    const id = await defineCron(queue, "*/5 * * * *", null);

    await expect(owner.query(
      "UPDATE project_cron_definitions SET project_id=$2 WHERE id=$1", [id, randomUUID()],
    )).rejects.toMatchObject({ message: expect.stringContaining("identity is immutable") });
  });

  it("hides definitions of a different organization", async () => {
    const queue = `cron-tenant-${randomUUID().slice(0, 8)}`;
    await defineCron(queue, "*/5 * * * *", null);

    const node = instance();
    const foreign = await node.repository.listActive(
      { ...service, organizationId: randomUUID() },
      { ...scope, organizationId: randomUUID() },
    );
    expect(foreign).toEqual([]);
  });

  /**
   * Derselbe Weg, aber gestartet wie im Betrieb: als eigener Prozess.
   *
   * Release 1.44 hat gefunden, dass **keiner** der sieben Worker starten konnte,
   * und dabei offen gelassen, dass nur der Queue-Wirt einen Lauf hat, der ihn
   * arbeiten sieht. Die anderen sechs erreichten ihre Konfigurationsgrenze —
   * mehr wusste niemand.
   *
   * Dieser Fall holt den groessten davon nach. Gestartet wird nichts
   * nachgebaut, sondern die Datei hinter `npm run worker:compute`, und gemessen
   * wird die Wirkung in der Datenbank: Ein faelliges Vorkommen wird zu einer
   * Nachricht, ohne dass dieser Test einen Scheduler anfasst.
   */
  it("dispatches from the shipped process", async () => {
    const node = instance();
    const queue = `cron-process-${randomUUID().slice(0, 8)}`;
    await node.queues.createQueue(admin, scope, { name: queue, dedupeWindowSeconds: 3600 });
    // Drei Minuten Rueckstand auf einen Minutentakt: Der Prozess hat etwas
    // nachzuholen, sobald er laeuft, und muss dafuer nicht auf den naechsten
    // Takt warten.
    await defineCron(queue, "*/1 * * * *", new Date(Date.now() - 180_000));

    const child = spawn(process.execPath, ["--import", "tsx", "workers/compute-runtime.mts"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        QKERN_COMPUTE_RUNTIME_ENABLED: "true",
        QKERN_COMPUTE_CRON_ENABLED: "true",
        // Ohne Signaturschluessel wuerde der Zusteller den Start verweigern —
        // zu Recht. Hier steht Cron auf dem Pruefstand, nicht die Zustellung.
        QKERN_COMPUTE_WEBHOOKS_ENABLED: "false",
        QKERN_COMPUTE_CRON_INTERVAL_MS: "1000",
        QKERN_COMPUTE_SCOPES_JSON: JSON.stringify([scope]),
        QKERN_PROJECT_QUEUES_ENABLED: "true",
        QKERN_RUNTIME_MODE: "postgres",
        QKERN_STATEMENT_ENCRYPTION_KEY: "0".repeat(64),
        QKERN_RUNTIME_DATABASE_URL: runtimeUrl!,
        // Hier steht Cron auf dem Pruefstand. Der Aufraeumer aus 2.89 braucht
        // die Auth-Verbindung, und dieser Stack reicht dem Fall keine; er wird
        // darum ausdruecklich abgeschaltet, statt den Prozess am Start zu
        // hindern.
        QKERN_COMPUTE_AUTH_RETENTION_ENABLED: "false",
      },
    });
    let noise = "";
    child.stderr.on("data", (chunk: Buffer) => { noise += chunk.toString(); });
    child.stdout.on("data", (chunk: Buffer) => { noise += chunk.toString(); });

    try {
      const deadline = Date.now() + 100_000;
      let count = 0;
      while (Date.now() < deadline && count === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const messages = await owner.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM project_queue_messages
            WHERE organization_id=$1 AND queue_id=(SELECT id FROM project_queues
              WHERE organization_id=$1 AND name=$2)`,
          [organizationId, queue],
        );
        count = messages.rows[0]?.count ?? 0;
      }
      expect(count, `Prozessausgabe: ${noise.slice(-800)}`).toBeGreaterThanOrEqual(1);

      // Der Prozess meldet seine Arbeit: welcher Scope, wie viele Vorkommen.
      // Bis Release 1.53 bot seine Komposition gar keine Naht — nach der
      // Startzeile kam nichts mehr.
      //
      // Gewartet wird auf die Meldung, nicht auf einen Moment: Die Nachricht
      // steht in der Datenbank, bevor die Runde zu Ende ist, und wer sofort
      // nachsieht, misst den Wettlauf statt die Zusage.
      const logDeadline = Date.now() + 20_000;
      while (Date.now() < logDeadline && !noise.includes("compute.cron_round")) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(noise).toContain("compute.cron_round");
      expect(noise).toMatch(/"dispatched":[1-9]/);
    } finally {
      child.kill();
    }

    // Der Prozess meldet die Zahl seiner Scopes und sonst nichts aus der
    // Konfiguration. Ein Passwort in einem Worker-Log ueberlebt jede Rotation.
    expect(noise).toContain("scope(s)");
    expect(noise).not.toContain("qkern_runtime_local_only");
    expect(noise).not.toContain(projectId);
  }, 180_000);

  /**
   * Die Probe sagt, ob es klemmt — und sonst nichts.
   *
   * `createLoopbackRuntimeProbeFromEnv` gab es seit Alpha 1, und kein Prozess
   * hat sie je gestartet: Vier Kompositionen reichten einen `probe` durch, den
   * niemand erzeugte. Der Erreichbarkeitsvertrag aus 1.42 hat das nicht
   * gesehen, weil das Modul importiert war — nur die Fabrik rief niemand.
   *
   * Release 1.45 hat eine Stunde gekostet, weil eine Schleife, die jede
   * Sekunde scheitert, von einer untaetigen nicht zu unterscheiden war.
   */
  function computeProcess(port: number, extra: Record<string, string> = {}) {
    const child = spawn(process.execPath, ["--import", "tsx", "workers/compute-runtime.mts"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        QKERN_COMPUTE_RUNTIME_ENABLED: "true",
        QKERN_COMPUTE_CRON_ENABLED: "true",
        QKERN_COMPUTE_WEBHOOKS_ENABLED: "false",
        QKERN_COMPUTE_CRON_INTERVAL_MS: "1000",
        QKERN_PROJECT_QUEUES_ENABLED: "true",
        QKERN_RUNTIME_MODE: "postgres",
        QKERN_STATEMENT_ENCRYPTION_KEY: "0".repeat(64),
        QKERN_RUNTIME_DATABASE_URL: runtimeUrl!,
        QKERN_RUNTIME_PROBE_ENABLED: "true",
        QKERN_RUNTIME_PROBE_PORT: String(port),
        // Wie oben: Der Aufraeumer aus 2.89 braucht die Auth-Verbindung, und
        // dieser Fall misst die Probe.
        QKERN_COMPUTE_AUTH_RETENTION_ENABLED: "false",
        ...extra,
      },
    });
    let noise = "";
    child.stderr.on("data", (chunk: Buffer) => { noise += chunk.toString(); });
    child.stdout.on("data", (chunk: Buffer) => { noise += chunk.toString(); });
    return { child, output: () => noise };
  }

  /**
   * Ein eigenes Projekt je Probe-Fall.
   *
   * Der Prozess bedient einen ganzen Scope, nicht eine Definition. Teilten
   * sich zwei Faelle ein Projekt, saehe der eine die Definitionen des anderen —
   * und „bereit" haette nichts mehr mit dem zu tun, was der Fall aufgebaut hat.
   * Genau daran ist der erste Anlauf gescheitert.
   */
  async function freshProject() {
    const id = randomUUID();
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Cron Probe', $3, 'test', 'ready', $4)`,
    [id, organizationId, `cron-probe-${id}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [organizationId, id, `managed:${id}`]);
    return { organizationId, projectId: id, environment: "development" as const };
  }

  async function defineCronIn(
    target: { projectId: string }, queue: string, expression: string, lastDispatchedAt: Date,
  ) {
    const id = randomUUID();
    await owner.query(
      `INSERT INTO project_cron_definitions
         (id, organization_id, project_id, environment, name, expression, queue, payload,
          last_dispatched_at)
       VALUES ($1,$2,$3,'development',$4,$5,$6,$7,$8)`,
      [id, organizationId, target.projectId, `cron-${id.slice(0, 8)}`, expression, queue,
        { task: "run" }, lastDispatchedAt],
    );
  }

  /** Wartet, bis `/ready` den erwarteten Status meldet — oder gibt auf. */
  async function readyBecomes(port: number, expected: number, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    let last = 0;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        const response = await fetch(`http://127.0.0.1:${port}/ready`);
        last = response.status;
        if (last === expected) return { status: last, body: await response.text() };
      } catch { last = 0; }
    }
    return { status: last, body: "" };
  }

  it("reports ready while the cron loop is doing its rounds", async () => {
    const node = instance();
    const own = await freshProject();
    const queue = `probe-ok-${randomUUID().slice(0, 8)}`;
    await node.queues.createQueue(admin, own, { name: queue, dedupeWindowSeconds: 3600 });
    await defineCronIn(own, queue, "*/1 * * * *", new Date(Date.now() - 120_000));

    const port = 9471;
    const process_ = computeProcess(port, { QKERN_COMPUTE_SCOPES_JSON: JSON.stringify([own]) });
    try {
      const ready = await readyBecomes(port, 200);
      expect(ready.status, `Prozessausgabe: ${process_.output().slice(-600)}`).toBe(200);
      expect(ready.body.trim()).toBe("ready");
    } finally {
      process_.child.kill();
    }
  }, 120_000);

  it("stops reporting ready when every definition fails", async () => {
    const node = instance();
    const own = await freshProject();
    const queue = `probe-bad-${randomUUID().slice(0, 8)}`;
    await node.queues.createQueue(admin, own, { name: queue, dedupeWindowSeconds: 3600 });
    // Eine Stunde 24 gibt es nicht. Der Definitionsdienst wiese das ab; ein
    // direkter INSERT nicht (der DB-CHECK prueft nur die Laenge) — und genau
    // so entstand der Zustand, den 1.45 nur durch Handarbeit sichtbar machen
    // konnte. Bis 1.86 stand hier `* * * * *`; seit der vollen Grammatik in
    // 1.87 ist das gueltig, die Definition lief erfolgreich, und der Fall
    // bestand nur noch, wenn die Probe das anfaengliche 503 vor der ersten
    // Runde erwischte — die Mutationsprobe von 1.87 hat das aufgedeckt.
    await defineCronIn(own, queue, "0 24 * * *", new Date(Date.now() - 120_000));

    const port = 9472;
    const process_ = computeProcess(port, { QKERN_COMPUTE_SCOPES_JSON: JSON.stringify([own]) });
    try {
      const ready = await readyBecomes(port, 503);
      expect(ready.status, `Prozessausgabe: ${process_.output().slice(-600)}`).toBe(503);
      // Die Antwort sagt, dass es klemmt — nicht woran. Ein Ausdruck, ein
      // Projekt oder eine Datenbankmeldung an dieser Stelle waere ein Leck.
      expect(ready.body.trim()).toBe("not ready");
      expect(ready.body).not.toContain("*");
      expect(process_.output()).not.toContain(own.projectId);
      expect(process_.output()).not.toContain("qkern_runtime_local_only");
      expect(process_.output()).not.toContain("cron expression");
    } finally {
      process_.child.kill();
    }
  }, 120_000);
});
