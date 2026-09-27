import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
  handleProjectPointInTimeRecovery,
  readBackupRestoreReadiness,
} from "@/app/api/v1/projects/[projectId]/environments/[environment]/database/backups/point-in-time/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { tenancyService } from "@/lib/server/tenancy-service";
import {
  pointInTimeRecoveryOverview,
  readWalArchiveDeclaration,
} from "@/lib/server/backup/point-in-time";

/**
 * Die point-in-time-Route (2.53) geht durch dieselbe Tuer wie
 * `/database/activity` und nimmt keinen Query-Parameter.
 */
async function identity() {
  const nonce = randomUUID();
  const result = await authRuntime.service.register({
    email: `point-in-time-${nonce}@qkern.test`,
    password: "a sufficiently long point in time route test password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(result.user);
  return result;
}

const params = { params: Promise.resolve({ projectId: "project", environment: "development" }) };
const url = "https://qkern.test/api/v1/projects/project/environments/development/database/backups/point-in-time";

describe("project point-in-time recovery route", () => {
  it("answers an authenticated session without caching and says plainly that there is no archive", async () => {
    const principal = await identity();
    const overview = vi.fn().mockResolvedValue(pointInTimeRecoveryOverview({
      declaration: readWalArchiveDeclaration({}), readiness: null, now: new Date("2026-09-26T12:00:00.000Z"),
    }));
    const response = await handleProjectPointInTimeRecovery(
      new NextRequest(url, { headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` } }),
      params, overview,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.data.state).toBe("no_archive");
    expect(body.data.lastDrill).toBeNull();
    expect(body.data.window.latestRestorablePoint).toBeNull();
    expect(overview).toHaveBeenCalledTimes(1);
  });

  it("rejects every query parameter and every anonymous caller without reading anything", async () => {
    const overview = vi.fn();
    const withParameter = await handleProjectPointInTimeRecovery(
      new NextRequest(`${url}?environment=production`), params, overview,
    );
    expect(withParameter.status).toBe(400);
    const anonymous = await handleProjectPointInTimeRecovery(new NextRequest(url), params, overview);
    expect(anonymous.status).toBe(401);
    const unknownEnvironment = await handleProjectPointInTimeRecovery(
      new NextRequest(url), { params: Promise.resolve({ projectId: "project", environment: "qa" }) }, overview,
    );
    expect(unknownEnvironment.status).toBe(400);
    expect(overview).not.toHaveBeenCalled();
  });

  it("treats missing, disabled or unusable evidence as an absent drill, not as an error", async () => {
    expect(await readBackupRestoreReadiness({})).toBeNull();
    expect(await readBackupRestoreReadiness({
      QKERN_BACKUP_RESTORE_EVIDENCE_ENABLED: "true",
      QKERN_BACKUP_RESTORE_EVIDENCE_FILE: "/nowhere/evidence.json",
      QKERN_BACKUP_RESTORE_VERIFIER_KEY_FILE: "/nowhere/key.json",
      QKERN_BACKUP_RESTORE_VERIFIER_KEY_SHA256: "a".repeat(64),
    })).toBeNull();
  });
});
