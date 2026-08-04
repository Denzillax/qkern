import { z } from "zod";
import { RealtimeError } from "@/lib/server/realtime/model";

const requestId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const channel = z.string().min(3).max(160).regex(/^[a-z0-9][a-z0-9:._-]+$/);
const event = z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/);

export const realtimeAuthCommand = z.object({
  type: z.literal("auth"),
  requestId,
  projectKey: z.string().regex(/^qk_(public|service)_[A-Za-z0-9_-]{43}$/),
  accessToken: z.string().min(16).max(8192).optional(),
}).strict();

export const realtimeClientCommand = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscribe"), requestId, channel,
    cursor: z.string().min(20).max(1024).optional(),
  }).strict(),
  z.object({ type: z.literal("unsubscribe"), requestId, channel }).strict(),
  z.object({ type: z.literal("broadcast"), requestId, channel, event, payload: z.unknown() }).strict(),
  z.object({ type: z.literal("presence.track"), requestId, channel, state: z.unknown() }).strict(),
  z.object({ type: z.literal("presence.untrack"), requestId, channel }).strict(),
  z.object({
    type: z.literal("ping"), requestId,
    nonce: z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/).optional(),
  }).strict(),
]);

export type RealtimeAuthCommand = z.infer<typeof realtimeAuthCommand>;
export type RealtimeClientCommand = z.infer<typeof realtimeClientCommand>;

export function parseRealtimeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new RealtimeError("REALTIME_INVALID_MESSAGE");
  }
}

export function parseRealtimeAuth(value: unknown): RealtimeAuthCommand {
  const parsed = realtimeAuthCommand.safeParse(value);
  if (!parsed.success) throw new RealtimeError("REALTIME_AUTH_FAILED");
  return parsed.data;
}

export function parseRealtimeCommand(value: unknown): RealtimeClientCommand {
  const parsed = realtimeClientCommand.safeParse(value);
  if (!parsed.success) throw new RealtimeError("REALTIME_INVALID_MESSAGE");
  return parsed.data;
}
