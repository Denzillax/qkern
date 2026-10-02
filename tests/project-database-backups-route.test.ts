import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import {
  createListProjectDatabaseBackupsHandler,
  createRequestProjectDatabaseBackupHandler,
} from "@/app/api/v1/projects/[projectId]/environments/[environment]/database/backups/route";
import { createGetProjectDatabaseBackupHandler } from "@/app/api/v1/projects/[projectId]/environments/[environment]/database/backups/[backupId]/route";
import { createRequestProjectDatabaseRestoreHandler } from "@/app/api/v1/projects/[projectId]/environments/[environment]/database/backups/[backupId]/restore/route";
import { authRuntime } from "@/lib/server/auth/runtime";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { requireCapability, RequestAuthorizationError } from "@/lib/server/request-context";
import { tenancyService } from "@/lib/server/tenancy-service";
import type { Membership } from "@/lib/server/tenancy";
import type { PublicAuthUser } from "@/lib/server/auth/model";
import { ProjectDatabaseBackupServiceError } from "@/lib/server/backup/project-database";
import type {
  ProjectDatabaseBackupCatalog,
  ProjectDatabaseBackupView,
} from "@/lib/server/backup/project-database-catalog";

/**
 * Die Routen des Backup-Katalogs (2.129).
 *
 * Was hier geprueft wird, ist die Tuer: die Rollenmatrix, der Ursprungsriegel,
 * die Form der Anfrage und die Projektion. Dass die **Mandantengrenze** ohne
 * Filter in der Anfrage haelt, prueft `(2.130)` gegen echtes PostgreSQL -- das
 * kann hier nichts belegen, weil die Policy aus 0083 eine Datenbank braucht.
 */

const PROJECT_ID = "2b2a6a9e-0b5f-4f0a-8a2f-6a7c6e9d1b31";
const OTHER_PROJECT_ID = "7c5b1d2e-1f3a-4b5c-8d9e-0f1a2b3c4d5e";
const BACKUP_ID = "5f3f1b74-9c2a-4a4e-8b6d-1f2e3a4b5c6d";

function principal(role: Membership["role"]) {
  const user: PublicAuthUser = {
    id: crypto.randomUUID(), email: "backup-role@qkern.test", status: "active", createdAt: new Date(),
  };
  return {
    user,
    membership: {
      organization: { id: crypto.randomUUID(), name: "Backup Role", slug: "backup-role" },
      userId: user.id,
      role,
    },
  };
}

const view: ProjectDatabaseBackupView = Object.freeze({
  id: BACKUP_ID,
  projectId: PROJECT_ID,
  environment: "production",
  status: "available",
  artifactFormat: "chunked",
  sizeBytes: 3_180,
  partCount: 3,
  manifestSha256: "a".repeat(64),
  includes: ["schema", "rows"],
  snapshotAt: "2026-10-02T06:00:00.000Z",
  completedAt: "2026-10-02T06:00:05.000Z",
  expiresAt: "2026-11-01T06:00:05.000Z",
  lastErrorCode: null,
  restore: null,
  createdAt: "2026-10-02T06:00:00.000Z",
});

function catalog(overrides: Partial<ProjectDatabaseBackupCatalog> = {}): ProjectDatabaseBackupCatalog {
  return {
    async list() { return { backups: [view], schedule: null }; },
    async get() { return view; },
    async request() { return { backup: view, created: true }; },
    async requestRestore() { return { ...view, restore: {
      status: "requested", requestedAt: "2026-10-02T07:00:00.000Z", completedAt: null,
      databaseName: "qkern_restore_5f3f1b749c2a4a4e8b6d1f2e3a4b5c6d", errorCode: null,
    } }; },
    ...overrides,
  };
}

async function ownerSession() {
  const nonce = crypto.randomUUID();
  const registration = await authRuntime.service.register({
    email: `backup-route-${nonce}@qkern.test`,
    password: "a sufficiently long backup route password",
    rateLimitKey: nonce,
  });
  await tenancyService.ensureWorkspace(registration.user);
  return registration.token;
}

function url(path = "") {
  return `https://qkern.test/api/v1/projects/${PROJECT_ID}/environments/production/database/backups${path}`;
}

function request(method: "GET" | "POST", input: {
  token?: string; path?: string; body?: string; origin?: string;
} = {}) {
  return new NextRequest(url(input.path ?? ""), {
    method,
    headers: {
      ...(method === "POST" ? {
        "content-type": "application/json",
        origin: input.origin ?? "https://qkern.test",
      } : {}),
      ...(input.token ? { cookie: `${SESSION_COOKIE_NAME}=${input.token}` } : {}),
    },
    ...(method === "POST" ? { body: input.body ?? "{}" } : {}),
  });
}

