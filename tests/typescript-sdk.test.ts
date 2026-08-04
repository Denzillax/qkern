import { describe, expect, it, vi } from "vitest";
import { createQkernClient, QkernError, type QkernFetch } from "@/sdk/typescript/src/index";

type Database = {
  public: { Tables: {
    orders: {
      Row: { id: string; status: string; total: number };
      Insert: { status: string; total: number };
      Update: { status?: string };
    };
  } };
};

function response(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("QKERN TypeScript SDK", () => {
  it("builds typed parameterized table-list requests and keeps credentials in headers", async () => {
    const fetcher = vi.fn<QkernFetch>(async () => response({ data: { rows: [{ id: "1", status: "paid", total: 42 }], nextCursor: null } }));
    const client = createQkernClient<Database>({
      baseUrl: "https://api.example.com", projectId: "project-1", environment: "development",
      projectKey: "qk_public_secret", accessToken: "app-jwt", fetch: fetcher,
    });
    const result = await client.from("orders").select({
      columns: ["id", "status"], filters: [{ column: "status", operator: "eq", value: "paid" }],
      order: { column: "id", direction: "asc" }, limit: 20,
    });
    expect(result.rows[0].total).toBe(42);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain("filter=status%3Aeq%3A%22paid%22");
    expect(String(url)).not.toContain("qk_public_secret");
    expect(init?.headers).toMatchObject({ "x-qkern-key": "qk_public_secret", authorization: "Bearer app-jwt" });
    expect(init?.redirect).toBe("error");
  });

  it("uses exact mutation bodies without automatic write retries", async () => {
    const fetcher = vi.fn<QkernFetch>(async () => response({ data: { rows: [{ id: "1", status: "paid", total: 42 }] } }, 201));
    const client = createQkernClient<Database>({
      baseUrl: "http://localhost:3000", projectId: "project-1", environment: "development", fetch: fetcher,
    });
    await client.from("orders").insert([{ status: "paid", total: 42 }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      schema: "public", rows: [{ status: "paid", total: 42 }],
    });
  });

  it("sends stable queue dedupe keys and never places them in URLs", async () => {
    const fetcher = vi.fn<QkernFetch>(async () => response({ data: { id: "message", deduplicated: false, availableAt: "now" } }, 202));
    const client = createQkernClient({
      baseUrl: "https://api.example.com", projectId: "project-1", environment: "production", fetch: fetcher,
    });
    await client.queues.enqueue("jobs", { payload: { task: "sync" }, dedupeKey: "private-dedupe" });
    expect(String(fetcher.mock.calls[0][0])).not.toContain("private-dedupe");
    expect(String(fetcher.mock.calls[0][1]?.body)).toContain("private-dedupe");
  });

  it("rejects non-origin base URLs, URL credentials and invalid path segments", () => {
    expect(() => createQkernClient({ baseUrl: "http://api.example.com", projectId: "project-1", environment: "production" }))
      .toThrow(QkernError);
    expect(() => createQkernClient({ baseUrl: "https://user:pass@example.com", projectId: "project-1", environment: "production" }))
      .toThrow("SDK_INVALID_BASE_URL");
    const client = createQkernClient({ baseUrl: "https://api.example.com", projectId: "project-1", environment: "production" });
    expect(() => client.queues.status("../admin")).toThrow("SDK_INVALID_INPUT");
  });

  it("maps bounded public error codes without reflecting server error text or secrets", async () => {
    const fetcher = vi.fn<QkernFetch>(async () => response({
      code: "QUEUE_CAPACITY_EXCEEDED", error: "secret qk_public_leak",
    }, 429, { "x-request-id": "request-1" }));
    const client = createQkernClient({
      baseUrl: "https://api.example.com", projectId: "project-1", environment: "production", fetch: fetcher,
    });
    await expect(client.queues.status("jobs")).rejects.toMatchObject({
      code: "QUEUE_CAPACITY_EXCEEDED", status: 429, requestId: "request-1",
    });
    await client.queues.status("jobs").catch((error: QkernError) => {
      expect(error.message).not.toMatch(/secret|qk_public_leak/i);
    });
  });

  it("bounds unresponsive fetch calls and does not expose credential values", async () => {
    const fetcher = vi.fn<QkernFetch>(async (_url, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const client = createQkernClient({
      baseUrl: "https://api.example.com", projectId: "project-1", environment: "production",
      projectKey: "qk_service_private", timeoutMs: 100, fetch: fetcher,
    });
    await expect(client.schema()).rejects.toMatchObject({ code: "SDK_TIMEOUT", status: 0 });
  });
});
