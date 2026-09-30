import { spawnSync } from "node:child_process";

/**
 * Realtime-Production-Zertifizierung im Wegwerfstack (Sprosse 5).
 *
 * Aufbau wie beim Backup-Drill, und aus demselben Grund: Der Stack hat einen
 * Einmal-Container (Zertifikate), und `--abort-on-container-exit` nimmt dessen
 * Ende je nach Zeitpunkt als Abbruch des ganzen Laufs. Deshalb erst
 * `up --wait` fuer den Quellserver (wartet auf gesund, die Zertifikate sind
 * dann laengst da), danach der Testcontainer als eigener `run`, dessen
 * Exit-Code zaehlt.
 *
 * Das Serverlog wird am Ende mitgeschrieben: Ob eine Verbindung wirklich ueber
 * TLS kam, steht am Ende in `pg_stat_ssl`, aber ein abgewiesener Klartext-
 * Versuch steht nur hier.
 *
 * Der Vault gehoert zum Stack: Postgres Changes brauchen unter
 * Production einen vault-gestuetzten Katalog, und beide Dienste muessen gesund
 * sein, bevor der Testcontainer laeuft.
 */
const project = process.env.COMPOSE_PROJECT_NAME?.trim() || "qkern-slice-rt";
const compose = ["compose", "-p", project, "-f", "docker-compose.realtime-certification.yml"];

const up = spawnSync("docker", [...compose, "up", "-d", "--wait", "--force-recreate", "postgres", "vault"], { stdio: "inherit" });
let status = up.status ?? 1;
if (up.error) console.error(`Unable to start the realtime certification stack: ${up.error.message}`);

if (status === 0) {
  const run = spawnSync("docker", [...compose, "run", "--rm", "--no-deps", "certification"], { stdio: "inherit" });
  status = run.status ?? 1;
  if (run.error) console.error(`Unable to run the realtime certification: ${run.error.message}`);
}

const logs = spawnSync("docker", [...compose, "logs", "--no-color", "postgres"], {
  stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
});
if (logs.stdout) process.stdout.write(logs.stdout);

const down = spawnSync("docker", [...compose, "down", "--volumes", "--remove-orphans"], { stdio: "inherit" });
if (down.error) console.error(`Unable to clean up the realtime certification stack: ${down.error.message}`);

console.log(`EXIT=${status}`);
process.exitCode = status;
