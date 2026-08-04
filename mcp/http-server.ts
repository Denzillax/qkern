import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createQKERNMcpServer, mcpContextFromEnv } from "@/mcp/server";
import { getProjectDataPlane } from "@/lib/server/data-plane/runtime";
import { getGeneratedDataApi } from "@/lib/server/data-plane/generated-runtime";

if (process.env.NODE_ENV === "production") {
  throw new Error("Static Bearer MCP transport is local-only. Production remote MCP requires the OAuth resource-server gate documented in docs/MCP_REMOTE_AUTH.md.");
}

const port = Number(process.env.QKERN_MCP_PORT ?? 8787);
const configuredToken = process.env.QKERN_MCP_TOKEN ?? "";
if (configuredToken.length < 16) throw new Error("QKERN_MCP_TOKEN must contain at least 16 characters.");
const configuredExpiry = process.env.QKERN_MCP_TOKEN_EXPIRES_AT ? Date.parse(process.env.QKERN_MCP_TOKEN_EXPIRES_AT) : Number.NaN;

const context = mcpContextFromEnv();

const app = createMcpExpressApp({ host: "127.0.0.1" });
function boundedInteger(raw: string | undefined, fallback: number, minimum: number, maximum: number, name: string) {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  return value;
}

const MAX_SESSIONS = boundedInteger(process.env.QKERN_MCP_MAX_SESSIONS, 100, 1, 10_000, "QKERN_MCP_MAX_SESSIONS");
const SESSION_TTL_MS = boundedInteger(process.env.QKERN_MCP_SESSION_TTL_MS, 15 * 60 * 1_000, 1_000, 24 * 60 * 60 * 1_000, "QKERN_MCP_SESSION_TTL_MS");
const transports = new Map<string, { transport: StreamableHTTPServerTransport; lastSeenAt: number }>();

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
  if (Number.isFinite(configuredExpiry) && configuredExpiry <= Date.now()) return false;
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const expectedBytes = Buffer.from(configuredToken);
  const suppliedBytes = Buffer.from(supplied);
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

app.use((request: Request, response: Response, next: NextFunction) => {
  if (!validBearer(request.headers.authorization)) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

app.post("/mcp", async (request: Request, response: Response) => {
  try {
    purgeExpiredSessions();
    const sessionId = request.headers["mcp-session-id"] as string | undefined;
    const active = sessionId ? transports.get(sessionId) : undefined;
    let transport = active?.transport;
    if (active) active.lastSeenAt = Date.now();
    if (!transport && !sessionId && isInitializeRequest(request.body)) {
      if (transports.size >= MAX_SESSIONS) {
        response.status(503).json({ error: "MCP session capacity reached" });
        return;
      }
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => { transports.set(id, { transport: transport!, lastSeenAt: Date.now() }); },
      });
      transport.onclose = () => {
        if (transport?.sessionId) transports.delete(transport.sessionId);
      };
      await createQKERNMcpServer(context, {
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
  const sessionId = request.headers["mcp-session-id"] as string | undefined;
  const active = sessionId ? transports.get(sessionId) : undefined;
  if (!active) { response.status(400).send("Invalid MCP session"); return; }
  active.lastSeenAt = Date.now();
  await active.transport.handleRequest(request, response);
});

app.delete("/mcp", async (request: Request, response: Response) => {
  purgeExpiredSessions();
  const sessionId = request.headers["mcp-session-id"] as string | undefined;
  const active = sessionId ? transports.get(sessionId) : undefined;
  if (!active) { response.status(400).send("Invalid MCP session"); return; }
  await active.transport.handleRequest(request, response);
});

app.get("/health", (_request: Request, response: Response) => response.json({ service: "qkern-mcp-server", status: "ok" }));

app.listen(port, "127.0.0.1", (error?: Error) => {
  if (error) throw error;
  console.error(`QKERN MCP Server listening on http://127.0.0.1:${port}/mcp`);
});
