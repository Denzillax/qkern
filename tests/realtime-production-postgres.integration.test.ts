import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID, X509Certificate, generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { Argon2idPasswordHasher } from "@/lib/server/auth/password";
import { InMemoryRateLimiter } from "@/lib/server/auth/rate-limit";
import { createPostgresPool } from "@/lib/server/db/pool";
import { hashProjectApiKey } from "@/lib/server/project-api-keys/service";
import { ProjectAuthSecretProtector, ProjectAuthTotp } from "@/lib/server/project-auth/mfa";
import { ProjectAuthOidcCatalog, ProjectAuthOidcClient } from "@/lib/server/project-auth/oidc";
import { PostgresProjectAuthRepository } from "@/lib/server/project-auth/postgres-repository";
import {
  NoopDevelopmentProjectAuthDelivery,
  ProjectAuthService,
} from "@/lib/server/project-auth/service";
import { projectAuthTokenServiceFromEnv } from "@/lib/server/project-auth/tokens";
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
// Der Change-Feed-Teil des Stacks (2.69): Projektdatenbank, Vault, Blatt-Pin.
const projectDatabaseUrl = process.env.QKERN_TEST_PROJECT_DATABASE_URL;
const projectDatabaseName = process.env.QKERN_TEST_PROJECT_DATABASE_NAME;
const projectApiRole = process.env.QKERN_TEST_PROJECT_API_ROLE;
const projectLedgerOwner = process.env.QKERN_TEST_PROJECT_LEDGER_OWNER;
const serverCertFile = process.env.QKERN_TEST_REALTIME_SERVER_CERT_FILE;
const vaultDatabaseUrl = process.env.QKERN_TEST_REALTIME_VAULT_DATABASE_URL;
const vaultStaticRole = process.env.QKERN_TEST_REALTIME_VAULT_STATIC_ROLE;
const vaultTokenFile = process.env.QKERN_TEST_REALTIME_VAULT_TOKEN_FILE;
const enabled = Boolean(
  process.env.QKERN_TEST_REALTIME_PRODUCTION_STACK === "true" &&
  ownerUrl && runtimeUrl && authUrl && tlsHost && caFile && altHost &&
  projectDatabaseUrl && projectDatabaseName && projectApiRole && projectLedgerOwner &&
  serverCertFile && vaultDatabaseUrl && vaultStaticRole && vaultTokenFile,
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
  /** Die Projektdatenbank, in der der Aenderungs-Feed liegt. */
  let projectDb: SqlPool;
  /** Der Auth-Pool, mit dem der Test seine Abonnenten anlegt. */
  let authDb: SqlPool;
  /** Eigenes Schema je Lauf, damit zwei Laeufe sich nicht sehen. */
  const schema = `rtc_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  /** Blatt-Pin des Serverzertifikats; eine Vault-Bindung verlangt ihn unter Production. */
  let serverCertificateSha256 = "";
  /**
   * Die Schluesselangaben von Project Auth, in Test und Kindprozess dieselben.
   * Nur so kann der Prozess ein Token pruefen, das der Test ausgestellt hat.
   */
  let projectAuthEnv: Record<string, string> = {};
  const subscribers: { id: string; accessToken: string }[] = [];

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

  async function authenticated(port: number, accessToken?: string) {
    const url = `ws://127.0.0.1:${port}/realtime/v1/projects/${projectId}/environments/production`;
    const socket = new WebSocket(url, QKERN_REALTIME_PROTOCOL, { origin: ORIGIN });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    const ready = nextMessage(socket, "ready");
    socket.send(JSON.stringify({
      type: "auth", requestId: "auth-1", projectKey, ...(accessToken ? { accessToken } : {}),
    }));
    await ready;
    return socket;
  }

  /**
   * Die Bindung, die der Prozess als Katalog bekommt. Ein Blatt-Pin ist unter
   * Production Pflicht: Ohne ihn weist die Bindung sich selbst ab, und das ist
   * richtig — eine Kette allein sagt nur, wer ausgestellt hat.
   */
  function binding(overrides: Record<string, unknown> = {}) {
    return {
      databaseInstanceRef: `managed:${projectId}`,
      vaultStaticRole: vaultStaticRole!,
      host: tlsHost!,
      port: 5432,
      expectedRole: projectApiRole!,
      expectedDatabase: projectDatabaseName!,
      expectedLedgerOwner: projectLedgerOwner!,
      serverCertificateSha256,
      ...overrides,
    };
  }

  /**
   * Die Umgebung eines Production-Prozesses **mit** Postgres Changes: derselbe
   * vault-gestuetzte Katalog, den der Migrations-Prozess fuehrt, und die
   * Generated Data API, durch die der Leser jede Zeile holt.
   */
  function changesEnv(port: number, overrides: Record<string, string | undefined> = {}) {
    return productionEnv(port, {
      QKERN_REALTIME_CHANGES_ENABLED: "true",
      QKERN_GENERATED_DATA_API_ENABLED: "true",
      QKERN_PROJECT_DATABASE_CATALOG_SOURCE: "static-env",
      QKERN_VAULT_DATABASE_URL: vaultDatabaseUrl!,
      QKERN_VAULT_TOKEN_FILE: vaultTokenFile!,
      QKERN_VAULT_PROJECT_DATABASE_CATALOG_JSON: JSON.stringify([binding()]),
      QKERN_REALTIME_CHANGE_POLL_MS: "200",
      QKERN_REALTIME_CHANGE_RECONCILE_MS: "500",
      ...projectAuthEnv,
      ...overrides,
    });
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

    // Der Blatt-Pin aus derselben Datei, die der Server vorzeigt. Kein
    // Abschreiben aus der Konfiguration: Was gepinnt wird, ist das Zertifikat.
    serverCertificateSha256 = new X509Certificate(await readFile(serverCertFile!))
      .fingerprint256.replaceAll(":", "").toLowerCase();

    // Die Tabelle, deren Aenderungen der Feed traegt. Eigentuemer ist der
    // Ledger-Owner, nicht der Data-API-Login: Die Generated Data API weist eine
    // Tabelle ab, die der lesenden Rolle selbst gehoert, weil RLS fuer den
    // Eigentuemer nicht gilt.
    projectDb = createPostgresPool({
      connectionString: projectDatabaseUrl!, max: 3, ssl: { rejectUnauthorized: true },
    });
    await projectDb.query(`CREATE SCHEMA "${schema}" AUTHORIZATION ${projectLedgerOwner}`);
    await projectDb.query(`CREATE TABLE "${schema}".items (
      id uuid PRIMARY KEY, owner_id text NOT NULL, label text NOT NULL)`);
    // Kein `SET ROLE` auf einem Pool: Die naechste Abfrage kann eine andere
    // Verbindung erwischen. Der Eigentuemer wird nachtraeglich gesetzt, das
    // Ergebnis ist dasselbe.
    await projectDb.query(`ALTER TABLE "${schema}".items OWNER TO ${projectLedgerOwner}`);
    await projectDb.query(`ALTER TABLE "${schema}".items ENABLE ROW LEVEL SECURITY`);
    await projectDb.query(`CREATE POLICY items_owner_isolation ON "${schema}".items
      USING (owner_id = current_setting('request.jwt.claim.sub', true))`);
    await projectDb.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${projectApiRole}`);
    await projectDb.query(`GRANT SELECT ON "${schema}".items TO ${projectApiRole}`);
    await projectDb.query(`CREATE TRIGGER items_capture
      AFTER INSERT OR UPDATE OR DELETE ON "${schema}".items
      FOR EACH ROW EXECUTE FUNCTION qkern_internal.capture_change()`);

    // Project Auth, damit der Abonnent ein echter angemeldeter Nutzer ist und
    // die Zeile mit **seinen** Claims gelesen wird. Mit einem Service-Schluessel
    // stuende in `sub` die Id des API-Schluessels; eine Policy darauf waere
    // erfunden und belegte nichts ueber den Weg, den ein Kunde geht.
    const { privateKey } = generateKeyPairSync("ed25519");
    projectAuthEnv = {
      QKERN_PROJECT_AUTH_ENABLED: "true",
      QKERN_PROJECT_AUTH_SIGNING_KEY_ID: "realtime-production",
      QKERN_PROJECT_AUTH_SIGNING_PRIVATE_KEY_BASE64:
        privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
      QKERN_PROJECT_AUTH_ISSUER_BASE_URL: ORIGIN,
      QKERN_PROJECT_AUTH_REDIRECT_ORIGINS: ORIGIN,
      QKERN_PROJECT_AUTH_CALLBACK_BASE_URL: ORIGIN,
      QKERN_PROJECT_AUTH_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
    };
    authDb = createPostgresPool({
      connectionString: authUrl!, max: 3, ssl: { rejectUnauthorized: true },
    });
    const projectAuth = new ProjectAuthService({
      repository: new PostgresProjectAuthRepository(authDb),
      passwords: new Argon2idPasswordHasher({}),
      rateLimiter: new InMemoryRateLimiter(),
      // Aus derselben Umgebung wie im Kindprozess: gleicher Schluessel, gleiche
      // Kennung, gleicher Aussteller. Sonst pruefte der Prozess ein Token, das
      // er nie ausgestellt haben koennte.
      tokens: projectAuthTokenServiceFromEnv({ ...projectAuthEnv, NODE_ENV: "production" }),
      mfa: new ProjectAuthTotp(),
      secrets: new ProjectAuthSecretProtector(Buffer.alloc(32, 7)),
      delivery: new NoopDevelopmentProjectAuthDelivery(),
      oidcCatalog: new ProjectAuthOidcCatalog([]),
      oidcClient: new ProjectAuthOidcClient({}, async () => { throw new Error("not expected"); }),
      callbackBaseUrl: ORIGIN,
      allowedRedirectOrigins: new Set([ORIGIN]),
      exposeDeliveryTokens: true,
    });
    const authScope = { organizationId, projectId, environment: "production" as const };
    for (let index = 0; index < 2; index += 1) {
      const signup = await projectAuth.signUp(authScope, {
        email: `realtime-changes-${randomUUID()}@qkern.test`,
        password: "a sufficiently long password",
        redirectTo: `${ORIGIN}/callback`,
        rateLimitKey: randomUUID(),
      });
      const session = await projectAuth.consumeEmailToken(authScope, {
        token: signup.debugToken!, purpose: "email_verification",
      });
      if (!("accessToken" in session)) throw new Error("the signup did not yield a session");
      subscribers.push({ id: session.user.id, accessToken: session.accessToken });
    }
  }, 300_000);

  afterAll(async () => {
    await projectDb?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await Promise.allSettled([owner?.end(), projectDb?.end(), authDb?.end()]);
  });

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
   * Der Befund aus `2.68.0`, geschlossen.
   *
   * Damals war Postgres Changes unter Production unerreichbar: Der Prozess baute
   * seinen Projektdatenbank-Katalog ausschliesslich lokal auf, und der lokale Weg
   * weist `NODE_ENV=production` ab. Der Migrations-Prozess hatte den
   * vault-gestuetzten Zweig, der Realtime-Prozess nicht. Jetzt rufen beide
   * dieselbe Fabrik (`lib/server/migrations/connection-catalog-runtime.ts`), und
   * dieser Fall geht den ganzen Weg:
   *
   * Trigger in der Projektdatenbank → `qkern_internal.change_feed` → Poller →
   * Lesen der Zeile mit den Claims des Abonnenten durch die Generated Data API →
   * Zustellung. Die Zugangsdaten der lesenden Rolle kommen aus einem echten
   * Vault ueber `https` mit gepruefter Kette, die Verbindung zur
   * Projektdatenbank haengt zusaetzlich an einem Blatt-Pin, und der Abonnent ist
   * ein angemeldeter Nutzer, nicht ein Service-Schluessel.
   *
   * Der zweite Teil ist so wichtig wie der erste: Die Zeile des **anderen**
   * Nutzers kommt nicht an. Sie wird nicht ausgefiltert, weil der Prozess etwas
   * ueber sie wuesste, sondern weil RLS sie beim Lesen nicht herausgibt.
   */
  it("carries a real change through the vault-backed catalog to an authenticated subscriber",
    async () => {
      const port = BASE_PORT + 7;
      const [mine, theirs] = subscribers;
      const started = start(changesEnv(port));
      try {
        await waitForListening(started);
        // Der Startgriff hat wirklich stattgefunden: Der Prozess sagt, wie viele
        // Projektdatenbanken er ueber den Vault erreicht hat.
        expect(started.output()).toContain("change feed catalog reached 1 project database(s)");

        const socket = await authenticated(port, mine.accessToken);
        const changes: Extract<RealtimeServerMessage, { type: "change" }>[] = [];
        socket.on("message", (raw: Buffer) => {
          const message = JSON.parse(raw.toString("utf8")) as RealtimeServerMessage;
          if (message.type === "change") changes.push(message);
        });
        try {
          const channel = `changes:${schema}.items`;
          const subscribed = nextMessage(socket, "subscribed");
          socket.send(JSON.stringify({ type: "subscribe", requestId: "sub-changes", channel }));
          expect(await subscribed).toMatchObject({ channel });

          const delivered = nextMessage(socket, "change");
          const foreignRow = randomUUID();
          const ownRow = randomUUID();
          // Die fremde Zeile zuerst und mit kleinerer Feed-Position: Kommt danach
          // die eigene an, war der Stapel beim Abonnenten und die fremde ist
          // nicht unterwegs verloren gegangen.
          await projectDb.query(
            `INSERT INTO "${schema}".items (id, owner_id, label) VALUES ($1, $2, 'their row')`,
            [foreignRow, theirs.id],
          );
          await projectDb.query(
            `INSERT INTO "${schema}".items (id, owner_id, label) VALUES ($1, $2, 'my row')`,
            [ownRow, mine.id],
          );

          const change = await delivered;
          expect(change).toMatchObject({
            channel, schema, table: "items", operation: "insert",
          });
          expect(change.record).toMatchObject({
            id: ownRow, owner_id: mine.id, label: "my row",
          });

          // Zeit lassen und danach zaehlen: Wenn die fremde Zeile kaeme, kaeme
          // sie in dieser Spanne.
          await new Promise((resolve) => setTimeout(resolve, 3_000));
          expect(changes.map((entry) => entry.record?.id)).toEqual([ownRow]);
          expect(JSON.stringify(changes)).not.toContain(foreignRow);
          expect(JSON.stringify(changes)).not.toContain("their row");
        } finally {
          socket.close();
        }

        // Nachgelesen im Server: Die lesende Verbindung gehoert der
        // unprivilegierten Data-API-Rolle, sie liegt in der Projektdatenbank und
        // sie ist verschluesselt. Die Zugangsdaten dafuer hat der Prozess vom
        // Vault geholt; das Passwort aus dem Init-Script gilt nach der Rotation
        // nicht mehr.
        const readers = await projectDb.query<{
          usename: string; ssl: boolean; version: string | null; application_name: string;
        }>(`SELECT activity.usename::text AS usename, ssl.ssl, ssl.version,
                   activity.application_name
              FROM pg_stat_activity AS activity
              JOIN pg_stat_ssl AS ssl ON ssl.pid = activity.pid
             WHERE activity.datname = current_database()
               AND activity.usename::text = $1`, [projectApiRole!]);
        console.error(`QKERN_REALTIME_CHANGE_READBACK ${JSON.stringify(readers.rows)}`);
        expect(readers.rows.length, "Der Prozess hielt keine Projektverbindung offen")
          .toBeGreaterThanOrEqual(1);
        expect(readers.rows.every((row) => row.ssl === true)).toBe(true);
        expect(readers.rows.every((row) => (row.version ?? "").startsWith("TLSv1."))).toBe(true);

        expect(started.output()).not.toContain(mine.accessToken);
        expect(started.output()).not.toContain("qkern_project_api_local_only");
      } finally {
        started.child.kill();
      }
    }, 300_000);

  /**
   * Die andere Haelfte der Zusage: Fehlt der Vault-Zweig oder liefert er nichts,
   * **faellt der Start**. Kein stiller Rutsch in ein `changes:`-Abonnement, das
   * fuer immer leer bleibt.
   *
   * Der letzte Fall ist der unauffaelligste und der wichtigste: Die
   * Konfiguration ist vollstaendig und gueltig, der Vault ist erreichbar, aber
   * die statische Rolle gibt es dort nicht. Ein vault-gestuetzter Katalog holt
   * seine Zugangsdaten erst beim ersten Zugriff, also waere das ohne den
   * Startgriff gar nicht zu merken gewesen: Der Prozess haette gelauscht, der
   * Leser waere geschlossen gefallen, und der Abonnent haette nichts bekommen —
   * ohne Fehler, ohne Hinweis.
   */
  it.each([
    [
      "the vault branch is not named",
      { QKERN_PROJECT_DATABASE_CATALOG_SOURCE: undefined },
      "QKERN_PROJECT_DATABASE_CATALOG_SOURCE=static-env",
    ],
    [
      "the bindings are missing",
      { QKERN_VAULT_PROJECT_DATABASE_CATALOG_JSON: undefined },
      "Vault project database catalog configuration is invalid",
    ],
    [
      "the token file is not named",
      { QKERN_VAULT_TOKEN_FILE: undefined },
      "QKERN_VAULT_TOKEN_FILE must be a bounded absolute path",
    ],
    [
      "the vault address is plain http",
      { QKERN_VAULT_DATABASE_URL: vaultDatabaseUrl?.replace("https://", "http://") },
      "Vault project database catalog configuration is invalid",
    ],
    [
      "the generated data api is switched off",
      { QKERN_GENERATED_DATA_API_ENABLED: undefined },
      "requires QKERN_GENERATED_DATA_API_ENABLED=true",
    ],
    [
      "the vault has no credential for the binding",
      {
        QKERN_VAULT_PROJECT_DATABASE_CATALOG_JSON: undefined as string | undefined,
      },
      "Vault credential response was rejected",
    ],
  ] as const)("falls when %s", async (name, overrides, message) => {
    const applied: Record<string, string | undefined> = { ...overrides };
    if (name === "the vault has no credential for the binding") {
      applied.QKERN_VAULT_PROJECT_DATABASE_CATALOG_JSON = JSON.stringify([
        binding({ vaultStaticRole: "qkern-project-api-absent" }),
      ]);
    }
    const started = start(changesEnv(BASE_PORT + 8, applied));
    const exitCode = await waitForExit(started);
    expect(exitCode, `Prozessausgabe: ${started.output().slice(-800)}`).not.toBe(0);
    expect(started.output()).toContain(message);
    expect(started.output()).not.toContain("listening");
  }, 180_000);
});
