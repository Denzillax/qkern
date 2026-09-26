/**
 * Grenzen der generierten Data API an einer Stelle.
 *
 * Der Server (`lib/server/data-plane/generated-api.ts`) prueft mit genau
 * diesen Werten, die Console (`components/console/data-api-settings-view.tsx`)
 * zeigt sie an. Keine Server-Importe, damit die Datei auch im Browser laeuft.
 *
 * `schema` ist das Standardschema: Die Routen setzen `public`, wenn die
 * Anfrage keines nennt, und die Console zeigt nur dieses.
 */
export const DATA_API_LIMITS = {
  schema: "public",
  rowsMin: 1,
  rowsMax: 100,
  maxFilters: 10,
  operators: ["eq", "neq", "gt", "gte", "lt", "lte", "in"] as const,
  keyClaims: { public: "anon", service: "service_role" } as const,
} as const;

export type DataApiFilterOperator = (typeof DATA_API_LIMITS.operators)[number];

/** Quelle des Musters fuer sensible Spaltennamen; der Server baut daraus `new RegExp(..., "i")`. */
export const SENSITIVE_COLUMN_PATTERN = "(?:password|secret|token|cookie|private.?key|authorization|api.?key)";

/** Die Woerter hinter dem Muster, lesbar fuer die Console. Ein Test prueft, dass jedes Wort trifft. */
export const SENSITIVE_COLUMN_WORDS = ["password", "secret", "token", "cookie", "private key", "authorization", "api key"] as const;
