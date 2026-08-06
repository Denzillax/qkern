import { describe, expect, it } from "vitest";
import { admitApiRequest, UsageQuotaExceededError } from "@/lib/server/usage/api-requests";
import { projectQueueRouteError } from "@/lib/server/project-queues/http";
import { projectStorageRouteError } from "@/lib/server/project-storage/http";
import type { UsageAdmission, UsageEmitterPort } from "@/lib/server/usage/emitter";
import type { UsageScope } from "@/lib/server/usage/model";

const scope: UsageScope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  environment: "development",
};

function emitter(admission: UsageAdmission, calls: unknown[] = []): UsageEmitterPort {
  return {
    async admit(_scope, input) {
      calls.push(input);
      return admission;
    },
  };
}

describe("admitApiRequest", () => {
  it("counts exactly one request", async () => {
    const calls: Array<{ metric: string; quantity?: number }> = [];
    await admitApiRequest("project_queues", scope,
      emitter({ admitted: true, reason: null }, calls));
    expect(calls).toHaveLength(1);
    expect(calls[0].metric).toBe("api_requests");
    // Ohne Menge, also eins. Eine Anfrage ist eine Anfrage.
    expect(calls[0].quantity).toBeUndefined();
  });

  it("stops the request when the quota is exhausted", async () => {
    await expect(admitApiRequest("project_storage", scope,
      emitter({ admitted: false, reason: "quota_exceeded" })))
      .rejects.toBeInstanceOf(UsageQuotaExceededError);
  });

  it("carries neither scope nor numbers in the error", async () => {
    // Der Fehler wird zu einer HTTP-Antwort. Was ein Betreiber erfaehrt, steht
    // in seiner Projektion, nicht in einer Fehlermeldung an seinen Endnutzer.
    const error = new UsageQuotaExceededError();
    expect(error.message).toBe("USAGE_QUOTA_EXCEEDED");
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error)))
      .not.toContain(scope.projectId);
  });
});

describe("route mapping", () => {
  it("answers 429 on every metered surface", () => {
    // Ein erschoepftes Kontingent ist "spaeter wiederkommen", nicht "kaputt".
    // Faellt eine dieser Abbildungen weg, wird daraus eine 500.
    expect(projectQueueRouteError(new UsageQuotaExceededError()).status).toBe(429);
    expect(projectStorageRouteError(new UsageQuotaExceededError()).status).toBe(429);
  });
});
