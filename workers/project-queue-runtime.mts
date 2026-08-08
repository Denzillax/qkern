import { closePostgresPool } from "@/lib/server/db/pool";
import { createProjectQueueHostFromEnv } from "@/lib/server/project-queues/host-composition";
import { createLoopbackRuntimeProbeFromEnv } from "@/lib/server/operations/runtime-probe";

/**
 * Der Prozess, der Queue-Nachrichten tatsaechlich verarbeitet.
 *
 * Bis Release 1.42 gab es ihn nicht: `ProjectQueueWorker` war seit Alpha 1
 * gebaut und getestet, aber kein Einstieg startete ihn. Nachrichten liessen
 * sich einreihen, und niemand nahm sie heraus.
 */
// Vier der sieben Prozesse starten die Probe seit der Baseline 1.8.0, der
// Compute-Prozess seit 1.46. Dieser war der letzte mit einer Schleife und ohne
// Beobachter.
const probe = createLoopbackRuntimeProbeFromEnv(process.env);

const host = (() => {
  try {
    return createProjectQueueHostFromEnv(process.env, { probe: probe?.observer });
  } catch {
    // Bindungen, Datenbankmeldungen und Function-Namen bleiben aus dem Log
    // dieses Prozesses.
    console.error("QKERN project queue host failed its startup boundary.");
    process.exitCode = 1;
    return null;
  }
})();

if (host) {
  const requestStop = () => { void host.runtime.stop(); };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  const bound = await probe?.start();
  console.error(`QKERN project queue host serving ${host.bindings.length} binding(s)`
    + (bound ? ` (probe on http://${bound.host}:${bound.port}/ready)` : ""));
  probe?.observer.runtimeStarted();
  try {
    await host.runtime.run();
  } catch {
    console.error("QKERN project queue host failed its runtime boundary.");
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", requestStop);
    process.removeListener("SIGTERM", requestStop);
    await probe?.stop();
    await closePostgresPool();
  }
}
