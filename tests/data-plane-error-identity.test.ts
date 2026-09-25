import { describe, expect, it } from "vitest";
import { dataPlaneRouteError } from "@/app/api/v1/projects/[projectId]/environments/[environment]/schema/route";
import { DisabledProjectDataPlane, ProjectDataPlaneError, isProjectDataPlaneError } from "@/lib/server/data-plane/service";
import { getProjectDataPlane } from "@/lib/server/data-plane/runtime";

/**
 * Ein Data-Plane-Fehler muss auch dann erkannt werden, wenn er aus einem
 * anderen Modulgraphen stammt (2.24, dasselbe Muster wie 2.8 fuer Auth): der
 * Dienst liegt im Dev-Modus auf `globalThis` und ueberlebt Hot-Reloads, die
 * Klasse nicht. Am 25. September antwortete deshalb jede Katalogansicht
 * "nicht verfuegbar" mit einem 500 ohne Code, obwohl der Dienst sauber
 * `DATA_PLANE_DISABLED` geworfen hatte.
 */
class ForeignDataPlaneError extends Error {
  constructor(readonly code: string) { super("The project data plane is unavailable."); this.name = "ProjectDataPlaneError"; }
}

describe("data plane error identity", () => {
  it("recognises its own class and a foreign copy, and rejects look-alikes", () => {
    expect(isProjectDataPlaneError(new ProjectDataPlaneError("DATA_PLANE_DISABLED"))).toBe(true);
    expect(isProjectDataPlaneError(new ProjectDataPlaneError("DATA_PLANE_DISABLED"), "DATA_PLANE_DISABLED")).toBe(true);
    expect(isProjectDataPlaneError(new ProjectDataPlaneError("DATA_PLANE_DISABLED"), "DATA_PLANE_NOT_READY")).toBe(false);
    expect(isProjectDataPlaneError(new ForeignDataPlaneError("DATA_PLANE_UNAVAILABLE"))).toBe(true);
    expect(isProjectDataPlaneError(new Error("DATA_PLANE_DISABLED"))).toBe(false);
    expect(isProjectDataPlaneError(Object.assign(new Error("x"), { name: "ProjectDataPlaneError" }))).toBe(false);
    expect(isProjectDataPlaneError({ name: "ProjectDataPlaneError", code: "DATA_PLANE_DISABLED" })).toBe(false);
  });

  it("maps a foreign copy of the error to the same status as its own class", async () => {
    for (const [code, status] of [["DATA_PLANE_DISABLED", 503], ["DATA_PLANE_UNAVAILABLE", 503], ["DATA_PLANE_NOT_READY", 409], ["DATA_PLANE_INVALID_INPUT", 400]] as const) {
      const own = dataPlaneRouteError(new ProjectDataPlaneError(code));
      const foreign = dataPlaneRouteError(new ForeignDataPlaneError(code));
      expect(own.status, code).toBe(status);
      expect(foreign.status, code).toBe(status);
      expect((await foreign.json()).code).toBe(code);
    }
  });

  it("does not memoise the disabled plane, so a reloaded module graph always sees the current class", async () => {
    const runtime = globalThis as typeof globalThis & { __qkernProjectDataPlanePromise?: unknown };
    const previous = process.env.QKERN_DATA_PLANE_ENABLED;
    const cached = runtime.__qkernProjectDataPlanePromise;
    delete process.env.QKERN_DATA_PLANE_ENABLED;
    delete runtime.__qkernProjectDataPlanePromise;
    try {
      const plane = await getProjectDataPlane();
      expect(plane).toBeInstanceOf(DisabledProjectDataPlane);
      expect(runtime.__qkernProjectDataPlanePromise).toBeUndefined();
      expect(typeof plane.inspectRoles).toBe("function");
      // Eine schon gemerkte abgeschaltete Instanz aus einem alten Modulgraphen wird verworfen.
      class StaleDisabledProjectDataPlane { inspectSchema() { throw new Error("stale"); } }
      runtime.__qkernProjectDataPlanePromise = Promise.resolve(new StaleDisabledProjectDataPlane());
      Object.defineProperty(StaleDisabledProjectDataPlane, "name", { value: "DisabledProjectDataPlane" });
      const fresh = await getProjectDataPlane();
      expect(fresh).toBeInstanceOf(DisabledProjectDataPlane);
      expect(runtime.__qkernProjectDataPlanePromise).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.QKERN_DATA_PLANE_ENABLED; else process.env.QKERN_DATA_PLANE_ENABLED = previous;
      if (cached === undefined) delete runtime.__qkernProjectDataPlanePromise; else runtime.__qkernProjectDataPlanePromise = cached;
    }
  });
});
