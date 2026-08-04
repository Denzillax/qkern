export type QkernJson = null | boolean | number | string | QkernJson[] | {
    [key: string]: QkernJson;
};
export type QkernDatabase = Record<string, {
    Tables: Record<string, {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
    }>;
}>;
type SchemaName<DB extends QkernDatabase> = Extract<keyof DB, string>;
type TableName<DB extends QkernDatabase, S extends SchemaName<DB>> = Extract<keyof DB[S]["Tables"], string>;
type Table<DB extends QkernDatabase, S extends SchemaName<DB>, T extends TableName<DB, S>> = DB[S]["Tables"][T];
export type QkernFilter = Readonly<{
    column: string;
    operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in";
    value: QkernJson;
}>;
export declare class QkernError extends Error {
    readonly code: string;
    readonly status: number;
    readonly requestId?: string | undefined;
    constructor(code: string, status: number, requestId?: string | undefined);
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
export declare class QkernClient<DB extends QkernDatabase = QkernDatabase> {
    private readonly transport;
    private readonly prefix;
    constructor(options: QkernClientOptions);
    from<S extends SchemaName<DB> = Extract<"public", SchemaName<DB>>, T extends TableName<DB, S> = TableName<DB, S>>(table: T, schema?: S): QkernTableClient<DB, S, T>;
    schema(): Promise<unknown>;
    readonly queues: {
        list: () => Promise<unknown[]>;
        status: (queue: string) => Promise<unknown>;
        enqueue: (queue: string, input: {
            payload: QkernJson;
            dedupeKey?: string;
            scheduledAt?: string;
        }) => Promise<{
            id: string;
            deduplicated: boolean;
            availableAt: string;
        }>;
        deadLetters: (queue: string, limit?: number) => Promise<unknown[]>;
        replay: (queue: string, messageId: string) => Promise<{
            id: string;
            replayedFromId: string;
            deduplicated: boolean;
        }>;
    };
    readonly auth: {
        signUp: (input: {
            email: string;
            password: string;
        }) => Promise<unknown>;
        token: (input: {
            grantType: "password";
            email: string;
            password: string;
        } | {
            grantType: "refresh_token";
            refreshToken: string;
        }) => Promise<unknown>;
        user: () => Promise<unknown>;
        logout: (refreshToken?: string) => Promise<unknown>;
    };
    readonly storage: {
        buckets: () => Promise<unknown[]>;
        objects: (bucketId: string, input?: {
            limit?: number;
            cursor?: string;
        }) => Promise<unknown[]>;
    };
}
export declare class QkernTableClient<DB extends QkernDatabase, S extends SchemaName<DB>, T extends TableName<DB, S>> {
    private readonly transport;
    private readonly prefix;
    private readonly schemaName;
    private readonly tableName;
    constructor(transport: Transport, prefix: string, schemaName: string, tableName: string);
    select(input?: {
        columns?: Array<Extract<keyof Table<DB, S, T>["Row"], string>>;
        filters?: QkernFilter[];
        order?: {
            column: Extract<keyof Table<DB, S, T>["Row"], string>;
            direction: "asc" | "desc";
        };
        limit?: number;
        cursor?: string;
    }): Promise<{
        rows: Array<Table<DB, S, T>["Row"]>;
        nextCursor: string | null;
    }>;
    insert(rows: Array<Table<DB, S, T>["Insert"]>): Promise<{
        rows: Array<Table<DB, S, T>["Row"]>;
    }>;
    update(match: Partial<Table<DB, S, T>["Row"]>, values: Table<DB, S, T>["Update"]): Promise<{
        rows: Array<Table<DB, S, T>["Row"]>;
    }>;
    delete(match: Partial<Table<DB, S, T>["Row"]>): Promise<{
        deleted: number;
    }>;
    private path;
}
declare class Transport {
    private readonly origin;
    private readonly projectKey?;
    private readonly accessToken?;
    private readonly timeoutMs;
    private readonly fetcher;
    private readonly credentials;
    constructor(options: QkernClientOptions);
    request<T>(path: string, input: {
        method: string;
        body?: unknown;
        signal?: AbortSignal;
    }): Promise<T>;
}
export declare function createQkernClient<DB extends QkernDatabase = QkernDatabase>(options: QkernClientOptions): QkernClient<DB>;
export {};
//# sourceMappingURL=index.d.ts.map