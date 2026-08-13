import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createPostgresPool } from "@/lib/server/db/pool";
import { hashProjectApiKey } from "@/lib/server/project-api-keys/service";
import { QKERN_REALTIME_PROTOCOL } from "@/lib/server/realtime/websocket-server";
import type { RealtimeServerMessage } from "@/lib/server/realtime/model";
import type { SqlPool } from "@/lib/server/db/sql";

/**
 * Der Realtime-Prozess, mit einem echten Client am anderen Ende.
 *
 * Seit Release 1.44 stand in jeder „Ehrlich offen"-Liste, dass Prozesse ohne
 * Arbeitsnachweis bleiben. Realtime war der letzte, fuer den es einen Weg gibt:
 * Er ist ein Server, also kann ein Client ihn befragen. Der Apply-Publisher
 * braucht einen Broker und der Provisioner einen Vault — beide gibt es im Stack
 * nicht.
 *
 * Gemessen wird die Kette, die ein Kunde sieht: verbinden, mit einem **echten**
 * Projekt-Key anmelden, abonnieren, senden, empfangen. Nichts davon ist
 * eingespeist; der Prozess ist der aus `npm run realtime`.
 */

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const authUrl = process.env.QKERN_TEST_AUTH_DATABASE_URL;
const enabled = Boolean(ownerUrl && runtimeUrl && authUrl);

const ORIGIN = "http://localhost:3000";
const PORT = 8791;

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

describe.runIf(enabled)("Realtime process PostgreSQL certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  /**
   * Ein **Service**-Schluessel, kein oeffentlicher.
   *
   * Ein oeffentlicher Schluessel authentifiziert als `anon`, und `anon` darf
   * ausschliesslich `public:`-Kanaele abonnieren und niemals senden. Wer damit
   * einen Rundlauf messen will, misst die Policy statt den Prozess.
   */
  // Nach dem Praefix stehen genau 43 Zeichen — `qk_service_` ist um eines
  // laenger als `qk_public_`, und ein Zeichen zu wenig macht den Schluessel
  // formungueltig, bevor ihn irgendjemand nachschlaegt.
  const projectKey = `qk_service_${randomUUID().replace(/-/g, "")}${"A".repeat(11)}`;

  let owner: SqlPool;

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    await owner.query(`INSERT INTO users (id,email,password_hash,status)
      VALUES ($1,$2,'$argon2id$integration-only','active')`,
    [controlUser, `realtime-process-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id,name,slug,created_by)
      VALUES ($1,'Realtime Process',$2,$3)`,
    [organizationId, `realtime-process-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id,organization_id,name,slug,region,status,created_by)
      VALUES ($1,$2,'Realtime Process',$3,'test','ready',$4)`,
    [projectId, organizationId, `realtime-process-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id,project_id,environment,database_instance_ref)
      VALUES ($1,$2,'development',$3)`, [organizationId, projectId, `managed:${projectId}`]);
    // Der Schluessel wird gespeichert, wie der Dienst ihn speichern wuerde:
    // Prefix und Hash, niemals das Geheimnis. Der Prozess authentifiziert
    // spaeter gegen genau diesen Hash.
    await owner.query(`INSERT INTO project_api_keys
      (organization_id,project_id,environment,name,kind,token_prefix,token_hash,expires_at,created_by)
      VALUES ($1,$2,'development','certification','service',$3,$4,now() + interval '1 day',$5)`,
    [organizationId, projectId, projectKey.slice(0, 22), hashProjectApiKey(projectKey), controlUser]);
  }, 120_000);

  afterAll(async () => { await owner?.end(); });

  it("serves a real client from the shipped process", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", "workers/realtime-runtime.mts"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "test",
        QKERN_REALTIME_ENABLED: "true",
        QKERN_REALTIME_PORT: String(PORT),
        QKERN_REALTIME_ALLOWED_ORIGINS: ORIGIN,
        QKERN_RUNTIME_MODE: "postgres",
        QKERN_STATEMENT_ENCRYPTION_KEY: "0".repeat(64),
        QKERN_RUNTIME_DATABASE_URL: runtimeUrl!,
        // Der Prozess baut den Projekt-Key-Dienst ueber die Auth-Rolle auf:
        // Schluessel liegen in der Control Plane, aber der Weg dorthin fuehrt
        // ueber die eigene Verbindung.
        QKERN_AUTH_DATABASE_URL: authUrl!,
      },
    });
    let noise = "";
    child.stderr.on("data", (chunk: Buffer) => { noise += chunk.toString(); });
    child.stdout.on("data", (chunk: Buffer) => { noise += chunk.toString(); });

    try {
      // Auf den Listener warten, nicht auf einen Moment.
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline && !noise.includes("listening")) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(noise, "Der Prozess hat nicht gemeldet, dass er lauscht").toContain("listening");

      const url = `ws://127.0.0.1:${PORT}/realtime/v1/projects/${projectId}/environments/development`;
      const socket = new WebSocket(url, QKERN_REALTIME_PROTOCOL, { origin: ORIGIN });
      await new Promise<void>((resolve, reject) => {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
      try {
        const ready = nextMessage(socket, "ready");
        socket.send(JSON.stringify({ type: "auth", requestId: "auth-1", projectKey }));
        expect(await ready, `Prozessausgabe: ${noise.slice(-600)}`).toMatchObject({ requestId: "auth-1" });

        const subscribed = nextMessage(socket, "subscribed");
        socket.send(JSON.stringify({
          type: "subscribe", requestId: "sub-1", channel: "private:certification",
        }));
        expect(await subscribed).toMatchObject({ channel: "private:certification" });

        // Derselbe Client sendet und empfaengt: Die Kette laeuft durch den
        // Prozess, nicht an ihm vorbei.
        const delivered = nextMessage(socket, "broadcast");
        socket.send(JSON.stringify({
          type: "broadcast", requestId: "send-1", channel: "private:certification",
          event: "certification.ping", payload: { probe: "1" },
        }));
        expect(await delivered).toMatchObject({
          channel: "private:certification", event: "certification.ping",
          payload: { probe: "1" }, replay: false,
        });
      } finally {
        socket.close();
      }

      // Der Prozess nennt seinen Zustand und sonst nichts aus der
      // Konfiguration. Ein Schluessel in einem Log ueberlebt jede Rotation.
      expect(noise).not.toContain(projectKey);
      expect(noise).not.toContain("qkern_runtime_local_only");
    } finally {
      child.kill();
    }
  }, 180_000);
});
