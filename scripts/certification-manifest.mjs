#!/usr/bin/env node
// Erzeugt ein Manifest zu einem Zertifizierungslauf.
//
// Testzahlen werden aus dem Rohlog gelesen, nicht von Hand gepflegt. Genau
// diese Handpflege hatte dazu gefuehrt, dass docs/QA.md einen ueberholten
// Stand als "aktuell" auswies.
//
// Aufruf: node scripts/certification-manifest.mjs <logdatei> <stack> [compose]

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const [logPath, stack, composePath] = process.argv.slice(2);
if (!logPath || !stack) {
  console.error("usage: certification-manifest.mjs <logfile> <stack> [compose-file]");
  process.exit(2);
}

// Compose praefixt jede Containerzeile mit ihrem Servicenamen und Vitest faerbt
// seine Ausgabe ein. Beides muss weg, bevor die Zusammenfassung lesbar ist.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const log = readFileSync(logPath, "utf8")
  .replace(ANSI, "")
  .split(/\r?\n/)
  .map((line) => line.replace(/^\S+\s+\|\s?/, ""))
  .join("\n");

const summary = /^\s*Tests\s+(.+)$/m.exec(log);
const files = /^\s*Test Files\s+(.+)$/m.exec(log);
const exitCode = /^EXIT=(\d+)$/m.exec(log);
const migrations = /certification-init: applied (\d+) migrations/.exec(log);

const counts = (label) => {
  const hit = new RegExp(`(\\d+)\\s+${label}`).exec(summary?.[1] ?? "");
  return hit ? Number.parseInt(hit[1], 10) : 0;
};

const images = composePath
  ? [...readFileSync(composePath, "utf8").matchAll(/^\s*image:\s*(\S+)\s*$/gm)].map((m) => m[1])
  : [];

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const manifest = {
  stack,
  log: basename(logPath),
  commit: git("rev-parse", "HEAD"),
  commitSubject: git("log", "-1", "--format=%s"),
  workingTreeClean: git("status", "--porcelain") === "",
  exitCode: exitCode ? Number.parseInt(exitCode[1], 10) : null,
  migrationsApplied: migrations ? Number.parseInt(migrations[1], 10) : null,
  testFiles: files?.[1]?.trim() ?? null,
  tests: summary?.[1]?.trim() ?? null,
  passed: counts("passed"),
  failed: counts("failed"),
  skipped: counts("skipped"),
  images,
};

if (manifest.exitCode === null || manifest.tests === null) {
  console.error("Log enthaelt keinen vollstaendigen Lauf. Es wird keine Evidenz abgelegt.");
  process.exit(1);
}

const target = logPath.replace(/\.log$/, ".manifest.json");
writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `${basename(target)}: ${manifest.passed} bestanden, ${manifest.failed} fehlgeschlagen, `
  + `${manifest.skipped} uebersprungen, exit ${manifest.exitCode}`,
);
if (!manifest.workingTreeClean) {
  console.log("Hinweis: Arbeitsbaum war beim Lauf nicht sauber; der Commit belegt den Stand nur teilweise.");
}
