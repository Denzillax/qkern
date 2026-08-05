import type { CronDefinition } from "@/lib/server/compute/model";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import type { ProjectQueueService } from "@/lib/server/project-queues/service";

export function nextCronOccurrence(expression: string, after: Date): Date {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5 || fields[2] !== "*" || fields[3] !== "*" || fields[4] !== "*") {
    throw new Error("Unsupported cron expression.");
  }
  const interval = /^\*\/([1-9]|[1-5][0-9])$/.exec(fields[0]);
  if (interval && fields[1] === "*") {
    const minutes = Number(interval[1]);
    const next = new Date(after);
    next.setUTCSeconds(0, 0);
    next.setUTCMinutes(next.getUTCMinutes() + 1);
    while (next.getUTCMinutes() % minutes !== 0) next.setUTCMinutes(next.getUTCMinutes() + 1);
    return next;
  }
  const minute = Number(fields[0]);
  const hour = Number(fields[1]);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59 ||
      !Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error("Unsupported cron expression.");
  const next = new Date(after);
  next.setUTCHours(hour, minute, 0, 0);
  if (next <= after) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export class CronDispatcher {
  constructor(private readonly queues: Pick<ProjectQueueService, "enqueue">) {}

  async dispatch(
    definition: CronDefinition,
    scheduledAt: Date,
    principal: ProjectQueuePrincipal,
  ) {
    if (!definition.enabled || principal.role !== "service_role" ||
        principal.organizationId !== definition.organizationId ||
        nextCronOccurrence(definition.expression, new Date(scheduledAt.getTime() - 60_000)).getTime() !== scheduledAt.getTime()) {
      throw new Error("Cron dispatch is not authorized for this occurrence.");
    }
    const receipt = await this.queues.enqueue(principal, {
      organizationId: definition.organizationId,
      projectId: definition.projectId,
      environment: definition.environment,
    }, definition.queue, {
      payload: definition.payload,
      dedupeKey: `cron:${definition.id}:${scheduledAt.toISOString()}`,
      // Bewusst **kein** scheduledAt. Ein Vorkommen ist faellig, wenn es
      // ausgeloest wird; die Nachricht soll sofort verfuegbar sein. Wurde der
      // Zeitpunkt weitergereicht, wies die Queue jedes nachgeholte Vorkommen
      // ab: sie akzeptiert hoechstens fuenf Minuten Rueckdatierung, und ein
      // Rueckstand nach einem Ausfall ist aelter. Das Nachholen konnte damit
      // nie funktionieren. Die Identitaet des Vorkommens steckt im
      // Dedupe-Key, nicht in der Verfuegbarkeit.
    });
    return Object.freeze({
      status: receipt.deduplicated ? "already_dispatched" as const : "dispatched" as const,
      messageId: receipt.id,
      scheduledAt: scheduledAt.toISOString(),
    });
  }
}
