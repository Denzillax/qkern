import type { RealtimeAuthenticator } from "@/lib/server/realtime/auth";
import type { RealtimeScope, RealtimeServerMessage, RealtimeSink } from "@/lib/server/realtime/model";
import { RealtimeError } from "@/lib/server/realtime/model";
import {
  parseRealtimeAuth,
  parseRealtimeCommand,
  parseRealtimeJson,
} from "@/lib/server/realtime/protocol";
import type { RealtimeService } from "@/lib/server/realtime/service";

export type RealtimeGatewayOptions = {
  scope: Omit<RealtimeScope, "organizationId">;
  authenticator: RealtimeAuthenticator;
  service: RealtimeService;
  sink: RealtimeSink;
  close: (code: number, reason: string) => void;
  maxMessageBytes?: number;
  maxMessagesPerWindow?: number;
  rateWindowMs?: number;
  now?: () => number;
};

export class RealtimeGatewaySession {
  private connectionId: string | null = null;
  private readonly maxMessageBytes: number;
  private readonly maxMessages: number;
  private readonly rateWindowMs: number;
  private readonly now: () => number;
  private windowStartedAt: number;
  private windowMessages = 0;
  private invalidMessages = 0;
  private closed = false;

  constructor(private readonly options: RealtimeGatewayOptions) {
    this.maxMessageBytes = bounded(options.maxMessageBytes ?? 32 * 1024, 1024, 512 * 1024);
    this.maxMessages = bounded(options.maxMessagesPerWindow ?? 100, 5, 10_000);
    this.rateWindowMs = bounded(options.rateWindowMs ?? 10_000, 1_000, 60_000);
    this.now = options.now ?? (() => Date.now());
    this.windowStartedAt = this.now();
  }

  get authenticated() { return this.connectionId !== null; }

  async receive(raw: string) {
    if (this.closed) return;
    if (Buffer.byteLength(raw, "utf8") > this.maxMessageBytes) {
      this.fail(new RealtimeError("REALTIME_PAYLOAD_TOO_LARGE"), undefined, true);
      return;
    }
    if (!this.consumeRate()) {
      this.fail(new RealtimeError("REALTIME_RATE_LIMITED"), undefined, true);
      return;
    }
    const parsed = (() => {
      try { return parseRealtimeJson(raw); }
      catch (error) { this.fail(error, undefined, !this.connectionId); return undefined; }
    })();
    if (parsed === undefined) return;
    if (!this.connectionId) {
      let auth;
      try { auth = parseRealtimeAuth(parsed); }
      catch (error) { this.fail(error, safeRequestId(parsed), true); return; }
      try {
        const authenticated = await this.options.authenticator.authenticate(this.options.scope, {
          projectKey: auth.projectKey,
          ...(auth.accessToken ? { accessToken: auth.accessToken } : {}),
        });
        if (this.closed) return;
        if (authenticated.scope.projectId !== this.options.scope.projectId ||
            authenticated.scope.environment !== this.options.scope.environment) {
          throw new RealtimeError("REALTIME_AUTH_FAILED");
        }
        this.connectionId = this.options.service.connect(
          authenticated.scope, authenticated.principal, this.options.sink,
        );
        this.options.sink.send({
          type: "ready", requestId: auth.requestId, connectionId: this.connectionId,
          heartbeatSeconds: this.options.service.heartbeatSeconds,
        });
      } catch (error) {
        this.fail(error, auth.requestId, true);
      }
      return;
    }

    let command;
    try { command = parseRealtimeCommand(parsed); }
    catch (error) { this.fail(error, safeRequestId(parsed), false); return; }
    try {
      switch (command.type) {
        case "subscribe":
          await this.options.service.subscribe(this.connectionId, command.requestId, command.channel, command.cursor);
          break;
        case "unsubscribe":
          await this.options.service.unsubscribe(this.connectionId, command.requestId, command.channel);
          break;
        case "broadcast":
          await this.options.service.broadcast(
            this.connectionId, command.requestId, command.channel, command.event, command.payload,
          );
          break;
        case "presence.track":
          await this.options.service.trackPresence(this.connectionId, command.requestId, command.channel, command.state);
          break;
        case "presence.untrack":
          await this.options.service.untrackPresence(this.connectionId, command.requestId, command.channel);
          break;
        case "ping":
          this.options.service.ping(this.connectionId, command.requestId, command.nonce);
          break;
      }
    } catch (error) {
      this.fail(error, command.requestId, false);
    }
  }

  async close() {
    this.closed = true;
    const connectionId = this.connectionId;
    this.connectionId = null;
    if (connectionId) await this.options.service.disconnect(connectionId);
  }

  private consumeRate() {
    const now = this.now();
    if (now < this.windowStartedAt || now - this.windowStartedAt >= this.rateWindowMs) {
      this.windowStartedAt = now;
      this.windowMessages = 0;
    }
    this.windowMessages += 1;
    return this.windowMessages <= this.maxMessages;
  }

  private fail(error: unknown, requestId: string | undefined, close: boolean) {
    const realtime = error instanceof RealtimeError ? error : new RealtimeError("REALTIME_INVALID_MESSAGE");
    const message: RealtimeServerMessage = {
      type: "error", ...(requestId ? { requestId } : {}), code: realtime.code,
    };
    try { this.options.sink.send(message); } catch { /* transport owns closure */ }
    if (!close) {
      this.invalidMessages += 1;
      if (this.invalidMessages < 3) return;
    }
    const authFailure = realtime.code === "REALTIME_AUTH_FAILED" || realtime.code === "REALTIME_AUTH_REQUIRED";
    this.options.close(authFailure ? 4401 : realtime.code === "REALTIME_RATE_LIMITED" ? 4429 : 4400,
      authFailure ? "Authentication failed" : "Realtime protocol error");
  }
}

function safeRequestId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const requestId = (value as { requestId?: unknown }).requestId;
  return typeof requestId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(requestId) ? requestId : undefined;
}

function bounded(value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RealtimeError("REALTIME_INVALID_MESSAGE");
  }
  return value;
}
