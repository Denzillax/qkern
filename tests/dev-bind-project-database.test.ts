import { describe, expect, it } from "vitest";
import {
  assertLocalUrl,
  bindStatement,
  parseArgs,
  resolveOrganizationId,
} from "../scripts/dev-bind-project-database.mjs";

const PROJECT = "6f1e2b7c-1b2d-4c3e-8f9a-0b1c2d3e4f5a";
const ORG = "7a2e3c8d-2c3e-4d4f-9a0b-1c2d3e4f5a6b";
const OTHER_ORG = "8b3f4d9e-3d4f-4e5a-8b1c-2d3e4f5a6b7c";

describe("dev-bind-project-database", () => {
  it("requires a project id and an environment", () => {
    expect(() => parseArgs([])).toThrow(/project/);
    expect(() => parseArgs(["not-a-uuid", "development"])).toThrow(/uuid/);
    expect(() => parseArgs([PROJECT, "prod"])).toThrow(/Umgebung/);
    expect(() => parseArgs([PROJECT])).toThrow(/project-uuid/);
    expect(() => parseArgs([PROJECT, "development", ORG, "extra"])).toThrow(/project-uuid/);
  });

  it("binds only a pending reference and never a production environment", () => {
    const args = parseArgs([PROJECT, "development"]);
    const statement = bindStatement(args);
    expect(statement.text).toMatch(/database_instance_ref ~\* '\^pending:'/);
    expect(statement.values).toEqual([PROJECT, "development", "managed:database-1"]);
    expect(() => parseArgs([PROJECT, "production"])).toThrow(/production/);
  });

  it("trims arguments and accepts the remote flag anywhere", () => {
    expect(parseArgs([` ${PROJECT} `, " staging "])).toEqual({
      projectId: PROJECT, environment: "staging", organizationId: undefined, allowRemote: false,
    });
    expect(parseArgs(["--allow-remote-host", PROJECT, "staging", ORG])).toEqual({
      projectId: PROJECT, environment: "staging", organizationId: ORG, allowRemote: true,
    });
  });

  it("stays inside the tenant of the organization the provisioner works for", () => {
    const statement = bindStatement(parseArgs([PROJECT, "staging"]));
    expect(statement.text).toMatch(/organization_id = qkern_current_organization_id\(\)/);
    expect(() => parseArgs([PROJECT, "staging", "org"])).toThrow(/Organisations-ID/);
  });

  it("takes the organization from the argument first, then from the environment", () => {
    expect(resolveOrganizationId({ organizationId: ORG }, { QKERN_PROVISIONER_ORGANIZATION_ID: OTHER_ORG })).toBe(ORG);
    expect(resolveOrganizationId({}, { QKERN_PROVISIONER_ORGANIZATION_ID: ` ${OTHER_ORG} ` })).toBe(OTHER_ORG);
    expect(() => resolveOrganizationId({}, {})).toThrow(/Organisation/);
    expect(() => resolveOrganizationId({}, { QKERN_PROVISIONER_ORGANIZATION_ID: "replace-with-an-organization-uuid" }))
      .toThrow(/Organisation/);
  });

  it("refuses a non-local database host unless forced", () => {
    expect(assertLocalUrl("postgresql://u:p@localhost:5432/qkern_control", { allowRemote: false }))
      .toEqual({ host: "localhost", port: "5432", database: "qkern_control" });
    expect(assertLocalUrl("postgresql://u:p@127.0.0.1:5439/qkern_control", { allowRemote: false }).port).toBe("5439");
    expect(assertLocalUrl("postgresql://u:p@[::1]/qkern_control", { allowRemote: false }).host).toBe("[::1]");
    expect(() => assertLocalUrl("postgresql://u:p@db.example.com:5432/qkern_control", { allowRemote: false }))
      .toThrow(/nicht lokal/);
    expect(assertLocalUrl("postgresql://u:p@db.example.com:5432/qkern_control", { allowRemote: true }).host)
      .toBe("db.example.com");
  });

  it("refuses a host override through ?host= unless forced", () => {
    expect(() => assertLocalUrl("postgresql://u:p@localhost:5432/db?host=prod.example.com", { allowRemote: false }))
      .toThrow(/\?host=/);
    expect(() => assertLocalUrl("postgresql://u:p@localhost:5432/db?HOST=/cloudsql/project:region:instance", { allowRemote: false }))
      .toThrow(/\?host=/);
    expect(assertLocalUrl("postgresql://u:p@localhost:5432/db?host=prod.example.com", { allowRemote: true }))
      .toEqual({ host: "localhost", port: "5432", database: "db" });
  });
});
