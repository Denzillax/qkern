import { spawnSync } from "node:child_process";

// Dieser Stack enthaelt mit `certs` einen Einmal-Dienst, der planmaessig mit
// Code 0 endet. `--abort-on-container-exit` (das `--exit-code-from` impliziert)
// wuerde den ganzen Stack genau dann abbrechen und den eigentlichen Testlauf nie
// starten. Deshalb werden die Dienste erst hochgefahren und der Testcontainer
// danach getrennt ausgefuehrt.

const compose = [
  "compose",
  "-p",
  "qkern-auth-v13-certification",
  "-f",
  "docker-compose.auth-certification.yml",
];

const run = (...args) => spawnSync("docker", [...compose, ...args], { stdio: "inherit" });

// --wait blockiert, bis dex und mailpit gesund beziehungsweise gestartet sind
// und der Zertifikatsdienst erfolgreich beendet ist.
const up = run("up", "--detach", "--wait", "--force-recreate", "dex", "mailpit");

let status = up.status ?? 1;
if (status === 0) {
  const certification = run("run", "--rm", "--no-deps", "certification");
  status = certification.status ?? 1;
  if (certification.error) {
    console.error(`Unable to run the Project Auth certification: ${certification.error.message}`);
  }
}

const down = run("down", "--volumes", "--remove-orphans");

if (up.error) {
  console.error(`Unable to start the Project Auth certification stack: ${up.error.message}`);
}
if (down.error) {
  console.error(`Unable to clean up the Project Auth certification stack: ${down.error.message}`);
}

process.exitCode = status;
