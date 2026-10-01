export class QkernError extends Error {
    code;
    status;
    requestId;
    constructor(code, status, requestId) {
        super(`QKERN request failed (${code}).`);
        this.code = code;
        this.status = status;
        this.requestId = requestId;
        this.name = "QkernError";
    }
}
export class QkernClient {
    transport;
    prefix;
    constructor(options) {
        this.transport = new Transport(options);
        this.prefix = `/api/v1/projects/${segment(options.projectId)}/environments/${segment(options.environment)}`;
    }
    from(table, schema = "public") {
        return new QkernTableClient(this.transport, this.prefix, String(schema), String(table));
    }
    schema() {
        return this.transport.request(`${this.prefix}/schema`, { method: "GET" });
    }
    queues = {
        list: () => this.transport.request(`${this.prefix}/queues`, { method: "GET" }),
        status: (queue) => this.transport.request(`${this.prefix}/queues/${segment(queue)}/status`, { method: "GET" }),
        enqueue: (queue, input) => this.transport.request(`${this.prefix}/queues/${segment(queue)}/messages`, { method: "POST", body: input }),
        deadLetters: (queue, limit = 50) => this.transport.request(`${this.prefix}/queues/${segment(queue)}/dead-letters?limit=${bounded(limit, 1, 100)}`, { method: "GET" }),
        replay: (queue, messageId) => this.transport.request(`${this.prefix}/queues/${segment(queue)}/dead-letters/${segment(messageId)}/replay`, { method: "POST" }),
    };
    auth = {
        signUp: (input) => this.transport.request(`${this.prefix}/auth/signup`, { method: "POST", body: input }),
        token: (input) => this.transport.request(`${this.prefix}/auth/token`, { method: "POST", body: input }),
        user: () => this.transport.request(`${this.prefix}/auth/user`, { method: "GET" }),
        logout: (refreshToken) => this.transport.request(`${this.prefix}/auth/logout`, { method: "POST", body: refreshToken ? { refreshToken } : {} }),
    };
    storage = {
        buckets: () => this.transport.request(`${this.prefix}/storage/buckets`, { method: "GET" }),
        objects: (bucketId, input = {}) => {
            const query = new URLSearchParams();
            if (input.limit !== undefined)
                query.set("limit", String(bounded(input.limit, 1, 100)));
            if (input.cursor)
                query.set("cursor", input.cursor);
            const suffix = query.size ? `?${query}` : "";
            return this.transport.request(`${this.prefix}/storage/buckets/${segment(bucketId)}/objects${suffix}`, { method: "GET" });
        },
    };
}
export class QkernTableClient {
    transport;
    prefix;
    schemaName;
    tableName;
    constructor(transport, prefix, schemaName, tableName) {
        this.transport = transport;
        this.prefix = prefix;
        this.schemaName = schemaName;
        this.tableName = tableName;
    }
    select(input = {}) {
        const query = new URLSearchParams({ schema: this.schemaName });
        if (input.columns?.length)
            query.set("select", input.columns.join(","));
        for (const filter of input.filters ?? []) {
            query.append("filter", `${identifier(filter.column)}:${filter.operator}:${JSON.stringify(filter.value)}`);
        }
        if (input.order)
            query.set("order", `${identifier(String(input.order.column))}.${input.order.direction}`);
        if (input.limit !== undefined)
            query.set("limit", String(bounded(input.limit, 1, 100)));
        if (input.cursor)
            query.set("cursor", input.cursor);
        return this.transport.request(`${this.path()}?${query}`, { method: "GET" });
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
    insert(rows, options = {}) {
        if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100)
            throw new QkernError("SDK_INVALID_INPUT", 0);
        const onConflict = options.onConflict;
        if (onConflict !== undefined &&
            (!Array.isArray(onConflict) || onConflict.length < 1 || onConflict.length > 32)) {
            throw new QkernError("SDK_INVALID_INPUT", 0);
        }
        return this.transport.request(this.path(), {
            method: "POST",
            body: {
                schema: this.schemaName,
                rows,
                ...(onConflict === undefined ? {} : { onConflict: onConflict.map((column) => identifier(String(column))) }),
            },
        });
    }
    update(match, values) {
        return this.transport.request(this.path(), {
            method: "PATCH", body: { schema: this.schemaName, match, values },
        });
    }
    delete(match) {
        return this.transport.request(this.path(), {
            method: "DELETE", body: { schema: this.schemaName, match },
        });
    }
    path() { return `${this.prefix}/tables/${segment(this.tableName)}/rows`; }
}
class Transport {
    origin;
    projectKey;
    accessToken;
    timeoutMs;
    fetcher;
    credentials;
    constructor(options) {
        this.origin = exactOrigin(options.baseUrl);
        if (!/^[A-Za-z0-9._:-]{3,128}$/.test(options.projectId))
            throw new QkernError("SDK_INVALID_INPUT", 0);
        this.projectKey = secret(options.projectKey);
        this.accessToken = secret(options.accessToken);
        this.timeoutMs = bounded(options.timeoutMs ?? 10_000, 100, 120_000);
        this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
        this.credentials = options.credentials ?? "same-origin";
    }
    async request(path, input) {
        const controller = new AbortController();
        const abort = () => controller.abort();
        input.signal?.addEventListener("abort", abort, { once: true });
        const timeout = setTimeout(abort, this.timeoutMs);
        const headers = { accept: "application/json" };
        if (input.body !== undefined)
            headers["content-type"] = "application/json";
        if (this.projectKey)
            headers["x-qkern-key"] = this.projectKey;
        if (this.accessToken)
            headers.authorization = `Bearer ${this.accessToken}`;
        let response;
        try {
            response = await this.fetcher(`${this.origin}${path}`, {
                method: input.method,
                headers,
                body: input.body === undefined ? undefined : JSON.stringify(input.body),
                signal: controller.signal,
                redirect: "error",
                credentials: this.credentials,
            });
        }
        catch {
            throw new QkernError(controller.signal.aborted ? "SDK_TIMEOUT" : "SDK_NETWORK_ERROR", 0);
        }
        finally {
            clearTimeout(timeout);
            input.signal?.removeEventListener("abort", abort);
        }
        const text = await response.text();
        if (text.length > 2_000_000)
            throw new QkernError("SDK_RESPONSE_TOO_LARGE", response.status);
        let envelope = {};
        try {
            envelope = text ? JSON.parse(text) : {};
        }
        catch {
            throw new QkernError("SDK_INVALID_RESPONSE", response.status);
        }
        if (!response.ok) {
            const code = typeof envelope.code === "string" && /^[A-Z0-9_]{3,64}$/.test(envelope.code)
                ? envelope.code : `HTTP_${response.status}`;
            throw new QkernError(code, response.status, safeRequestId(response.headers.get("x-request-id")));
        }
        return envelope.data;
    }
}
export function createQkernClient(options) {
    return new QkernClient(options);
}
function exactOrigin(value) {
    try {
        const url = new URL(value);
        const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
        if ((url.protocol !== "https:" && !local) || url.origin !== value || url.username || url.password)
            throw new Error();
        return url.origin;
    }
    catch {
        throw new QkernError("SDK_INVALID_BASE_URL", 0);
    }
}
function segment(value) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value))
        throw new QkernError("SDK_INVALID_INPUT", 0);
    return encodeURIComponent(value);
}
function identifier(value) {
    // Seit 1.7.0-alpha.5 mit Grossbuchstaben, wie der Server seit 2.26 (`"Order"`, `"createdAt"`).
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value))
        throw new QkernError("SDK_INVALID_INPUT", 0);
    return value;
}
function bounded(value, min, max) {
    if (!Number.isSafeInteger(value) || value < min || value > max)
        throw new QkernError("SDK_INVALID_INPUT", 0);
    return value;
}
function secret(value) {
    if (value === undefined)
        return undefined;
    if (!value || value.length > 4_096 || /[\r\n]/.test(value))
        throw new QkernError("SDK_INVALID_INPUT", 0);
    return value;
}
function safeRequestId(value) {
    return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}
//# sourceMappingURL=index.js.map