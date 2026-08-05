import { describe, expect, it } from "vitest";
import { RealtimeError, type RealtimeScope } from "@/lib/server/realtime/model";
import { ControlPlaneRealtimeProjectConnection } from
  "@/lib/server/realtime/project-connection";

const scope: RealtimeScope = {
  organizationId: "org-1", projectId: "project-1", environment: "development",
};

const HEALTHY = {
  role_name: "qkern_project_api_app",
  session_name: "qkern_project_api_app",
  database_name: "project_db",
  can_login: true,
  superuser: false,
  bypass_rls: false,
  replication: false,
};

function pool(boundary: Record<string, unknown> | null, queries: string[] = []) {
  let released = 0;
  return {
    get released() { return released; },
    async connect() {
      return {
        async query(text: string) {
          queries.push(text);
          if (text.includes("pg_catalog.pg_roles")) {
            return { rows: boundary ? [boundary] : [] };
          }
          return { rows: [{ ok: true }] };
        },
        release() { released += 1; },
      };
    },
  };
}

function build(options: {
  boundary?: Record<string, unknown> | null;
  ref?: string | null;
  expectedRole?: string;
  expectedDatabase?: string;
  queries?: string[];
}) {
  const targets = {
    async resolveTarget() {
      if (options.ref === null) throw new Error("no target");
      return { databaseInstanceRef: options.ref ?? "managed:project-1" };
    },
  };
  const connections = {
    async resolve() {
      return {
        pool: pool(options.boundary === undefined ? HEALTHY : options.boundary, options.queries),
        expectedRole: options.expectedRole ?? "qkern_project_api_app",
        expectedDatabase: options.expectedDatabase ?? "project_db",
        expectedLedgerOwner: "qkern",
      };
    },
  };
  return new ControlPlaneRealtimeProjectConnection(targets as never, connections as never);
}

describe("ControlPlaneRealtimeProjectConnection", () => {
  it("resolves the catalog reference and runs the work", async () => {
    const queries: string[] = [];
    const connection = build({ queries });

    const result = await connection.withProject(scope, async (database) => {
      await database.query("SELECT position FROM qkern_internal.change_feed");
      return "done";
    });

    expect(result).toBe("done");
    expect(queries.some((text) => text.includes("change_feed"))).toBe(true);
  });

  it("refuses when the control plane knows no target", async () => {
    // Ein unbekanntes Projekt darf nicht auf eine Standardverbindung fallen.
    await expect(build({ ref: null }).withProject(scope, async () => "unreachable"))
      .rejects.toBeInstanceOf(RealtimeError);
  });

  it("refuses a connection whose role does not match the catalog", async () => {
    // Ein Katalog, der auf eine andere Rolle zeigt, wuerde Feed-Zeilen fremder
    // Projekte liefern -- und der Reader loest daraufhin Lesevorgaenge mit den
    // Claims echter Abonnenten aus.
    await expect(
      build({ boundary: { ...HEALTHY, role_name: "qkern_app" } })
        .withProject(scope, async () => "unreachable"),
    ).rejects.toBeInstanceOf(RealtimeError);
  });

  it("refuses a connection to a different database", async () => {
    await expect(
      build({ boundary: { ...HEALTHY, database_name: "other_db" } })
        .withProject(scope, async () => "unreachable"),
    ).rejects.toBeInstanceOf(RealtimeError);
  });

  it("refuses a privileged login", async () => {
    for (const privileged of [
      { superuser: true }, { bypass_rls: true }, { replication: true }, { can_login: false },
    ]) {
      await expect(
        build({ boundary: { ...HEALTHY, ...privileged } })
          .withProject(scope, async () => "unreachable"),
      ).rejects.toBeInstanceOf(RealtimeError);
    }
  });

  it("checks the boundary on every access, not once at startup", async () => {
    const queries: string[] = [];
    const connection = build({ queries });

    await connection.withProject(scope, async () => "first");
    await connection.withProject(scope, async () => "second");

    const checks = queries.filter((text) => text.includes("pg_catalog.pg_roles"));
    expect(checks).toHaveLength(2);
  });

  it("releases the client even when the work throws", async () => {
    const targets = { async resolveTarget() { return { databaseInstanceRef: "managed:x" }; } };
    const shared = pool(HEALTHY);
    const connections = {
      async resolve() {
        return {
          pool: shared,
          expectedRole: "qkern_project_api_app",
          expectedDatabase: "project_db",
          expectedLedgerOwner: "qkern",
        };
      },
    };
    const connection = new ControlPlaneRealtimeProjectConnection(
      targets as never, connections as never,
    );

    await expect(connection.withProject(scope, async () => { throw new Error("boom"); }))
      .rejects.toThrow("boom");
    expect(shared.released).toBe(1);
  });
});