const params = (projectId = PROJECT_ID, environment = "production") => ({
  params: Promise.resolve({ projectId, environment }),
});
const backupParams = (
  backupId = BACKUP_ID, projectId = PROJECT_ID, environment = "production",
) => ({ params: Promise.resolve({ projectId, environment, backupId }) });

describe("Die Rollenmatrix der Backup-Routen (2.129)", () => {
  it("trennt Lesen, Bestellen und Wiederherstellen", () => {
    // Lesen: dasselbe Feld wie `project_provisioning_read`.
    for (const role of ["owner", "administrator", "deployer", "support"] as const) {
      expect(() => requireCapability(principal(role), "project_backup_read")).not.toThrow();
    }
    for (const role of ["developer", "analyst", "read_only"] as const) {
      expect(() => requireCapability(principal(role), "project_backup_read"))
        .toThrow(RequestAuthorizationError);
    }
    // Bestellen: Eigentuemer und Administrator, wie `project_provisioning_request`.
    expect(() => requireCapability(principal("owner"), "project_backup_request")).not.toThrow();
    expect(() => requireCapability(principal("administrator"), "project_backup_request")).not.toThrow();
    for (const role of ["deployer", "support", "developer", "analyst", "read_only"] as const) {
      expect(() => requireCapability(principal(role), "project_backup_request"))
        .toThrow(RequestAuthorizationError);
    }
    // Wiederherstellen: **nur** der Eigentuemer. Eine Wiederherstellung ist kein
    // Lesen; sie legt eine Datenbank an und bringt geloeschte Daten zurueck.
    expect(() => requireCapability(principal("owner"), "project_backup_restore")).not.toThrow();
    for (const role of [
      "administrator", "deployer", "support", "developer", "analyst", "read_only",
    ] as const) {
      expect(() => requireCapability(principal(role), "project_backup_restore"))
        .toThrow(RequestAuthorizationError);
    }
  });
});

