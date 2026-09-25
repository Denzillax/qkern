import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const cache = mkdtempSync(path.join(tmpdir(), "qkern-npm-cache-"));
import { existsSync } from "node:fs";

// Node 24 verweigert `npm.cmd` ohne Shell (EINVAL, CVE-2024-27980). Statt einer
// Shell rufen wir npm's eigenes CLI-Skript direkt mit dem laufenden Node auf;
// es liegt neben der Node-Binary (Windows) oder unter ../lib (Unix).
const nodeDirectory = path.dirname(process.execPath);
const npmCli = [
  path.join(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
  path.join(nodeDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
].find((candidate) => existsSync(candidate));
if (!npmCli) throw new Error("npm-cli.js neben " + process.execPath + " nicht gefunden");

try {
  for (const packageDirectory of ["./sdk/typescript", "./cli"]) {
    execFileSync(process.execPath, [npmCli, "pack", "--dry-run", packageDirectory], {
      cwd: process.cwd(),
      env: { ...process.env, npm_config_cache: cache },
      stdio: "inherit",
      windowsHide: true,
    });
  }
  process.stdout.write("QKERN SDK and CLI package tarballs verified.\n");
} finally {
  rmSync(cache, { recursive: true, force: true });
}
