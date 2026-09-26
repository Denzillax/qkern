import { describe, expect, it } from "vitest";
import {
  evaluateSecurityRules,
  isTriviallyTrue,
  type SecurityAdvisorInput,
  type SecurityAdvisorPolicy,
  type SecurityAdvisorTable,
} from "@/lib/server/advisors/security-rules";
import { SECURITY_CHECK_REASONS, SECURITY_RULE_IDS } from "@/lib/console/security-advisor-texts";

/** Die Regeln des Sicherheitsberaters (2.39): jede feuert, jede schweigt, wo sie soll. */
const NOW = new Date("2026-09-26T12:00:00.000Z");

function table(name: string, rowSecurityEnabled: boolean, kind: SecurityAdvisorTable["kind"] = "table"): SecurityAdvisorTable {
  return { name, kind, rowSecurityEnabled };
}

function policy(overrides: Partial<SecurityAdvisorPolicy> & { name: string; table: string }): SecurityAdvisorPolicy {
  return { permissive: true, command: "select", roles: ["public"], usingExpression: "(owner = CURRENT_USER)", checkExpression: null, ...overrides };
}

function input(overrides: Partial<SecurityAdvisorInput> = {}): SecurityAdvisorInput {
  return {
    environment: "development",
    now: NOW,
    database: { schema: "public", tables: [], tablesTruncated: false, policies: [], policiesTruncated: false },
    storage: { buckets: [] },
    apiKeys: { keys: [] },
    ...overrides,
  };
}

function database(tables: SecurityAdvisorTable[], policies: SecurityAdvisorPolicy[] = [], extra: Partial<{ schema: string; tablesTruncated: boolean; policiesTruncated: boolean }> = {}): SecurityAdvisorInput["database"] {
  return { schema: "public", tables, policies, tablesTruncated: false, policiesTruncated: false, ...extra };
}

const rules = (result: ReturnType<typeof evaluateSecurityRules>) => result.findings.map((item) => `${item.rule}:${item.object.name}`);

