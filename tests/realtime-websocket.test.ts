import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { RealtimeAuthenticator } from "@/lib/server/realtime/auth";
import { RealtimeCursorCodec } from "@/lib/server/realtime/cursor";
import type { RealtimeServerMessage } from "@/lib/server/realtime/model";
import { PrefixRealtimeAuthorization } from "@/lib/server/realtime/policy";
import { MemoryRealtimeEventLog } from "@/lib/server/realtime/repository";
import { RealtimeService } from "@/lib/server/realtime/service";
import {
  createRealtimeWebSocketServer,
  QKERN_REALTIME_PROTOCOL,
} from "@/lib/server/realtime/websocket-server";

const origin = "http://localhost:3000";
const projectKey = `qk_public_${"A".repeat(43)}`;

function openSocket(url: string, socketOrigin = origin) {
  const socket = new WebSocket(url, QKERN_REALTIME_PROTOCOL, { origin: socketOrigin });
  return new Promise<WebSocket>((resolve, reject) => {
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextMessage<T extends RealtimeServerMessage["type"]>(socket: WebSocket, type: T) {
  return new Promise<Extract<RealtimeServerMessage, { type: T }>>((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${type}`)); }, 2_000);
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

async function authenticate(socket: WebSocket, requestId: string) {
  const ready = nextMessage(socket, "ready");
  socket.send(JSON.stringify({ type: "auth", requestId, projectKey, accessToken: "A".repeat(16) }));
  return await ready;
}

function rejectedStatus(url: string, socketOrigin: string) {
  return new Promise<number | undefined>((resolve, reject) => {
    const socket = new WebSocket(url, QKERN_REALTIME_PROTOCOL, { origin: socketOrigin });
    const timeout = setTimeout(() => { socket.terminate(); reject(new Error("Upgrade did not finish")); }, 2_000);
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timeout);
      const status = response.statusCode;
      response.resume();
      resolve(status);
    });
    socket.once("open", () => { clearTimeout(timeout); socket.close(); reject(new Error("Upgrade was accepted")); });
    socket.once("error", () => undefined);
  });
}

describe("Realtime WebSocket server", () => {
  it("authenticates real sockets and broadcasts inside one scoped channel", async () => {
    const authenticator: RealtimeAuthenticator = {
      async authenticate(scope, credentials) {
        if (credentials.projectKey !== projectKey || !credentials.accessToken) throw new Error("invalid");
        return {
          scope: { organizationId: "org-realtime", ...scope },
          principal: {
            organizationId: "org-realtime", actorRef: "project-auth-user:alice",
            role: "authenticated", subject: "alice",
          },
        };
      },
    };
    const service = new RealtimeService({
      eventLog: new MemoryRealtimeEventLog(), authorization: new PrefixRealtimeAuthorization(),
      cursor: new RealtimeCursorCodec(Buffer.alloc(32, 5)),
    });
    const runtime = createRealtimeWebSocketServer({
      authenticator, service, allowedOrigins: new Set([origin]), port: 0, heartbeatMs: 5_000,
    });
    const port = await runtime.listen();
    const url = `ws://127.0.0.1:${port}/realtime/v1/projects/project-realtime/environments/development`;
    const publisher = await openSocket(url);
    const subscriber = await openSocket(url);
    try {
      await Promise.all([authenticate(publisher, "auth-publisher"), authenticate(subscriber, "auth-subscriber")]);
      const publisherSubscribed = nextMessage(publisher, "subscribed");
      publisher.send(JSON.stringify({ type: "subscribe", requestId: "sub-publisher", channel: "private:orders" }));
      await publisherSubscribed;
      const subscriberSubscribed = nextMessage(subscriber, "subscribed");
      subscriber.send(JSON.stringify({ type: "subscribe", requestId: "sub-subscriber", channel: "private:orders" }));
      await subscriberSubscribed;

      const acknowledgement = nextMessage(publisher, "ack");
      const delivered = nextMessage(subscriber, "broadcast");
      publisher.send(JSON.stringify({
        type: "broadcast", requestId: "send-1", channel: "private:orders",
        event: "order.created", payload: { orderId: "order-1" },
      }));
      expect(await acknowledgement).toMatchObject({ operation: "broadcast", requestId: "send-1" });
      expect(await delivered).toMatchObject({
        channel: "private:orders", event: "order.created", payload: { orderId: "order-1" }, replay: false,
      });
      expect(runtime.stats()).toMatchObject({ clients: 2, connections: 2, subscriptions: 2 });
    } finally {
      publisher.terminate();
      subscriber.terminate();
      await runtime.close();
    }
  });

  it("rejects unlisted origins and any query-string credentials before upgrade", async () => {
    const authenticator: RealtimeAuthenticator = { async authenticate() { throw new Error("not reached"); } };
    const service = new RealtimeService({
      eventLog: new MemoryRealtimeEventLog(), authorization: new PrefixRealtimeAuthorization(),
      cursor: new RealtimeCursorCodec(Buffer.alloc(32, 6)),
    });
    const runtime = createRealtimeWebSocketServer({
      authenticator, service, allowedOrigins: new Set([origin]), port: 0, heartbeatMs: 5_000,
    });
    const port = await runtime.listen();
    const base = `ws://127.0.0.1:${port}/realtime/v1/projects/project-realtime/environments/development`;
    try {
      expect(await rejectedStatus(base, "https://attacker.example")).toBe(403);
      expect(await rejectedStatus(`${base}?projectKey=${projectKey}`, origin)).toBe(403);
    } finally {
      await runtime.close();
    }
  });
});
