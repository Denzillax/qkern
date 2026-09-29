import { spawnSync } from "node:child_process";

// Der Projektname kommt aus COMPOSE_PROJECT_NAME, wenn gesetzt, damit ein
// paralleler Schnitt seinen Stack am Praefix erkennt.
const compose = [
  "compose",
  "-p",
  process.env.COMPOSE_PROJECT_NAME?.trim() || "qkern-v023-certification",
  "-f",
  "docker-compose.certification.yml",
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
  console.error(`Unable to start the PostgreSQL certification stack: ${up.error.message}`);
}
if (down.error) {
  console.error(`Unable to clean up the PostgreSQL certification stack: ${down.error.message}`);
}

// Wie in den fuenf anderen Staeks: Der Runner schreibt den Exit-Code selbst ins
// Protokoll. `scripts/certification-manifest.mjs` liest ihn dort, und ein Log
// ohne diese Zeile gilt als unvollstaendiger Lauf. Bisher musste ihn die Shell
// anhaengen — eine Handpflege, die genau an der Stelle sass, an der die Evidenz
// entsteht.
console.log(`EXIT=${up.status ?? 1}`);
process.exitCode = up.status ?? 1;
