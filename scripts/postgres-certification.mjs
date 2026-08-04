import { spawnSync } from "node:child_process";

const compose = [
  "compose",
  "-p",
  "qkern-v023-certification",
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

process.exitCode = up.status ?? 1;
