export type QkernJson = null | boolean | number | string | QkernJson[] | { [key: string]: QkernJson };

export type QkernDatabase = Record<string, {
  Tables: Record<string, { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> }>;
}>;

type SchemaName<DB extends QkernDatabase> = Extract<keyof DB, string>;
type TableName<DB extends QkernDatabase, S extends SchemaName<DB>> = Extract<keyof DB[S]["Tables"], string>;
type Table<DB extends QkernDatabase, S extends SchemaName<DB>, T extends TableName<DB, S>> = DB[S]["Tables"][T];

export type QkernFilter = Readonly<{
  column: string;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in";
  value: QkernJson;
}>;

export class QkernError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(`QKERN request failed (${code}).`);
    this.name = "QkernError";
  }
}

export type QkernFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type QkernClientOptions = Readonly<{
  baseUrl: string;
  projectId: string;
  environment: "development" | "staging" | "production";
  projectKey?: string;
  accessToken?: string;
  timeoutMs?: number;
  fetch?: QkernFetch;
  credentials?: "omit" | "same-origin" | "include";
}>;

export class QkernClient<DB extends QkernDatabase = QkernDatabase> {
  private readonly transport: Transport;
  private readonly prefix: string;

  constructor(options: QkernClientOptions) {
    this.transport = new Transport(options);
    this.prefix = `/api/v1/projects/${segment(options.projectId)}/environments/${segment(options.environment)}`;
  }

  from<
    S extends SchemaName<DB> = Extract<"public", SchemaName<DB>>,
    T extends TableName<DB, S> = TableName<DB, S>,
  >(table: T, schema: S = "public" as S) {
    return new QkernTableClient<DB, S, T>(this.transport, this.prefix, String(schema), String(table));
  }

  schema() {
    return this.transport.request<unknown>(`${this.prefix}/schema`, { method: "GET" });
  }

  readonly queues = {
    list: () => this.transport.request<unknown[]>(`${this.prefix}/queues`, { method: "GET" }),
    status: (queue: string) => this.transport.request<unknown>(`${this.prefix}/queues/${segment(queue)}/status`, { method: "GET" }),
    enqueue: (queue: string, input: { payload: QkernJson; dedupeKey?: string; scheduledAt?: string }) =>
      this.transport.request<{ id: string; deduplicated: boolean; availableAt: string }>(
        `${this.prefix}/queues/${segment(queue)}/messages`, { method: "POST", body: input },
      ),
    deadLetters: (queue: string, limit = 50) => this.transport.request<unknown[]>(
      `${this.prefix}/queues/${segment(queue)}/dead-letters?limit=${bounded(limit, 1, 100)}`, { method: "GET" },
    ),
    replay: (queue: string, messageId: string) => this.transport.request<{
      id: string; replayedFromId: string; deduplicated: boolean;
    }>(`${this.prefix}/queues/${segment(queue)}/dead-letters/${segment(messageId)}/replay`, { method: "POST" }),
  };

  readonly auth = {
    signUp: (input: { email: string; password: string }) =>
      this.transport.request<unknown>(`${this.prefix}/auth/signup`, { method: "POST", body: input }),
    token: (input: { grantType: "password"; email: string; password: string } |
      { grantType: "refresh_token"; refreshToken: string }) =>
      this.transport.request<unknown>(`${this.prefix}/auth/token`, { method: "POST", body: input }),
    user: () => this.transport.request<unknown>(`${this.prefix}/auth/user`, { method: "GET" }),
    logout: (refreshToken?: string) => this.transport.request<unknown>(
      `${this.prefix}/auth/logout`, { method: "POST", body: refreshToken ? { refreshToken } : {} },
    ),
  };

  readonly storage = {
    buckets: () => this.transport.request<unknown[]>(`${this.prefix}/storage/buckets`, { method: "GET" }),
    objects: (bucketId: string, input: { limit?: number; cursor?: string } = {}) => {
      const query = new URLSearchParams();
      if (input.limit !== undefined) query.set("limit", String(bounded(input.limit, 1, 100)));
      if (input.cursor) query.set("cursor", input.cursor);
      const suffix = query.size ? `?${query}` : "";
      return this.transport.request<unknown[]>(
        `${this.prefix}/storage/buckets/${segment(bucketId)}/objects${suffix}`, { method: "GET" },
      );
    },
  };
}

export class QkernTableClient<
  DB extends QkernDatabase,
  S extends SchemaName<DB>,
  T extends TableName<DB, S>,
