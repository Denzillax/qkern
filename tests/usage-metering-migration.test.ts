import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("usage metering PostgreSQL contract", () => {
  it("binds append-only verifier events, monotonic counters and quota policies to tenant RLS", async () => {
    const sql = await readFile("db/migrations/0028_usage_metering.sql", "utf8");
    expect(sql).toContain("CREATE TABLE usage_quota_policies");
    expect(sql).toContain("CREATE TABLE usage_counters");
    expect(sql).toContain("CREATE TABLE usage_events");
    expect(sql).toContain("usage_events_idempotency_key UNIQUE");
    expect(sql).toContain("usage events are append-only");
    expect(sql).toContain("usage counter identity or monotonicity is invalid");
    expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(3);
    expect(sql).toContain("organization_id = qkern_current_organization_id()");
    expect(sql).not.toMatch(/raw[_ ]?(key|token)|idempotency_key\s+text/i);
  });
});
