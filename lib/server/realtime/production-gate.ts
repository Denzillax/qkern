import { ConfigurationError } from "@/lib/server/db/errors";

/**
 * Das Production-Tor des Realtime-Transports — Sprosse 5 der Paritätsleiter.
 *
 * Seit Alpha 1 stand hier ein bedingungsloses Verbot: „Production requires the
 * documented TLS, persistent event-log and fan-out gates." Zwei dieser drei
 * Bedingungen sind seither gebaut und zertifiziert — der dauerhafte Log seit
 * `1.11`, der instanzübergreifende Fan-out seit `1.16`. Ein Verbot, dessen
 * Gründe erfüllt sind, ist keine Sicherheit mehr, sondern eine Erinnerung.
 *
 * An seine Stelle tritt ein Tor, das jede Bedingung **einzeln prüft und
 * einzeln benennt**. Production startet genau dann, wenn:
 *
 * - der dauerhafte Log aktiv ist (der Memory-Log verliert bei jedem Neustart
 *   alles und erreicht keine zweite Instanz),
 * - ein stabiles Cursor-Geheimnis gesetzt ist (sonst überlebt kein
 *   Replay-Cursor einen Neustart, und keine zweite Instanz kann ihn prüfen),
 * - Aufbewahrung konfiguriert ist (sonst wächst der dauerhafte Log
 *   unbeobachtet),
 * - die Origin-Allowlist ausdrücklich ist und nur `https`-Origins trägt,
 * - und — nur bei öffentlichem Binding — der Betreiber attestiert, dass TLS
 *   vor dem Prozess terminiert. Der Transport selbst spricht `ws` ohne TLS;
 *   das kann der Prozess nicht selbst verifizieren, und die Attestierung ist
 *   deshalb genau das: eine Attestierung, kein Beweis. Sie steht hier, damit
 *   niemand sie versehentlich gibt.
 *
 * Ein Binding jenseits von Loopback verlangt in **jeder** Umgebung ein
 * ausdrückliches `QKERN_REALTIME_PUBLIC_BIND=true`.
 */
export type RealtimeBindPlan = Readonly<{
  host: string;
  production: boolean;
}>;

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export function realtimeBindPlan(
  env: Readonly<Record<string, string | undefined>>,
  allowedOrigins: readonly string[],
): RealtimeBindPlan {
  const production = env.NODE_ENV === "production";
  const host = env.QKERN_REALTIME_BIND_HOST?.trim() || "127.0.0.1";
  if (!/^[a-z0-9.:\-]{1,253}$/i.test(host)) {
    throw new ConfigurationError("QKERN_REALTIME_BIND_HOST must be a plain host or address.");
  }
  const loopback = LOOPBACK.has(host.toLowerCase());
  if (!loopback && env.QKERN_REALTIME_PUBLIC_BIND !== "true") {
    throw new ConfigurationError(
      "QKERN_REALTIME_BIND_HOST is not a loopback address. Set QKERN_REALTIME_PUBLIC_BIND=true explicitly.");
  }
  if (!production) return { host, production };

  if (env.QKERN_REALTIME_EPHEMERAL_LOG === "true") {
    throw new ConfigurationError(
      "Production Realtime requires the durable event log; QKERN_REALTIME_EPHEMERAL_LOG must not be true.");
  }
  const cursorSecret = env.QKERN_REALTIME_CURSOR_SECRET?.trim() ?? "";
  if (Buffer.from(cursorSecret, "base64url").byteLength < 32) {
    throw new ConfigurationError(
      "Production Realtime requires QKERN_REALTIME_CURSOR_SECRET with at least 32 bytes " +
      "so replay cursors survive restarts and reach every instance.");
  }
  if (!hasRetentionScopes(env.QKERN_REALTIME_RETENTION_SCOPES_JSON)) {
    throw new ConfigurationError(
      "Production Realtime requires QKERN_REALTIME_RETENTION_SCOPES_JSON " +
      "so the durable log does not grow unwatched.");
  }
  if (allowedOrigins.length === 0 ||
      allowedOrigins.some((origin) => !origin.startsWith("https://"))) {
    throw new ConfigurationError(
      "Production Realtime requires an explicit https-only origin allowlist.");
  }
  if (!loopback && env.QKERN_REALTIME_TLS_TERMINATED !== "proxy") {
    throw new ConfigurationError(
      "Production Realtime behind a public bind requires QKERN_REALTIME_TLS_TERMINATED=proxy — " +
      "the transport itself speaks ws without TLS.");
  }
  return { host, production };
}

/** Eine lesbare, nicht leere Scope-Liste — die eigentliche Prüfung der
 * Eintraege bleibt beim Parser des Prozesses. */
function hasRetentionScopes(raw: string | undefined): boolean {
  if (!raw?.trim()) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}
