import { describe, expect, it } from "vitest";
import { renderQueueMetrics } from "@/lib/server/project-queues/metrics";

/**
 * Das Prometheus-Textformat (1.88): jede Queue mit allen fuenf Zustaenden —
 * auch die leere —, Label-Werte maskiert, das Alter der aeltesten wartenden
 * Nachricht in Sekunden, 0 ohne Wartende.
 */
describe("queue metrics exposition", () => {
  const scope = { organizationId: "org-1", projectId: "prj-1", environment: "development" as const };
  const now = new Date("2026-09-24T12:00:30.000Z");

  it("renders every queue with every state and escaped labels", () => {
    const text = renderQueueMetrics(scope, [
      { queue: "jobs", available: 3, scheduled: 1, inFlight: 2, completed: 10, deadLettered: 1,
        oldestAvailableAt: "2026-09-24T12:00:00.000Z" },
      { queue: "empty", available: 0, scheduled: 0, inFlight: 0, completed: 0, deadLettered: 0,
        oldestAvailableAt: null },
    ], now);
    expect(text).toContain('qkern_queue_messages{project="prj-1",environment="development",queue="jobs",state="available"} 3');
    expect(text).toContain('queue="jobs",state="in_flight"} 2');
    expect(text).toContain('queue="jobs",state="dead_lettered"} 1');
    // Die leere Queue traegt alle fuenf Zeitreihen — mit 0, nicht mit Abwesenheit.
    for (const state of ["available", "scheduled", "in_flight", "completed", "dead_lettered"]) {
      expect(text).toContain(`queue="empty",state="${state}"} 0`);
    }
    expect(text).toContain('qkern_queue_oldest_available_age_seconds{project="prj-1",environment="development",queue="jobs"} 30');
    expect(text).toContain('queue="empty"} 0');
    expect(text.startsWith("# HELP qkern_queue_messages")).toBe(true);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("escapes label values the exposition format would otherwise break on", () => {
    const text = renderQueueMetrics({ ...scope, projectId: 'p"r\\o\nj' }, [
      { queue: "q", available: 0, scheduled: 0, inFlight: 0, completed: 0, deadLettered: 0, oldestAvailableAt: null },
    ], now);
    expect(text).toContain('project="p\\"r\\\\o\\nj"');
    expect(text.split("\n").every((line) => line === "" || line.startsWith("#") || /^[a-z_]+\{[^\n]*\} \d+$/.test(line))).toBe(true);
  });
});
