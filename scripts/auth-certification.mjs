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
// Die Dienste stehen hier namentlich — wer einen in der Compose-Datei
// ergaenzt und diese Liste vergisst, hat einen Dienst, der nie laeuft.
// Genau so fehlte dex-partner beim ersten Zwei-Provider-Lauf.
const up = run("up", "--detach", "--wait", "--force-recreate", "dex", "dex-partner", "mailpit");

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


// Wie im PostgreSQL-Laeufer: Der Runner schreibt den Exit-Code selbst ins
// Protokoll. `scripts/certification-manifest.mjs` liest ihn dort, und ein Log
// ohne diese Zeile gilt als unvollstaendiger Lauf. Vorher musste ihn die Shell
// anhaengen, also genau an der Stelle von Hand, an der die Evidenz entsteht.
console.log(`EXIT=${status}`);
process.exitCode = status;
