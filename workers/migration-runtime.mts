import { closePostgresPool } from "@/lib/server/db/pool";
import {
  createProjectDatabaseCatalogFromEnv,
  type ProjectDatabaseCatalogRuntime,
} from "@/lib/server/migrations/connection-catalog-runtime";
import { createMigrationWorkerRuntimeFromEnv } from "@/lib/server/migrations/runtime-composition";
import { createLoopbackRuntimeProbeFromEnv } from "@/lib/server/operations/runtime-probe";

const controller = new AbortController();
const requestStop = () => controller.abort();
process.once("SIGINT", requestStop);
process.once("SIGTERM", requestStop);

let catalog: ProjectDatabaseCatalogRuntime | undefined;
const probe = createLoopbackRuntimeProbeFromEnv(process.env);
try {
  // Dieselbe Fabrik, die auch der Realtime-Prozess ruft. Der Migrations-Prozess
  // ist der einzige, der seine Bindungen auch aus der Control Plane lesen darf:
  // Die Tabelle gehoert der Worker-Rolle, und genau die hat er.
  catalog = await createProjectDatabaseCatalogFromEnv(process.env, {
    allowControlPlaneBindings: true,
  });
  const runtime = createMigrationWorkerRuntimeFromEnv(process.env, {
    catalog,
    // Der Runtime-Logger meldet Runden, der Worker-Logger einzelne Auftraege.
    // Bis Release 1.51 setzte dieser Prozess nur den ersten und verwarf damit
    // jedes auftragsbezogene Ereignis — auch die Namen der verletzten
    // Grenzbedingungen. Beide Ereignisse sind redigiert: Ids und feste Codes,
    // keine Meldungen der Datenbank.
    workerLogger: { log: (event) => console.info(JSON.stringify(event)) },
    runtimeLogger: { log: (event) => console.info(JSON.stringify(event)) },
    probe: probe?.observer,
  });
  await probe?.start();
  await runtime.run({ signal: controller.signal });
} catch {
  console.error("QKERN migration runtime failed its secure startup or runtime boundary.");
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", requestStop);
  process.removeListener("SIGTERM", requestStop);
  await Promise.allSettled([probe?.stop(), catalog?.close(), closePostgresPool()]);
}
