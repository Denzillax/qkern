import { describe, expect, it } from "vitest";
import { displayWorkspaceName } from "@/lib/console/workspace-name";

describe("displayWorkspaceName", () => {
  it("turns the automatic e-mail derived name into a readable one", () => {
    expect(displayWorkspaceName("Denis.mihaljevic Workspace")).toBe("Denis Mihaljevic");
    expect(displayWorkspaceName("jane_doe-x Workspace")).toBe("Jane Doe X");
  });
  it("keeps a custom name and only drops the trailing 'Workspace'", () => {
    expect(displayWorkspaceName("Acme Workspace")).toBe("Acme");
    expect(displayWorkspaceName("Acme Labs")).toBe("Acme Labs");
  });
  it("falls back when there is no name", () => {
    expect(displayWorkspaceName(null)).toBe("QKERN");
    expect(displayWorkspaceName("Workspace")).toBe("Workspace");
  });
});
