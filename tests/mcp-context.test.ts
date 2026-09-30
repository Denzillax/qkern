import { describe, expect, it } from "vitest";
import { createQKERNMcpServer, mcpContextFromEnv, type MCPContext } from "@/mcp/server";
import {
  PROJECT_AUTH_OAUTH_SCOPES,
  type ProjectAuthOAuthScope,
} from "@/lib/server/project-auth/oauth";
import { AUTH_OAUTH_SCOPE_TEXTS } from "@/lib/console/auth-oauth-server-texts";
import { MCP_TOOL_SCOPES } from "@/mcp/tool-scopes";

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

  it("(2.103) opens exactly the tools a new scope names and nothing beside them", () => {
    const withScopes = (...scopes: ProjectAuthOAuthScope[]) => registeredTools(createQKERNMcpServer({
      organizationId: "org", projectId: "project", environment: "development",
      actorRef: "project-auth-oauth:ai-bridge:nutzer",
      access: {
        kind: "project_oauth", clientName: "ai-bridge", userId: "nutzer",
        email: "nutzer@example.test", scopes,
      },
    }));
    const names = (tools: Record<string, unknown>) => Object.keys(tools).sort();

    // Vollstaendig und nicht "enthaelt": Die Aussage eines Bereichs ist, was er
    // **nicht** oeffnet.
    expect(names(withScopes("storage:read")))
      .toEqual(["qkern_storage_buckets_list", "qkern_storage_objects_list"]);
    expect(names(withScopes("queues:read")))
      .toEqual(["qkern_queue_status", "qkern_queues_list"]);
    // Einstellen schliesst Lesen nicht ein, genau wie bei der Data API. Und es
    // oeffnet keine Worker-Operation; die gibt es hier gar nicht.
    expect(names(withScopes("queues:write"))).toEqual(["qkern_queue_message_enqueue"]);
    expect(names(withScopes("project:read")))
      .toEqual(["qkern_automation_policy_get", "qkern_project_get"]);
    // Das Audit-Log ist ein eigener Satz und haengt nicht an project:read.
    expect(names(withScopes("logs:read"))).toEqual(["qkern_logs_search"]);
    expect(names(withScopes("project:read"))).not.toContain("qkern_logs_search");
    // Vorschlagen ist nicht Anwenden.
    expect(names(withScopes("migrations:propose"))).toEqual(["qkern_migration_preview"]);

    // Und die zwei, die an der Zeilensicherheit vorbeilesen, bleiben mit jedem
    // Bereich zusammen unerreichbar.
    const alles = withScopes(...PROJECT_AUTH_OAUTH_SCOPES);
    expect(alles.qkern_query_readonly).toBeUndefined();
    expect(alles.qkern_schema_list).toBeUndefined();
    expect(alles.qkern_migration_apply_queue).toBeUndefined();
    // Lokal gibt es sie, und das ist der Unterschied, den dieser Schnitt haelt.
    const lokal = registeredTools(createQKERNMcpServer(localContext));
    expect(lokal.qkern_query_readonly).toBeDefined();
    expect(lokal.qkern_schema_list).toBeDefined();
    expect(lokal.qkern_migration_apply_queue).toBeDefined();
  });

  it("(2.103) gives every scope a sentence the console can show and every entry a scope that exists", () => {
    // Ein Bereich, den die Console nicht erklaeren kann, erscheint auf der Seite
    // als nackte Kennung. Der Nutzer liest dann `queues:write` und soll daraus
    // selbst schliessen, was er erlaubt. Darum haengt hier die Bereichsliste an
    // der Texttabelle und nicht bloss an sich selbst.
    expect(Object.keys(AUTH_OAUTH_SCOPE_TEXTS).sort())
      .toEqual([...PROJECT_AUTH_OAUTH_SCOPES].sort());

    // Und umgekehrt: Kein Eintrag der Werkzeugtabelle nennt einen Bereich, den
    // es nicht gibt. Der Typ verhindert das schon; diese Zeile faengt den Fall,
    // in dem jemand den Typ weitet, statt die Liste zu pflegen.
    for (const needed of Object.values(MCP_TOOL_SCOPES)) {
      if (needed === null) continue;
      expect(PROJECT_AUTH_OAUTH_SCOPES).toContain(needed);
    }
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
