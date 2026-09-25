import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getProjectStorageService } from "@/lib/server/project-storage/runtime";
import { projectStorageRouteError } from "@/lib/server/project-storage/http";
import { ProjectStorageError } from "@/lib/server/project-storage/service";
import { getBillingService, getUsageService } from "@/lib/server/usage/runtime";
import { usageRouteError } from "@/lib/server/usage/http";
import { UsageError } from "@/lib/server/usage/service";

/**
 * Abgeschaltetes Storage antwortet 503, nicht 500 (2.27, derselbe Fall wie
 * die Queues in 2.24): die Laufzeit liefert einen Dienst, der erst beim
 * Aufruf `PROJECT_STORAGE_DISABLED` wirft, statt beim Anlegen vor dem `try`
 * der Route.
 */
type Runtime = typeof globalThis & { __qkernProjectStorageService?: unknown };

describe("project storage disabled runtime", () => {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.QKERN_PROJECT_STORAGE_ENABLED;
    delete process.env.QKERN_PROJECT_STORAGE_ENABLED;
    delete (globalThis as Runtime).__qkernProjectStorageService;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.QKERN_PROJECT_STORAGE_ENABLED;
    else process.env.QKERN_PROJECT_STORAGE_ENABLED = previous;
    delete (globalThis as Runtime).__qkernProjectStorageService;
  });

  it("hands out a service that throws PROJECT_STORAGE_DISABLED on use and maps it to 503", async () => {
    const service = getProjectStorageService();
    let caught: unknown;
    try {
      await service.listBuckets({ organizationId: "org", actorRef: "a", role: "admin", subject: "s" } as never, { projectId: "p", environment: "development" } as never);
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ProjectStorageError);
    expect((caught as ProjectStorageError).code).toBe("PROJECT_STORAGE_DISABLED");
    expect((globalThis as Runtime).__qkernProjectStorageService).toBeUndefined();
    const response = projectStorageRouteError(caught);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Project Storage is disabled" });
  });

  it("does the same for usage metering and billing", async () => {
    const previousUsage = process.env.QKERN_USAGE_METERING_ENABLED;
    const runtime = globalThis as typeof globalThis & { __qkernUsageService?: unknown; __qkernBillingService?: unknown };
    delete process.env.QKERN_USAGE_METERING_ENABLED;
    delete runtime.__qkernUsageService; delete runtime.__qkernBillingService;
    try {
      for (const service of [getUsageService() as unknown as Record<string, () => unknown>, getBillingService() as unknown as Record<string, () => unknown>]) {
        let caught: unknown;
        try { await service.listInvoices(); } catch (error) { caught = error; }
        expect(caught).toBeInstanceOf(UsageError);
        expect((caught as UsageError).code).toBe("USAGE_METERING_DISABLED");
        expect(usageRouteError(caught).status).toBe(503);
      }
      expect(runtime.__qkernUsageService).toBeUndefined();
      expect(runtime.__qkernBillingService).toBeUndefined();
    } finally {
      if (previousUsage === undefined) delete process.env.QKERN_USAGE_METERING_ENABLED; else process.env.QKERN_USAGE_METERING_ENABLED = previousUsage;
      delete runtime.__qkernUsageService; delete runtime.__qkernBillingService;
    }
  });
});