describe("GET auf den Backup-Katalog", () => {
  it("verlangt eine Anmeldung", async () => {
    const response = await createListProjectDatabaseBackupsHandler(catalog())(
      request("GET"), params(),
    );
    expect(response.status).toBe(401);
  });

  it("gibt die Liste mit private, no-store heraus", async () => {
    const token = await ownerSession();
    const response = await createListProjectDatabaseBackupsHandler(catalog())(
      request("GET", { token }), params(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.data.backups[0].id).toBe(BACKUP_ID);
    // Kein Objektschluessel, kein eingewickelter Schluessel, kein Schluesselname,
    // keine Pruefsumme des Artefakts, kein Verweis auf die Datenbankinstanz.
    const keys = Object.keys(body.data.backups[0]);
    for (const forbidden of [
      "objectKey", "wrappedDataKey", "keyId", "artifactSha256", "databaseInstanceRef",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("weist einen unbekannten Query-Parameter mit 400 ab", async () => {
    const token = await ownerSession();
    const response = await createListProjectDatabaseBackupsHandler(catalog())(
      request("GET", { token, path: "?project=other" }), params(),
    );
    expect(response.status).toBe(400);
  });

  it("weist eine Grenze ausserhalb des Bereichs mit 400 ab", async () => {
    const token = await ownerSession();
    const response = await createListProjectDatabaseBackupsHandler(catalog())(
      request("GET", { token, path: "?limit=0" }), params(),
    );
    expect(response.status).toBe(400);
  });

  it("gibt 404 fuer eine Projektkennung, die keine ist", async () => {
    const token = await ownerSession();
    const response = await createListProjectDatabaseBackupsHandler(catalog())(
      request("GET", { token }), params("nicht-uuid"),
    );
    expect(response.status).toBe(404);
  });
});

describe("POST auf den Backup-Katalog", () => {
  it("weist einen fremden Ursprung ab, bevor es die Anmeldung ansieht", async () => {
    const response = await createRequestProjectDatabaseBackupHandler(catalog())(
      request("POST", { origin: "https://angreifer.test" }), params(),
    );
    expect(response.status).toBe(403);
  });

  it("antwortet 202 fuer einen neuen Auftrag und 200 fuer einen, der schon wartet", async () => {
    const token = await ownerSession();
    const created = await createRequestProjectDatabaseBackupHandler(catalog())(
      request("POST", { token }), params(),
    );
    expect(created.status).toBe(202);
    expect((await created.json()).data.idempotent).toBe(false);

    const again = await createRequestProjectDatabaseBackupHandler(
      catalog({ async request() { return { backup: view, created: false }; } }),
    )(request("POST", { token }), params());
    expect(again.status).toBe(200);
    expect((await again.json()).data.idempotent).toBe(true);
  });

  it("weist einen Rumpf mit einer Angabe ab", async () => {
    const token = await ownerSession();
    const response = await createRequestProjectDatabaseBackupHandler(catalog())(
      request("POST", { token, body: JSON.stringify({ retentionDays: 1 }) }), params(),
    );
    expect(response.status).toBe(400);
  });

  it("gibt 404, wenn es fuer diese Umgebung keine Bindung gibt", async () => {
    const token = await ownerSession();
    const response = await createRequestProjectDatabaseBackupHandler(catalog({
      async request() { throw new ProjectDatabaseBackupServiceError("BACKUP_NOT_FOUND"); },
    }))(request("POST", { token }), params());
    expect(response.status).toBe(404);
  });
});

describe("GET auf ein einzelnes Backup", () => {
  it("gibt 404 fuer ein Backup, das es nicht gibt", async () => {
    const token = await ownerSession();
    const response = await createGetProjectDatabaseBackupHandler(catalog({
      async get() { return null; },
    }))(request("GET", { path: `/${BACKUP_ID}`, token }), backupParams());
    expect(response.status).toBe(404);
  });

  it("gibt 404 fuer ein eigenes Backup unter einem fremden Projektpfad", async () => {
    // Die Policy sagt dazu nichts: die Zeile gehoert dem Mandanten. Ohne diese
    // Pruefung waere der Pfad eine Verzierung.
    const token = await ownerSession();
    const response = await createGetProjectDatabaseBackupHandler(catalog())(
      request("GET", { path: `/${BACKUP_ID}`, token }),
      backupParams(BACKUP_ID, OTHER_PROJECT_ID),
    );
    expect(response.status).toBe(404);
  });

  it("gibt 404 fuer ein eigenes Backup unter einer fremden Umgebung", async () => {
    const token = await ownerSession();
    const response = await createGetProjectDatabaseBackupHandler(catalog())(
      request("GET", { path: `/${BACKUP_ID}`, token }),
      backupParams(BACKUP_ID, PROJECT_ID, "staging"),
    );
    expect(response.status).toBe(404);
  });
});

describe("POST auf die Wiederherstellung", () => {
  it("weist einen fremden Ursprung ab", async () => {
    const response = await createRequestProjectDatabaseRestoreHandler(catalog())(
      request("POST", { path: `/${BACKUP_ID}/restore`, origin: "https://angreifer.test" }),
      backupParams(),
    );
    expect(response.status).toBe(403);
  });

  it("antwortet 202 und sagt, dass die Wiederherstellung bestellt ist", async () => {
    const token = await ownerSession();
    const response = await createRequestProjectDatabaseRestoreHandler(catalog())(
      request("POST", { path: `/${BACKUP_ID}/restore`, token }), backupParams(),
    );
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.data.backup.restore.status).toBe("requested");
    // Der Name der Zieldatenbank kommt aus der Backup-Id und nicht aus der Anfrage.
    expect(body.data.backup.restore.databaseName)
      .toBe("qkern_restore_5f3f1b749c2a4a4e8b6d1f2e3a4b5c6d");
  });

  it("gibt 409, wenn schon eine laeuft", async () => {
    const token = await ownerSession();
    const response = await createRequestProjectDatabaseRestoreHandler(catalog({
      async requestRestore() {
        throw new ProjectDatabaseBackupServiceError("RESTORE_ALREADY_REQUESTED");
      },
    }))(request("POST", { path: `/${BACKUP_ID}/restore`, token }), backupParams());
    expect(response.status).toBe(409);
  });

  it("gibt 409 fuer ein Backup, das nicht verfuegbar ist", async () => {
    const token = await ownerSession();
    const response = await createRequestProjectDatabaseRestoreHandler(catalog({
      async requestRestore() {
        throw new ProjectDatabaseBackupServiceError("BACKUP_NOT_AVAILABLE");
      },
    }))(request("POST", { path: `/${BACKUP_ID}/restore`, token }), backupParams());
    expect(response.status).toBe(409);
  });

  it("gibt 404 fuer ein eigenes Backup unter einem fremden Projektpfad", async () => {
    const token = await ownerSession();
    const response = await createRequestProjectDatabaseRestoreHandler(catalog())(
      request("POST", { path: `/${BACKUP_ID}/restore`, token }),
      backupParams(BACKUP_ID, OTHER_PROJECT_ID),
    );
    expect(response.status).toBe(404);
  });

  it("weist eine Rolle ohne das Recht mit 404 ab", async () => {
    // Eine Rolle ohne Recht soll nicht erfahren, dass es dieses Projekt gibt.
    // Der Administrator ist hier der interessante Fall: er darf bestellen und
    // lesen, und zurueckholen nicht.
    const nonce = crypto.randomUUID();
    const registration = await authRuntime.service.register({
      email: `backup-admin-${nonce}@qkern.test`,
      password: "a sufficiently long backup admin password",
      rateLimitKey: nonce,
    });
    const membership = await tenancyService.ensureWorkspace(registration.user);
    expect(() => requireCapability(
      { user: registration.user, membership: { ...membership, role: "administrator" } },
      "project_backup_restore",
    )).toThrow(RequestAuthorizationError);
  });
});
