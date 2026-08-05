import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GeneratedApiRealtimeChangeReader } from "@/lib/server/realtime/change-reader";
import type { RealtimeChange } from "@/lib/server/realtime/change-source";
import { RealtimeError } from "@/lib/server/realtime/model";
import {
  PostgresRealtimeChangeSource,
  type ProjectConnection,
  type ProjectQueryable,
} from "@/lib/server/realtime/postgres-change-source";

const migration = fs.readFileSync(
  path.resolve(process.cwd(), "db/project/0003_qkern_change_feed.sql"),
  "utf8",
);

const scope = {
  organizationId: "org-1", projectId: "project-1", environment: "development" as const,
};

function change(overrides: Partial<RealtimeChange> = {}): RealtimeChange {
  return {
    ...scope,
    position: 1,
    schema: "public",
    table: "items",
    operation: "insert",
    key: { id: "row-1" },
    committedAt: new Date("2026-08-04T12:00:00.000Z"),
    ...overrides,
  };
}

function connection(rows: Record<string, unknown>[] = []): ProjectConnection & { queries: string[] } {
  const queries: string[] = [];
  const database: ProjectQueryable = {
    async query(text: string) {
      queries.push(text);
      return { rows: rows as never };
    },
  };
  return { queries, withProject: (_scope, work) => work(database) };
}

describe("change feed migration", () => {
  it("stores primary key values but never row values", () => {
    expect(migration).toContain("row_key jsonb NOT NULL");
    expect(migration).not.toMatch(/^\s*(record|row_data|new_values)\s+jsonb/m);
    expect(migration).toContain("octet_length(row_key::text) <= 4096");
  });

  it("captures through a trigger instead of logical replication", () => {
    // db/project/0001 erzwingt fuer jede Rolle rolreplication = false.
    // Replikation zu verwenden hiesse, diese Zusicherung umzukehren.
    expect(migration).toContain("CREATE OR REPLACE FUNCTION qkern_internal.capture_change()");
    expect(migration).not.toMatch(/CREATE PUBLICATION|REPLICA IDENTITY|wal_level/);
  });

  it("writes through a definer function with a fixed search path", () => {
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = qkern_internal, pg_catalog");
  });

  it("never lets the runtime role write the feed", () => {
    // Ein erfundenes Aenderungsereignis wuerde einen Lesevorgang mit fremden
    // Claims ausloesen.
    expect(migration).toContain("GRANT SELECT, DELETE ON qkern_internal.change_feed TO qkern_project_api_app");
    expect(migration).not.toMatch(/GRANT[^;]*INSERT[^;]*change_feed[^;]*qkern_project_api_app/);
  });

  it("refuses a table without a primary key", () => {
    expect(migration).toContain("change capture requires a primary key");
  });
});

describe("PostgresRealtimeChangeSource", () => {
  it("reads only after the given position and in order", async () => {
    const link = connection([{
      position: "7", schema_name: "public", table_name: "items", operation: "update",
      row_key: { id: "a" }, committed_at: new Date("2026-08-04T12:00:00.000Z"),
    }]);
    const source = new PostgresRealtimeChangeSource(link);

    const changes = await source.read(scope, 6, 10);

    expect(link.queries[0]).toContain("WHERE position > $1");
    expect(link.queries[0]).toContain("ORDER BY position");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ position: 7, operation: "update", key: { id: "a" } });
  });

  it("rejects an unbounded limit", async () => {
    const source = new PostgresRealtimeChangeSource(connection());
    await expect(source.read(scope, 0, 5_000)).rejects.toBeInstanceOf(RealtimeError);
    await expect(source.read(scope, 0, 0)).rejects.toBeInstanceOf(RealtimeError);
  });

  it("refuses an unknown operation instead of guessing", async () => {
    const link = connection([{
      position: 1, schema_name: "public", table_name: "items", operation: "truncate",
      row_key: { id: "a" }, committed_at: new Date(),
    }]);
    await expect(new PostgresRealtimeChangeSource(link).read(scope, 0, 10))
      .rejects.toBeInstanceOf(RealtimeError);
  });

  it("refuses a position that is not a safe integer", async () => {
    const link = connection([{
      position: "99999999999999999999", schema_name: "public", table_name: "items",
      operation: "insert", row_key: { id: "a" }, committed_at: new Date(),
    }]);
    await expect(new PostgresRealtimeChangeSource(link).read(scope, 0, 10))
      .rejects.toBeInstanceOf(RealtimeError);
  });
});

describe("GeneratedApiRealtimeChangeReader", () => {
  const api = (rows: Record<string, unknown>[], onCall?: (input: unknown) => void) => ({
    async listRows(_context: unknown, _scope: unknown, input: unknown) {
      onCall?.(input);
      return { rows } as never;
    },
  });

  it("returns the row a subscriber is allowed to see", async () => {
    let seen: unknown;
    const reader = new GeneratedApiRealtimeChangeReader(
      api([{ id: "row-1", name: "visible" }], (input) => { seen = input; }) as never,
    );

    const row = await reader.read(change(), { role: "authenticated", subject: "alice" });

    expect(row).toEqual({ id: "row-1", name: "visible" });
    expect(seen).toMatchObject({
      schema: "public", table: "items", limit: 1,
      filters: [{ column: "id", operator: "eq", value: "row-1" }],
    });
  });

  it("returns nothing when row level security hides the row", async () => {
    const reader = new GeneratedApiRealtimeChangeReader(api([]) as never);
    expect(await reader.read(change(), { role: "anon" })).toBeNull();
  });

  it("fails closed when the read itself fails", async () => {
    const reader = new GeneratedApiRealtimeChangeReader({
      async listRows() { throw new Error("unavailable"); },
    } as never);

    expect(await reader.read(change(), { role: "authenticated", subject: "alice" })).toBeNull();
  });

  it("reports a deletion only to service_role", async () => {
    // Nach dem DELETE kann RLS nicht mehr beantworten, wer die Zeile haette
    // sehen duerfen. Den Schluessel an alle zu melden wuerde seine Existenz
    // offenlegen.
    const reader = new GeneratedApiRealtimeChangeReader(api([]) as never);
    const deletion = change({ operation: "delete" });

    expect(await reader.read(deletion, { role: "service_role", subject: "worker" }))
      .toEqual({ id: "row-1" });
    expect(await reader.read(deletion, { role: "authenticated", subject: "alice" })).toBeNull();
    expect(await reader.read(deletion, { role: "anon" })).toBeNull();
  });

  it("refuses an implausibly wide primary key", async () => {
    const wide = change({
      key: Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`k${index}`, index])),
    });
    const reader = new GeneratedApiRealtimeChangeReader(api([{ id: 1 }]) as never);
    expect(await reader.read(wide, { role: "authenticated", subject: "alice" })).toBeNull();
  });
});
