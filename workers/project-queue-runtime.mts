import { closePostgresPool } from "@/lib/server/db/pool";
import { createProjectQueueHostFromEnv } from "@/lib/server/project-queues/host-composition";

/**
 * Der Prozess, der Queue-Nachrichten tatsaechlich verarbeitet.
 *
 * Bis Release 1.42 gab es ihn nicht: `ProjectQueueWorker` war seit Alpha 1
 * gebaut und getestet, aber kein Einstieg startete ihn. Nachrichten liessen
 * sich einreihen, und niemand nahm sie heraus.
 */
const host = (() => {
  try {
    return createProjectQueueHostFromEnv(process.env);
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
  console.error(`QKERN project queue host serving ${host.bindings.length} binding(s)`);
  try {
    await host.runtime.run();
  } catch {
    console.error("QKERN project queue host failed its runtime boundary.");
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", requestStop);
    process.removeListener("SIGTERM", requestStop);
    await closePostgresPool();
  }
}
