import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const cache = mkdtempSync(path.join(tmpdir(), "qkern-npm-cache-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  for (const packageDirectory of ["./sdk/typescript", "./cli"]) {
    execFileSync(npm, ["pack", "--dry-run", packageDirectory], {
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
