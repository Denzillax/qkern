import type { RealtimeScope, RealtimeStoredEvent } from "@/lib/server/realtime/model";
import { RealtimeError } from "@/lib/server/realtime/model";

export interface RealtimeEventLog {
  append(event: Omit<RealtimeStoredEvent, "sequence">): Promise<RealtimeStoredEvent>;
  replay(scope: RealtimeScope, channel: string, afterSequence: number, limit: number): Promise<{
    events: RealtimeStoredEvent[];
    latestSequence: number;
    stale: boolean;
  }>;
  latestSequence(scope: RealtimeScope, channel: string): Promise<number>;
}

export class MemoryRealtimeEventLog implements RealtimeEventLog {
  private readonly channels = new Map<string, { nextSequence: number; events: RealtimeStoredEvent[] }>();

  constructor(private readonly maxEventsPerChannel = 200) {
    if (!Number.isInteger(maxEventsPerChannel) || maxEventsPerChannel < 1 || maxEventsPerChannel > 10_000) {
      throw new RealtimeError("REALTIME_INVALID_MESSAGE");
    }
  }

  async append(event: Omit<RealtimeStoredEvent, "sequence">): Promise<RealtimeStoredEvent> {
    const key = channelKey(event, event.channel);
    const channel = this.channels.get(key) ?? { nextSequence: 1, events: [] };
    const stored = cloneEvent({ ...event, sequence: channel.nextSequence++ });
    channel.events.push(stored);
    if (channel.events.length > this.maxEventsPerChannel) channel.events.shift();
    this.channels.set(key, channel);
    return cloneEvent(stored);
  }

  async replay(scope: RealtimeScope, channelName: string, afterSequence: number, limit: number) {
    const channel = this.channels.get(channelKey(scope, channelName));
    const latestSequence = channel ? channel.nextSequence - 1 : 0;
    const earliestSequence = channel?.events[0]?.sequence ?? latestSequence + 1;
    const available = channel?.events.filter((event) => event.sequence > afterSequence) ?? [];
    return {
      events: available.slice(0, limit).map(cloneEvent),
      latestSequence,
      stale: afterSequence > latestSequence || afterSequence < earliestSequence - 1 || available.length > limit,
    };
  }

  async latestSequence(scope: RealtimeScope, channelName: string) {
    return (this.channels.get(channelKey(scope, channelName))?.nextSequence ?? 1) - 1;
  }
}

function channelKey(scope: RealtimeScope, channel: string) {
  return `${scope.organizationId}\u0000${scope.projectId}\u0000${scope.environment}\u0000${channel}`;
}

function cloneEvent(event: RealtimeStoredEvent): RealtimeStoredEvent {
  return { ...event, payload: structuredClone(event.payload), createdAt: new Date(event.createdAt) };
}
