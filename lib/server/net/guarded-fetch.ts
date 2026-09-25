import { recognisedByName } from "@/lib/server/errors/identity";
import { lookup as dnsLookup } from "node:dns";
import { request as httpsRequest } from "node:https";
import { isPubliclyRoutable } from "@/lib/server/net/address-policy";

export type EgressRejectionReason =
  | "EGRESS_HOST_INVALID"
  | "EGRESS_HOST_UNRESOLVABLE"
  | "EGRESS_ADDRESS_NOT_PUBLIC";

/** Bewusst ohne `cause`: Die Adresse selbst gehört nicht in eine Fehlermeldung. */
export class EgressBlockedError extends Error {
  constructor(readonly reason: EgressRejectionReason) {
    super(reason);
    this.name = "EgressBlockedError";
  }
}
recognisedByName(EgressBlockedError, "EgressBlockedError");

export type ResolvedAddress = Readonly<{ address: string; family: 4 | 6 }>;

export interface AddressResolver {
  resolve(hostname: string): Promise<ReadonlyArray<ResolvedAddress>>;
}

/** Auflösung über das Betriebssystem, also derselbe Weg, den die Verbindung nähme. */
export const systemResolver: AddressResolver = {
  resolve(hostname) {
    return new Promise((resolve, reject) => {
      dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
        if (error || !addresses?.length) {
          reject(new EgressBlockedError("EGRESS_HOST_UNRESOLVABLE"));
          return;
        }
        resolve(addresses.map((entry) => ({
          address: entry.address,
          family: entry.family === 6 ? 6 : 4,
        })));
      });
    });
  },
};

export type GuardedFetchOptions = {
  resolver?: AddressResolver;
  maxResponseBytes?: number;
  timeoutMs?: number;
};

/**
 * Löst den Namen auf, prüft jede Adresse und verbindet dann genau zu der
 * geprüften.
 *
 * **Alle** aufgelösten Adressen müssen öffentlich sein, nicht nur eine. Ein
 * Name, der gleichzeitig auf eine öffentliche und eine interne Adresse zeigt,
 * ist kein Grenzfall, sondern das Muster eines Angriffs.
 *
 * Danach wird die Adresse festgehalten. Ohne dieses Festhalten bliebe zwischen
 * Prüfung und Verbindungsaufbau ein Fenster offen, in dem dieselbe Anfrage
 * erneut auflöst und diesmal woanders landet. Der Name wandert trotzdem als
 * SNI und als erwarteter Zertifikatsname mit: Eine feste Adresse darf nicht
 * dazu führen, dass die Identität des Gegenübers ungeprüft bleibt.
 */
export function createGuardedFetch(options: GuardedFetchOptions = {}): typeof fetch {
  const resolver = options.resolver ?? systemResolver;
  const maxResponseBytes = options.maxResponseBytes ?? 1_048_576;
  const timeoutMs = options.timeoutMs ?? 15_000;

  return (async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = input instanceof URL ? input : new URL(String(input));
    if (url.protocol !== "https:") throw new EgressBlockedError("EGRESS_HOST_INVALID");

    const pinned = await guardHostname(url.hostname, resolver);

    return await new Promise<Response>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let settled = false;

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        request.destroy();
        reject(error);
      };

      const request = httpsRequest(url, {
        method: (init.method ?? "GET").toUpperCase(),
        headers: toHeaderRecord(init.headers),
        // Die geprüfte Adresse, und nur sie. `servername` bleibt der Name,
        // damit SNI und Zertifikatsprüfung unverändert greifen.
        //
        // Die Antwortform hängt davon ab, wonach gefragt wurde. Node ruft diesen
        // Ersatz seit `autoSelectFamily` mit `all: true` auf und erwartet dann
        // eine **Liste**; eine einzelne Adresse endet in
        // `ERR_INVALID_IP_ADDRESS`. Genau das war der Zustand nach Release
        // 1.27: Das Festhalten der Adresse war gegen einen eingespeisten
        // `fetch` belegt und hat gegen einen echten Socket jede Verbindung
        // verhindert.
        lookup: (_hostname, options, callback) => {
          const entry = { address: pinned.address, family: pinned.family };
          (callback as unknown as (
            error: null, addresses: string | ResolvedAddress[], family?: number,
          ) => void)(null, options?.all ? [entry] : entry.address, entry.family);
        },
        servername: url.hostname,
        timeout: timeoutMs,
      }, (response) => {
        const status = response.statusCode ?? 0;
        if (init.redirect === "error" && status >= 300 && status < 400 && response.headers.location) {
          // Eine Umleitung führt zu einem Ziel, das weder auf der Allowlist
          // stand noch geprüft wurde. Sie zu folgen hiesse, beides zu umgehen.
          response.destroy();
          fail(new EgressBlockedError("EGRESS_HOST_INVALID"));
          return;
        }
        response.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > maxResponseBytes) {
            response.destroy();
            fail(new EgressBlockedError("EGRESS_HOST_INVALID"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (settled) return;
          settled = true;
          resolve(new Response(Buffer.concat(chunks, total).toString("utf8"), {
            status: status || 502,
            headers: toResponseHeaders(response.headers),
          }));
        });
        response.on("error", fail);
      });

      request.on("timeout", () => fail(new Error("EGRESS_TIMEOUT")));
      request.on("error", fail);

      if (init.signal) {
        if (init.signal.aborted) { fail(new Error("EGRESS_ABORTED")); return; }
        init.signal.addEventListener("abort", () => fail(new Error("EGRESS_ABORTED")), { once: true });
      }

      const body = init.body;
      if (typeof body === "string" && body.length > 0) request.write(body);
      request.end();
    });
  }) as typeof fetch;
}

/** Prüft einen Namen und gibt die Adresse zurück, zu der verbunden werden darf. */
export async function guardHostname(
  hostname: string,
  resolver: AddressResolver = systemResolver,
): Promise<ResolvedAddress> {
  if (!hostname || hostname.length > 253) throw new EgressBlockedError("EGRESS_HOST_INVALID");

  const addresses = await resolver.resolve(hostname);
  if (addresses.length === 0) throw new EgressBlockedError("EGRESS_HOST_UNRESOLVABLE");
  for (const entry of addresses) {
    if (!isPubliclyRoutable(entry.address)) {
      throw new EgressBlockedError("EGRESS_ADDRESS_NOT_PUBLIC");
    }
  }
  return addresses[0];
}

function toHeaderRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

function toResponseHeaders(raw: NodeJS.Dict<string | string[]>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    // `set-cookie` wird nicht weitergereicht. Eine fremde Sitzung hat in einer
    // Antwort an eine Function oder einen Zusteller nichts verloren.
    if (name.toLowerCase() === "set-cookie") continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}
