import { closePostgresPool } from "@/lib/server/db/pool";
import { createMigrationApplyBrokerPublisherFromEnv } from "@/lib/server/migrations/runtime-composition";
import { createLoopbackRuntimeProbeFromEnv } from "@/lib/server/operations/runtime-probe";

const controller = new AbortController();
const requestStop = () => controller.abort();
process.once("SIGINT", requestStop);
process.once("SIGTERM", requestStop);

const probe = createLoopbackRuntimeProbeFromEnv(process.env);
try {
  const publisher = createMigrationApplyBrokerPublisherFromEnv(process.env, {
    logger: { log: (event) => console.info(JSON.stringify(event)) },
    probe: probe?.observer,
  });
  await probe?.start();
  await publisher.run(controller.signal);
} catch {
  console.error("QKERN apply publisher failed its secure startup or runtime boundary.");
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", requestStop);
  process.removeListener("SIGTERM", requestStop);
  await Promise.allSettled([probe?.stop(), closePostgresPool()]);
}
