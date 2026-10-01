#!/usr/bin/env node
// Zertifizierung der Webhook-Signaturschluessel gegen einen echten Vault.
//
// Gleiche Form wie die uebrigen Compose-Stacks: wegwerfbar, portlos, und die
// Container samt Volumes werden immer abgeraeumt — auch wenn der Lauf rot war.

import { spawnSync } from "node:child_process";

// Der Projektname kommt aus COMPOSE_PROJECT_NAME, wenn gesetzt, wie in den
// anderen Laeufern: Ein paralleler Schnitt erkennt seinen Stack dann am eigenen
// Praefix und raeumt nur ihn ab. Ohne die Variable bleibt es der Name von
// vorher, damit die archivierte Evidenz denselben Stack nennt.
const compose = [
  "compose",
  "-p",
  process.env.COMPOSE_PROJECT_NAME?.trim() || "qkern-vault-certification",
  "-f",
  "docker-compose.vault-certification.yml",
];

const up = spawnSync(
  "docker",
  [
    ...compose,
    "up",
    "--abort-on-container-exit",
    "--exit-code-from",
    "certification",
    "--force-recreate",
  ],
  { stdio: "inherit" },
);

const down = spawnSync(
  "docker",
  [...compose, "down", "--volumes", "--remove-orphans"],
  { stdio: "inherit" },
);

if (up.error) {
  console.error(`Unable to start the Vault certification stack: ${up.error.message}`);
}
if (down.error) {
  console.error(`Unable to clean up the Vault certification stack: ${down.error.message}`);
}

console.log(`EXIT=${up.status ?? 1}`);
process.exitCode = up.status ?? 1;
