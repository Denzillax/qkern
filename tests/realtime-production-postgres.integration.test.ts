import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createPostgresPool } from "@/lib/server/db/pool";
import { hashProjectApiKey } from "@/lib/server/project-api-keys/service";
import { QKERN_REALTIME_PROTOCOL } from "@/lib/server/realtime/websocket-server";
import type { RealtimeServerMessage } from "@/lib/server/realtime/model";
import type { SqlPool } from "@/lib/server/db/sql";

/**
 * Der Production-Start von Realtime gegen echtes TLS-PostgreSQL.
 *
 * `docs/PARITAET.md` nannte in der Realtime-Zeile seit Langem dieselbe Luecke:
 * ein belegter Production-Start gegen SSL-PostgreSQL. Seit `1.73.0` steht im
 * Produkt ein Tor mit benannten Bedingungen statt eines pauschalen Verbots
 * (`lib/server/realtime/production-gate.ts`), und `tests/realtime-process-
 * postgres.integration.test.ts` belegt seither, dass eine verletzte Bedingung
 * den Start verweigert. Was nie belegt war: dass der Prozess unter
 * `NODE_ENV=production` mit **erfuellten** Bedingungen wirklich anlaeuft, und
 * dass die Verbindung dabei wirklich prueft, mit wem sie spricht.
 *
 * Dieser Fall laeuft ausschliesslich im Stack
 * `docker-compose.realtime-certification.yml`. Dessen PostgreSQL weist jede
 * Verbindung ohne TLS ab (`db/docker/realtime-pg_hba.conf`), und sein
 * Serverzertifikat kommt aus einer eigenen CA. Damit sind beide Haelften von
 * `sslmode=verify-full` pruefbar, und zwar gegen den Server statt gegen die
 * Konfiguration:
 *
 * - **Kette**: Ohne Vertrauensanker kommt der Prozess nicht hoch.
 * - **Hostname**: Ueber `127.0.0.1` statt `postgres.qkern.test` kommt er nicht
 *   hoch, obwohl derselbe Anker vorliegt und der Server dieselbe Zeile in
 *   `pg_hba.conf` erlaubt.
 * - **Nachgelesen**: `pg_stat_ssl` sagt fuer jede Verbindung des Prozesses,
 *   dass sie verschluesselt ist, und nennt Version und Cipher.
 *
 * Gefunden wurde dabei ein Produktfehler, der genau diesen Start seit `1.11`
 * unmoeglich gemacht hat: Die `LISTEN`-Verbindung des Fan-outs baute sich ohne
 * jede TLS-Konfiguration auf. Gegen ein PostgreSQL mit `hostnossl ... reject`
 * scheiterte sie, und weil sie vor dem Lauschen aufgebaut wird, startete der
 * Prozess nie. Der dauerhafte Log ist unter Production Pflicht, der Bus haengt
 * am dauerhaften Log. Die Bedingung des Tors war also erfuellbar und der Start
 * trotzdem nicht.
 */

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const authUrl = process.env.QKERN_TEST_AUTH_DATABASE_URL;
const tlsHost = process.env.QKERN_TEST_REALTIME_TLS_HOST;
const caFile = process.env.QKERN_TEST_REALTIME_CA_FILE;
const altHost = process.env.QKERN_TEST_REALTIME_ALT_HOST;
const enabled = Boolean(
  process.env.QKERN_TEST_REALTIME_PRODUCTION_STACK === "true" &&
  ownerUrl && runtimeUrl && authUrl && tlsHost && caFile && altHost,
);

/** Nur `https`: Das Tor verlangt es, und der Client muss es genauso senden. */
const ORIGIN = "https://app.qkern.test";
const BASE_PORT = 8794;
const CURSOR_SECRET = Buffer.alloc(32, 9).toString("base64url");

