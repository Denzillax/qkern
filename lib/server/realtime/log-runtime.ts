import { ConfigurationError } from "@/lib/server/db/errors";
import { getPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { PostgresRealtimeLogReader } from "@/lib/server/realtime/log-reader";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";

/**
 * Der Leser der Realtime-Logseite (2.86).
 *
 * Es gibt bewusst keinen Memory-Port. Die Seite beantwortet die Frage, was
 * wirklich festgehalten wird; ein Nachbau im Speicher koennte sie nicht
 * beantworten, sondern nur bestaetigen, was der Nachbau enthaelt.
 */
export function createRealtimeLogReaderFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PostgresRealtimeLogReader {
  if (runtimeModeFromEnv(env) !== "postgres") {
    throw new ConfigurationError("The realtime log requires the PostgreSQL runtime mode.");
  }
  return new PostgresRealtimeLogReader(new PostgresControlPlane(getPostgresPool(env)));
}

type GlobalRealtimeLog = typeof globalThis & {
  __qkernRealtimeLogReader?: PostgresRealtimeLogReader;
};

export function getRealtimeLogReader(): PostgresRealtimeLogReader {
  const remembered = globalThis as GlobalRealtimeLog;
  const reader = remembered.__qkernRealtimeLogReader ?? createRealtimeLogReaderFromEnv();
  if (process.env.NODE_ENV !== "production") remembered.__qkernRealtimeLogReader = reader;
  return reader;
}
