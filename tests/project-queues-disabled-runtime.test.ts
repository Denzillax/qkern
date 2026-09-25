import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getProjectQueueService } from "@/lib/server/project-queues/runtime";
import { projectQueueRouteError } from "@/lib/server/project-queues/http";
import { ProjectQueueError, isProjectQueueError } from "@/lib/server/project-queues/service";

/**
 * Abgeschaltete Queues antworten 503, nicht 500 (2.24). Bis dahin warf
 * `getProjectQueueService()` schon beim Anlegen, in jeder der elf Routen vor
 * dem `try`; Next antwortete 500 ohne Koerper. Jetzt liefert die Laufzeit
 * einen Dienst, der erst beim Aufruf `PROJECT_QUEUES_DISABLED` wirft, und
 * die Fehlerabbildung erkennt den Fehler an Name und Code, auch aus einem
 * fremden Modulgraphen.
 */
type Runtime = typeof globalThis & { __qkernProjectQueueService?: unknown };

describe("project queues disabled runtime", () => {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.QKERN_PROJECT_QUEUES_ENABLED;
    delete process.env.QKERN_PROJECT_QUEUES_ENABLED;
    delete (globalThis as Runtime).__qkernProjectQueueService;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.QKERN_PROJECT_QUEUES_ENABLED;
    else process.env.QKERN_PROJECT_QUEUES_ENABLED = previous;
    delete (globalThis as Runtime).__qkernProjectQueueService;
  });

  it("hands out a service that throws PROJECT_QUEUES_DISABLED on use instead of throwing on creation", async () => {
    const service = getProjectQueueService();
    let caught: unknown;
    try {
      await service.listQueues({ organizationId: "org", actorRef: "a", role: "admin" } as never, { projectId: "p", environment: "development" } as never);
    } catch (error) { caught = error; }
    expect(isProjectQueueError(caught, "PROJECT_QUEUES_DISABLED")).toBe(true);
    expect((globalThis as Runtime).__qkernProjectQueueService).toBeUndefined();
    const response = projectQueueRouteError(caught);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Project Queues are disabled" });
  });

  it("recognises a queue error from a foreign copy of the class", async () => {
    class ForeignQueueError extends Error {
      constructor(readonly code: string) { super(code); this.name = "ProjectQueueError"; }
    }
    expect(isProjectQueueError(new ForeignQueueError("QUEUE_CONFLICT"), "QUEUE_CONFLICT")).toBe(true);
    expect(isProjectQueueError(new ProjectQueueError("QUEUE_CONFLICT"), "QUEUE_LEASE_LOST")).toBe(false);
    expect(isProjectQueueError(new Error("QUEUE_CONFLICT"))).toBe(false);
    expect(projectQueueRouteError(new ForeignQueueError("QUEUE_CONFLICT")).status).toBe(409);
    expect(projectQueueRouteError(new ForeignQueueError("PROJECT_QUEUES_DISABLED")).status).toBe(503);
  });
});
