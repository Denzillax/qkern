import { spawnSync } from "node:child_process";

const compose = [
  "compose",
  "-p",
  "qkern-storage-v140a2-certification",
  "-f",
  "docker-compose.storage-certification.yml",
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
  console.error(`Unable to start the Storage certification stack: ${up.error.message}`);
}
if (down.error) {
  console.error(`Unable to clean up the Storage certification stack: ${down.error.message}`);
}


// Wie im PostgreSQL-Laeufer: Der Runner schreibt den Exit-Code selbst ins
// Protokoll. `scripts/certification-manifest.mjs` liest ihn dort, und ein Log
// ohne diese Zeile gilt als unvollstaendiger Lauf. Vorher musste ihn die Shell
// anhaengen, also genau an der Stelle von Hand, an der die Evidenz entsteht.
console.log(`EXIT=${up.status ?? 1}`);
process.exitCode = up.status ?? 1;
