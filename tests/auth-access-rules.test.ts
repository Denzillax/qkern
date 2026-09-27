import { describe, expect, it } from "vitest";
import {
  classifyAuthAccessCondition,
  evaluateAuthAccess,
  type AuthAccessPolicyInput,
  type AuthAccessTableInput,
} from "@/lib/server/data-plane/auth-access-rules";
import { AUTH_ACCESS_COMMANDS, AUTH_ACCESS_VERDICTS } from "@/lib/console/auth-policies-texts";

/**
 * Die Regeln von Auth -> Policies (2.62) ohne Datenbank.
 *
 * Das Modul ist rein: Eingabe sind zwei Katalogauskuenfte als flache Daten und
 * ein Rollenname, Ausgabe ist je Tabelle ein Urteil. Genau die fuenf Lagen,
 * die eine Policy-Liste falsch deuten laesst, stehen hier: eine wahre
 * permissive Bedingung, eine Bedingung auf den Claim, ueberhaupt keine Policy,
 * Row Level Security aus und eine Policy fuer eine andere Rolle.
 */
const ROLE = "qkern_project_api_app";

function table(name: string, rowSecurityEnabled: boolean, kind: AuthAccessTableInput["kind"] = "table"): AuthAccessTableInput {
  return { name, kind, rowSecurityEnabled };
}

function policy(input: Partial<AuthAccessPolicyInput> & { name: string; table: string }): AuthAccessPolicyInput {
  return {
    permissive: true,
    command: "select",
    roles: ["public"],
    usingExpression: null,
    checkExpression: null,
    ...input,
  };
}

function run(tables: AuthAccessTableInput[], policies: AuthAccessPolicyInput[]) {
  return evaluateAuthAccess({ schema: "public", role: ROLE, tables, policies });
}

function commandOf(result: ReturnType<typeof run>, tableName: string, command: string) {
  return result.tables.find((entry) => entry.table === tableName)!.commands.find((entry) => entry.command === command)!;
}

