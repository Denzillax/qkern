import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createQKERNMcpServer, mcpContextFromEnv, type MCPContext } from "@/mcp/server";
import { admitMcpOAuthRequest } from "@/mcp/oauth-gate";
import { getProjectDataPlane } from "@/lib/server/data-plane/runtime";
import { getGeneratedDataApi } from "@/lib/server/data-plane/generated-runtime";

/**
 * Wie dieser Server Aufrufer einlaesst (2.91).
 *
 * `static`: der Bearer aus `QKERN_MCP_TOKEN`, der Mandant aus der
 * Prozessumgebung, alle Werkzeuge. Bequem auf dem eigenen Rechner, und nur
 * dort: Das Token wird nicht widerrufen, es steht in einer Datei neben dem
 * Projekt, es nennt keinen Nutzer, und es traegt keine Bereiche. Nichts davon
 * ist im Betrieb zu verantworten, und darum steht der Riegel unten weiter, nur
 * eben genau vor dieser Betriebsart und nicht mehr vor dem ganzen Transport.
 *
 * `oauth`: ein Token aus dem Ablauf von 2.82, der Mandant aus dem, was der
 * Aufrufer vorlegt, und nur die Werkzeuge der zugestimmten Bereiche. Das ist
 * das Gate, auf das `docs/MCP_REMOTE_AUTH.md` gewartet hat, und darum faellt
 * der Riegel fuer diesen Weg.
 *
 * Die Vorgabe richtet sich nach `NODE_ENV`, damit niemand die sichere
 * Betriebsart erst einschalten muss: In Production ist `oauth` die Vorgabe,
 * sonst `static`. Wer es anders will, schreibt es hin.
 */
const MCP_AUTH_MODES = ["static", "oauth"] as const;
type McpAuthMode = (typeof MCP_AUTH_MODES)[number];
const configuredMode = (process.env.QKERN_MCP_AUTH ?? "").trim();
const mode: McpAuthMode = configuredMode === ""
  ? (process.env.NODE_ENV === "production" ? "oauth" : "static")
  : (MCP_AUTH_MODES as readonly string[]).includes(configuredMode)
    ? configuredMode as McpAuthMode
    : (() => { throw new Error(`QKERN_MCP_AUTH must be one of ${MCP_AUTH_MODES.join(", ")}.`); })();

// Der Riegel, an der Stelle, an der er noch noetig ist: vor dem statischen
// Bearer und nicht mehr vor dem Transport. Er nennt jetzt auch den Ausweg,
// denn seit 2.82 gibt es einen.
if (mode === "static" && process.env.NODE_ENV === "production") {
  throw new Error("Static Bearer MCP transport is local-only: the token is not revocable, names no user and carries no scopes. Set QKERN_MCP_AUTH=oauth to serve remote MCP through the OAuth resource-server gate documented in docs/MCP_REMOTE_AUTH.md.");
}

const port = Number(process.env.QKERN_MCP_PORT ?? 8787);

/**
 * Der statische Bearer, samt dem Mandanten aus der Prozessumgebung. Beides wird
 * im OAuth-Betrieb nicht einmal gelesen: Ein Server, der ohne Token starten
 * kann, soll auch keines verlangen, und ein Mandant, der dort nicht gilt, soll
 * dort auch nicht herumliegen.
 */
const staticBearer = mode === "static" ? (() => {
  const token = process.env.QKERN_MCP_TOKEN ?? "";
  if (token.length < 16) throw new Error("QKERN_MCP_TOKEN must contain at least 16 characters.");
  const expiry = process.env.QKERN_MCP_TOKEN_EXPIRES_AT
    ? Date.parse(process.env.QKERN_MCP_TOKEN_EXPIRES_AT) : Number.NaN;
  return { token, expiry, context: mcpContextFromEnv() };
})() : null;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const host = process.env.QKERN_MCP_HOST?.trim() || "127.0.0.1";
// Der statische Bearer verlaesst die Schleife nicht. Ohne diese Zeile waere
// "lokal" eine Zusage, die an einer einzigen Umgebungsvariablen haengt.
if (mode === "static" && !LOCAL_HOSTS.has(host)) {
  throw new Error("QKERN_MCP_HOST must stay on the loopback interface while QKERN_MCP_AUTH=static.");
}
const allowedHosts = (process.env.QKERN_MCP_ALLOWED_HOSTS ?? "")
  .split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
