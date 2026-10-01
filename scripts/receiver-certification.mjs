#!/usr/bin/env node
// Zertifizierung des ausgehenden Wegs gegen einen echten HTTPS-Empfaenger.
//
// Der Stack enthaelt mit `certs` einen Einmal-Dienst, der planmaessig mit Code 0
// endet. `--abort-on-container-exit` (das `--exit-code-from` impliziert) wuerde
// den ganzen Stack genau dann abbrechen und den Testlauf nie starten — derselbe
// Fehler, der in Release 1.25 den Vault-Lauf zweimal rot gemacht hat. Deshalb
// werden die Dienste erst hochgefahren und der Testcontainer danach getrennt
// ausgefuehrt.

import { spawnSync } from "node:child_process";

// Der Projektname kommt aus COMPOSE_PROJECT_NAME, wenn gesetzt, wie in den
// anderen Laeufern: Ein paralleler Schnitt erkennt seinen Stack dann am eigenen
// Praefix und raeumt nur ihn ab. Ohne die Variable bleibt es der Name von
// vorher, damit die archivierte Evidenz denselben Stack nennt.
const compose = [
  "compose",
  "-p",
  process.env.COMPOSE_PROJECT_NAME?.trim() || "qkern-receiver-certification",
  "-f",
  "docker-compose.receiver-certification.yml",
];

const run = (...args) => spawnSync("docker", [...compose, ...args], { stdio: "inherit" });

// Ein liegen gebliebenes Netz aus einem abgebrochenen Lauf haette dasselbe
// Subnetz und wuerde den naechsten Aufbau verhindern.
run("down", "--volumes", "--remove-orphans");

// --wait blockiert, bis der Empfaenger gesund und PostgreSQL bereit ist und der
// Zertifikatsdienst erfolgreich beendet wurde.
const up = run("up", "--detach", "--wait", "--force-recreate", "receiver", "postgres", "internal");

let status = up.status ?? 1;
if (status === 0) {
  const certification = run("run", "--rm", "--no-deps", "certification");
  status = certification.status ?? 1;
  if (certification.error) {
    console.error(`Unable to run the receiver certification: ${certification.error.message}`);
  }
}

// Immer abraeumen, auch wenn der Lauf rot war: Der Stack belegt fuer seine
// Dauer oeffentlichen Adressraum auf der lokalen Bridge.
const down = run("down", "--volumes", "--remove-orphans");

if (up.error) {
  console.error(`Unable to start the receiver certification stack: ${up.error.message}`);
}
if (down.error) {
  console.error(`Unable to clean up the receiver certification stack: ${down.error.message}`);
}

console.log(`EXIT=${status}`);
process.exitCode = status;