> {
  constructor(
    private readonly transport: Transport,
    private readonly prefix: string,
    private readonly schemaName: string,
    private readonly tableName: string,
  ) {}

  select(input: {
    columns?: Array<Extract<keyof Table<DB, S, T>["Row"], string>>;
    filters?: QkernFilter[];
    order?: { column: Extract<keyof Table<DB, S, T>["Row"], string>; direction: "asc" | "desc" };
    limit?: number;
    cursor?: string;
  } = {}) {
    const query = new URLSearchParams({ schema: this.schemaName });
    if (input.columns?.length) query.set("select", input.columns.join(","));
    for (const filter of input.filters ?? []) {
      query.append("filter", `${identifier(filter.column)}:${filter.operator}:${JSON.stringify(filter.value)}`);
    }
    if (input.order) query.set("order", `${identifier(String(input.order.column))}.${input.order.direction}`);
    if (input.limit !== undefined) query.set("limit", String(bounded(input.limit, 1, 100)));
    if (input.cursor) query.set("cursor", input.cursor);
    return this.transport.request<{
      rows: Array<Table<DB, S, T>["Row"]>;
      nextCursor: string | null;
    }>(`${this.path()}?${query}`, { method: "GET" });
  }

  /**
   * Zeilen einfuegen, und mit `onConflict` als Upsert (2.115).
   *
   * Derselbe Weg wie ohne: dieselbe Route, dasselbe Verb, derselbe Rumpf mit
   * einem Feld mehr. Der Konfliktschluessel wird hier **nicht** geprueft, und
   * das ist Absicht. Ob die genannten Spalten einen Primaerschluessel oder
   * eindeutigen Index bilden, weiss nur der Katalog der Projektdatenbank, und
   * der Server liest ihn aus `pg_index`. Eine zweite Pruefung im SDK koennte
   * nur die Gestalt der Namen wiederholen, und genau das tut sie: `identifier`
   * laesst durch, was ein Spaltenname sein darf, und alles Weitere beantwortet
   * die Antwort des Servers mit `GENERATED_DATA_API_CONFLICT_KEY_UNKNOWN`.
   */
  insert(rows: Array<Table<DB, S, T>["Insert"]>, options: {
    onConflict?: Array<Extract<keyof Table<DB, S, T>["Row"], string>>;
  } = {}) {
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100) throw new QkernError("SDK_INVALID_INPUT", 0);
    const onConflict = options.onConflict;
    if (onConflict !== undefined &&
        (!Array.isArray(onConflict) || onConflict.length < 1 || onConflict.length > 32)) {
      throw new QkernError("SDK_INVALID_INPUT", 0);
    }
    return this.transport.request<{ rows: Array<Table<DB, S, T>["Row"]> }>(this.path(), {
      method: "POST",
      body: {
        schema: this.schemaName,
        rows,
        ...(onConflict === undefined ? {} : { onConflict: onConflict.map((column) => identifier(String(column))) }),
      },
    });
  }

  update(match: Partial<Table<DB, S, T>["Row"]>, values: Table<DB, S, T>["Update"]) {
    return this.transport.request<{ rows: Array<Table<DB, S, T>["Row"]> }>(this.path(), {
      method: "PATCH", body: { schema: this.schemaName, match, values },
    });
  }

  delete(match: Partial<Table<DB, S, T>["Row"]>) {
    return this.transport.request<{ deleted: number }>(this.path(), {
      method: "DELETE", body: { schema: this.schemaName, match },
    });
  }

  private path() { return `${this.prefix}/tables/${segment(this.tableName)}/rows`; }
}

class Transport {
  private readonly origin: string;
  private readonly projectKey?: string;
  private readonly accessToken?: string;
  private readonly timeoutMs: number;
  private readonly fetcher: QkernFetch;
  private readonly credentials: "omit" | "same-origin" | "include";

  constructor(options: QkernClientOptions) {
    this.origin = exactOrigin(options.baseUrl);
    if (!/^[A-Za-z0-9._:-]{3,128}$/.test(options.projectId)) throw new QkernError("SDK_INVALID_INPUT", 0);
    this.projectKey = secret(options.projectKey);
    this.accessToken = secret(options.accessToken);
    this.timeoutMs = bounded(options.timeoutMs ?? 10_000, 100, 120_000);
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.credentials = options.credentials ?? "same-origin";
  }

  async request<T>(path: string, input: { method: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, this.timeoutMs);
    const headers: Record<string, string> = { accept: "application/json" };
    if (input.body !== undefined) headers["content-type"] = "application/json";
    if (this.projectKey) headers["x-qkern-key"] = this.projectKey;
    if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    let response: Response;
    try {
      response = await this.fetcher(`${this.origin}${path}`, {
        method: input.method,
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: controller.signal,
        redirect: "error",
        credentials: this.credentials,
      });
    } catch {
      throw new QkernError(controller.signal.aborted ? "SDK_TIMEOUT" : "SDK_NETWORK_ERROR", 0);
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
    }
    const text = await response.text();
    if (text.length > 2_000_000) throw new QkernError("SDK_RESPONSE_TOO_LARGE", response.status);
    let envelope: { data?: T; code?: unknown } = {};
    try { envelope = text ? JSON.parse(text) as { data?: T; code?: unknown } : {}; } catch {
      throw new QkernError("SDK_INVALID_RESPONSE", response.status);
    }
    if (!response.ok) {
      const code = typeof envelope.code === "string" && /^[A-Z0-9_]{3,64}$/.test(envelope.code)
        ? envelope.code : `HTTP_${response.status}`;
      throw new QkernError(code, response.status, safeRequestId(response.headers.get("x-request-id")));
    }
    return envelope.data as T;
  }
}

export function createQkernClient<DB extends QkernDatabase = QkernDatabase>(options: QkernClientOptions) {
  return new QkernClient<DB>(options);
}

function exactOrigin(value: string) {
  try {
    const url = new URL(value);
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !local) || url.origin !== value || url.username || url.password) throw new Error();
    return url.origin;
  } catch { throw new QkernError("SDK_INVALID_BASE_URL", 0); }
}

function segment(value: string) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new QkernError("SDK_INVALID_INPUT", 0);
  return encodeURIComponent(value);
}

function identifier(value: string) {
  // Seit 1.7.0-alpha.5 mit Grossbuchstaben, wie der Server seit 2.26 (`"Order"`, `"createdAt"`).
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) throw new QkernError("SDK_INVALID_INPUT", 0);
  return value;
}

function bounded(value: number, min: number, max: number) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new QkernError("SDK_INVALID_INPUT", 0);
  return value;
}

function secret(value?: string) {
  if (value === undefined) return undefined;
  if (!value || value.length > 4_096 || /[\r\n]/.test(value)) throw new QkernError("SDK_INVALID_INPUT", 0);
  return value;
}

function safeRequestId(value: string | null) {
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}
