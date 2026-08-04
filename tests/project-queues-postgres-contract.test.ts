import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PostgresProjectQueueRepository } from "@/lib/server/project-queues/postgres-repository";

describe("Project Queues PostgreSQL contract", () => {
  it("declares a durable adapter and uses non-blocking row claims", async () => {
    const repository = new PostgresProjectQueueRepository({
      async withTenant() { throw new Error("not called"); },
    } as never);
    const source = await readFile("lib/server/project-queues/postgres-repository.ts", "utf8");
    expect(repository.durability).toBe("durable");
    expect(source).toContain("FOR UPDATE SKIP LOCKED");
    expect(source).toContain("lease_token_hash");
    expect(source).not.toContain("lease_token text");
  });

  it("pins tenant RLS, scoped foreign keys and least-privilege grants in migration 0026", async () => {
    const migration = await readFile("db/migrations/0026_project_queues.sql", "utf8");
    expect(migration).toContain("REFERENCES project_environments (organization_id, project_id, environment)");
    expect(migration).toContain("REFERENCES project_queues (organization_id, project_id, environment, id)");
    expect(migration).toContain("CREATE UNIQUE INDEX project_queue_messages_active_dedupe_key");
    expect(migration).toContain("ALTER TABLE project_queues ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("ALTER TABLE project_queue_messages ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("GRANT SELECT, INSERT ON project_queues TO qkern_runtime");
    expect(migration).not.toContain("GRANT SELECT, INSERT, DELETE ON project_queues");
    expect(migration).not.toMatch(/GRANT UPDATE \([^)]*payload/i);
  });

  it("binds each dead-letter replay to one immutable same-tenant source", async () => {
    const migration = await readFile("db/migrations/0027_project_queue_dead_letter_replay.sql", "utf8");
    expect(migration).toContain("project_queue_messages_replay_source_fk");
    expect(migration).toContain("REFERENCES project_queue_messages (organization_id, project_id, environment, id)");
    expect(migration).toContain("CREATE UNIQUE INDEX project_queue_messages_replay_once");
    expect(migration).toContain("project queue replay binding is immutable");
    expect(migration).toContain("ON DELETE RESTRICT");
  });
});
