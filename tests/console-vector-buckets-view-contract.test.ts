import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  VECTOR_BUCKET_TEXTS,
  VECTOR_FACTS,
  VECTOR_NEXT_STEPS,
  VECTOR_VERDICTS,
  vectorBucketTexts,
  vectorVerdict,
} from "@/lib/console/vector-buckets-texts";

/**
 * Storage -> Vektor-Buckets (2.93) am Quelltext geprueft.
 *
 * Die Seite macht Aussagen ueber dieses Repository, und dieser Vertrag liest
 * die Stellen nach, ueber die sie redet. Er faellt, sobald eine Aussage nicht
 * mehr zur Lage passt: ein Image mit pgvector in einer Compose-Datei, eine
 * Migration, die einen Vektortyp anlegt, oder eine Route, die Einbettungen
 * entgegennimmt, macht die Seite zur Luege, und das soll auffallen und nicht
 * stillschweigend stehen bleiben.
 *
 * Was der Server wirklich anbietet, prueft dieser Vertrag nicht; das kann nur
 * ein Lauf gegen die echte Datenbank, und das ist der Fall (2.93) in
 * `tests/postgres.integration.test.ts`.
 */
const VIEW = "components/console/vector-buckets-view.tsx";
const TEXTS = "lib/console/vector-buckets-texts.ts";

async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

/** Dieselbe Datei ohne ihre Kommentare: gemeint ist der Code, nicht der Grund. */
async function code(file: string) {
  return (await source(file)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("console vector buckets view contract", () => {
  it("makes the page real and takes the placeholder claim off the navigation", async () => {
    expect(REAL_VIEWS).toContain("storage-vectors");
    expect(isPlaceholder("storage-vectors" as never)).toBe(false);
    expect("storage-vectors" in PLACEHOLDERS).toBe(false);

    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "storage-vectors": return <VectorBucketsView');

    // Das alte Versprechen steht nirgends mehr, in keiner Sprache.
    const claim = "Ablage für Embeddings mit Ähnlichkeitssuche.";
    expect(await source("components/console/navigation.ts")).not.toContain(claim);
    for (const locale of ["en", "fr", "it"] as const) {
      expect(CONSOLE_TRANSLATIONS[locale][claim]).toBeUndefined();
    }
  });

  it("reads and does not write", async () => {
    const view = await code(VIEW);
    expect(view).toContain("/schema/extensions");
    expect(view).toContain("/storage/buckets");
    for (const verb of ['method: "POST"', 'method: "PUT"', 'method: "PATCH"', 'method: "DELETE"']) {
      expect(view, verb).not.toContain(verb);
    }
  });

  it("keeps the claim about the image true: every compose file runs the same plain PostgreSQL image, none carries pgvector", async () => {
    const root = process.cwd();
    const files = (await readdir(root)).filter((name) => /^docker-compose.*\.ya?ml$/u.test(name));
    expect(files.length).toBeGreaterThanOrEqual(8);

    const withPostgres: string[] = [];
    for (const file of files) {
      const text = await readFile(path.join(root, file), "utf8");
      // Kein Image, das pgvector mitbraechte. Faellt dieser Fall, ist die
      // Seite ueberholt und nicht die Zusicherung falsch.
      expect(text.toLowerCase(), `${file}: ein Image mit pgvector`).not.toContain("pgvector");
      for (const match of text.matchAll(/^\s*image:\s*(\S+)\s*$/gmu)) {
        if (!match[1].startsWith("postgres")) continue;
        expect(match[1], `${file}: fremdes PostgreSQL-Image`).toBe("postgres:17-alpine");
        if (!withPostgres.includes(file)) withPostgres.push(file);
      }
    }
    // Der Satz auf der Seite nennt die Zahl. Sie steht hier und nicht im Kopf.
    expect(withPostgres).toHaveLength(6);
    expect(VECTOR_BUCKET_TEXTS.nextTitle.length).toBeGreaterThan(0);
    expect(VECTOR_NEXT_STEPS[0].body).toContain("Sechs Compose-Dateien");
    expect(VECTOR_NEXT_STEPS[0].body).toContain("postgres:17-alpine");
  });

  it("keeps the claim about QKERN true: no migration, no route and no service knows a vector", async () => {
    const migrations = path.resolve(process.cwd(), "db/migrations");
    for (const file of await readdir(migrations)) {
      const text = (await readFile(path.join(migrations, file), "utf8")).toLowerCase();
      for (const word of ["vector(", "embedding", "pgvector", "ivfflat", "hnsw"]) {
        expect(text, `${file}: ${word}`).not.toContain(word);
      }
    }
    // Und im Produktquelltext gibt es keine Route, die Einbettungen annimmt.
    const routes = path.resolve(process.cwd(), "app/api");
    const seen: string[] = [];
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (/vector|embedding/u.test(entry.name)) seen.push(full); await walk(full); }
      }
    };
    await walk(routes);
    expect(seen).toEqual([]);
  });

  it("derives its verdict from the catalogue and not from a fixed sentence", () => {
    expect(vectorVerdict(null, false)).toBe("missing");
    expect(vectorVerdict(null, true)).toBe("available");
    expect(vectorVerdict("0.8.0", true)).toBe("installed");
    // Auch der seltsame Fall bleibt eindeutig: installiert schlaegt angeboten.
    expect(vectorVerdict("0.8.0", false)).toBe("installed");
    for (const verdict of Object.values(VECTOR_VERDICTS)) {
      expect(verdict.label.length).toBeGreaterThan(10);
      expect(verdict.explains.length).toBeGreaterThan(80);
    }
  });

  it("holds its facts in one place, and the page takes them from there", async () => {
    expect(VECTOR_FACTS.extension).toBe("vector");
    expect(VECTOR_FACTS.fallbackExtension).toBe("cube");
    expect(VECTOR_FACTS.fallbackMaxDimensions).toBe(100);

    const view = await code(VIEW);
    // Kein Name und keine Zahl steht ein zweites Mal in der Ansicht.
    expect(view).toContain("VECTOR_FACTS.extension");
    expect(view).toContain("VECTOR_FACTS.fallbackExtension");
    expect(view).toContain("VECTOR_FACTS.fallbackMaxDimensions");
    expect(view).not.toMatch(/"vector"/u);
    expect(view).not.toMatch(/"cube"/u);

    // Jeder Text des Moduls geht durch den Uebersetzungsvertrag.
    const texts = vectorBucketTexts();
    expect(new Set(texts).size).toBe(texts.length);
    const module = await source(TEXTS);
    for (const text of texts) expect(module, text.slice(0, 40)).toContain(text);
  });
});
