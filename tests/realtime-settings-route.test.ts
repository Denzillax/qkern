import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { handleProjectRealtimeSettings } from "@/app/api/v1/projects/[projectId]/environments/[environment]/realtime/settings/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { tenancyService } from "@/lib/server/tenancy-service";

/**
 * Die settings-Route (2.48) geht durch dieselbe Tuer wie
 * `/database/activity`: Session mit Leserecht oder scope-gebundener
 * Projekt-Key. Sie nimmt keinen Parameter, sie schreibt nichts, und sie
 * traegt kein Geheimnis.
 */
async function identity() {
  const nonce = randomUUID();
  const result = await authRuntime.service.register({
    email: `realtime-settings-${nonce}@qkern.test`,
    password: "a sufficiently long realtime settings route test password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(result.user);
  return result;
}

const params = { params: Promise.resolve({ projectId: "project", environment: "development" }) };
const url = "https://qkern.test/api/v1/projects/project/environments/development/realtime/settings";

describe("project realtime settings route", () => {
  it("answers the effective limits with value, unit and origin and disables caching", async () => {
    const principal = await identity();
    const response = await handleProjectRealtimeSettings(new NextRequest(url, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), params, { QKERN_REALTIME_MAX_CONNECTIONS: "1200", QKERN_REALTIME_ENABLED: "true" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const payload = await response.json();
    expect(payload.data.projectId).toBe("project");
    expect(payload.data.environment).toBe("development");
    expect(payload.data.features).toEqual({ enabled: true, changes: false, durableLog: true });
    expect(payload.data.figures).toEqual({ available: false, reason: "separate_process" });
    const limits = payload.data.limits as Array<Record<string, unknown>>;
    expect(limits.length).toBeGreaterThan(15);
    for (const entry of limits) {
      expect(Object.keys(entry).sort()).toEqual(
        ["group", "id", "invalid", "maximum", "minimum", "origin", "unit", "value", "variable"],
      );
      expect(["environment", "default", "code"]).toContain(entry.origin);
    }
    expect(limits.find((entry) => entry.id === "maxConnections"))
      .toMatchObject({ value: 1200, origin: "environment", unit: "connections" });
    expect(limits.find((entry) => entry.id === "messagesPerWindow"))
      .toMatchObject({ value: 100, origin: "code", variable: null });
  });

  it("carries no secret out of the environment", async () => {
    const principal = await identity();
    const response = await handleProjectRealtimeSettings(new NextRequest(url, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${principal.token}` },
    }), params, {
      QKERN_REALTIME_CURSOR_SECRET: "c3VwZXItZ2VoZWlt",
      QKERN_RUNTIME_DATABASE_URL: "postgres://user:hunter2@db.internal:5432/qkern",
      QKERN_REALTIME_ALLOWED_ORIGINS: "https://console.example",
    });
    const serialized = JSON.stringify(await response.json());
    for (const secret of ["c3VwZXItZ2VoZWlt", "hunter2", "postgres://", "console.example"]) {
      expect(serialized, secret).not.toContain(secret);
    }
  });

  it("rejects every query parameter, an unknown environment and anonymous callers", async () => {
    // Es gibt nichts zu waehlen; eine Angabe wird nicht stillschweigend ignoriert.
    const bad = await handleProjectRealtimeSettings(new NextRequest(`${url}?group=transport`), params, {});
    expect(bad.status).toBe(400);
    const environment = await handleProjectRealtimeSettings(new NextRequest(url),
      { params: Promise.resolve({ projectId: "project", environment: "nirgendwo" }) }, {});
    expect(environment.status).toBe(400);
    const anonymous = await handleProjectRealtimeSettings(new NextRequest(url), params, {});
    expect(anonymous.status).toBe(401);
  });

  it("offers no write verb at all", async () => {
    const route = await import("@/app/api/v1/projects/[projectId]/environments/[environment]/realtime/settings/route");
    expect(Object.keys(route).sort()).toEqual(["GET", "handleProjectRealtimeSettings"]);
  });
});
