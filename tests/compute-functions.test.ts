import { describe, expect, it } from "vitest";
import type { FunctionDefinition } from "@/lib/server/compute/model";
import {
  FunctionInvoker,
  validateFunctionDefinition,
  type FunctionSandboxPort,
} from "@/lib/server/compute/functions";

const definition: FunctionDefinition = {
  organizationId: "org-compute", projectId: "project-compute", environment: "development",
  id: "function-id", name: "send_email", runtime: "nodejs24",
  image: `registry.example.com/qkern/send-email@sha256:${"a".repeat(64)}`,
  entrypoint: "dist/handler.js", timeoutMs: 100, memoryMiB: 128, maxConcurrency: 4,
  egressOrigins: ["https://api.example.com"], secretRefs: ["vault/functions/send-email"],
};

describe("Compute function boundary", () => {
  it("accepts only digest-pinned definitions with public HTTPS egress and secret references", () => {
    expect(validateFunctionDefinition(definition).image).toContain("@sha256:");
    expect(() => validateFunctionDefinition({ ...definition, image: "registry.example.com/qkern/send-email:latest" }))
      .toThrow("FUNCTION_INVALID");
    expect(() => validateFunctionDefinition({ ...definition, egressOrigins: ["http://localhost:8080"] }))
      .toThrow("FUNCTION_INVALID");
    expect(() => validateFunctionDefinition({ ...definition, egressOrigins: ["https://127.0.0.1"] }))
      .toThrow("FUNCTION_INVALID");
  });

  it("invokes an external sandbox port and validates its bounded response", async () => {
    const sandbox: FunctionSandboxPort = {
      async invoke(received, invocation) {
        expect(received.secretRefs).toEqual(["vault/functions/send-email"]);
        expect(invocation.payload).toEqual({ recipient: "user@example.test" });
        return { statusCode: 202, headers: { "content-type": "application/json" }, body: { accepted: true } };
      },
    };
    await expect(new FunctionInvoker(sandbox).invoke(definition, {
      id: "invocation-id", functionId: definition.id,
      payload: { recipient: "user@example.test" }, requestedAt: new Date().toISOString(),
    })).resolves.toMatchObject({ statusCode: 202, body: { accepted: true } });
  });

  it("times out an uncooperative sandbox and rejects unsafe response headers", async () => {
    const slow: FunctionSandboxPort = { async invoke() { return await new Promise(() => undefined); } };
    await expect(new FunctionInvoker(slow).invoke(definition, {
      id: "slow", functionId: definition.id, payload: {}, requestedAt: new Date().toISOString(),
    })).rejects.toMatchObject({ code: "FUNCTION_TIMEOUT" });
    const unsafe: FunctionSandboxPort = {
      async invoke() { return { statusCode: 200, headers: { "set-cookie": "secret=value" }, body: null }; },
    };
    await expect(new FunctionInvoker(unsafe).invoke(definition, {
      id: "unsafe", functionId: definition.id, payload: {}, requestedAt: new Date().toISOString(),
    })).rejects.toMatchObject({ code: "FUNCTION_SANDBOX_FAILED" });
  });
});
