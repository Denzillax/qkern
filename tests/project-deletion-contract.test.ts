import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { requireCapability, RequestAuthorizationError, type AuthenticatedRequestContext } from "@/lib/server/request-context";
import type { OrganizationRole } from "@/lib/server/tenancy";
import { MemoryControlPlaneService } from "@/lib/server/control-plane/memory";
import { ProjectDeleteConfirmationError } from "@/lib/server/control-plane/model";

/**
 * Ein Projekt loeschen, mit Frist (2.173).
 *
 * Entschieden von Denzil am 7. Oktober 2026: sofort gesperrt und ausgeblendet,
 * sieben Tage zurueckholbar, danach mit Datenbank, Backups und Buckets
 * abgeraeumt; nur die Owner-Rolle.
 *
 * Was in der Datenbank liegt (die Frist, die gesperrten Keys, die Mandanten-
 * grenze), belegt der Fall (2.173) gegen echtes PostgreSQL. Dieser Vertrag
 * haelt den Rest: wer es darf, dass die Routen es verlangen, dass die Console
 * den Namen abtippen laesst, und dass der Speicher-Adapter dieselben Regeln
 * hat wie die Datenbank.
 */
const ROOT = process.cwd();
const read = (file: string) => readFile(path.resolve(ROOT, file), "utf8");

function contextFor(role: OrganizationRole): AuthenticatedRequestContext {
  return {
    user: { id: "usr_1", email: "a@example.test" },
    membership: { organization: { id: "org_1", name: "Org", slug: "org" }, userId: "usr_1", role },
  } as unknown as AuthenticatedRequestContext;
}

describe("project deletion contract", () => {
  it("lets only the owner delete or restore a project", () => {
    const roles: OrganizationRole[] = ["owner", "administrator", "developer", "deployer", "analyst", "support", "read_only"];
    const allowed = roles.filter((role) => {
      try { requireCapability(contextFor(role), "project_delete"); return true; } catch (error) {
        expect(error).toBeInstanceOf(RequestAuthorizationError);
        return false;
      }
    });
    expect(allowed).toEqual(["owner"]);
  });

  it("asks for the capability, the trusted origin and the typed name on every route", async () => {
    const remove = await read("app/api/v1/projects/[projectId]/route.ts");
    expect(remove).toContain("if (!hasTrustedOrigin(request)) return csrfRejected();");
    expect(remove).toContain('requireCapability(context, "project_delete");');
    expect(remove).toContain("confirmName: z.string()");
    const restore = await read("app/api/v1/projects/[projectId]/restore/route.ts");
    expect(restore).toContain("if (!hasTrustedOrigin(request)) return csrfRejected();");
    expect(restore).toContain('requireCapability(context, "project_delete");');
    // Und der Dienst prueft den Namen selbst, nicht nur die Console.
    const service = await read("lib/server/control-plane/postgres.ts");
    expect(service).toContain("if (confirmName !== project.name) throw new ProjectDeleteConfirmationError();");
  });

  it("makes the console type the name and say what happens", async () => {
    const view = await read("components/console/project-deletion.tsx");
    expect(view).toContain("confirmName={project.name}");
    expect(view).toContain("Sieben Tage lang lässt es sich zurückholen");
    expect(view).toContain("/restore");
  });

  it("follows the same rules in the memory adapter", async () => {
    const service = new MemoryControlPlaneService();
    const context = { organizationId: "org_moqro", actor: { id: "usr_demo", ref: "demo@example.test", type: "user" as const } };
    const created = await service.createProject(context, { name: "Loeschprobe", slug: "loeschprobe", region: "ch-zrh-1" });

    await expect(service.deleteProject(context, created.id, "loeschprobe")).rejects.toBeInstanceOf(ProjectDeleteConfirmationError);
    const deleted = await service.deleteProject(context, created.id, "Loeschprobe");
    expect(Date.parse(deleted.deleteAfter) - Date.parse(deleted.deletedAt)).toBe(7 * 24 * 60 * 60 * 1000);
    expect((await service.listProjects(context)).map((entry) => entry.id)).not.toContain(created.id);
    expect((await service.listDeletedProjects(context)).map((entry) => entry.id)).toContain(created.id);
    // Eine andere Organisation sieht es nicht und holt es nicht zurueck.
    const other = { ...context, organizationId: "org_other" };
    expect(await service.listDeletedProjects(other)).toEqual([]);
    await expect(service.restoreProject(other, created.id)).rejects.toThrow();

    await service.restoreProject(context, created.id);
    expect((await service.listProjects(context)).map((entry) => entry.id)).toContain(created.id);
    expect((await service.listDeletedProjects(context)).map((entry) => entry.id)).not.toContain(created.id);
  });
});
