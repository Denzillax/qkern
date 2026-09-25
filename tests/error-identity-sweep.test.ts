import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConflictError, ConnectionUnavailableError, RepositoryError } from "@/lib/server/db/errors";
import { ProjectAuthError } from "@/lib/server/project-auth/service";
import { ProjectStorageConflictError } from "@/lib/server/project-storage/repository";
import { ProjectDataPlaneError } from "@/lib/server/data-plane/service";
import { recognisedByName } from "@/lib/server/errors/identity";

/**
 * Jede Fehlerklasse des Servers besteht `instanceof` auch aus einem fremden
 * Modulgraphen (2.25). Der Vertrag hat zwei Haelften: das Verhalten an
 * Beispielen, und ein Scan, dass keine exportierte Fehlerklasse ohne
 * Registrierung bleibt, damit der vierte Fall dieser Klasse nicht entsteht.
 */
function foreign(name: string, code?: string): Error {
  class Foreign extends Error { constructor() { super(name); this.name = name; if (code) Object.assign(this, { code }); } }
  return new Foreign();
}

async function serverFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await serverFiles(full));
    else if (entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

describe("error identity sweep", () => {
  it("recognises a foreign copy of the same error, keeps real subclasses, and rejects strangers", () => {
    expect(foreign("ProjectAuthError", "INVALID_INPUT") instanceof ProjectAuthError).toBe(true);
    expect(foreign("ProjectStorageConflictError") instanceof ProjectStorageConflictError).toBe(true);
    expect(foreign("ProjectDataPlaneError", "DATA_PLANE_DISABLED") instanceof ProjectDataPlaneError).toBe(true);
    // Eine fremde Unterklasse zaehlt fuer die Basisklasse.
    expect(foreign("ConflictError") instanceof RepositoryError).toBe(true);
    expect(foreign("ConflictError") instanceof ConflictError).toBe(true);
    expect(foreign("ConflictError") instanceof ConnectionUnavailableError).toBe(false);
    // Echte Instanzen wie bisher.
    expect(new ConflictError() instanceof RepositoryError).toBe(true);
    expect(new ConflictError() instanceof ConnectionUnavailableError).toBe(false);
    expect(new ConflictError().name).toBe("ConflictError");
    expect(new RepositoryError("CONFLICT", "x").name).toBe("RepositoryError");
    // Fremde ohne passenden Namen und Nicht-Fehler bleiben draussen.
    expect(foreign("SomethingElse") instanceof ProjectAuthError).toBe(false);
    expect(new Error("ProjectAuthError") instanceof ProjectAuthError).toBe(false);
    expect(({ name: "ProjectAuthError" }) instanceof ProjectAuthError).toBe(false);
    expect((null as unknown) instanceof ProjectAuthError).toBe(false);
  });

  it("sets the name as a literal on the prototype, independent of the class name", () => {
    class Mangled extends Error {}
    recognisedByName(Mangled, "ReadableError");
    expect(new Mangled().name).toBe("ReadableError");
    expect(foreign("ReadableError") instanceof Mangled).toBe(true);
  });

  it("lets an unregistered subclass fall back to the prototype chain and registers subclasses with their ancestors", () => {
    // Nicht registriert: erbt das statische hasInstance, darf aber nicht die Namen des Vorfahren als eigene nehmen (Review 2.28).
    class Unregistered extends RepositoryError { constructor() { super("CONFLICT", "x"); } }
    expect(new ConflictError() instanceof Unregistered).toBe(false);
    expect(foreign("ConflictError") instanceof Unregistered).toBe(false);
    expect(new Unregistered() instanceof Unregistered).toBe(true);
    expect(new Unregistered() instanceof RepositoryError).toBe(true);
    // Registriert: eine fremde Kopie der Unterklasse ist auch eine Instanz der Basisklasse, ohne Liste in der Basis.
    class Registered extends RepositoryError { constructor() { super("CONFLICT", "x"); } }
    recognisedByName(Registered, "RegisteredRepositoryError");
    expect(foreign("RegisteredRepositoryError") instanceof RepositoryError).toBe(true);
    expect(foreign("RegisteredRepositoryError") instanceof Registered).toBe(true);
    expect(foreign("RegisteredRepositoryError") instanceof ConflictError).toBe(false);
  });

  it("registers every exported error class in lib/server", async () => {
    const missing: string[] = [];
    for (const file of await serverFiles(path.resolve(process.cwd(), "lib/server"))) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/^export class (\w+Error) extends /gm)) {
        if (!source.includes(`recognisedByName(${match[1]}, "${match[1]}"`)) missing.push(`${path.relative(process.cwd(), file)}: ${match[1]}`);
      }
    }
    expect(missing, "Fehlerklassen ohne recognisedByName").toEqual([]);
  });
});
