import { describe, expect, it, vi } from "vitest";
import type { SqlPool, SqlPoolClient, SqlQueryResult, SqlValue } from "@/lib/server/db/sql";
import {
  DisabledProjectDataPlane,
  ProjectDataPlaneError,
  ProjectDataPlaneService,
  type ProjectDataPlaneTargetResolver,
} from "@/lib/server/data-plane/service";
import {
  cacheHitRatio,
  connectionLoad,
  connectionStateText,
  sessionAge,
} from "@/lib/console/database-activity-texts";

/**
 * Betriebszahlen und Verbindungsgruppen (2.46) am Fake-Client: Abbildung,
 * Gruppenreihenfolge, Grenze, fehlende Quelle und die reinen Rechnungen der
 * Ansicht. Was nur ein echter Server belegt — dass fremde Abfragetexte
 * wirklich nirgends auftauchen — steht als Fall "(2.46)" in
 * `postgres.integration.test.ts`.
 */
const context = { organizationId: "org-1", actorRef: "console@qkern.test" };
const scope = { projectId: "project-1", environment: "development" as const };

class FakeClient implements SqlPoolClient {
  readonly calls: Array<{ text: string; values?: readonly SqlValue[] }> = [];
  constructor(private readonly response: (text: string) => Record<string, unknown>[] | Error) {}
  async query<Row extends Record<string, unknown>>(text: string, values?: readonly SqlValue[]): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    const response = this.response(text);
    if (response instanceof Error) throw response;
    return { rows: response as Row[], rowCount: response.length };
  }
  release = vi.fn();
}

function fixture(response: (text: string) => Record<string, unknown>[] | Error) {
  const client = new FakeClient((text) => text.includes("FROM pg_catalog.pg_roles AS role") ? [{
    role_name: "qkern_project_reader", session_name: "qkern_project_reader", database_name: "project_database",
    read_only: true, can_login: true, superuser: false, bypass_rls: false, create_database: false,
    create_role: false, replication: false, has_memberships: false,
  }] : response(text));
  const pool: SqlPool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn(), end: vi.fn() };
  const targets: ProjectDataPlaneTargetResolver = { resolveTarget: vi.fn().mockResolvedValue({ databaseInstanceRef: "managed:database-1" }) };
  const connections = { resolve: vi.fn().mockResolvedValue({ pool, expectedRole: "qkern_project_reader", expectedDatabase: "project_database", expectedLedgerOwner: "qkern_ledger_owner" }) };
  return { service: new ProjectDataPlaneService(targets, connections), client };
}

const databaseRow = (o: Record<string, unknown> = {}) => ({
  commits: "1200", rollbacks: "7", blocks_read: "300", blocks_hit: "2700", deadlocks: "0",
  temp_files: "2", temp_bytes: "4096", backends: 9, max_connections: "300",
  stats_reset: "2026-09-26T08:00:00Z", ...o,
});
const groupRow = (o: Record<string, unknown> = {}) => ({
  role_name: "qkern_project_api_app", state: "idle", connections: "4", oldest_seconds: "930", ...o,
});
const isDatabaseSql = (text: string) => text.includes("FROM pg_catalog.pg_stat_database");
const isGroupSql = (text: string) => text.includes("FROM pg_catalog.pg_stat_activity");

