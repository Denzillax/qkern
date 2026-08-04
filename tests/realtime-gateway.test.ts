import { describe, expect, it } from "vitest";
import type { RealtimeAuthenticator, RealtimeCredentials } from "@/lib/server/realtime/auth";
import { RealtimeCursorCodec } from "@/lib/server/realtime/cursor";
import { RealtimeGatewaySession } from "@/lib/server/realtime/gateway";
import type { RealtimeServerMessage, RealtimeSink } from "@/lib/server/realtime/model";
import { PrefixRealtimeAuthorization } from "@/lib/server/realtime/policy";
import { MemoryRealtimeEventLog } from "@/lib/server/realtime/repository";
import { RealtimeService } from "@/lib/server/realtime/service";

const projectKey = `qk_public_${"A".repeat(43)}`;
const scope = { projectId: "project-realtime", environment: "development" as const };

class Sink implements RealtimeSink {
  readonly messages: RealtimeServerMessage[] = [];
  send(message: RealtimeServerMessage) { this.messages.push(structuredClone(message)); return true; }
}

function fixture(options: { maxMessages?: number } = {}) {
  const credentials: RealtimeCredentials[] = [];
  const closes: Array<{ code: number; reason: string }> = [];
  const sink = new Sink();
  const service = new RealtimeService({
    eventLog: new MemoryRealtimeEventLog(), authorization: new PrefixRealtimeAuthorization(),
    cursor: new RealtimeCursorCodec(Buffer.alloc(32, 9)), heartbeatSeconds: 15,
  });
  const authenticator: RealtimeAuthenticator = {
    async authenticate(authScope, supplied) {
      credentials.push({ ...supplied });
      if (supplied.projectKey !== projectKey) throw new Error("invalid key");
      return {
        scope: { organizationId: "org-realtime", ...authScope },
        principal: {
          organizationId: "org-realtime", actorRef: "project-auth-user:alice",
          role: "authenticated", subject: "alice",
        },
      };
    },
  };
  const session = new RealtimeGatewaySession({
    scope, authenticator, service, sink,
    close: (code, reason) => closes.push({ code, reason }),
    maxMessagesPerWindow: options.maxMessages,
  });
  return { session, sink, closes, credentials, service };
}

describe("Realtime gateway session", () => {
  it("requires authentication as the first frame and never echoes credentials", async () => {
    const built = fixture();
    const raw = JSON.stringify({ type: "ping", requestId: "first", nonce: "secret-token" });
    await built.session.receive(raw);
    expect(built.sink.messages).toEqual([{ type: "error", requestId: "first", code: "REALTIME_AUTH_FAILED" }]);
    expect(built.closes).toEqual([{ code: 4401, reason: "Authentication failed" }]);
    expect(JSON.stringify({ messages: built.sink.messages, closes: built.closes })).not.toContain("secret-token");
  });

  it("authenticates once, delegates commands and returns only server-derived state", async () => {
    const built = fixture();
    const accessToken = "sensitive-access-token";
    await built.session.receive(JSON.stringify({
      type: "auth", requestId: "auth-1", projectKey, accessToken,
    }));
    expect(built.session.authenticated).toBe(true);
    expect(built.credentials).toEqual([{ projectKey, accessToken }]);
    expect(built.sink.messages[0]).toMatchObject({ type: "ready", requestId: "auth-1", heartbeatSeconds: 15 });
    expect(JSON.stringify(built.sink.messages)).not.toContain(projectKey);
    expect(JSON.stringify(built.sink.messages)).not.toContain(accessToken);

    await built.session.receive(JSON.stringify({
      type: "subscribe", requestId: "sub-1", channel: "private:room",
    }));
    await built.session.receive(JSON.stringify({ type: "ping", requestId: "ping-1", nonce: "n-1" }));
    expect(built.sink.messages.some((message) => message.type === "subscribed")).toBe(true);
    expect(built.sink.messages).toContainEqual({ type: "pong", requestId: "ping-1", nonce: "n-1" });
  });

  it("closes after three invalid commands and immediately on rate exhaustion", async () => {
    const invalid = fixture();
    await invalid.session.receive(JSON.stringify({ type: "auth", requestId: "auth", projectKey }));
    for (let index = 0; index < 3; index += 1) {
      await invalid.session.receive(JSON.stringify({ type: "unknown", requestId: `bad-${index}` }));
    }
    expect(invalid.closes.at(-1)).toEqual({ code: 4400, reason: "Realtime protocol error" });

    const limited = fixture({ maxMessages: 5 });
    await limited.session.receive(JSON.stringify({ type: "auth", requestId: "auth", projectKey }));
    for (let index = 0; index < 5; index += 1) {
      await limited.session.receive(JSON.stringify({ type: "ping", requestId: `ping-${index}` }));
    }
    expect(limited.sink.messages.at(-1)).toMatchObject({ type: "error", code: "REALTIME_RATE_LIMITED" });
    expect(limited.closes.at(-1)).toEqual({ code: 4429, reason: "Realtime protocol error" });
  });

  it("does not create an orphan connection when the socket closes during authentication", async () => {
    let release!: () => void;
    const authentication = new Promise<void>((resolve) => { release = resolve; });
    const sink = new Sink();
    const service = new RealtimeService({
      eventLog: new MemoryRealtimeEventLog(), authorization: new PrefixRealtimeAuthorization(),
      cursor: new RealtimeCursorCodec(Buffer.alloc(32, 4)),
    });
    const authenticator: RealtimeAuthenticator = {
      async authenticate(authScope) {
        await authentication;
        return {
          scope: { organizationId: "org-realtime", ...authScope },
          principal: {
            organizationId: "org-realtime", actorRef: "project-auth-user:alice",
            role: "authenticated", subject: "alice",
          },
        };
      },
    };
    const session = new RealtimeGatewaySession({
      scope, authenticator, service, sink, close: () => undefined,
    });
    const receiving = session.receive(JSON.stringify({ type: "auth", requestId: "auth", projectKey }));
    await session.close();
    release();
    await receiving;
    expect(service.stats()).toEqual({ connections: 0, subscriptions: 0 });
    expect(sink.messages).toEqual([]);
  });

  it("rejects an authenticator result that does not match the URL scope", async () => {
    const sink = new Sink();
    const closes: number[] = [];
    const service = new RealtimeService({
      eventLog: new MemoryRealtimeEventLog(), authorization: new PrefixRealtimeAuthorization(),
      cursor: new RealtimeCursorCodec(Buffer.alloc(32, 3)),
    });
    const session = new RealtimeGatewaySession({
      scope,
      authenticator: {
        async authenticate() {
          return {
            scope: { organizationId: "org-realtime", projectId: "another-project", environment: "development" },
            principal: {
              organizationId: "org-realtime", actorRef: "project-auth-user:alice",
              role: "authenticated", subject: "alice",
            },
          };
        },
      },
      service, sink, close: (code) => closes.push(code),
    });
    await session.receive(JSON.stringify({ type: "auth", requestId: "auth", projectKey }));
    expect(sink.messages).toEqual([{ type: "error", requestId: "auth", code: "REALTIME_AUTH_FAILED" }]);
    expect(closes).toEqual([4401]);
    expect(service.stats().connections).toBe(0);
  });
});