describe("security advisor rules", () => {
  it("reports nothing for a clean project and lists every rule in the checks", () => {
    const result = evaluateSecurityRules(input({
      database: database([table("orders", true)], [policy({ name: "own", table: "orders" })]),
    }));
    expect(result.findings).toEqual([]);
    expect(result.checks.map((item) => item.rule)).toEqual([...SECURITY_RULE_IDS]);
    expect(result.checks.find((item) => item.rule === "auth_provider_unverified_email")).toEqual({
      rule: "auth_provider_unverified_email", ran: false, reason: SECURITY_CHECK_REASONS.providerNotExposed,
    });
  });

  it("rls_disabled fires for ordinary and partitioned tables, not for views", () => {
    const result = evaluateSecurityRules(input({ database: database([
      table("open", false), table("parts", false, "partitioned_table"), table("report", false, "view"), table("mat", false, "materialized_view"), table("closed", true),
    ], [policy({ name: "p", table: "closed" })]) }));
    expect(rules(result)).toEqual(["rls_disabled:open", "rls_disabled:parts"]);
    expect(result.findings[0]).toMatchObject({ id: "rls_disabled:table:open", severity: "high", object: { kind: "table", name: "open" } });
    expect(result.findings[0].summary).toMatch(/Row Level Security ist aus/);
    expect(result.findings[0].remedy).toMatch(/ENABLE ROW LEVEL SECURITY/);
  });

  it("rls_no_policies fires only for RLS tables without any policy", () => {
    const result = evaluateSecurityRules(input({ database: database(
      [table("locked", true), table("guarded", true), table("open", false)],
      [policy({ name: "p", table: "guarded" })],
    ) }));
    expect(rules(result)).toEqual(["rls_disabled:open", "rls_no_policies:locked"]);
    expect(result.findings[1].severity).toBe("medium");
  });

  it("rls_no_policies does not guess when the policy list is truncated", () => {
    const result = evaluateSecurityRules(input({ database: database([table("locked", true)], [], { policiesTruncated: true, tablesTruncated: true }) }));
    expect(result.findings).toEqual([]);
    expect(result.checks.find((item) => item.rule === "rls_no_policies")).toEqual({ rule: "rls_no_policies", ran: false, reason: SECURITY_CHECK_REASONS.policiesIncomplete });
    expect(result.checks.find((item) => item.rule === "rls_disabled")).toEqual({ rule: "rls_disabled", ran: true, reason: SECURITY_CHECK_REASONS.tablesTruncated });
    expect(result.checks.find((item) => item.rule === "policy_always_true")).toEqual({ rule: "policy_always_true", ran: true, reason: SECURITY_CHECK_REASONS.policiesTruncated });
  });

  it("policy_always_true fires for true in USING or CHECK for broad roles, including parentheses and whitespace", () => {
    const result = evaluateSecurityRules(input({ database: database([table("t", true)], [
      policy({ name: "a_plain", table: "t", usingExpression: "true" }),
      policy({ name: "b_parens", table: "t", usingExpression: " ( ( TRUE ) ) " }),
      policy({ name: "c_check", table: "t", command: "insert", roles: ["anon"], usingExpression: null, checkExpression: "(true)" }),
      policy({ name: "d_authenticated", table: "t", roles: ["authenticated", "reporting"], usingExpression: "true" }),
    ]) }));
    expect(rules(result)).toEqual([
      "policy_always_true:t.a_plain", "policy_always_true:t.b_parens", "policy_always_true:t.c_check", "policy_always_true:t.d_authenticated",
    ]);
    expect(result.findings.every((item) => item.severity === "high" && item.object.kind === "policy")).toBe(true);
  });

  it("policy_always_true stays silent for restrictive, narrow-role or conditional policies", () => {
    const result = evaluateSecurityRules(input({ database: database([table("t", true)], [
      policy({ name: "restrictive", table: "t", permissive: false, usingExpression: "true" }),
      policy({ name: "narrow", table: "t", roles: ["reporting"], usingExpression: "true" }),
      policy({ name: "split", table: "t", usingExpression: "(true) OR (false)" }),
      policy({ name: "owner", table: "t", usingExpression: "(owner = CURRENT_USER)" }),
      policy({ name: "true_ish", table: "t", usingExpression: "trueish" }),
    ]) }));
    expect(result.findings).toEqual([]);
  });

  it("recognises true only as the whole expression", () => {
    expect(isTriviallyTrue("true")).toBe(true);
    expect(isTriviallyTrue("\n (\ttrue ) ")).toBe(true);
    expect(isTriviallyTrue("((true))")).toBe(true);
    expect(isTriviallyTrue("(true) AND (x = 1)")).toBe(false);
    expect(isTriviallyTrue("(x = 1) OR (true)")).toBe(false);
    expect(isTriviallyTrue("false")).toBe(false);
    expect(isTriviallyTrue(null)).toBe(false);
    expect(isTriviallyTrue("")).toBe(false);
  });

  it("policy_check_missing fires for INSERT without check and for UPDATE or ALL without any condition", () => {
    const result = evaluateSecurityRules(input({ database: database([table("t", true)], [
      policy({ name: "a_insert", table: "t", command: "insert", roles: ["writer"], usingExpression: null, checkExpression: null }),
      policy({ name: "b_update", table: "t", command: "update", roles: ["writer"], usingExpression: null, checkExpression: null }),
      policy({ name: "c_all_using", table: "t", command: "all", roles: ["writer"], usingExpression: "(owner = CURRENT_USER)", checkExpression: null }),
      policy({ name: "d_insert_checked", table: "t", command: "insert", roles: ["writer"], usingExpression: null, checkExpression: "(owner = CURRENT_USER)" }),
      policy({ name: "e_select", table: "t", command: "select", roles: ["writer"], usingExpression: null, checkExpression: null }),
      policy({ name: "f_restrictive", table: "t", permissive: false, command: "insert", roles: ["writer"], usingExpression: null, checkExpression: null }),
    ]) }));
    expect(rules(result)).toEqual(["policy_check_missing:t.a_insert", "policy_check_missing:t.b_update"]);
    expect(result.findings[0].severity).toBe("low");
  });

  it("ignores internal schemas entirely", () => {
    for (const schema of ["pg_catalog", "information_schema", "qkern_internal", "qkern_audit"]) {
      const result = evaluateSecurityRules(input({ database: database(
        [table("open", false), table("locked", true)], [policy({ name: "p", table: "x", usingExpression: "true" })], { schema },
      ) }));
      expect(result.findings, schema).toEqual([]);
    }
  });

  it("bucket rules fire on public read and on authenticated write without MIME types", () => {
    const result = evaluateSecurityRules(input({ storage: { buckets: [
      { name: "avatars", readPolicy: "public", writePolicy: "authenticated", allowedMimeTypes: [] },
      { name: "docs", readPolicy: "owner", writePolicy: "authenticated", allowedMimeTypes: ["application/pdf"] },
      { name: "private", readPolicy: "private", writePolicy: "owner", allowedMimeTypes: [] },
    ] } }));
    expect(result.findings.map((item) => `${item.rule}:${item.object.name}:${item.severity}`)).toEqual([
      "bucket_public_read:avatars:medium", "bucket_authenticated_write_any_type:avatars:low",
    ]);
  });

  it("api_key_broad fires for active service keys in production only", () => {
    const keys = [
      { id: "k1", name: "backend", kind: "service" as const, expiresAt: "2027-01-01T00:00:00.000Z", revokedAt: null },
      { id: "k2", name: "revoked", kind: "service" as const, expiresAt: "2027-01-01T00:00:00.000Z", revokedAt: "2026-09-01T00:00:00.000Z" },
      { id: "k3", name: "expired", kind: "service" as const, expiresAt: "2026-09-01T00:00:00.000Z", revokedAt: null },
      { id: "k4", name: "browser", kind: "public" as const, expiresAt: "2027-01-01T00:00:00.000Z", revokedAt: null },
    ];
    const production = evaluateSecurityRules(input({ environment: "production", apiKeys: { keys } }));
    expect(production.findings).toEqual([expect.objectContaining({ id: "api_key_broad:api_key:k1", rule: "api_key_broad", severity: "medium", object: { kind: "api_key", name: "backend" } })]);
    const staging = evaluateSecurityRules(input({ environment: "staging", apiKeys: { keys } }));
    expect(staging.findings).toEqual([]);
    expect(staging.checks.find((item) => item.rule === "api_key_broad")).toEqual({ rule: "api_key_broad", ran: true, reason: SECURITY_CHECK_REASONS.productionOnly });
  });

  it("marks the rules of a missing source as not run, with the reason", () => {
    const result = evaluateSecurityRules(input({
      database: { unavailable: "databaseDisabled" },
      storage: { unavailable: "storageDisabled" },
      apiKeys: { unavailable: "consoleOnly" },
    }));
    expect(result.findings).toEqual([]);
    expect(result.checks.filter((item) => item.ran)).toEqual([]);
    expect(result.checks.find((item) => item.rule === "rls_disabled")?.reason).toBe(SECURITY_CHECK_REASONS.databaseDisabled);
    expect(result.checks.find((item) => item.rule === "bucket_public_read")?.reason).toBe(SECURITY_CHECK_REASONS.storageDisabled);
    expect(result.checks.find((item) => item.rule === "api_key_broad")?.reason).toBe(SECURITY_CHECK_REASONS.consoleOnly);
  });

  it("sorts by severity, then by object, and is deterministic", () => {
    const build = (reverse: boolean) => {
      const tables = [table("zeta", false), table("alpha", false), table("mid", true)];
      const policies = [policy({ name: "p", table: "mid", command: "insert", roles: ["writer"], usingExpression: null, checkExpression: null })];
      const buckets = [{ name: "b2", readPolicy: "public", writePolicy: "owner", allowedMimeTypes: [] }, { name: "b1", readPolicy: "public", writePolicy: "owner", allowedMimeTypes: [] }];
      return evaluateSecurityRules(input({
        database: database(reverse ? [...tables].reverse() : tables, policies),
        storage: { buckets: reverse ? [...buckets].reverse() : buckets },
      }));
    };
    const first = build(false);
    expect(first.findings.map((item) => `${item.severity}:${item.object.name}`)).toEqual([
      "high:alpha", "high:zeta", "medium:b1", "medium:b2", "low:mid.p",
    ]);
    expect(build(true)).toEqual(first);
  });
});