describe("project data plane activity", () => {
  it("maps the database figures and keeps the groups in the order the database returned them", async () => {
    const built = fixture((text) => isDatabaseSql(text) ? [databaseRow()]
      : isGroupSql(text) ? [
        groupRow({ connections: "4" }),
        groupRow({ role_name: "qkern_project_api_app", state: "active", connections: "2", oldest_seconds: "5" }),
        groupRow({ role_name: "qkern_migrator", state: "idle in transaction", connections: "1", oldest_seconds: "0" }),
      ] : []);

    const result = await built.service.inspectActivity(context, scope);
    expect(result.source).toBe("postgres");
    expect(result.truncated).toBe(false);
    expect(result.database).toEqual({
      commits: 1200, rollbacks: 7, blocksRead: 300, blocksHit: 2700, deadlocks: 0,
      tempFiles: 2, tempBytes: 4096, backends: 9, maxConnections: 300,
      statsReset: "2026-09-26T08:00:00Z",
    });
    // Eine Zeile je Gruppe, in der Reihenfolge der Abfrage; nichts wird umsortiert.
    expect(result.connections).toEqual([
      { role: "qkern_project_api_app", state: "idle", count: 4, oldestSeconds: 930 },
      { role: "qkern_project_api_app", state: "active", count: 2, oldestSeconds: 5 },
      { role: "qkern_migrator", state: "idle in transaction", count: 1, oldestSeconds: 0 },
    ]);
    expect(built.client.release).toHaveBeenCalledTimes(1);
  });

  it("reads only counters, groups in the database and never selects a query text", async () => {
    const built = fixture((text) => isDatabaseSql(text) ? [databaseRow()] : isGroupSql(text) ? [groupRow()] : []);
    await built.service.inspectActivity(context, scope);
    const activity = built.client.calls.find((call) => isGroupSql(call.text))!.text;
    const database = built.client.calls.find((call) => isDatabaseSql(call.text))!.text;
    // Die eigene Datenbank, nicht der Cluster: `pg_stat_activity` zeigt einer
    // Rolle mit genug Rechten auch fremde Mandanten.
    expect(activity).toContain("activity.datname = current_database()");
    expect(database).toContain("stat.datname = current_database()");
    expect(activity).toContain("GROUP BY");
    expect(activity).toContain("ORDER BY");
    for (const forbidden of ["query", "xmin", "client_addr", "client_hostname", "application_name", "pid"]) {
      expect(activity.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    // Und kein Schreibverb, nirgends.
    for (const verb of ["terminate", "cancel", "insert", "update", "delete"]) {
      expect((activity + database).toLowerCase(), verb).not.toContain(verb);
    }
  });

  it("reports truncation honestly and rejects rows outside the boundary", async () => {
    const many = fixture((text) => isDatabaseSql(text) ? [databaseRow()]
      : isGroupSql(text) ? Array.from({ length: 201 }, (_, index) => groupRow({ role_name: `role_${index}` })) : []);
    const truncated = await many.service.inspectActivity(context, scope);
    expect(truncated.connections).toHaveLength(200);
    expect(truncated.truncated).toBe(true);

    const badCounter = fixture((text) => isDatabaseSql(text) ? [databaseRow({ commits: "nicht eine Zahl" })] : isGroupSql(text) ? [groupRow()] : []);
    await expect(badCounter.service.inspectActivity(context, scope)).rejects.toMatchObject({ code: "DATA_PLANE_BOUNDARY_REJECTED" });

    const badGroup = fixture((text) => isDatabaseSql(text) ? [databaseRow()] : isGroupSql(text) ? [groupRow({ role_name: "" })] : []);
    await expect(badGroup.service.inspectActivity(context, scope)).rejects.toBeInstanceOf(ProjectDataPlaneError);
  });

  it("fails closed when the statistics view has no row for this database", async () => {
    // Keine Quelle heisst keine Zahlen. Eine Null waere gelogen.
    const missing = fixture((text) => isGroupSql(text) ? [groupRow()] : []);
    await expect(missing.service.inspectActivity(context, scope)).rejects.toMatchObject({ code: "DATA_PLANE_BOUNDARY_REJECTED" });
  });

  it("says clearly that the data plane is off instead of pretending to have numbers", async () => {
    await expect(new DisabledProjectDataPlane().inspectActivity(context, scope))
      .rejects.toMatchObject({ code: "DATA_PLANE_DISABLED" });
  });

  it("computes the cache hit ratio, the connection load and the session age without inventing anything", () => {
    // Ohne einen einzigen gelesenen Block gibt es keine Quote: weder 0 noch 1.
    expect(cacheHitRatio(0, 0)).toBeNull();
    expect(cacheHitRatio(100, 0)).toBe(1);
    expect(cacheHitRatio(0, 100)).toBe(0);
    expect(cacheHitRatio(2700, 300)).toBeCloseTo(0.9, 10);
    expect(cacheHitRatio(-1, 10)).toBeNull();

    expect(connectionLoad(9, 300)).toBeCloseTo(0.03, 10);
    expect(connectionLoad(9, 0)).toBeNull();

    // Abgerundet: 119 Sekunden sind eine Minute, nicht zwei.
    expect(sessionAge(0)).toEqual({ value: 0, unit: "Sekunden" });
    expect(sessionAge(59)).toEqual({ value: 59, unit: "Sekunden" });
    expect(sessionAge(119)).toEqual({ value: 1, unit: "Minuten" });
    expect(sessionAge(3600)).toEqual({ value: 1, unit: "Stunden" });
    expect(sessionAge(86_400 * 3 + 5)).toEqual({ value: 3, unit: "Tage" });

    expect(connectionStateText("idle in transaction").tone).toBe("risk medium");
    // Ein Zustand, den diese Version nicht kennt, wird als unbekannt gezeigt und nicht erfunden.
    expect(connectionStateText("etwas ganz Neues").label).toBe("unbekannt");
  });
});
