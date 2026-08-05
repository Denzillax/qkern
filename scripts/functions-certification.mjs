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

const build = run("docker", ["build", "--quiet", "--file", `${context}/Dockerfile`, context]);
if (build.status !== 0) {
  console.error("Das Test-Image konnte nicht gebaut werden.");
  console.error(build.stderr);
  process.exit(1);
}
const image = build.stdout.trim();
if (!/^sha256:[0-9a-f]{64}$/.test(image)) {
  console.error(`Unerwartete Image-Referenz: ${image}`);
  process.exit(1);
}
console.log(`Test-Image ${image}`);

// Vitest wird direkt ueber seinen Einstiegspunkt gestartet, nicht ueber einen
// Paketmanager-Wrapper: Auf Windows ist das ein Batch-Skript, und ein
// fehlgeschlagener Start waere sonst kaum von einem roten Lauf zu unterscheiden.
const test = run(process.execPath, [
  resolve(root, "node_modules/vitest/vitest.mjs"),
  "run", "tests/function-sandbox.integration.test.ts",
  "--testTimeout=120000", "--hookTimeout=120000",
], {
  stdio: "inherit",
  cwd: root,
  env: { ...process.env, QKERN_TEST_FUNCTION_IMAGE: image },
});
if (test.error) {
  console.error(`Der Testlauf konnte nicht gestartet werden: ${test.error.message}`);
}

// Das Image wird immer entfernt, auch wenn der Lauf rot war. Ein liegen
// gebliebenes Image liesse den naechsten Lauf gegen einen anderen Inhalt
// pruefen, ohne dass es auffaellt.
const remove = run("docker", ["image", "rm", "--force", image]);
if (remove.status !== 0) console.error("Hinweis: Das Test-Image konnte nicht entfernt werden.");

console.log(`EXIT=${test.status ?? 1}`);
process.exitCode = test.status ?? 1;
