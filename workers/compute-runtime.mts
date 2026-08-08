import { createComputeRuntimeFromEnv } from "@/lib/server/compute/runtime-composition";
import { closePostgresPool } from "@/lib/server/db/pool";
import { createLoopbackRuntimeProbeFromEnv } from "@/lib/server/operations/runtime-probe";

const controller = new AbortController();
const requestStop = () => controller.abort();
process.once("SIGINT", requestStop);
process.once("SIGTERM", requestStop);

// Die Probe gab es seit Alpha 1, und kein Prozess hat sie je gestartet: Vier
// Kompositionen reichten einen `probe` durch, den niemand erzeugte. Der
// Erreichbarkeitsvertrag aus 1.42 hat das nicht gesehen — das Modul war
// importiert, nur die Fabrik rief niemand.
const probe = createLoopbackRuntimeProbeFromEnv(process.env);

try {
  const runtime = createComputeRuntimeFromEnv(process.env, { probe: probe?.observer });
  const bound = await probe?.start();
  console.error(
    `QKERN compute runtime serving ${runtime.scopes.length} scope(s): cron dispatch and webhook delivery`
    + (bound ? ` (probe on http://${bound.host}:${bound.port}/ready)` : ""),
  );
  runtime.scopes.length > 0 && probe?.observer.runtimeStarted();
  await runtime.run(controller.signal);
} catch {
  // Konfiguration, Endpunkte, Geheimnisreferenzen und Datenbankmeldungen
  // bleiben aus dem Log dieses Prozesses.
  console.error("QKERN compute runtime failed its startup or runtime boundary.");
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", requestStop);
  process.removeListener("SIGTERM", requestStop);
  await probe?.stop();
  await closePostgresPool();
}
