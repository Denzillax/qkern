import { recognisedByName } from "@/lib/server/errors/identity";
import type { Environment } from "@/lib/types";

export type RealtimeScope = {
  organizationId: string;
  projectId: string;
  environment: Environment;
};

export type RealtimeRole = "anon" | "authenticated" | "service_role";

export type RealtimePrincipal = {
  organizationId: string;
  actorRef: string;
  role: RealtimeRole;
  subject: string;
};

export type RealtimeJson = null | boolean | number | string | RealtimeJson[] | {
  [key: string]: RealtimeJson;
};

export type RealtimeStoredEvent = RealtimeScope & {
  sequence: number;
  channel: string;
  event: string;
  payload: RealtimeJson;
  actorRole: RealtimeRole;
  createdAt: Date;
};

export type RealtimePresenceEntry = {
  presenceKey: string;
  state: Record<string, RealtimeJson>;
};

export type RealtimeServerMessage =
  | { type: "ready"; requestId: string; connectionId: string; heartbeatSeconds: number }
  | { type: "subscribed"; requestId: string; channel: string; cursor: string; replayed: number }
  | { type: "unsubscribed"; requestId: string; channel: string }
  | { type: "ack"; requestId: string; operation: "broadcast" | "presence.track" | "presence.untrack"; cursor?: string }
  | { type: "broadcast"; channel: string; event: string; payload: RealtimeJson; cursor: string; actorRole: RealtimeRole; createdAt: string; replay: boolean }
  | { type: "presence"; channel: string; joins: RealtimePresenceEntry[]; leaves: string[] }
  | {
      type: "change";
      channel: string;
      schema: string;
      table: string;
      operation: "insert" | "update" | "delete";
      position: number;
      /**
       * Signierter Cursor auf genau diese Position.
       *
       * Bis hierher trug eine Aenderung nur die Position als Zahl, und ein Cursor
       * ist HMAC-signiert: Ein Client konnte sich also keinen bauen und ein
       * `changes:`-Abonnement nach einem Abbruch gar nicht wieder aufsetzen. Die
       * Position bleibt daneben stehen, weil sie vergleichbar ist und der Cursor
       * es nicht ist.
       */
      cursor: string;
      /** Zeile, wie sie dieser Abonnent sehen darf. Bei delete nur der Schluessel. */
      record: Record<string, RealtimeJson>;
      /** Wahr, wenn diese Aenderung nachgereicht wurde und nicht gerade entstand. */
      replay: boolean;
    }
  | { type: "pong"; requestId: string; nonce?: string }
  | { type: "error"; requestId?: string; code: RealtimeErrorCode };

export type RealtimeErrorCode =
  | "REALTIME_INVALID_MESSAGE"
  | "REALTIME_AUTH_REQUIRED"
  | "REALTIME_AUTH_FAILED"
  | "REALTIME_ACCESS_DENIED"
  | "REALTIME_NOT_SUBSCRIBED"
  | "REALTIME_CHANNEL_LIMIT"
  | "REALTIME_PAYLOAD_TOO_LARGE"
  | "REALTIME_CURSOR_INVALID"
  | "REALTIME_CURSOR_STALE"
  | "REALTIME_RATE_LIMITED"
  | "REALTIME_BACKPRESSURE";

export class RealtimeError extends Error {
  constructor(readonly code: RealtimeErrorCode) {
    super(code);
    this.name = "RealtimeError";
  }
}
recognisedByName(RealtimeError, "RealtimeError");

export interface RealtimeSink {
  send(message: RealtimeServerMessage): boolean;
}
