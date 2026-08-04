import { describe, expect, it } from "vitest";
import { createQKERNMcpServer, mcpContextFromEnv } from "@/mcp/server";

describe("MCP scope context", () => {
  it("fails closed when tenant, project or environment is missing", () => {
    expect(() => mcpContextFromEnv({})).toThrow("QKERN_MCP_ORGANIZATION_ID");
    expect(() => mcpContextFromEnv({ QKERN_MCP_ORGANIZATION_ID: "org" })).toThrow("QKERN_MCP_PROJECT_ID");
    expect(() => mcpContextFromEnv({ QKERN_MCP_ORGANIZATION_ID: "org", QKERN_MCP_PROJECT_ID: "project", QKERN_MCP_ENVIRONMENT: "invalid" })).toThrow("QKERN_MCP_ENVIRONMENT");
  });

  it("returns only a validated scoped context", () => {
    expect(mcpContextFromEnv({ QKERN_MCP_ORGANIZATION_ID: "org", QKERN_MCP_PROJECT_ID: "project", QKERN_MCP_ENVIRONMENT: "staging" })).toEqual({
      organizationId: "org", projectId: "project", environment: "staging", actorRef: "local-mcp-agent",
    });
  });

  it("marks apply queueing as an idempotent destructive write for client approval policy", () => {
    const server = createQKERNMcpServer({
      organizationId: "org", projectId: "project", environment: "development", actorRef: "test-agent",
    });
    const tools = (server as unknown as { _registeredTools: Record<string, { annotations: Record<string, boolean> }> })._registeredTools;
    expect(tools.qkern_automation_policy_get?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tools.qkern_migration_apply_queue?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tools.qkern_table_rows_list?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tools.qkern_table_row_delete?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tools.qkern_storage_buckets_list?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tools.qkern_storage_objects_list?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tools.qkern_queues_list?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tools.qkern_queue_status?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tools.qkern_queue_message_enqueue?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(tools.qkern_queue_claim).toBeUndefined();
  });
});
