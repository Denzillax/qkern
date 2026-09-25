import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * Backup-/Restore-Drill im Wegwerfstack (Sprosse 10, 2.29). Wie die anderen
 * Zertifizierungsskripte, mit zwei Zusaetzen:
 *
 * 1. Der Stack hat einen Einmal-Container (Zertifikat), und
 *    `--abort-on-container-exit` nimmt dessen Ende als Abbruch, je nach
 *    Zeitpunkt. Deshalb erst `up --wait` fuer den Quellserver (wartet auf
 *    gesund, das Zertifikat ist dann laengst da), dann der Drill als eigener
 *    `run`, dessen Exit-Code zaehlt.
 * 2. Der Drill schreibt die signierte Evidenz und den Pruefschluessel als
 *    Base64-Zeilen ins Log; dieses Skript legt sie unter
 *    `docs/evidence/backup-restore/` ab, damit der Verifier des Produkts sie
 *    lesen kann.
 */
const compose = [
  "compose",
  "-p",
  "qkern-backup-v229-certification",
  "-f",
  "docker-compose.backup-certification.yml",
];

const up = spawnSync("docker", [...compose, "up", "-d", "--wait", "--force-recreate", "postgres"], { stdio: "inherit" });
let status = up.status ?? 1;
let output = "";

if (status === 0) {
  const run = spawnSync(
    "docker",
    [...compose, "run", "--rm", "--no-deps", "drill"],
    { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  output = run.stdout ?? "";
  process.stdout.write(output);
  status = run.status ?? 1;
  if (run.error) console.error(`Unable to run the backup drill: ${run.error.message}`);
} else if (up.error) {
  console.error(`Unable to start the backup drill stack: ${up.error.message}`);
}

const logs = spawnSync("docker", [...compose, "logs", "--no-color", "postgres"], { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (logs.stdout) process.stdout.write(logs.stdout);

const down = spawnSync("docker", [...compose, "down", "--volumes", "--remove-orphans"], { stdio: "inherit" });
if (down.error) console.error(`Unable to clean up the backup drill stack: ${down.error.message}`);

const evidence = /QKERN_BACKUP_EVIDENCE_BASE64 ([A-Za-z0-9+/=]+)/.exec(output);
const key = /QKERN_BACKUP_VERIFIER_KEY_BASE64 ([A-Za-z0-9+/=]+)/.exec(output);
if (status === 0 && evidence && key) {
  mkdirSync("docs/evidence/backup-restore", { recursive: true });
  writeFileSync("docs/evidence/backup-restore/drill.evidence.json", Buffer.from(evidence[1], "base64"));
  const keyBytes = Buffer.from(key[1], "base64");
  writeFileSync("docs/evidence/backup-restore/drill.verifier-key.json", keyBytes);
  // Der Verifier pinnt den SHA-256 des rohen 32-Byte-Schluessels, nicht der
  // Datei. Der Pin liegt daneben, damit `npm run verify:backup-restore` ihn
  // ohne Nachrechnen bekommt.
  const publicKey = Buffer.from(JSON.parse(keyBytes.toString("utf8")).publicKey, "base64url");
  writeFileSync("docs/evidence/backup-restore/drill.verifier-key.sha256", createHash("sha256").update(publicKey).digest("hex") + "\n");
  console.log("Evidenz abgelegt: docs/evidence/backup-restore/drill.evidence.json");
} else if (status === 0) {
  console.error("Drill gruen, aber keine Evidenzzeilen im Log gefunden.");
  status = 1;
}

console.log(`EXIT=${status}`);
process.exitCode = status;
