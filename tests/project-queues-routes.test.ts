import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createProjectQueueMessageHandlers } from "@/app/api/v1/projects/[projectId]/environments/[environment]/queues/[queue]/messages/route";
import { createProjectQueueHandlers } from "@/app/api/v1/projects/[projectId]/environments/[environment]/queues/route";
import { createProjectQueueDeadLetterReplayHandler } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/queues/[queue]/dead-letters/[messageId]/replay/route";
import { projectQueuePreflight, projectQueueRouteError } from "@/lib/server/project-queues/http";
import { ProjectQueueError, type ProjectQueueService } from "@/lib/server/project-queues/service";

const context = {
  params: Promise.resolve({ projectId: "prj-queues", environment: "development", queue: "email_jobs" }),
};

describe("Project Queues routes", () => {
  it("rejects an unallowlisted browser origin before authentication or service access", async () => {
    const service = { enqueue: vi.fn() } as unknown as ProjectQueueService;
    const previous = process.env.QKERN_PROJECT_QUEUES_ALLOWED_ORIGINS;
    process.env.QKERN_PROJECT_QUEUES_ALLOWED_ORIGINS = "https://app.example.test";
    try {
      const request = new NextRequest("https://api.example.test/api/queues", {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "application/json" },
        body: JSON.stringify({ payload: { recipient: "user@example.test" } }),
      });
      const response = await createProjectQueueMessageHandlers(service).POST(request, context);
      expect(response.status).toBe(403);
      expect(service.enqueue).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.QKERN_PROJECT_QUEUES_ALLOWED_ORIGINS;
      else process.env.QKERN_PROJECT_QUEUES_ALLOWED_ORIGINS = previous;
    }
  });

  it("returns a CORS preflight only for an exact configured origin", () => {
    const previous = process.env.QKERN_PROJECT_QUEUES_ALLOWED_ORIGINS;
    process.env.QKERN_PROJECT_QUEUES_ALLOWED_ORIGINS = "https://app.example.test";
    try {
      const allowed = projectQueuePreflight(new NextRequest("https://api.example.test", {
        method: "OPTIONS", headers: { origin: "https://app.example.test" },
      }));
      expect(allowed.status).toBe(204);
      expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.example.test");
      expect(allowed.headers.get("access-control-allow-headers")).toContain("x-qkern-key");
      const denied = projectQueuePreflight(new NextRequest("https://api.example.test", {
        method: "OPTIONS", headers: { origin: "https://app.example.test.evil" },
      }));
      expect(denied.status).toBe(403);
    } finally {
      if (previous === undefined) delete process.env.QKERN_PROJECT_QUEUES_ALLOWED_ORIGINS;
      else process.env.QKERN_PROJECT_QUEUES_ALLOWED_ORIGINS = previous;
    }
  });

  it("protects session-admin queue creation with trusted-origin CSRF validation", async () => {
    const service = { createQueue: vi.fn() } as unknown as ProjectQueueService;
    const request = new NextRequest("https://qkern.example.test/api/queues", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ name: "email_jobs" }),
    });
    const response = await createProjectQueueHandlers(service).POST(request, context);
    expect(response.status).toBe(403);
    expect(service.createQueue).not.toHaveBeenCalled();
  });

  it("rejects dead-letter replay before service access when Same-Origin fails", async () => {
    const service = { replayDeadLetter: vi.fn() } as unknown as ProjectQueueService;
    const request = new NextRequest("https://qkern.example.test/api/queues/jobs/dead-letters/message/replay", {
      method: "POST", headers: { origin: "https://evil.example" },
    });
    const response = await createProjectQueueDeadLetterReplayHandler(service)(request, {
      params: Promise.resolve({
        projectId: "prj-queues", environment: "development", queue: "email_jobs", messageId: "message-1",
      }),
    });
    expect(response.status).toBe(403);
    expect(service.replayDeadLetter).not.toHaveBeenCalled();
  });

  it("maps capacity, lease and disabled failures without leaking tokens or internals", async () => {
    const capacity = projectQueueRouteError(new ProjectQueueError("QUEUE_CAPACITY_EXCEEDED"));
    expect(capacity.status).toBe(429);
    expect(await capacity.json()).toEqual({ error: "Queue capacity exceeded" });
    const lease = projectQueueRouteError(new ProjectQueueError("QUEUE_LEASE_LOST"));
    expect(lease.status).toBe(409);
    expect(JSON.stringify(await lease.json())).not.toMatch(/qk_lease_|workerId|tokenHash/i);
    const disabled = projectQueueRouteError(new ProjectQueueError("PROJECT_QUEUES_DISABLED"));
    expect(disabled.status).toBe(503);
    // Ein erschoepfter Verbindungspool ist keine 409. Bis Release 1.64 hat die
    // Grenze hier „Queue conflict" geantwortet und dem Aufrufer damit gesagt,
    // jemand anderes sei schneller gewesen — waehrend die Warteschlange in
    // Ordnung war und die Abfrage nie gelaufen ist.
    const unavailable = projectQueueRouteError(new ProjectQueueError("QUEUE_UNAVAILABLE"));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "Project Queues unavailable" });
  });
});
