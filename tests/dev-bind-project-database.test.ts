import { describe, expect, it } from "vitest";
import { bindStatement, parseArgs } from "../scripts/dev-bind-project-database.mjs";

describe("dev-bind-project-database", () => {
  it("requires a project id and an environment", () => {
    expect(() => parseArgs([])).toThrow(/project/);
    expect(() => parseArgs(["not-a-uuid", "development"])).toThrow(/uuid/);
    expect(() => parseArgs(["6f1e2b7c-1b2d-4c3e-8f9a-0b1c2d3e4f5a", "prod"])).toThrow(/environment/);
  });

  it("binds only a pending reference and never a production environment", () => {
    const args = parseArgs(["6f1e2b7c-1b2d-4c3e-8f9a-0b1c2d3e4f5a", "development"]);
    const statement = bindStatement(args);
    expect(statement.text).toMatch(/database_instance_ref ~\* '\^pending:'/);
    expect(statement.values).toEqual(["6f1e2b7c-1b2d-4c3e-8f9a-0b1c2d3e4f5a", "development", "managed:database-1"]);
    expect(() => parseArgs(["6f1e2b7c-1b2d-4c3e-8f9a-0b1c2d3e4f5a", "production"])).toThrow(/production/);
  });

  it("stays inside the tenant of the organization the provisioner works for", () => {
    const statement = bindStatement(parseArgs(["6f1e2b7c-1b2d-4c3e-8f9a-0b1c2d3e4f5a", "staging"]));
    expect(statement.text).toMatch(/organization_id = qkern_current_organization_id\(\)/);
    expect(() => parseArgs(["6f1e2b7c-1b2d-4c3e-8f9a-0b1c2d3e4f5a", "staging", "org"])).toThrow(/organization/);
    expect(parseArgs(["6f1e2b7c-1b2d-4c3e-8f9a-0b1c2d3e4f5a", "staging", "7a2e3c8d-2c3e-4d4f-9a0b-1c2d3e4f5a6b"]).organizationId)
      .toBe("7a2e3c8d-2c3e-4d4f-9a0b-1c2d3e4f5a6b");
  });
});
