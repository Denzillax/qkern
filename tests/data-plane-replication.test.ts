import { describe, expect, it, vi } from "vitest";
import type { SqlPool, SqlPoolClient, SqlQueryResult, SqlValue } from "@/lib/server/db/sql";
import {
  DisabledProjectDataPlane,
  ProjectDataPlaneError,
  ProjectDataPlaneService,
  type ProjectDataPlaneTargetResolver,
} from "@/lib/server/data-plane/service";
import { SLOT_STATE_TEXTS, slotState } from "@/lib/console/replication-texts";

/**
 * Replikation (2.74) am Fake-Client: Abbildung, die Grenzen, das
 * Fail-closed-Verhalten und die Ableitung des Zustands, die die Ansicht zeigt.
 *
 * Was nur ein echter Server belegt, naemlich dass ein echter Slot mit einem
 * echten Rueckstand herauskommt und in der Antwort kein Verbindungsgeheimnis
 * steht, steht als Fall (2.74) in `postgres.integration.test.ts`.
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

const slotRow = (o: Record<string, unknown>) => ({
  slot_name: "warehouse", slot_type: "logical", plugin: "pgoutput", database_name: "project_database",
  temporary: false, active: true, wal_status: "reserved", retained_bytes: "16384", safe_bytes: null, ...o,
});
const subscriptionRow = (o: Record<string, unknown>) => ({
  subscription_name: "warehouse_sub", owner: "qkern", enabled: true, slot_name: "warehouse",
  publications: ["orders_pub"], ...o,
});
const publicationRow = (o: Record<string, unknown>) => ({
  publication_name: "orders_pub", owner: "qkern", publish_insert: true, publish_update: true,
  publish_delete: false, publish_truncate: false, all_tables: false, tables: ["public.orders"], ...o,
});

function answer(rows: {
  state?: Record<string, unknown>[];
  publications?: Record<string, unknown>[];
  subscriptions?: Record<string, unknown>[];
  slots?: Record<string, unknown>[];
}) {
  return (text: string) =>
    text.includes("pg_catalog.pg_is_in_recovery() AS in_recovery") ? rows.state ?? [{ wal_level: "logical", in_recovery: false }]
    : text.includes("pg_catalog.pg_publication AS publication") ? rows.publications ?? []
    : text.includes("pg_catalog.pg_subscription AS subscription") ? rows.subscriptions ?? []
    : text.includes("pg_catalog.pg_replication_slots AS slot") ? rows.slots ?? []
    : [];
}

describe("project data plane replication", () => {
  it("maps the wal level, the publications, the subscriptions and the slots with their backlog", async () => {
    const built = fixture(answer({
      publications: [publicationRow({}), publicationRow({ publication_name: "everything", all_tables: true, tables: [] })],
      subscriptions: [subscriptionRow({}), subscriptionRow({ subscription_name: "paused", enabled: false, slot_name: null, publications: [] })],
      slots: [
        slotRow({}),
        // Ein physischer Slot ohne Konsumenten: der Fall, der WAL festhaelt,
        // bis die Platte voll ist.
        slotRow({
          slot_name: "standby_one", slot_type: "physical", plugin: null, database_name: null,
          active: false, retained_bytes: "1073741824", safe_bytes: "5242880",
        }),
        // Und einer, der noch keine Position hat: haelt nichts fest.
        slotRow({ slot_name: "fresh", wal_status: null, retained_bytes: null, active: false }),
      ],
    }));

    const result = await built.service.inspectReplication(context, scope);
    expect(result.source).toBe("postgres");
    expect(result.walLevel).toBe("logical");
    expect(result.inRecovery).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.publications.map((entry) => entry.name)).toEqual(["orders_pub", "everything"]);
    expect(result.subscriptions).toEqual([
      { name: "warehouse_sub", owner: "qkern", enabled: true, slotName: "warehouse", publications: ["orders_pub"] },
      { name: "paused", owner: "qkern", enabled: false, slotName: null, publications: [] },
    ]);
    expect(result.slots[0]).toEqual({
      name: "warehouse", slotType: "logical", plugin: "pgoutput", database: "project_database",
      temporary: false, active: true, walStatus: "reserved", retainedBytes: 16_384, safeBytes: null,
    });
    expect(result.slots[1]!.retainedBytes).toBe(1_073_741_824);
    expect(result.slots[1]!.safeBytes).toBe(5_242_880);
    // `null` bleibt `null`: Kein Rueckstand ist etwas anderes als null Bytes.
    expect(result.slots[2]!.retainedBytes).toBeNull();
    expect(result.slots[2]!.walStatus).toBeNull();

    // Die Ableitung, die die Ansicht zeigt, an denselben drei Slots.
    expect(slotState(result.slots[0]!)).toBe("attached");
    expect(slotState(result.slots[1]!)).toBe("abandoned");
    expect(SLOT_STATE_TEXTS[slotState(result.slots[1]!)].tone).toBe("risk high");
    expect(slotState(result.slots[2]!)).toBe("unpositioned");

    // Die Verbindungszeichenfolge des Abonnements wird nicht einmal
    // ausgewaehlt, und es gibt keine zweite Lesestelle fuer Publikationen.
    const statements = built.client.calls.map((call) => call.text).join("\n");
    expect(statements).not.toContain("subconninfo");
    expect(statements).not.toContain("conninfo");
    expect(statements).not.toContain("suborigin");
    // Die Antwort traegt keine LSN, auch nicht als Text: gerechnet wird der
    // Abstand, und nur der kommt heraus.
    expect(JSON.stringify(result)).not.toContain("lsn");
  });

  it("reads the publications through the very same statement as the publications page", async () => {
    const built = fixture(answer({ publications: [publicationRow({})] }));
    const page = fixture(answer({ publications: [publicationRow({})] }));
    const replication = await built.service.inspectReplication(context, scope);
    const publications = await page.service.inspectPublications(context, scope);
    expect(replication.publications).toEqual(publications.publications);
    const used = built.client.calls.find((call) => call.text.includes("pg_catalog.pg_publication AS publication"));
    const same = page.client.calls.find((call) => call.text.includes("pg_catalog.pg_publication AS publication"));
    expect(used?.text).toBe(same?.text);
  });

  it("reports truncation honestly and rejects rows outside the boundary", async () => {
    const many = Array.from({ length: 201 }, (_, index) => slotRow({ slot_name: `slot_${index}` }));
    const truncating = fixture(answer({ slots: many }));
    const truncated = await truncating.service.inspectReplication(context, scope);
    expect(truncated.slots).toHaveLength(200);
    expect(truncated.truncated).toBe(true);

    // Ein wal_level, das dieser Code nicht kennt, ist kein Grund zum Raten.
    const oddLevel = fixture(answer({ state: [{ wal_level: "archive", in_recovery: false }] }));
    await expect(oddLevel.service.inspectReplication(context, scope))
      .rejects.toThrowError(ProjectDataPlaneError);

    // Keine Zeile heisst: keine Auskunft, nicht eine Vorgabe.
    const noState = fixture(answer({ state: [] }));
    await expect(noState.service.inspectReplication(context, scope))
      .rejects.toThrowError(ProjectDataPlaneError);

    // Eine Slot-Art, die es nicht gibt.
    const oddType = fixture(answer({ slots: [slotRow({ slot_type: "chemical" })] }));
    await expect(oddType.service.inspectReplication(context, scope))
      .rejects.toThrowError(ProjectDataPlaneError);

    // Ein Zustand ausserhalb der vier, die PostgreSQL kennt.
    const oddStatus = fixture(answer({ slots: [slotRow({ wal_status: "gone" })] }));
    await expect(oddStatus.service.inspectReplication(context, scope))
      .rejects.toThrowError(ProjectDataPlaneError);

    // Ein negativer Rueckstand wird nicht auf null gebogen.
    const negative = fixture(answer({ slots: [slotRow({ retained_bytes: "-8192" })] }));
    await expect(negative.service.inspectReplication(context, scope))
      .rejects.toThrowError(ProjectDataPlaneError);

    // Und eine Zahl jenseits des sicheren Integers ebenso.
    const huge = fixture(answer({ slots: [slotRow({ retained_bytes: "9007199254740993" })] }));
    await expect(huge.service.inspectReplication(context, scope))
      .rejects.toThrowError(ProjectDataPlaneError);
  });

  it("stays closed while the data plane is disabled", async () => {
    await expect(new DisabledProjectDataPlane().inspectReplication(context, scope))
      .rejects.toMatchObject({ code: "DATA_PLANE_DISABLED" });
  });
});
