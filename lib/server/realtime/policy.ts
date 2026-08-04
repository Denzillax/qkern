import type { RealtimePrincipal, RealtimeScope } from "@/lib/server/realtime/model";
import { RealtimeError } from "@/lib/server/realtime/model";

export type RealtimeChannelAction = "subscribe" | "broadcast" | "presence";

export interface RealtimeAuthorizationPort {
  authorize(input: {
    scope: RealtimeScope;
    principal: RealtimePrincipal;
    channel: string;
    action: RealtimeChannelAction;
  }): Promise<boolean>;
}

export class PrefixRealtimeAuthorization implements RealtimeAuthorizationPort {
  async authorize(input: {
    scope: RealtimeScope;
    principal: RealtimePrincipal;
    channel: string;
    action: RealtimeChannelAction;
  }) {
    const { principal, channel, action } = input;
    if (principal.organizationId !== input.scope.organizationId || !validChannel(channel)) return false;
    const [kind, subject] = channel.split(":", 3);
    if (principal.role === "service_role") return action !== "presence";
    if (principal.role === "anon") return kind === "public" && action === "subscribe";
    if (kind === "public" || kind === "private") return true;
    return kind === "user" && subject === principal.subject;
  }
}

export function assertRealtimeChannel(channel: string) {
  if (!validChannel(channel)) throw new RealtimeError("REALTIME_ACCESS_DENIED");
}

function validChannel(channel: string) {
  if (channel.length < 3 || channel.length > 160 || !/^[a-z0-9][a-z0-9:._-]+$/.test(channel)) return false;
  const parts = channel.split(":");
  if (parts.some((part) => !part || part.length > 80 || !/^[a-z0-9][a-z0-9._-]*$/.test(part))) return false;
  if (parts[0] === "user") return parts.length >= 3 && parts.length <= 5;
  return ["public", "private"].includes(parts[0]) && parts.length >= 2 && parts.length <= 4;
}
