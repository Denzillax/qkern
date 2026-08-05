import { createComputeRuntimeFromEnv } from "@/lib/server/compute/runtime-composition";
import { closePostgresPool } from "@/lib/server/db/pool";

const controller = new AbortController();
const requestStop = () => controller.abort();
process.once("SIGINT", requestStop);
process.once("SIGTERM", requestStop);

try {
  const runtime = createComputeRuntimeFromEnv(process.env);
  console.error(
    `QKERN compute runtime serving ${runtime.scopes.length} scope(s): cron dispatch and webhook delivery`,
  );
  await runtime.run(controller.signal);
} catch {
  // Konfiguration, Endpunkte, Geheimnisreferenzen und Datenbankmeldungen
  // bleiben aus dem Log dieses Prozesses.
  console.error("QKERN compute runtime failed its startup or runtime boundary.");
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", requestStop);
  process.removeListener("SIGTERM", requestStop);
  await closePostgresPool();
}
