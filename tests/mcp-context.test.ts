import { describe, expect, it } from "vitest";
import { createQKERNMcpServer, mcpContextFromEnv, type MCPContext } from "@/mcp/server";

const localContext: MCPContext = {
  organizationId: "org", projectId: "project", environment: "development", actorRef: "test-agent",
  access: { kind: "local_static_bearer" },
};

function registeredTools(server: ReturnType<typeof createQKERNMcpServer>) {
  return (server as unknown as {
    _registeredTools: Record<string, { annotations: Record<string, boolean> }>;
  })._registeredTools;
}

describe("MCP scope context", () => {
  it("fails closed when tenant, project or environment is missing", () => {
    expect(() => mcpContextFromEnv({})).toThrow("QKERN_MCP_ORGANIZATION_ID");
    expect(() => mcpContextFromEnv({ QKERN_MCP_ORGANIZATION_ID: "org" })).toThrow("QKERN_MCP_PROJECT_ID");
    expect(() => mcpContextFromEnv({ QKERN_MCP_ORGANIZATION_ID: "org", QKERN_MCP_PROJECT_ID: "project", QKERN_MCP_ENVIRONMENT: "invalid" })).toThrow("QKERN_MCP_ENVIRONMENT");
  });

  it("returns only a validated scoped context", () => {
    expect(mcpContextFromEnv({ QKERN_MCP_ORGANIZATION_ID: "org", QKERN_MCP_PROJECT_ID: "project", QKERN_MCP_ENVIRONMENT: "staging" })).toEqual({
      organizationId: "org", projectId: "project", environment: "staging", actorRef: "local-mcp-agent",
      // Der Mandant aus der Prozessumgebung gehoert zum statischen Bearer, und
      // die Betriebsart steht seit 2.91 im Kontext, damit kein Aufrufer sie
      // spaeter erraten muss.
      access: { kind: "local_static_bearer" },
    });
  });

  it("(2.91) hands an OAuth caller only the tools its scopes open", () => {
    const readOnly = registeredTools(createQKERNMcpServer({
      organizationId: "org", projectId: "project", environment: "development",
      actorRef: "project-auth-oauth:ai-bridge:nutzer",
      access: {
        kind: "project_oauth", clientName: "ai-bridge", userId: "nutzer",
        email: "nutzer@example.test", scopes: ["identity:read", "data:read"],
      },
    }));
    expect(readOnly.qkern_table_rows_list).toBeDefined();
    // Die Mutationen fehlen, und sie fehlen wirklich: Ein Werkzeug, das ein
    // Client sieht und nicht aufrufen darf, waere eine Einladung zum Probieren.
    expect(readOnly.qkern_table_rows_insert).toBeUndefined();
    expect(readOnly.qkern_table_row_update).toBeUndefined();
    expect(readOnly.qkern_table_row_delete).toBeUndefined();

    const writeOnly = registeredTools(createQKERNMcpServer({
      organizationId: "org", projectId: "project", environment: "development",
      actorRef: "project-auth-oauth:ai-bridge:nutzer",
      access: {
        kind: "project_oauth", clientName: "ai-bridge", userId: "nutzer",
        email: "nutzer@example.test", scopes: ["data:write"],
      },
    }));
    // Schreiben schliesst Lesen nicht ein, genau wie an der Data API: Wer
    // beides will, laesst beidem zustimmen.
    expect(writeOnly.qkern_table_rows_list).toBeUndefined();
    expect(writeOnly.qkern_table_rows_insert).toBeDefined();
    // Und der Weg ueber Migrationen bleibt zu, mit jedem Bereich, den es gibt.
    expect(writeOnly.qkern_migration_apply_queue).toBeUndefined();
    expect(writeOnly.qkern_migration_preview).toBeUndefined();
  });

  it("marks apply queueing as an idempotent destructive write for client approval policy", () => {
    const tools = registeredTools(createQKERNMcpServer(localContext));
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