describe("auth access rules", () => {
  it("calls a table with a permissive true policy for PUBLIC open to everyone, and says so certainly", () => {
    const result = run(
      [table("posts", true)],
      [policy({ name: "read_all", table: "posts", command: "select", usingExpression: "true" })],
    );
    const report = result.tables[0];
    expect(report.verdict).toBe("open");
    expect(report.uncertain).toBe(false);
    expect(commandOf(result, "posts", "select")).toMatchObject({
      allowed: "always", condition: "none", policies: ["read_all"], restrictedBy: [],
    });
    // Nur SELECT; schreiben darf hier niemand.
    for (const command of ["insert", "update", "delete"]) {
      expect(commandOf(result, "posts", command), command).toMatchObject({ allowed: "no", condition: "none" });
    }
    expect(result.counts).toEqual({ refused: 0, locked: 0, readable: 0, writable: 0, open: 1 });
    // Auch die geklammerte Schreibweise von pg_get_expr ist bedingungslos.
    expect(classifyAuthAccessCondition("((true))")).toBe("none");
    expect(classifyAuthAccessCondition(null)).toBe("none");
  });

  it("keeps a condition on the subject claim uncertain and never turns it into a yes", () => {
    const using = "(owner_id = (current_setting('request.jwt.claim.sub'::text, true))::uuid)";
    const result = run(
      [table("notes", true)],
      [
        policy({ name: "own_select", table: "notes", command: "select", roles: [ROLE], usingExpression: using }),
        policy({ name: "own_write", table: "notes", command: "insert", roles: [ROLE], checkExpression: using }),
      ],
    );
    const report = result.tables[0];
    // Schreibbar sticht lesbar, und die Zeile traegt die Unsicherheit selbst.
    expect(report.verdict).toBe("writable");
    expect(report.uncertain).toBe(true);
    expect(commandOf(result, "notes", "select")).toMatchObject({ allowed: "sometimes", condition: "request" });
    expect(commandOf(result, "notes", "insert")).toMatchObject({ allowed: "sometimes", condition: "request", policies: ["own_write"] });
    expect(commandOf(result, "notes", "delete")).toMatchObject({ allowed: "no" });
    // Offen fuer alle ist das ausdruecklich nicht, obwohl eine Policy gilt.
    expect(report.verdict).not.toBe("open");
    expect(classifyAuthAccessCondition(using)).toBe("request");
    // Ein Vergleich nur auf Spalten ist etwas anderes als eine Anfragebedingung.
    expect(classifyAuthAccessCondition("(published = true)")).toBe("constant");
    // Jeder Funktionsaufruf zaehlt, auch ein eigener.
    expect(classifyAuthAccessCondition("hat_zugriff(id)")).toBe("request");
  });

  it("calls a table with row security on and no policy at all locked", () => {
    const result = run([table("secrets", true)], []);
    const report = result.tables[0];
    expect(report.verdict).toBe("locked");
    expect(report.uncertain).toBe(false);
    expect(report.policies).toEqual([]);
    expect(report.foreignRolePolicies).toBe(0);
    expect(report.commands.map((entry) => entry.allowed)).toEqual(["no", "no", "no", "no"]);
    expect(report.commands.map((entry) => entry.command)).toEqual([...AUTH_ACCESS_COMMANDS]);
  });

  it("calls a table with row security off refused, even when a permissive true policy sits on it", () => {
    const result = run(
      [table("audit", false)],
      [policy({ name: "read_all", table: "audit", command: "all", usingExpression: "true" })],
    );
    const report = result.tables[0];
    // Der Schalter sticht jede Policy: Die Data API nimmt die Tabelle nicht an.
    expect(report.verdict).toBe("refused");
    expect(report.rowSecurityEnabled).toBe(false);
    // Die Policy wird trotzdem gezeigt, damit niemand sie fuer wirksam haelt.
    expect(report.policies).toHaveLength(1);
    expect(report.policies[0].applies).toBe(true);
    expect(result.counts.refused).toBe(1);
    expect(result.counts.open).toBe(0);
  });

  it("does not count a policy that names another role only, and says how many there are", () => {
    const result = run(
      [table("reports", true)],
      [
        policy({ name: "analyst_read", table: "reports", command: "select", roles: ["analyst"], usingExpression: "true" }),
        policy({ name: "admin_all", table: "reports", command: "all", roles: ["reporting_admin"], usingExpression: "true" }),
      ],
    );
    const report = result.tables[0];
    expect(report.verdict).toBe("locked");
    expect(report.foreignRolePolicies).toBe(2);
    expect(report.policies.map((entry) => entry.applies)).toEqual([false, false]);
    expect(commandOf(result, "reports", "select")).toMatchObject({ allowed: "no", policies: [] });
  });

  it("lets a restrictive policy narrow a yes to a depends, and never grant on its own", () => {
    const narrow = run(
      [table("orders", true)],
      [
        policy({ name: "read_all", table: "orders", command: "select", usingExpression: "true" }),
        policy({ name: "tenant_only", table: "orders", command: "all", permissive: false, roles: ["public"], usingExpression: "(tenant_id = (current_setting('app.tenant'::text, true))::integer)" }),
      ],
    );
    expect(commandOf(narrow, "orders", "select")).toMatchObject({
      allowed: "sometimes", condition: "request", policies: ["read_all"], restrictedBy: ["tenant_only"],
    });
    // Und darum ist die Tabelle nicht mehr offen fuer alle.
    expect(narrow.tables[0].verdict).toBe("readable");

    const alone = run(
      [table("orders", true)],
      [policy({ name: "tenant_only", table: "orders", command: "all", permissive: false, usingExpression: "true" })],
    );
    expect(alone.tables[0].verdict).toBe("locked");
    expect(commandOf(alone, "orders", "select")).toMatchObject({ allowed: "no", restrictedBy: ["tenant_only"] });
  });

  it("reads a FOR ALL policy without WITH CHECK the way PostgreSQL does, and counts views out", () => {
    const result = run(
      [table("items", true), table("item_overview", true, "view"), table("item_cache", true, "materialized_view")],
      [policy({ name: "everything", table: "items", command: "all", roles: [ROLE], usingExpression: "true" })],
    );
    expect(result.views).toBe(2);
    expect(result.tables).toHaveLength(1);
    // Fehlt WITH CHECK, nimmt PostgreSQL USING; INSERT ist damit bedingungslos erlaubt.
    for (const command of AUTH_ACCESS_COMMANDS) {
      expect(commandOf(result, "items", command), command).toMatchObject({ allowed: "always", condition: "none" });
    }
    // Fuer PUBLIC ist die Policy nicht geschrieben, also ist die Tabelle nicht offen fuer alle.
    expect(result.tables[0].verdict).toBe("writable");
    expect(result.role).toBe(ROLE);
    expect(result.claimRole).toBe("authenticated");
    expect(Object.keys(result.counts).sort()).toEqual([...AUTH_ACCESS_VERDICTS].sort());
  });
});