function nextMessage<T extends RealtimeServerMessage["type"]>(socket: WebSocket, type: T) {
  return new Promise<Extract<RealtimeServerMessage, { type: T }>>((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${type}`)); }, 20_000);
    const onMessage = (raw: Buffer) => {
      const message = JSON.parse(raw.toString("utf8")) as RealtimeServerMessage;
      if (message.type !== type) return;
      cleanup();
      resolve(message as Extract<RealtimeServerMessage, { type: T }>);
    };
    const onClose = () => { cleanup(); reject(new Error(`Socket closed before ${type}`)); };
    function cleanup() {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("close", onClose);
    }
    socket.on("message", onMessage);
    socket.once("close", onClose);
  });
}

type Started = { child: ChildProcess; output: () => string };

function start(env: NodeJS.ProcessEnv): Started {
  const child = spawn(process.execPath, ["--import", "tsx", "workers/realtime-runtime.mts"], {
    cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env,
  });
  let noise = "";
  child.stderr?.on("data", (chunk: Buffer) => { noise += chunk.toString(); });
  child.stdout?.on("data", (chunk: Buffer) => { noise += chunk.toString(); });
  return { child, output: () => noise };
}

async function waitForListening(started: Started, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !started.output().includes("listening")) {
    if (started.child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  expect(started.output(), "Der Prozess hat nicht gemeldet, dass er lauscht").toContain("listening");
}

async function waitForExit(started: Started, timeoutMs = 60_000) {
  const exit = new Promise<number | null>((resolve) => started.child.once("exit", resolve));
  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), timeoutMs));
  const result = await Promise.race([exit, timeout]);
  if (result === "timeout") {
    started.child.kill();
    throw new Error(`Der Prozess lief weiter statt zu scheitern: ${started.output().slice(-800)}`);
  }
  return result;
}

describe.runIf(enabled)("Realtime production TLS PostgreSQL certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  /**
   * Ein **Service**-Schluessel: `anon` darf nur `public:` abonnieren und nie
   * senden, und wer damit einen Rundlauf messen will, misst die Policy statt
   * den Prozess. Nach dem Praefix stehen genau 43 Zeichen.
   */
  const projectKey = `qk_service_${randomUUID().replace(/-/g, "")}${"A".repeat(11)}`;

  let owner: SqlPool;

  /**
   * Die Umgebung eines Production-Prozesses mit **allen** Bedingungen des Tors
   * erfuellt. `overrides` mit dem Wert `undefined` nimmt eine Variable heraus,
   * statt sie auf den leeren String zu setzen: Ein leerer String ist im Prozess
   * eine gesetzte Variable und wuerde eine andere Bedingung treffen.
   */
  function productionEnv(port: number, overrides: Record<string, string | undefined> = {}) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_SSL: "require",
      QKERN_REALTIME_ENABLED: "true",
      QKERN_REALTIME_PORT: String(port),
      // Oeffentliches Binding, damit auch die TLS-Attestierung des Tors
      // wirklich verlangt und geprueft wird.
      QKERN_REALTIME_BIND_HOST: "0.0.0.0",
      QKERN_REALTIME_PUBLIC_BIND: "true",
      QKERN_REALTIME_TLS_TERMINATED: "proxy",
      QKERN_REALTIME_ALLOWED_ORIGINS: ORIGIN,
      QKERN_REALTIME_CURSOR_SECRET: CURSOR_SECRET,
      QKERN_REALTIME_RETENTION_SCOPES_JSON: JSON.stringify([{
        organizationId, projectId, environment: "production",
      }]),
      QKERN_RUNTIME_MODE: "postgres",
      QKERN_STATEMENT_ENCRYPTION_KEY: "0".repeat(64),
      // Die Messung laeuft mit: Unter Production verlangt sie die dauerhafte
      // PostgreSQL-Ablage, und genau die soll dieser Fall belegen.
      QKERN_USAGE_METERING_ENABLED: "true",
      QKERN_RUNTIME_DATABASE_URL: runtimeUrl!,
      QKERN_AUTH_DATABASE_URL: authUrl!,
    };
    for (const [name, value] of Object.entries(overrides)) {
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
    return env;
  }

  async function authenticated(port: number) {
    const url = `ws://127.0.0.1:${port}/realtime/v1/projects/${projectId}/environments/production`;
    const socket = new WebSocket(url, QKERN_REALTIME_PROTOCOL, { origin: ORIGIN });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    const ready = nextMessage(socket, "ready");
    socket.send(JSON.stringify({ type: "auth", requestId: "auth-1", projectKey }));
    await ready;
    return socket;
  }

  beforeAll(async () => {
    // Auch der Test spricht nur TLS: Der Stack laesst nichts anderes zu. Der
    // Vertrauensanker steht in `NODE_EXTRA_CA_CERTS`, also prueft `pg` Kette
    // und Hostnamen ohne weitere Angabe.
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 3, ssl: { rejectUnauthorized: true } });
    await owner.query(`INSERT INTO users (id,email,password_hash,status)
      VALUES ($1,$2,'$argon2id$integration-only','active')`,
    [controlUser, `realtime-production-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id,name,slug,created_by)
      VALUES ($1,'Realtime Production',$2,$3)`,
    [organizationId, `realtime-production-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id,organization_id,name,slug,region,status,created_by)
      VALUES ($1,$2,'Realtime Production',$3,'test','ready',$4)`,
    [projectId, organizationId, `realtime-production-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id,project_id,environment,database_instance_ref)
      VALUES ($1,$2,'production',$3)`, [organizationId, projectId, `managed:${projectId}`]);
    await owner.query(`INSERT INTO project_api_keys
      (organization_id,project_id,environment,name,kind,token_prefix,token_hash,expires_at,created_by)
      VALUES ($1,$2,'production','certification','service',$3,$4,now() + interval '1 day',$5)`,
    [organizationId, projectId, projectKey.slice(0, 22), hashProjectApiKey(projectKey), controlUser]);
  }, 180_000);

  afterAll(async () => { await owner?.end(); });

  /**
   * Der Stack selbst: Ohne TLS kommt niemand an diese Datenbank. Ohne diesen
   * Fall koennte jeder folgende gegen ein PostgreSQL laufen, das Klartext
   * nebenbei zulaesst, und wuerde nichts belegen.
   */
  it("refuses an unencrypted connection at the server", async () => {
    const plain = createPostgresPool({ connectionString: ownerUrl!, max: 1, ssl: false });
    try {
      await expect(plain.query("SELECT 1")).rejects.toThrow(/no encryption|pg_hba/i);
    } finally {
      await plain.end().catch(() => undefined);
    }
  }, 60_000);

  it("starts under production and carries a broadcast end to end", async () => {
    const port = BASE_PORT;
    const started = start(productionEnv(port));
    try {
      await waitForListening(started);
      // Der Prozess nennt seinen Zustand selbst: dauerhafter Log, Fan-out.
      // Mit fluechtigem Log stuende hier die andere Haelfte des Satzes, und das
      // Tor haette ihn ohnehin nicht starten lassen.
      expect(started.output()).toContain("durable log, cross-instance fan-out");
      expect(started.output()).toContain("ws://0.0.0.0:");

      const socket = await authenticated(port);
      try {
        const subscribed = nextMessage(socket, "subscribed");
        socket.send(JSON.stringify({
          type: "subscribe", requestId: "sub-1", channel: "private:production",
        }));
        expect(await subscribed).toMatchObject({ channel: "private:production" });

        const delivered = nextMessage(socket, "broadcast");
        socket.send(JSON.stringify({
          type: "broadcast", requestId: "send-1", channel: "private:production",
          event: "production.ping", payload: { probe: "tls" },
        }));
        expect(await delivered).toMatchObject({
          channel: "private:production", event: "production.ping",
          payload: { probe: "tls" }, replay: false,
        });
      } finally {
        socket.close();
      }

      // Der dauerhafte Log ist keine Behauptung der Startzeile: Das Ereignis
      // liegt in der Datenbank, und zwar in der, die nur TLS annimmt.
      const stored = await owner.query<{ event: string; sequence: string | number }>(
        `SELECT event, sequence FROM realtime_events
         WHERE organization_id = $1 AND project_id = $2 AND environment = 'production'
           AND channel = 'private:production'`,
        [organizationId, projectId],
      );
      expect(stored.rows.map((row) => row.event)).toEqual(["production.ping"]);

      // Nachgelesen im Server, nicht in der Konfiguration: Jede Verbindung des
      // Prozesses ist verschluesselt. Erwartet werden mindestens zwei: der Pool
      // des Event-Logs und die `LISTEN`-Verbindung des Fan-outs.
      const tls = await owner.query<{
        usename: string; ssl: boolean; version: string | null; cipher: string | null;
      }>(`SELECT activity.usename::text AS usename, ssl.ssl, ssl.version, ssl.cipher
            FROM pg_stat_activity AS activity
            JOIN pg_stat_ssl AS ssl ON ssl.pid = activity.pid
           WHERE activity.datname = current_database()
             AND activity.usename::text = 'qkern_app'`);
      // Ins Log, damit ein Lauf nicht nur einen Exit-Code hinterlaesst: Was der
      // Server ueber die Verbindungen dieses Prozesses sagt, steht danach da.
      console.error(`QKERN_REALTIME_TLS_READBACK ${JSON.stringify(tls.rows)}`);
      expect(tls.rows.length, "Der Prozess hielt keine Verbindung offen").toBeGreaterThanOrEqual(2);
      expect(tls.rows.every((row) => row.ssl === true)).toBe(true);
      expect(tls.rows.every((row) => (row.version ?? "").startsWith("TLSv1."))).toBe(true);
      expect(tls.rows.every((row) => Boolean(row.cipher))).toBe(true);

      expect(started.output()).not.toContain(projectKey);
      expect(started.output()).not.toContain("qkern_runtime_local_only");
    } finally {
      started.child.kill();
    }
  }, 240_000);

  /**
   * Der Fan-out unter Production: Zwei Prozesse, ein Ereignis. Die
   * Benachrichtigung laeuft ueber `LISTEN`/`NOTIFY` derselben TLS-Datenbank,
   * und die empfangende Instanz liest das Ereignis aus dem Log. Genau diese
   * Verbindung hat den Production-Start bis zu diesem Stack verhindert.
   */
  it("carries a broadcast to a second production instance", async () => {
    const first = start(productionEnv(BASE_PORT + 1));
    const second = start(productionEnv(BASE_PORT + 2));
    try {
      await waitForListening(first);
      await waitForListening(second);

      const listener = await authenticated(BASE_PORT + 2);
      const sender = await authenticated(BASE_PORT + 1);
      try {
        for (const [socket, requestId] of [[listener, "sub-listener"], [sender, "sub-sender"]] as const) {
          const subscribed = nextMessage(socket, "subscribed");
          socket.send(JSON.stringify({
            type: "subscribe", requestId, channel: "private:fanout",
          }));
          await subscribed;
        }

        const remote = nextMessage(listener, "broadcast");
        sender.send(JSON.stringify({
          type: "broadcast", requestId: "send-fanout", channel: "private:fanout",
          event: "production.fanout", payload: { probe: "instances" },
        }));
        expect(await remote, `Erste Instanz: ${first.output().slice(-400)}`).toMatchObject({
          channel: "private:fanout", event: "production.fanout", payload: { probe: "instances" },
        });
      } finally {
        listener.close();
        sender.close();
      }
    } finally {
      first.child.kill();
      second.child.kill();
    }
  }, 300_000);

  /**
   * Die erste Haelfte von `verify-full`: die Kette. Ohne Vertrauensanker ist
   * das Serverzertifikat unbekannt, und der Prozess kommt nicht hoch. Faellt
   * dieser Fall nicht, prueft die Verbindung die Gegenseite nicht und
   * `sslmode=require` waere genauso gut.
   */
  it("refuses to start when the server certificate cannot be verified", async () => {
    const started = start(productionEnv(BASE_PORT + 3, { NODE_EXTRA_CA_CERTS: undefined }));
    const exitCode = await waitForExit(started);
    expect(exitCode, `Prozessausgabe: ${started.output().slice(-800)}`).not.toBe(0);
    expect(started.output()).toMatch(/certificate/i);
    expect(started.output()).not.toContain("listening");
  }, 120_000);

  /**
   * Die zweite Haelfte von `verify-full`: der Hostname. Derselbe
   * Vertrauensanker, derselbe Server, dieselbe Zeile in `pg_hba.conf`, nur ein
   * Name, der im Zertifikat nicht steht: der Dienstname aus Compose statt des
   * Alias, auf den das Zertifikat lautet.
   */
  it("refuses to start when the server name does not match the certificate", async () => {
    const started = start(productionEnv(BASE_PORT + 4, {
      QKERN_RUNTIME_DATABASE_URL: runtimeUrl!.replace(tlsHost!, altHost!),
      QKERN_AUTH_DATABASE_URL: authUrl!.replace(tlsHost!, altHost!),
    }));
    const exitCode = await waitForExit(started);
    expect(exitCode, `Prozessausgabe: ${started.output().slice(-800)}`).not.toBe(0);
    expect(started.output()).toMatch(/altnames|does not match|Hostname\/IP/i);
    expect(started.output()).not.toContain("listening");
  }, 120_000);

  /**
   * Das Tor ist ein Tor: Jede einzelne Bedingung, die fehlt, laesst den Start
   * fallen und **nennt sich**. Kein stiller Rutsch in einen schwaecheren Modus,
   * und keine pauschale Abweisung, die nicht sagt, was fehlt.
   *
   * Der Unterschied zum Fall in `realtime-process-postgres`: Dort ist genau
   * eine Bedingung verletzt und die Umgebung ist im Uebrigen unvollstaendig.
   * Hier ist die Umgebung dieselbe, mit der der Prozess zwei Faelle vorher
   * wirklich angelaufen ist. Jeder Fehlschlag hier liegt also an der
   * herausgenommenen Bedingung und an nichts sonst.
   */
  it.each([
    ["ephemeral log", { QKERN_REALTIME_EPHEMERAL_LOG: "true" }, "durable event log"],
    ["cursor secret", { QKERN_REALTIME_CURSOR_SECRET: undefined }, "QKERN_REALTIME_CURSOR_SECRET"],
    ["retention scopes", { QKERN_REALTIME_RETENTION_SCOPES_JSON: undefined }, "QKERN_REALTIME_RETENTION_SCOPES_JSON"],
    ["https origins", { QKERN_REALTIME_ALLOWED_ORIGINS: "http://localhost:3000" }, "https-only origin allowlist"],
    ["tls attestation", { QKERN_REALTIME_TLS_TERMINATED: undefined }, "QKERN_REALTIME_TLS_TERMINATED=proxy"],
  ] as const)("falls and names the condition when %s is missing", async (_name, overrides, message) => {
    const started = start(productionEnv(BASE_PORT + 5, overrides));
    const exitCode = await waitForExit(started);
    expect(exitCode, `Prozessausgabe: ${started.output().slice(-800)}`).not.toBe(0);
    expect(started.output()).toContain(message);
    expect(started.output()).not.toContain("listening");
  }, 120_000);

  /**
   * Der Befund dieses Laufs, als Fall festgehalten.
   *
   * Postgres Changes sind unter Production **nicht** erreichbar. Der
   * Realtime-Prozess baut seinen Projektdatenbank-Katalog ausschliesslich ueber
   * `createLocalProjectDatabaseCatalogFromEnv` beziehungsweise
   * `createGeneratedDataApiFromEnv` auf, und beide weisen `NODE_ENV=production`
   * ab: Sie verlangen einen eingespeisten, vault-gestuetzten Katalog. Der
   * Migrations-Prozess hat diesen Zweig (`createVaultProjectDatabaseCatalog
   * FromEnv`), der Realtime-Prozess hat ihn nicht.
   *
   * Das Tor aus `1.73.0` nennt diese Bedingung nicht, weil sie nicht im Tor
   * steht. Der Fall haelt fest, was heute gilt: Die Abweisung ist ausdruecklich
   * und benannt, nicht ein stiller Rutsch in ein leeres `changes:`-Abonnement.
   * Sobald der Prozess einen vault-gestuetzten Katalog bekommt, faellt dieser
   * Fall und muss umgeschrieben werden.
   */
  it("names the missing injected project catalog when changes are switched on", async () => {
    const started = start(productionEnv(BASE_PORT + 6, {
      QKERN_REALTIME_CHANGES_ENABLED: "true",
      QKERN_GENERATED_DATA_API_ENABLED: "true",
    }));
    const exitCode = await waitForExit(started);
    expect(exitCode, `Prozessausgabe: ${started.output().slice(-800)}`).not.toBe(0);
    expect(started.output()).toContain("injected dedicated project API-role catalog");
    expect(started.output()).not.toContain("listening");
  }, 120_000);
});
