import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createLogExplorerHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/logs/search/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { tenancyService } from "@/lib/server/tenancy-service";
import { ConfigurationError } from "@/lib/server/db/errors";
import type { ComputeDefinitionService } from "@/lib/server/compute/definitions";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import type { ProjectStorageService } from "@/lib/server/project-storage/service";

/**
 * Die Route des Log-Explorers (2.65).
 *
 * Gegenstand ist die HTTP-Grenze, nicht der Dienst: eine Anmeldung fuer die
 * ganze Anfrage, danach je Quelle die vorhandene Tuer; jeder unbekannte
 * Parameter ein 400 **vor** jedem Dienstaufruf; `private, no-store`; und die
 * Eigenschaft, um die es in diesem Schnitt geht -- eine Quelle, die nicht
 * liefert, nimmt die anderen nicht mit.
 */
async function identity() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `log-explorer-${nonce}@qkern.test`,
    password: "a sufficiently long log explorer route test password",
    rateLimitKey: nonce,
  });
  const membership = await tenancyService.ensureWorkspace(registration.user);
  const projects = await controlPlaneService.listProjects({
    organizationId: membership.organization.id,
    actor: { id: registration.user.id, ref: registration.user.email, type: "user" },
  });
  return { ...registration, membership, project: projects[0] };
}

const auditEvent = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(), createdAt: "2026-09-24T12:00:30.000Z", actorType: "app_user",
  actorRef: "user:1", action: "project_auth.session.created", resourceRef: "user:1",
  status: "succeeded", metadata: {}, ...over,
});

const invocationRow = (over: Record<string, unknown> = {}) => ({
  functionId: "00000000-0000-4000-8000-000000000f01", functionName: "bestellungen",
  invocationId: randomUUID(), invokedBy: "admin@qkern.test",
  startedAt: "2026-09-24T12:00:20.000Z", durationMs: 42, outcome: "completed",
  statusCode: 200, errorCode: null, ...over,
});

const storageEntry = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(), bucketId: randomUUID(), bucketName: "rechnungen", key: "2026/09/a.pdf",
  ownerSubject: "user:1", sizeBytes: 1_024, contentType: "application/pdf", status: "clean",
  createdAt: "2026-09-24T12:00:10.000Z", deleteAfter: null, deletedAt: null, ...over,
});

function services(over: {
  auth?: unknown; compute?: unknown; storage?: unknown;
} = {}) {
  return {
    auth: (over.auth ?? {
      listAuditEvents: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
    }) as unknown as ProjectAuthService,
    compute: (over.compute ?? {
      readFunctionInvocationLog: vi.fn().mockResolvedValue({
        rows: [], limit: 100, offset: 0, hasMore: false, counts: { completed: 0, failed: 0 },
      }),
    }) as unknown as ComputeDefinitionService,
    storage: (over.storage ?? {
      readObjectLog: vi.fn().mockResolvedValue({
        entries: [], counts: { quarantined: 0, clean: 0, infected: 0 },
        nextCursor: null, buckets: [],
      }),
    }) as unknown as ProjectStorageService,
  };
}

function call(projectId: string, token: string | null, search: string, given = services()) {
  const url = `https://qkern.test/api/v1/projects/${encodeURIComponent(projectId)}/environments/development/logs/search${search}`;
  const init = token === null ? undefined : { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } };
  return createLogExplorerHandlers(given).GET(new NextRequest(url, init), {
    params: Promise.resolve({ projectId, environment: "development" }),
  });
}

