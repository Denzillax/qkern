#!/usr/bin/env node
// Zertifizierung der Functions-Sandbox gegen eine echte Container-Laufzeit.
//
// Anders als die drei Compose-Stacks braucht dieser Lauf keinen Dienst, sondern
// die Laufzeit selbst: Geprueft wird, ob die Container-Flags wirklich greifen —
// kein Netz, kein Schreibzugriff, nicht root, harte Speichergrenze.
//
// Das Test-Image wird lokal gebaut und ueber seine **Image-Id** referenziert.
// Eine Id ist inhaltsadressiert und damit die staerkste Bindung, die es gibt;
// ein Tag waere veraenderlich und wuerde genau die Zusage aufweichen, die hier
// belegt werden soll.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const context = resolve(root, "tests/support/function-sandbox");

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

const version = run("docker", ["version", "--format", "{{.Server.Version}}"]);
if (version.status !== 0) {
  console.error("Docker ist nicht erreichbar. Die Functions-Zertifizierung wird nicht ausgefuehrt.");
  process.exit(1);
}
console.log(`Docker-Server ${version.stdout.trim()}`);

// Ein echtes PostgreSQL gehoert dazu, seit Release 1.24: Bis dahin liefen die
// Definitionen im einen Stack und die Sandbox im anderen. Beide Haelften waren
// belegt, die Naht dazwischen nicht — und genau an solchen Naehten hat dieser
// Sprint mehrfach Fehler gefunden.
const compose = [
  "compose", "-p", "qkern-functions-certification",
  "-f", "docker-compose.functions-certification.yml",
];

function composeDown() {
  run("docker", [...compose, "down", "--volumes", "--remove-orphans"], { cwd: root });
}

/**
 * Entfernt Sandbox-Container aus frueheren Laeufen.
 *
 * Ein Fall prueft, dass nach einem Timeout kein Sandbox-Container mehr laeuft.
 * Die Entfernung selbst laeuft abgekoppelt weiter, und wenn der Testprozess
 * vorher endet, kann sie ausbleiben. Ein Rest aus dem Vorlauf haette den Fall
 * dann rot gemacht, ohne dass am Produkt etwas falsch ist — der Daemon ist
 * geteilter Zustand, und dieser Lauf raeumt ihn auf, bevor er misst.
 */
function removeStaleSandboxes() {
  const listed = run("docker", [
    "ps", "--all", "--quiet", "--filter", "name=qkern-fn-",
  ]);
  const ids = (listed.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (ids.length === 0) return;
  console.log(`Entferne ${ids.length} Sandbox-Container aus einem frueheren Lauf.`);
  run("docker", ["rm", "--force", ...ids]);
}

removeStaleSandboxes();
composeDown();
const database = run("docker", [...compose, "up", "--detach", "--wait", "--force-recreate"], {
  cwd: root, stdio: "inherit",
});
if (database.status !== 0) {
  console.error("Die Zertifizierungsdatenbank konnte nicht gestartet werden.");
  composeDown();
  process.exit(1);
}

const build = run("docker", ["build", "--quiet", "--file", `${context}/Dockerfile`, context]);
if (build.status !== 0) {
  console.error("Das Test-Image konnte nicht gebaut werden.");
  console.error(build.stderr);
  composeDown();
  process.exit(1);
}
const image = build.stdout.trim();
if (!/^sha256:[0-9a-f]{64}$/.test(image)) {
  console.error(`Unerwartete Image-Referenz: ${image}`);
  composeDown();
  process.exit(1);
}
console.log(`Test-Image ${image}`);

// Vitest wird direkt ueber seinen Einstiegspunkt gestartet, nicht ueber einen
// Paketmanager-Wrapper: Auf Windows ist das ein Batch-Skript, und ein
// fehlgeschlagener Start waere sonst kaum von einem roten Lauf zu unterscheiden.
const owner = "postgresql://qkern:qkern_local_only@127.0.0.1:55433/qkern_control";
const runtime = "postgresql://qkern_app:qkern_runtime_local_only@127.0.0.1:55433/qkern_control";

const test = run(process.execPath, [
  resolve(root, "node_modules/vitest/vitest.mjs"),
  "run", "tests/function-sandbox.integration.test.ts", "tests/function-chain.integration.test.ts",
  "--testTimeout=120000", "--hookTimeout=120000",
  // Beide Dateien teilen sich einen Docker-Daemon. Ein Fall prueft, dass nach
  // einem Timeout **kein** Sandbox-Container mehr laeuft — parallel laufende
  // Dateien machen daraus einen Wettlauf, und der Fall waere dann nicht rot,
  // weil das Produkt falsch ist, sondern weil der Nachbar noch arbeitet.
  "--no-file-parallelism",
], {
  stdio: "inherit",
  cwd: root,
  env: {
    ...process.env,
    QKERN_TEST_FUNCTION_IMAGE: image,
    DATABASE_SSL: "disable",
    QKERN_TEST_OWNER_DATABASE_URL: owner,
    QKERN_TEST_RUNTIME_DATABASE_URL: runtime,
  },
});
if (test.error) {
  console.error(`Der Testlauf konnte nicht gestartet werden: ${test.error.message}`);
}

// Image und Datenbank werden immer entfernt, auch wenn der Lauf rot war. Ein
// liegen gebliebenes Image liesse den naechsten Lauf gegen einen anderen Inhalt
// pruefen, ohne dass es auffaellt.
removeStaleSandboxes();
const remove = run("docker", ["image", "rm", "--force", image]);
if (remove.status !== 0) console.error("Hinweis: Das Test-Image konnte nicht entfernt werden.");
composeDown();

console.log(`EXIT=${test.status ?? 1}`);
process.exitCode = test.status ?? 1;
