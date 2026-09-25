import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Vertrag fuer das Init-Layout des Dev-Compose.
//
// Docker Desktop (WSL2) kann kein Mount in das read-only gemountete
// `/docker-entrypoint-initdb.d` hineinschachteln ("make mountpoint: read-only
// file system"). Deshalb mountet der Dev-Compose wie die Zertifizierungsstacks
// `db` an einen eigenen Pfad und legt nur `000-certification-init.sh` in das
// Init-Verzeichnis. Der Schnellstart braucht ausserdem die lokale
// Projektdatenbank, die `999` am Ende ueber `998` anlegt; ihr Ledger-Owner
// darf sich wie in Produktion nicht anmelden.

const composePath = path.resolve(process.cwd(), "docker-compose.yml");
const loginPath = path.resolve(process.cwd(), "db/docker/999-runtime-login.sh");
const projectDatabasePath = path.resolve(process.cwd(), "db/docker/998-project-database.sh");

describe("dev compose init layout", () => {
  it("mounts db beside the init directory and only the single init entry point into it", async () => {
    const compose = await readFile(composePath, "utf8");
    expect(compose).toContain("./db:/qkern/db:ro");
    expect(compose).toContain(
      "./db/docker/000-certification-init.sh:/docker-entrypoint-initdb.d/000-certification-init.sh:ro",
    );
    expect(compose).not.toContain("./db/migrations:/docker-entrypoint-initdb.d");
    expect(compose).not.toContain("QKERN_PROJECT_LEDGER_DB_PASSWORD");
  });

  it("creates the local project database as the last init step", async () => {
    const login = await readFile(loginPath, "utf8");
    const lines = login.split(/\r?\n/).filter((line) => line.trim() !== "");
    expect(lines.at(-1)).toBe("bash /qkern/db/docker/998-project-database.sh");
  });

  it("keeps the ledger owner without login and closes the database for PUBLIC", async () => {
    const script = await readFile(projectDatabasePath, "utf8");
    const ledgerLine = script.split(/\r?\n/).find((line) => line.startsWith("CREATE ROLE qkern_ledger_owner "));
    expect(ledgerLine).toBeDefined();
    expect(ledgerLine).toContain("NOLOGIN");
    expect(ledgerLine).not.toContain("PASSWORD");
    expect(script).toContain("REVOKE ALL ON DATABASE project_database FROM PUBLIC");
  });
});