// Der SDK schaltet den Schutz gegen DNS-Rebinding nur fuer Loopback-Adressen
// von selbst ein. Wer weiter bindet, muss die erlaubten Hostnamen hinschreiben,
// sonst faellt der Schutz beim Wechsel auf 0.0.0.0 still weg, und ein stiller
// Wegfall ist schlimmer als eine Zeile Arbeit.
if (!LOCAL_HOSTS.has(host) && allowedHosts.length === 0) {
  throw new Error("QKERN_MCP_ALLOWED_HOSTS must list the hostnames this server answers for when QKERN_MCP_HOST is not a loopback address.");
}

const app = createMcpExpressApp(allowedHosts.length > 0 ? { host, allowedHosts } : { host });
function boundedInteger(raw: string | undefined, fallback: number, minimum: number, maximum: number, name: string) {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  return value;
}

const MAX_SESSIONS = boundedInteger(process.env.QKERN_MCP_MAX_SESSIONS, 100, 1, 10_000, "QKERN_MCP_MAX_SESSIONS");
const SESSION_TTL_MS = boundedInteger(process.env.QKERN_MCP_SESSION_TTL_MS, 15 * 60 * 1_000, 1_000, 24 * 60 * 60 * 1_000, "QKERN_MCP_SESSION_TTL_MS");
const transports = new Map<string, {
  transport: StreamableHTTPServerTransport;
  lastSeenAt: number;
  /**
   * Woran diese Sitzung haengt (2.91): beim statischen Bearer die Betriebsart,
   * beim OAuth-Token die Pruefsumme genau dieses Tokens.
   *
   * Ohne diese Bindung waere eine Sitzungskennung der eigentliche Schluessel:
   * Wer sie kennt und irgendein gueltiges Token dieses Servers hat, spraeche
   * weiter in der Sitzung, die ein anderer Nutzer mit anderen Bereichen
   * begonnen hat. Die angemeldeten Werkzeuge stehen naemlich am
   * Server-Objekt der Sitzung und nicht an der einzelnen Anfrage.
   */
  binding: string;
}>();

function purgeExpiredSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [sessionId, active] of transports) {
    if (active.lastSeenAt < cutoff) {
      transports.delete(sessionId);
      void active.transport.close().catch(() => undefined);
    }
  }
}

function validBearer(header: string | undefined) {
  if (!staticBearer) return false;
  if (Number.isFinite(staticBearer.expiry) && staticBearer.expiry <= Date.now()) return false;
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const expectedBytes = Buffer.from(staticBearer.token);
  const suppliedBytes = Buffer.from(supplied);
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

/**
 * Was eine eingelassene Anfrage mitbringt: ihren Mandanten und ihre Bindung.
 *
 * In einer WeakMap und nicht an der Anfrage selbst, damit keine Kopfzeile und
 * kein spaeterer Handler ein Feld setzen kann, das wie ein Ergebnis dieser
 * Pruefung aussieht.
 */
const admitted = new WeakMap<Request, { context: MCPContext; binding: string }>();

app.use((request: Request, response: Response, next: NextFunction) => {
  if (mode === "static") {
    if (!validBearer(request.headers.authorization) || !staticBearer) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }
    admitted.set(request, { context: staticBearer.context, binding: "static" });
    next();
    return;
  }
  void admitMcpOAuthRequest({
    authorization: request.headers.authorization,
    projectKey: typeof request.headers["x-qkern-key"] === "string"
      ? request.headers["x-qkern-key"] : undefined,
  }).then((admission) => {
    if (!admission.ok) {
      response.status(admission.status).json({ error: admission.error });
      return;
    }
    admitted.set(request, { context: admission.context, binding: admission.sessionBinding });
    next();
  }).catch((error) => {
    console.error("QKERN MCP admission failed", error instanceof Error ? error.message : error);
    // Ein Fehler in der Pruefung ist kein Einlass. Und er sagt nach aussen
    // nichts ueber sich: Wer erfaehrt, dass die Pruefung selbst gestolpert ist,
    // weiss mehr ueber diesen Server als ein abgewiesener Aufrufer soll.
    if (!response.headersSent) response.status(401).json({ error: "Unauthorized" });
  });
});

