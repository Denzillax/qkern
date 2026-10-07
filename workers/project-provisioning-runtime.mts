import { closePostgresPool, getProvisionerPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { createProjectDatabaseProvisioningWorkerFromEnv } from "@/lib/server/provisioning/runtime-composition";
import { createLoopbackRuntimeProbeFromEnv } from "@/lib/server/operations/runtime-probe";
import {
  createProjectDatabaseBackupRuntimeFromEnv,
  type ProjectDatabaseBackupRuntime,
} from "@/lib/server/backup/project-database-runtime";

const controller = new AbortController();
const requestStop = () => controller.abort();
process.once("SIGINT", requestStop);
process.once("SIGTERM", requestStop);

const probe = createLoopbackRuntimeProbeFromEnv(process.env);
/**
 * Das Backup einer Projektdatenbank laeuft in diesem Prozess (2.126). Warum
 * hier und nicht in einem neunten Prozess, steht in
 * `lib/server/backup/project-database.ts`. Es laeuft als Leerlauf-Pflicht: ein
 * wartender Projektauftrag geht immer vor.
 *
 * Ohne Backup-Einstellungen wird nichts gebaut, und der Prozess verhaelt sich
 * wie vorher. Eine **halbe** Einstellung dagegen laesst den Start fallen, und
 * zwar hier und nicht beim ersten Backup in drei Wochen.
 */
let backup: ProjectDatabaseBackupRuntime | null = null;
try {
  const pool = getProvisionerPostgresPool(process.env);
  backup = createProjectDatabaseBackupRuntimeFromEnv(process.env, {
    controlPlane: new PostgresControlPlane(pool),
    controlPlanePool: pool,
    logger: { log: (event) => console.info(JSON.stringify(event)) },
  });
  const worker = createProjectDatabaseProvisioningWorkerFromEnv(process.env, {
    pool,
    logger: { log: (event) => console.info(JSON.stringify(event)) },
    probe: probe?.observer,
    // Die Leerlaufrunde traegt zwei Pflichten (2.175): erst Backups und
    // Wiederherstellungen, dann der Abraeumer fuer Projekte, deren Frist
    // abgelaufen ist. Faellt der Abraeumer aus, ist die Backup-Runde schon
    // gelaufen; der Worker faengt den Fehler und macht weiter.
    idleDuty: backup ? {
      runRound: async (signal?: AbortSignal) => {
        await backup!.service.runRound(signal);
        await backup!.purge.runRound();
      },
    } : undefined,
  });
  await probe?.start();
  await worker.run(controller.signal);
} catch {
  console.error("QKERN project database provisioner failed its secure startup or runtime boundary.");
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", requestStop);
  process.removeListener("SIGTERM", requestStop);
  await Promise.allSettled([probe?.stop(), backup?.close(), closePostgresPool()]);
}