describe("log explorer route", () => {
  it("merges the three sources into one ordered list, newest first", async () => {
    const principal = await identity();
    const given = services({
      auth: { listAuditEvents: vi.fn().mockResolvedValue({ events: [auditEvent()], nextCursor: null }) },
      compute: {
        readFunctionInvocationLog: vi.fn().mockResolvedValue({
          rows: [invocationRow()], limit: 100, offset: 0, hasMore: false,
          counts: { completed: 1, failed: 0 },
        }),
      },
      storage: {
        readObjectLog: vi.fn().mockResolvedValue({
          entries: [storageEntry()], counts: { quarantined: 0, clean: 1, infected: 0 },
          nextCursor: null, buckets: [],
        }),
      },
    });
    const response = await call(principal.project.id, principal.token, "", given);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.data.entries.map((entry: { source: string }) => entry.source))
      .toEqual(["auth_audit", "function_invocations", "storage_objects"]);
    expect(body.data.entries[1]).toMatchObject({
      action: "compute.function_invocation", subject: "bestellungen", outcome: "ok",
    });
    expect(body.data.sources.map((report: { id: string; state: string }) => report.state))
      .toEqual(["ok", "ok", "ok"]);
    // Die Antwort nennt je Quelle die vorhandene Route und ihre Rolle.
    expect(body.data.sources[0]).toMatchObject({
      route: "auth/admin/audit", capability: "project_auth_admin",
    });
    // Und sie sagt selbst, was sie nicht erreicht.
    expect(body.data.outOfReach.map((entry: { label: string }) => entry.label))
      .toContain("Cron-Vorkommen");
  });

  it("carries no payload, no caller reference and no owner into the merged list", async () => {
    // `invokedBy` und `ownerSubject` stehen in den gelesenen Zeilen. In der
    // gemischten Liste haben sie nichts zu suchen: Die Projektion nimmt sechs
    // Felder, und keines davon ist eine Referenz auf eine Person.
    const principal = await identity();
    const given = services({
      compute: {
        readFunctionInvocationLog: vi.fn().mockResolvedValue({
          rows: [invocationRow({ invokedBy: "geheim@qkern.test" })],
          limit: 100, offset: 0, hasMore: false, counts: { completed: 1, failed: 0 },
        }),
      },
      storage: {
        readObjectLog: vi.fn().mockResolvedValue({
          entries: [storageEntry({ ownerSubject: "auch-geheim@qkern.test" })],
          counts: { quarantined: 0, clean: 1, infected: 0 }, nextCursor: null, buckets: [],
        }),
      },
    });
    const body = await (await call(principal.project.id, principal.token, "", given)).text();
    expect(body).not.toContain("geheim@qkern.test");
    expect(body).not.toContain("invokedBy");
    expect(body).not.toContain("ownerSubject");
  });

  it("leaves the other sources usable when one source is refused or broken", async () => {
    const principal = await identity();
    const given = services({
      auth: { listAuditEvents: vi.fn().mockResolvedValue({ events: [auditEvent()], nextCursor: null }) },
      compute: {
        readFunctionInvocationLog: vi.fn().mockRejectedValue(
          new ConfigurationError("Set QKERN_COMPUTE_DEFINITIONS_ENABLED=true explicitly.")),
      },
      storage: { readObjectLog: vi.fn().mockRejectedValue(new Error("boom")) },
    });
    const response = await call(principal.project.id, principal.token, "", given);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.entries).toHaveLength(1);
    expect(Object.fromEntries(body.data.sources.map(
      (report: { id: string; state: string }) => [report.id, report.state]))).toEqual({
      auth_audit: "ok", function_invocations: "unavailable", storage_objects: "failed",
    });
  });

  it("asks only the chosen sources", async () => {
    const principal = await identity();
    const given = services();
    const listAuditEvents = (given.auth as unknown as { listAuditEvents: ReturnType<typeof vi.fn> }).listAuditEvents;
    const readObjectLog = (given.storage as unknown as { readObjectLog: ReturnType<typeof vi.fn> }).readObjectLog;
    const response = await call(principal.project.id, principal.token, "?sources=auth_audit", given);

    expect(response.status).toBe(200);
    expect(listAuditEvents).toHaveBeenCalled();
    expect(readObjectLog).not.toHaveBeenCalled();
    expect((await response.json()).data.sources.map((report: { id: string }) => report.id))
      .toEqual(["auth_audit"]);
  });

  it("hands the typed filter to the source that owns it", async () => {
    const principal = await identity();
    const given = services();
    const readFunctionInvocationLog =
      (given.compute as unknown as { readFunctionInvocationLog: ReturnType<typeof vi.fn> }).readFunctionInvocationLog;
    await call(principal.project.id, principal.token,
      "?sources=function_invocations&outcome=failed", given);
    expect(readFunctionInvocationLog).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.objectContaining({ outcome: "failed" }),
    );
  });

  it("rejects an unknown parameter, a repeated one and a filter without its source before any service", async () => {
    const principal = await identity();
    const given = services();
    const listAuditEvents = (given.auth as unknown as { listAuditEvents: ReturnType<typeof vi.fn> }).listAuditEvents;
    for (const search of [
      "?statement=SELECT%201", "?sql=SELECT%201", "?table=audit_logs",
      "?limit=5&limit=6", "?limit=0", "?limit=101",
      "?sources=audit_logs", "?sources=",
      "?from=gestern", "?from=2026-09-24T12:00:00Z&to=2026-09-24T11:00:00Z",
      "?before=nonsense", "?outcome=vielleicht",
      "?sources=auth_audit&outcome=completed",
    ]) {
      const response = await call(principal.project.id, principal.token, search, given);
      expect(response.status, search).toBe(400);
      expect((await response.json()).error, search).toBe("Invalid log search");
    }
    expect(listAuditEvents).not.toHaveBeenCalled();
  });

  it("names the reason of a rejection instead of only refusing", async () => {
    const principal = await identity();
    const body = await (await call(principal.project.id, principal.token, "?limit=500")).json();
    expect(body.code).toBe("INVALID_LIMIT");
    expect(body.reason).toContain("1 bis 100");
  });

  it("denies the anonymous caller without touching a service", async () => {
    const principal = await identity();
    const given = services();
    const listAuditEvents = (given.auth as unknown as { listAuditEvents: ReturnType<typeof vi.fn> }).listAuditEvents;
    const response = await call(principal.project.id, null, "", given);
    expect(response.status).toBe(401);
    expect(listAuditEvents).not.toHaveBeenCalled();
  });

  it("answers a project the caller does not own with unreachable sources, never with rows", async () => {
    // Die Tuer je Quelle bleibt die alte: ein fremder oder unbrauchbarer Pfad
    // endet in `forbidden`/`failed`, nicht in fremden Zeilen.
    const principal = await identity();
    const given = services({
      auth: { listAuditEvents: vi.fn() }, compute: { readFunctionInvocationLog: vi.fn() },
      storage: { readObjectLog: vi.fn() },
    });
    const response = await call("not a project id", principal.token, "", given);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.entries).toEqual([]);
    expect(body.data.sources.every((report: { state: string }) => report.state !== "ok")).toBe(true);
  });
});
