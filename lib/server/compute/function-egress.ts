import type { FunctionDefinition } from "@/lib/server/compute/model";

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const HEADER_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const FORBIDDEN_HEADERS = new Set([
  "host", "connection", "content-length", "transfer-encoding", "cookie", "proxy-authorization",
  "upgrade", "expect", "te", "trailer",
]);

export type EgressRequest = Readonly<{
  url: string;
  method?: string;
  headers?: Readonly<Record<string, string>>;
  body?: string;
}>;

export type EgressResponse = Readonly<{
  status: number;
  headers: Readonly<Record<string, string>>;
  body: string;
}>;

export type EgressRejection = Readonly<{
  error: "EGRESS_NOT_ALLOWED" | "EGRESS_INVALID" | "EGRESS_LIMIT" | "EGRESS_FAILED";
}>;

export type EgressOutcome = EgressResponse | EgressRejection;

export function isEgressRejection(outcome: EgressOutcome): outcome is EgressRejection {
  return "error" in outcome;
}

export type MediatedEgressOptions = {
  fetchFn?: typeof fetch;
  /** Höchstzahl Ausgangsverbindungen je Aufruf. */
  maxRequests?: number;
  maxResponseBytes?: number;
  maxRequestBytes?: number;
  timeoutMs?: number;
};

/**
 * Führt Ausgangsverbindungen einer Function **im Runtime-Prozess** aus.
 *
 * Der Container behält `--network none`. Das ist die stärkste Zusage, die es
 * gibt, und sie ist seit Release 1.22 zertifiziert — sie hier aufzugeben, nur
 * damit `fetch` im Container direkt funktioniert, wäre ein Rückschritt. Ein
 * Egress-Proxy in einem eigenen Netz bräuchte ein zusätzliches Image, ein
 * zusätzliches Netz und eine zusätzliche Vertrauensbeziehung, um am Ende
 * dieselbe Frage zu beantworten: Darf dieser Aufruf zu diesem Ziel?
 *
 * Die Antwort gibt hier Code, den QKERN ohnehin prüft. Der Preis ist ehrlich zu
 * nennen: Eine Function benutzt nicht direkt `fetch`, sondern den vermittelten
 * Kanal ihrer Laufzeit.
 *
 * Die Allowlist stammt aus der Definition und wird bei jedem einzelnen Aufruf
 * geprüft — nicht einmal beim Start. Eine Function, die zehn Anfragen stellt,
 * wird zehnmal geprüft.
 */
export class MediatedFunctionEgress {
  private readonly maxRequests: number;
  private readonly maxResponseBytes: number;
  private readonly maxRequestBytes: number;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: MediatedEgressOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.maxRequests = bounded(options.maxRequests ?? 10, 1, 100);
    this.maxResponseBytes = bounded(options.maxResponseBytes ?? 256 * 1024, 1024, 4 * 1024 * 1024);
    this.maxRequestBytes = bounded(options.maxRequestBytes ?? 64 * 1024, 256, 1024 * 1024);
    this.timeoutMs = bounded(options.timeoutMs ?? 10_000, 100, 60_000);
  }

  /** Ein Zähler je Aufruf; ohne ihn wäre die Anzahl der Verbindungen unbegrenzt. */
  budget(): { spend(): boolean } {
    let used = 0;
    const limit = this.maxRequests;
    return { spend: () => ++used <= limit };
  }

  async request(
    definition: FunctionDefinition,
    request: EgressRequest,
  ): Promise<EgressOutcome> {
    const allowed = new Set(definition.egressOrigins);
    if (allowed.size === 0) return { error: "EGRESS_NOT_ALLOWED" };

    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return { error: "EGRESS_INVALID" };
    }
    // Exakt die Origin aus der Definition. `https://api.example.com.evil.test`
    // ist eine andere Origin und faellt hier durch.
    if (!allowed.has(url.origin)) return { error: "EGRESS_NOT_ALLOWED" };
    if (url.protocol !== "https:" || url.username || url.password) {
      return { error: "EGRESS_NOT_ALLOWED" };
    }

    const method = (request.method ?? "GET").toUpperCase();
    if (!METHODS.has(method)) return { error: "EGRESS_INVALID" };
    if (request.body !== undefined &&
        (typeof request.body !== "string" ||
          Buffer.byteLength(request.body, "utf8") > this.maxRequestBytes)) {
      return { error: "EGRESS_INVALID" };
    }

    const headers = sanitizedHeaders(request.headers);
    if (!headers) return { error: "EGRESS_INVALID" };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(url, {
        method,
        headers,
        ...(request.body === undefined || method === "GET" || method === "HEAD"
          ? {} : { body: request.body }),
        // Eine Umleitung koennte an ein Ziel fuehren, das nicht auf der
        // Allowlist steht. Sie zu folgen hiesse, die Policy zu umgehen.
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
      return await bounded_response(response, this.maxResponseBytes);
    } catch {
      // Die Ursache kann Ziel, Header oder Netzwerkdetails tragen.
      return { error: "EGRESS_FAILED" };
    } finally {
      clearTimeout(timer);
    }
  }
}

function sanitizedHeaders(
  input: Readonly<Record<string, string>> | undefined,
): Record<string, string> | null {
  const headers: Record<string, string> = {};
  if (!input) return headers;
  const entries = Object.entries(input);
  if (entries.length > 20) return null;
  for (const [rawName, value] of entries) {
    const name = rawName.toLowerCase();
    // Hop-by-Hop- und Identitaetsheader gehoeren der Runtime, nicht der
    // Function. `cookie` faellt ebenfalls: Eine Function soll keine fremde
    // Sitzung mitschicken koennen.
    if (!HEADER_NAME.test(name) || FORBIDDEN_HEADERS.has(name)) return null;
    if (typeof value !== "string" || value.length > 1_024 || /[\r\n]/.test(value)) return null;
    headers[name] = value;
  }
  return headers;
}

async function bounded_response(response: Response, maximumBytes: number): Promise<EgressOutcome> {
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) {
    await response.body?.cancel().catch(() => undefined);
    return { error: "EGRESS_LIMIT" };
  }
  const headers: Record<string, string> = {};
  for (const name of ["content-type", "etag", "last-modified", "location"]) {
    const value = response.headers.get(name);
    if (value && value.length <= 1_024) headers[name] = value;
  }
  if (!response.body) return { status: response.status, headers, body: "" };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return { error: "EGRESS_LIMIT" };
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  return {
    status: response.status,
    headers,
    body: Buffer.concat(chunks, total).toString("utf8"),
  };
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError("A function egress setting is out of range.");
  }
  return value;
}
