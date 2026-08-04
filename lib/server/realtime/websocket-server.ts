import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { RealtimeAuthenticator } from "@/lib/server/realtime/auth";
import { RealtimeGatewaySession } from "@/lib/server/realtime/gateway";
import type { RealtimeScope, RealtimeServerMessage } from "@/lib/server/realtime/model";
import type { RealtimeService } from "@/lib/server/realtime/service";

export const QKERN_REALTIME_PROTOCOL = "qkern.realtime.v1";

export type RealtimeWebSocketServerOptions = {
  authenticator: RealtimeAuthenticator;
  service: RealtimeService;
  allowedOrigins: ReadonlySet<string>;
  host?: string;
  port?: number;
  maxConnections?: number;
  maxMessageBytes?: number;
  maxBufferedBytes?: number;
  authTimeoutMs?: number;
  heartbeatMs?: number;
};

export function createRealtimeWebSocketServer(options: RealtimeWebSocketServerOptions) {
  const host = options.host ?? "127.0.0.1";
  const port = bounded(options.port ?? 8788, 0, 65_535, "port");
  const maxConnections = bounded(options.maxConnections ?? 500, 1, 10_000, "connection limit");
  const maxMessageBytes = bounded(options.maxMessageBytes ?? 32 * 1024, 1024, 512 * 1024, "message limit");
  const maxBufferedBytes = bounded(options.maxBufferedBytes ?? 256 * 1024, 16 * 1024, 16 * 1024 * 1024, "backpressure limit");
  const authTimeoutMs = bounded(options.authTimeoutMs ?? 5_000, 1_000, 30_000, "authentication timeout");
  const heartbeatMs = bounded(options.heartbeatMs ?? 30_000, 5_000, 120_000, "heartbeat");
  if (!options.allowedOrigins.size || options.allowedOrigins.size > 20) throw new Error("Invalid Realtime origin allowlist.");

  const pendingScopes = new WeakMap<IncomingMessage, Omit<RealtimeScope, "organizationId">>();
  const alive = new WeakMap<WebSocket, boolean>();
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ service: "qkern-realtime", status: "ok", ...options.service.stats() }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
    response.end('{"error":"Not found"}');
  });
  const webSockets = new WebSocketServer({
    noServer: true,
    clientTracking: true,
    perMessageDeflate: false,
    maxPayload: maxMessageBytes,
    handleProtocols(protocols) { return protocols.has(QKERN_REALTIME_PROTOCOL) ? QKERN_REALTIME_PROTOCOL : false; },
  });

  server.on("upgrade", (request, socket, head) => {
    const scope = upgradeScope(request);
    const origin = request.headers.origin;
    const protocols = request.headers["sec-websocket-protocol"]?.split(",").map((value) => value.trim()) ?? [];
    if (!scope || !origin || !options.allowedOrigins.has(origin) ||
        !protocols.includes(QKERN_REALTIME_PROTOCOL) || webSockets.clients.size >= maxConnections) {
      rejectUpgrade(socket, webSockets.clients.size >= maxConnections ? 503 : 403);
      return;
    }
    pendingScopes.set(request, scope);
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSockets.emit("connection", webSocket, request);
    });
  });

  webSockets.on("connection", (webSocket, request) => {
    const scope = pendingScopes.get(request);
    if (!scope) { webSocket.close(4400, "Invalid Realtime scope"); return; }
    alive.set(webSocket, true);
    webSocket.on("pong", () => alive.set(webSocket, true));
    webSocket.on("error", () => undefined);
    const sink = {
      send(message: RealtimeServerMessage) {
        if (webSocket.readyState !== WebSocket.OPEN) return false;
        const serialized = JSON.stringify(message);
        if (webSocket.bufferedAmount + Buffer.byteLength(serialized, "utf8") > maxBufferedBytes) {
          webSocket.close(1013, "Realtime backpressure limit");
          return false;
        }
        webSocket.send(serialized);
        return true;
      },
    };
    const session = new RealtimeGatewaySession({
      scope, authenticator: options.authenticator, service: options.service, sink,
      maxMessageBytes,
      close(code, reason) { if (webSocket.readyState === WebSocket.OPEN) webSocket.close(code, reason); },
    });
    const authenticationTimer = setTimeout(() => {
      if (!session.authenticated && webSocket.readyState === WebSocket.OPEN) {
        webSocket.close(4401, "Authentication timeout");
      }
    }, authTimeoutMs);
    let messageQueue = Promise.resolve();
    webSocket.on("message", (data, isBinary) => {
      if (isBinary) { webSocket.close(1003, "Text messages required"); return; }
      messageQueue = messageQueue.then(() => session.receive(data.toString("utf8"))).catch(() => {
        if (webSocket.readyState === WebSocket.OPEN) webSocket.close(1011, "Realtime session failed");
      });
    });
    webSocket.once("close", () => {
      clearTimeout(authenticationTimer);
      void session.close();
    });
  });

  const heartbeat = setInterval(() => {
    for (const webSocket of webSockets.clients) {
      if (!alive.get(webSocket)) { webSocket.terminate(); continue; }
      alive.set(webSocket, false);
      webSocket.ping();
    }
  }, heartbeatMs);
  heartbeat.unref();

  return {
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => { server.off("error", reject); resolve(); });
      });
      return (server.address() as AddressInfo).port;
    },
    async close() {
      clearInterval(heartbeat);
      for (const webSocket of webSockets.clients) webSocket.terminate();
      await Promise.all([
        new Promise<void>((resolve) => webSockets.close(() => resolve())),
        new Promise<void>((resolve) => server.close(() => resolve())),
      ]);
    },
    stats() { return { clients: webSockets.clients.size, ...options.service.stats() }; },
  };
}

function upgradeScope(request: IncomingMessage): Omit<RealtimeScope, "organizationId"> | null {
  try {
    const url = new URL(request.url ?? "", "http://qkern.local");
    const matched = url.pathname.match(/^\/realtime\/v1\/projects\/([A-Za-z0-9_-]{1,128})\/environments\/(development|staging|production)$/);
    if (!matched || url.search || url.hash) return null;
    return { projectId: matched[1], environment: matched[2] as RealtimeScope["environment"] };
  } catch { return null; }
}

function rejectUpgrade(socket: Duplex, status: 403 | 503) {
  const label = status === 503 ? "Service Unavailable" : "Forbidden";
  socket.write(`HTTP/1.1 ${status} ${label}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function bounded(value: number, min: number, max: number, label: string) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid Realtime ${label}.`);
  return value;
}
