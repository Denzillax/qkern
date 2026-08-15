import { closePostgresPool } from "@/lib/server/db/pool";
import { createBillingInvoiceRunFromEnv } from "@/lib/server/usage/invoice-composition";
import { createLoopbackRuntimeProbeFromEnv } from "@/lib/server/operations/runtime-probe";

const controller = new AbortController();
const requestStop = () => controller.abort();
process.once("SIGINT", requestStop);
process.once("SIGTERM", requestStop);

const probe = createLoopbackRuntimeProbeFromEnv(process.env);
try {
  const run = createBillingInvoiceRunFromEnv(process.env, {
    logger: { log: (event) => console.info(JSON.stringify(event)) },
    probe: probe?.observer,
  });
  await probe?.start();
  await run.run(controller.signal);
} catch {
  console.error("QKERN billing invoice run failed its secure startup or runtime boundary.");
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", requestStop);
  process.removeListener("SIGTERM", requestStop);
  await Promise.allSettled([probe?.stop(), closePostgresPool()]);
}
