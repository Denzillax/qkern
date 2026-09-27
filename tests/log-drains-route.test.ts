import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createLogDrainHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/compute/log-drains/route";
import { createLogDrainItemHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/compute/log-drains/[logDrainId]/route";
import type { LogDrainService } from "@/lib/server/compute/log-drains";

/**
 * Die Log-Drain-Routen (2.54) an derselben Tuer wie die benachbarten
 * Definitionsrouten.
 *
 * Geprueft wird die Reihenfolge der Verteidigungslinien: Ein fremder Ursprung
 * kommt nicht bis zum Dienst, und ein anonymer Aufrufer erfaehrt nichts ueber
 * die Grenzen -- weder ueber 400 noch ueber 404. Und: Es gibt in dieser Flaeche
 * kein DELETE und kein Feld fuer einen Geheimniswert.
 */
const logDrainId = "44444444-4444-4444-8444-444444444444";
const context = {
  params: Promise.resolve({ projectId: "prj-logs", environment: "development", logDrainId }),
};
const listContext = {
  params: Promise.resolve({ projectId: "prj-logs", environment: "development" }),
};

const valid = {
  name: "logs-an-siem",
  url: "https://siem.example.com/qkern/logs",
  sources: ["auth_audit"],
  signingSecretRef: "vault:log-drains/siem",
};

function post(body: unknown, origin = "https://evil.example") {
  return new NextRequest("https://qkern.example.test/api/compute/log-drains", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(body: unknown, origin = "https://evil.example") {
  return new NextRequest("https://qkern.example.test/api/compute/log-drains", {
    method: "PATCH",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("log drain routes", () => {
  it("rejects creation from an untrusted origin before touching the service", async () => {
    const service = { create: vi.fn() } as unknown as LogDrainService;
    const response = await createLogDrainHandlers(service).POST(post(valid), listContext);
    expect(response.status).toBe(403);
    expect(service.create).not.toHaveBeenCalled();
  });

  it("rejects switching from an untrusted origin before touching the service", async () => {
    const service = { setEnabled: vi.fn() } as unknown as LogDrainService;
    const response = await createLogDrainItemHandlers(service)
      .PATCH(patch({ enabled: false }), context);
    expect(response.status).toBe(403);
    expect(service.setEnabled).not.toHaveBeenCalled();
  });

  it("authenticates before it validates, so an anonymous caller learns nothing", async () => {
    // Weder die Feldgrenzen noch die Existenz der Ressource sollen sich an der
    // Antwort ablesen lassen; 401 kommt vor 400 und vor 404.
    const service = { list: vi.fn(), get: vi.fn() } as unknown as LogDrainService;
    const request = new NextRequest("https://qkern.example.test/api/compute/log-drains");
    expect((await createLogDrainHandlers(service).GET(request, listContext)).status).toBe(401);
    expect((await createLogDrainItemHandlers(service).GET(request, context)).status).toBe(401);
    expect(service.list).not.toHaveBeenCalled();
    expect(service.get).not.toHaveBeenCalled();
  });

  it("answers private, no-store on every route", async () => {
    const service = { list: vi.fn() } as unknown as LogDrainService;
    const response = await createLogDrainHandlers(service)
      .GET(new NextRequest("https://qkern.example.test/api/compute/log-drains"), listContext);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Pragma")).toBe("no-cache");
  });

  it("offers no DELETE at all", async () => {
    const list = createLogDrainHandlers({} as unknown as LogDrainService);
    const item = createLogDrainItemHandlers({} as unknown as LogDrainService);
    expect(Object.keys(list).sort()).toEqual(["GET", "POST"]);
    expect(Object.keys(item).sort()).toEqual(["GET", "PATCH"]);
  });

  it("has no field a secret value, a field selection or a filter could travel in", async () => {
    // Das Schema ist `.strict()`. Ein Koerper mit einem Feld mehr wird
    // abgewiesen, und zwar bevor der Dienst ihn sieht -- so kann auch ein
    // spaeter hinzugefuegtes Feld nicht stillschweigend durchgereicht werden.
    const source = await import("node:fs/promises").then(async (fs) => fs.readFile(
      "app/api/v1/projects/[projectId]/environments/[environment]/compute/log-drains/route.ts",
      "utf8"));
    expect(source).toContain(".strict()");
    for (const forbidden of ["signingSecret:", "secretValue", "fields:", "filter:", "payload:"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});
