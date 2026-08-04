import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST as decideApproval } from "@/app/api/v1/approvals/[approvalId]/decision/route";
import { POST as queueApply } from "@/app/api/v1/changesets/[changeSetId]/apply/route";
import { POST as createChangeSet } from "@/app/api/v1/changesets/route";
import { GET as getConsole } from "@/app/api/v1/console/route";
import {
  GET as getAutomationPolicy,
  PUT as putAutomationPolicy,
} from "@/app/api/v1/projects/[projectId]/environments/[environment]/automation-policy/route";
import { authRuntime } from "@/lib/server/auth/runtime";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { tenancyService } from "@/lib/server/tenancy-service";

function authenticatedRequest(path: string, token: string, options: { method?: string; body?: string } = {}) {
  return new NextRequest(`https://qkern.test${path}`, {
    method: options.method ?? "GET",
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
      ...(options.body ? { "content-type": "application/json", origin: "https://qkern.test" } : {}),
    },
    body: options.body,
  });
}

describe("authenticated control-plane routes", () => {
  it("previews, redacts and approves one tenant-bound change end to end", async () => {
    const nonce = randomUUID();
    const registration = await authRuntime.service.register({
      email: `route-${nonce}@qkern.test`,
      password: "a sufficiently long route test password",
      rateLimitKey: nonce,
    });
    await tenancyService.ensureWorkspace(registration.user);

    const initialConsole = await getConsole(authenticatedRequest("/api/v1/console", registration.token));
    expect(initialConsole.status).toBe(200);
    const initial = await initialConsole.json();
    const projectId = initial.projects[0]?.id as string;
    expect(projectId).toBeTruthy();

    const previewResponse = await createChangeSet(authenticatedRequest("/api/v1/changesets", registration.token, {
      method: "POST",
      body: JSON.stringify({
        projectId,
        environment: "development",
        title: "Remove obsolete orders table",
        statement: "DROP TABLE obsolete_orders",
      }),
    }));
    expect(previewResponse.status).toBe(201);
    const preview = (await previewResponse.json()).data;
    expect(preview).toMatchObject({ projectId, risk: "critical", status: "ready", statement: "[REDACTED]" });

    const reviewResponse = await getConsole(authenticatedRequest("/api/v1/console", registration.token));
    const review = await reviewResponse.json();
    const approval = review.approvals.find((item: { changeSetId: string }) => item.changeSetId === preview.id);
    expect(approval).toMatchObject({ status: "pending", projectId });
    expect(review.changeSets.find((item: { id: string }) => item.id === preview.id)?.statement).toBe("[REDACTED]");

    const decisionResponse = await decideApproval(
      authenticatedRequest(`/api/v1/approvals/${approval.id}/decision`, registration.token, {
        method: "POST",
        body: JSON.stringify({ decision: "approved" }),
      }),
      { params: Promise.resolve({ approvalId: approval.id }) },
    );
    expect(decisionResponse.status).toBe(200);
    await expect(decisionResponse.json()).resolves.toMatchObject({ data: { id: approval.id, status: "approved" } });

    const applyRequest = () => authenticatedRequest(`/api/v1/changesets/${preview.id}/apply`, registration.token, {
      method: "POST",
      body: "{}",
    });
    const queuedApply = await queueApply(applyRequest(), { params: Promise.resolve({ changeSetId: preview.id }) });
    expect(queuedApply.status).toBe(202);
    await expect(queuedApply.json()).resolves.toMatchObject({
      data: { outcome: "queued", changeSetId: preview.id, idempotent: false },
    });
    const duplicateApply = await queueApply(applyRequest(), { params: Promise.resolve({ changeSetId: preview.id }) });
    expect(duplicateApply.status).toBe(200);
    await expect(duplicateApply.json()).resolves.toMatchObject({
      data: { outcome: "already_queued", changeSetId: preview.id, idempotent: true },
    });

    const finalConsole = await getConsole(authenticatedRequest("/api/v1/console", registration.token));
    const finalSnapshot = await finalConsole.json();
    expect(finalSnapshot.changeSets.find((item: { id: string }) => item.id === preview.id)).toMatchObject({
      status: "approved",
      statement: "[REDACTED]",
    });
  });

  it("returns a controlled 400 for malformed JSON", async () => {
    const response = await createChangeSet(new NextRequest("https://qkern.test/api/v1/changesets", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://qkern.test" },
      body: "{not-json",
    }));
    expect(response.status).toBe(400);
  });

  it("can replace per-change human approval with an explicit autonomous project policy", async () => {
    const nonce = randomUUID();
    const registration = await authRuntime.service.register({
      email: `autonomy-${nonce}@qkern.test`,
      password: "a sufficiently long autonomy test password",
      rateLimitKey: nonce,
    });
    await tenancyService.ensureWorkspace(registration.user);
    const initial = await (await getConsole(
      authenticatedRequest("/api/v1/console", registration.token),
    )).json();
    const projectId = initial.projects[0]?.id as string;
    const routeContext = () => ({ params: Promise.resolve({ projectId, environment: "development" }) });

    const defaultPolicy = await getAutomationPolicy(
      authenticatedRequest(`/api/v1/projects/${projectId}/environments/development/automation-policy`, registration.token),
      routeContext(),
    );
    expect(defaultPolicy.status).toBe(200);
    await expect(defaultPolicy.json()).resolves.toMatchObject({ data: { mode: "manual", revision: 0 } });

    const updated = await putAutomationPolicy(
      authenticatedRequest(`/api/v1/projects/${projectId}/environments/development/automation-policy`, registration.token, {
        method: "PUT",
        body: JSON.stringify({
          mode: "autonomous",
          maxAutoRisk: "critical",
          autoQueue: false,
          emergencyStop: false,
        }),
      }),
      routeContext(),
    );
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ data: {
      mode: "autonomous", maxAutoRisk: "critical", revision: 1,
    } });

    const previewResponse = await createChangeSet(authenticatedRequest("/api/v1/changesets", registration.token, {
      method: "POST",
      body: JSON.stringify({
        projectId,
        environment: "development",
        title: "Autonomous cleanup",
        statement: "DROP TABLE autonomous_cleanup_target",
      }),
    }));
    expect(previewResponse.status).toBe(201);
    const preview = (await previewResponse.json()).data;
    expect(preview).toMatchObject({ status: "approved", risk: "critical" });

    const review = await (await getConsole(
      authenticatedRequest("/api/v1/console", registration.token),
    )).json();
    expect(review.approvals.find((item: { changeSetId: string }) => item.changeSetId === preview.id))
      .toMatchObject({ status: "approved" });
  });
});
