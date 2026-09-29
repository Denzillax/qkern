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
// Der Projektname kommt aus COMPOSE_PROJECT_NAME, wenn gesetzt: So koennen
// parallele Schnitte ihre Stacks am Praefix erkennen und nur die eigenen
// abraeumen. Die veroeffentlichten Ports bleiben dieselben; zwei Stacks
// gleichzeitig traegt die Maschine ohnehin nicht.
const project = process.env.COMPOSE_PROJECT_NAME?.trim() || "qkern-functions-certification";
const compose = [
  "compose", "-p", project,
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

const REGISTRY = "127.0.0.1:55000";
const TAG = `${REGISTRY}/qkern/probe:certification`;

function fail(message, detail) {
  console.error(message);
  if (detail) console.error(detail);
  composeDown();
  process.exit(1);
}

const build = run("docker", ["build", "--quiet", "--tag", TAG, "--file", `${context}/Dockerfile`, context]);
if (build.status !== 0) fail("Das Test-Image konnte nicht gebaut werden.", build.stderr);
const localId = build.stdout.trim();
if (!/^sha256:[0-9a-f]{64}$/.test(localId)) fail(`Unerwartete Image-Id: ${localId}`);

// Der Digest kommt aus der Registry, nicht aus dem lokalen Speicher. Eine
// lokale Image-Id ist etwas anderes als ein Registry-Digest: Sie beschreibt die
// Konfiguration, er das Manifest. Nur der zweite ist das, was ein Betreiber
// hinterlegt.
const push = run("docker", ["push", TAG]);
if (push.status !== 0) fail("Das Test-Image konnte nicht in die Registry geschoben werden.", push.stderr);

const inspect = run("docker", ["inspect", "--format", "{{index .RepoDigests 0}}", TAG]);
if (inspect.status !== 0) fail("Der Registry-Digest konnte nicht gelesen werden.", inspect.stderr);
const image = inspect.stdout.trim();
if (!new RegExp(`^${REGISTRY.replace(".", "\\.")}/qkern/probe@sha256:[0-9a-f]{64}$`).test(image)) {
  fail(`Unerwarteter Registry-Bezug: ${image}`);
}

// Beide lokalen Namen verschwinden, damit der Lauf wirklich aus der Registry
// zieht. Ohne diesen Schritt beantwortete der lokale Zwischenspeicher die
// Frage, und die Registry waere Kulisse.
run("docker", ["image", "rm", "--force", TAG, image]);
console.log(`Test-Image ${image} (lokal entfernt, wird aus der Registry geholt)`);

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
// Nach dem Lauf liegt das Image wieder lokal — es wurde ja gezogen. Es muss
// weg, sonst prueft der naechste Lauf gegen einen Zwischenspeicher statt gegen
// die Registry.
const remove = run("docker", ["image", "rm", "--force", image, localId]);
if (remove.status !== 0) console.error("Hinweis: Das Test-Image konnte nicht entfernt werden.");
composeDown();

console.log(`EXIT=${test.status ?? 1}`);
process.exitCode = test.status ?? 1;
