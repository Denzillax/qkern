import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createComputeInvocationOutputHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/compute/invocations/[invocationId]/output/route";
import { createComputeOutputLogHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/compute/output/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { ConfigurationError } from "@/lib/server/db/errors";
import { ComputeDefinitionError, type ComputeDefinitionService } from "@/lib/server/compute/definitions";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { tenancyService } from "@/lib/server/tenancy-service";

/**
 * Die beiden Leserouten der Inhaltslogs (2.98).
 *
 * Der Dienst ist gegen echtes PostgreSQL zertifiziert; Gegenstand hier ist
 * die HTTP-Grenze: Admin-Session, kein Parameter beziehungsweise drei und
 * kein vierter, no-store, ein abgeschalteter Compute-Dienst als 503, ein
 * unbekannter Aufruf als 404 und ein Aufruf ohne Ausgabe als 200 mit null.
 */
async function identity() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `fn-output-${nonce}@qkern.test`,
    password: "a sufficiently long invocation output route test password",
    rateLimitKey: nonce,
  });
  const membership = await tenancyService.ensureWorkspace(registration.user);
  const projects = await controlPlaneService.listProjects({
    organizationId: membership.organization.id,
    actor: { id: registration.user.id, ref: registration.user.email, type: "user" },
  });
  return { ...registration, membership, project: projects[0] };
}

const invocationId = "00000000-0000-4000-8000-00000000c0de";
const functionId = "00000000-0000-4000-8000-000000000f01";

const record = {
  invocationId, functionId, functionName: "bestellungen", startedAt: "2026-09-29T10:00:00.000Z",
  outcome: "completed",
  output: {
    lines: [{ at: "2026-09-29T10:00:00.100Z", stream: "stdout", text: "start", cut: false }],
    lineCount: 1, stdoutLines: 1, stderrLines: 0, byteCount: 5, truncated: false, droppedLines: 0,
  },
};

function outputRequest(principal: Awaited<ReturnType<typeof identity>>, search = "", id = invocationId) {
  return [new NextRequest(
    `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/compute/invocations/${id}/output${search}`,
    { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
  ), { params: Promise.resolve({ projectId: principal.project.id, environment: "development", invocationId: id }) }] as const;
}

function listRequest(principal: Awaited<ReturnType<typeof identity>>, search = "") {
  return [new NextRequest(
    `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/compute/output${search}`,
    { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } },
  ), { params: Promise.resolve({ projectId: principal.project.id, environment: "development" }) }] as const;
}

describe("compute invocation output route", () => {
  it("serves the lines of one invocation with no-store through the admin session", async () => {
    const principal = await identity();
    const readFunctionInvocationOutput = vi.fn().mockResolvedValue(record);
    const response = await createComputeInvocationOutputHandlers(
      { readFunctionInvocationOutput } as unknown as ComputeDefinitionService,
    ).GET(...outputRequest(principal));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.data.output.lines[0]).toMatchObject({ stream: "stdout", text: "start" });
    expect(readFunctionInvocationOutput).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: principal.membership.organization.id }),
      { organizationId: principal.membership.organization.id, projectId: principal.project.id, environment: "development" },
      invocationId,
    );
  });

  it("answers an invocation that wrote nothing with output null, not with 404", async () => {
    const principal = await identity();
    const response = await createComputeInvocationOutputHandlers({
      readFunctionInvocationOutput: vi.fn().mockResolvedValue({ ...record, output: null }),
    } as unknown as ComputeDefinitionService).GET(...outputRequest(principal));
    expect(response.status).toBe(200);
    expect((await response.json()).data.output).toBeNull();
  });

  it("rejects any query parameter and a malformed id before the service, and maps the service errors", async () => {
    const principal = await identity();
    const readFunctionInvocationOutput = vi.fn();
    const handlers = createComputeInvocationOutputHandlers(
      { readFunctionInvocationOutput } as unknown as ComputeDefinitionService);
    expect((await handlers.GET(...outputRequest(principal, "?limit=1"))).status).toBe(400);
    expect((await handlers.GET(...outputRequest(principal, "", "not-an-id"))).status).toBe(404);
    expect(readFunctionInvocationOutput).not.toHaveBeenCalled();

    readFunctionInvocationOutput.mockRejectedValueOnce(new ComputeDefinitionError("COMPUTE_NOT_FOUND"));
    expect((await handlers.GET(...outputRequest(principal))).status).toBe(404);
    readFunctionInvocationOutput.mockRejectedValueOnce(new ConfigurationError("Set QKERN_COMPUTE_DEFINITIONS_ENABLED=true explicitly."));
    const disabled = await handlers.GET(...outputRequest(principal));
    expect(disabled.status).toBe(503);
    expect((await disabled.json()).error).toBe("Compute definitions are disabled");
  });

  it("denies the anonymous caller without touching the service", async () => {
    const principal = await identity();
    const readFunctionInvocationOutput = vi.fn();
    const response = await createComputeInvocationOutputHandlers(
      { readFunctionInvocationOutput } as unknown as ComputeDefinitionService,
    ).GET(new NextRequest(
      `https://qkern.test/api/v1/projects/${principal.project.id}/environments/development/compute/invocations/${invocationId}/output`,
    ), { params: Promise.resolve({ projectId: principal.project.id, environment: "development", invocationId }) });
    expect(response.status).toBe(401);
    expect(readFunctionInvocationOutput).not.toHaveBeenCalled();
  });
});

describe("compute output log route", () => {
  it("serves one page of summaries with the three parameters", async () => {
    const principal = await identity();
    const readFunctionOutputLog = vi.fn().mockResolvedValue({
      rows: [{ invocationId, functionId, functionName: "bestellungen", startedAt: record.startedAt,
        recordedAt: "2026-09-29T10:00:00.200Z", outcome: "completed", lineCount: 1, stdoutLines: 1,
        stderrLines: 0, byteCount: 5, truncated: false, droppedLines: 0 }],
      limit: 2, offset: 4, hasMore: true,
    });
    const response = await createComputeOutputLogHandlers(
      { readFunctionOutputLog } as unknown as ComputeDefinitionService,
    ).GET(...listRequest(principal, `?limit=2&offset=4&function=${functionId}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.data.hasMore).toBe(true);
    expect(body.data.rows[0]).toMatchObject({ functionName: "bestellungen", lineCount: 1 });
    // Die Liste traegt nie die Zeilen selbst.
    expect(JSON.stringify(body)).not.toContain('"lines"');
    expect(readFunctionOutputLog).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), { functionId, limit: 2, offset: 4 },
    );
  });

  it("falls back to the default page and rejects unknown, repeated and malformed parameters before the service", async () => {
    const principal = await identity();
    const readFunctionOutputLog = vi.fn().mockResolvedValue({ rows: [], limit: 50, offset: 0, hasMore: false });
    const handlers = createComputeOutputLogHandlers({ readFunctionOutputLog } as unknown as ComputeDefinitionService);
    expect((await handlers.GET(...listRequest(principal))).status).toBe(200);
    expect(readFunctionOutputLog).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), { functionId: null, limit: 50, offset: 0 });
    readFunctionOutputLog.mockClear();
    for (const search of ["?outcome=failed", "?limit=1&limit=2", "?limit=x", "?offset=-1", "?function=nope", "?sql=1"]) {
      expect((await handlers.GET(...listRequest(principal, search))).status, search).toBe(400);
    }
    expect(readFunctionOutputLog).not.toHaveBeenCalled();
  });
});