/**
 * Die Sitzung zu dieser Anfrage, oder keine.
 *
 * Eine Sitzung gehoert dem, der sie begonnen hat. Welche Werkzeuge in ihr
 * angemeldet sind, entschied das Token von damals, und es waere sonst genug,
 * die Kennung zu kennen und irgendein gueltiges Token dieses Servers zu haben,
 * um in fremden Bereichen zu arbeiten.
 *
 * Eine fremde Sitzung ist darum keine Sitzung: dieselbe Antwort wie auf eine
 * erfundene Kennung. Wer eine raet, soll nicht daran erkennen, dass er richtig
 * geraten hat.
 */
function boundSession(request: Request) {
  const sessionId = request.headers["mcp-session-id"] as string | undefined;
  const active = sessionId ? transports.get(sessionId) : undefined;
  if (!active) return undefined;
  const entry = admitted.get(request);
  if (!entry || entry.binding !== active.binding) return undefined;
  active.lastSeenAt = Date.now();
  return active;
}

app.post("/mcp", async (request: Request, response: Response) => {
  try {
    purgeExpiredSessions();
    const entry = admitted.get(request);
    if (!entry) { response.status(401).json({ error: "Unauthorized" }); return; }
    const sessionId = request.headers["mcp-session-id"] as string | undefined;
    const active = boundSession(request);
    let transport = active?.transport;
    if (!transport && !sessionId && isInitializeRequest(request.body)) {
      if (transports.size >= MAX_SESSIONS) {
        response.status(503).json({ error: "MCP session capacity reached" });
        return;
      }
      const binding = entry.binding;
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, { transport: transport!, lastSeenAt: Date.now(), binding });
        },
      });
      transport.onclose = () => {
        if (transport?.sessionId) transports.delete(transport.sessionId);
      };
      // Der Mandant dieser Sitzung kommt aus dieser Anfrage und nicht aus dem
      // Prozess. Beim statischen Bearer ist es derselbe wie immer, beim
      // OAuth-Token der des vorgelegten Tokens, und die Werkzeuge sind die
      // seiner Bereiche.
      await createQKERNMcpServer(entry.context, {
        dataPlane: await getProjectDataPlane(),
        generatedDataApi: await getGeneratedDataApi(),
      }).connect(transport);
    }
    if (!transport) {
      response.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Invalid or missing MCP session" }, id: null });
      return;
    }
    await transport.handleRequest(request, response, request.body);
  } catch (error) {
    console.error("QKERN MCP request failed", error instanceof Error ? error.message : error);
    if (!response.headersSent) response.status(500).json({ error: "MCP request failed" });
  }
});

app.get("/mcp", async (request: Request, response: Response) => {
  purgeExpiredSessions();
  const active = boundSession(request);
  if (!active) { response.status(400).send("Invalid MCP session"); return; }
  await active.transport.handleRequest(request, response);
});

app.delete("/mcp", async (request: Request, response: Response) => {
  purgeExpiredSessions();
  const active = boundSession(request);
  if (!active) { response.status(400).send("Invalid MCP session"); return; }
  await active.transport.handleRequest(request, response);
});

app.get("/health", (_request: Request, response: Response) => response.json({ service: "qkern-mcp-server", status: "ok" }));

app.listen(port, host, (error?: Error) => {
  if (error) throw error;
  console.error(`QKERN MCP Server listening on ${host}:${port}/mcp with QKERN_MCP_AUTH=${mode}`);
});
