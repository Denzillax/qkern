import type { ProjectQueueScope, ProjectQueueStatus } from "@/lib/server/project-queues/model";

/**
 * Prometheus-Textformat (exposition 0.0.4) fuer die Queues eines Scopes —
 * der Metrics-Export der Paritaetsleiter.
 *
 * Reine Funktion: Wer sie ruft, entscheidet die Grenze; hier entsteht nur
 * Text. Jede Queue erscheint mit **allen** fuenf Zustaenden, auch wenn alle
 * Zaehler null sind — ein Scraper braucht die Zeitreihe, bevor sie sich
 * bewegt. Genau diese Vollstaendigkeit ist das Mutationsziel von 1.88.
 */
export const QUEUE_METRICS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

const STATES = ["available", "scheduled", "inFlight", "completed", "deadLettered"] as const;

export function renderQueueMetrics(
  scope: ProjectQueueScope,
  statuses: readonly ProjectQueueStatus[],
  now: Date,
): string {
  const lines = [
    "# HELP qkern_queue_messages Messages per queue and state.",
    "# TYPE qkern_queue_messages gauge",
  ];
  const base = `project="${label(scope.projectId)}",environment="${label(scope.environment)}"`;
  for (const status of statuses) {
    for (const state of STATES) {
      lines.push(`qkern_queue_messages{${base},queue="${label(status.queue)}",state="${snake(state)}"} ${status[state]}`);
    }
  }
  lines.push(
    "# HELP qkern_queue_oldest_available_age_seconds Age of the oldest available message; 0 when none waits.",
    "# TYPE qkern_queue_oldest_available_age_seconds gauge",
  );
  for (const status of statuses) {
    const age = status.oldestAvailableAt === null
      ? 0
      : Math.max(0, Math.floor((now.getTime() - new Date(status.oldestAvailableAt).getTime()) / 1_000));
    lines.push(`qkern_queue_oldest_available_age_seconds{${base},queue="${label(status.queue)}"} ${age}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Label-Werte nach Exposition-Format: Backslash, Anfuehrungszeichen und Zeilenumbruch maskiert. */
function label(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n");
}

function snake(state: (typeof STATES)[number]): string {
  return state.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}
