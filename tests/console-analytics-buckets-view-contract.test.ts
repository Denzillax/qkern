import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  ANALYTICS_BUCKET_TEXTS,
  ANALYTICS_FACTS,
  ANALYTICS_NEXT_STEPS,
  ANALYTICS_VERDICTS,
  analyticsBucketTexts,
  analyticsVerdict,
} from "@/lib/console/analytics-buckets-texts";
import { S3_DEFAULT_MAX_PUT_BYTES, S3_ENDPOINT_PATH } from "@/lib/server/project-storage/s3-endpoint";

/**
 * Storage -> Analytics-Buckets (2.99) am Quelltext geprueft.
 *
 * Die Seite macht Aussagen ueber dieses Repository, und dieser Vertrag liest
 * die Stellen nach, ueber die sie redet. Er faellt, sobald eine Aussage nicht
 * mehr zur Lage passt: eine Engine oder ein Katalogdienst in einer
 * Compose-Datei, eine Migration, die Namensraeume oder Tabellen fuer Iceberg
 * anlegt, eine Route, die die Iceberg-REST-Schnittstelle spricht, oder ein
 * S3-Endpunkt, der Multipart kann, macht die Seite zur Luege, und das soll
 * auffallen und nicht stillschweigend stehen bleiben.
 *
 * Was der Server wirklich anbietet, prueft dieser Vertrag nicht; das liest
 * die Seite bei jedem Oeffnen aus dem Katalog, und ein Fall gegen die echte
 * Datenbank gibt es dafuer nicht. Die Seite behauptet darum im Quelltext
 * nichts ueber das Image, und dieser Vertrag prueft, dass das so bleibt.
 */
const VIEW = "components/console/analytics-buckets-view.tsx";
const TEXTS = "lib/console/analytics-buckets-texts.ts";

async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

/** Dieselbe Datei ohne ihre Kommentare: gemeint ist der Code, nicht der Grund. */
async function code(file: string) {
  return (await source(file)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

async function walk(dir: string, visit: (full: string, name: string) => void) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { visit(full, entry.name); await walk(full, visit); }
  }
}

describe("console analytics buckets view contract", () => {
  it("makes the page real, takes the last placeholder off the navigation and leaves the table empty", async () => {
    expect(REAL_VIEWS).toContain("storage-analytics");
    expect(isPlaceholder("storage-analytics" as never)).toBe(false);
    expect("storage-analytics" in PLACEHOLDERS).toBe(false);
    // Der letzte Platzhalter: Die Tabelle ist leer, und die Ansicht dazu ist weg.
    expect(Object.keys(PLACEHOLDERS)).toEqual([]);
    const consoleDir = path.resolve(process.cwd(), "components/console");
    expect(await readdir(consoleDir)).not.toContain("placeholder-view.tsx");

    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "storage-analytics": return <AnalyticsBucketsView');
    expect(app).not.toContain("PlaceholderView");

    // Das alte Versprechen steht nirgends mehr, in keiner Sprache.
    const claim = "Spaltenorientierte Ablage für grosse Auswertungen (Iceberg).";
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
    // Und sie zieht keinen Servercode in den Browser: die Zahlen kommen aus dem Textmodul.
    expect(view).not.toContain("lib/server/");
  });

  it("keeps the claims about the S3 endpoint true: same path, same limit, multipart built and only UploadPartCopy left at 501", async () => {
    expect(ANALYTICS_FACTS.s3EndpointPath).toBe(S3_ENDPOINT_PATH);
    expect(ANALYTICS_FACTS.s3MaxPutMiB * 1024 * 1024).toBe(S3_DEFAULT_MAX_PUT_BYTES);
    const endpoint = await code("lib/server/project-storage/s3-endpoint.ts");
    // Schritt 2 der Seite ist seit 2.101 zur Haelfte erledigt: Multipart wird
    // angenommen, und was am Endpunkt noch mit 501 antwortet, ist UploadPartCopy.
    for (const operation of ["CreateMultipartUpload", "UploadPart", "CompleteMultipartUpload",
      "AbortMultipartUpload", "ListParts", "ListMultipartUploads"]) {
      expect(endpoint, operation).toContain(`kind: "${operation}"`);
    }
    expect(endpoint).toMatch(/x-amz-copy-source[\s\S]{0,200}NotImplemented[\s\S]{0,200}UploadPartCopy is not implemented/);
    // Was von Schritt 2 bleibt, ist der Scanner vor jeder Datei.
    expect(ANALYTICS_NEXT_STEPS[1].body).toContain("Scanner");
    expect(ANALYTICS_BUCKET_TEXTS.s3Meaning).toContain("Multipart");
  });

  it("keeps the claim about the stack true: no compose file runs an engine or a catalogue service", async () => {
    const root = process.cwd();
    const files = (await readdir(root)).filter((name) => /^docker-compose.*\.ya?ml$/u.test(name));
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const file of files) {
      const text = (await readFile(path.join(root, file), "utf8")).toLowerCase();
      for (const word of ["iceberg", "spark", "trino", "duckdb", "lakekeeper", "nessie", "polaris", "parquet"]) {
        expect(text, `${file}: ${word}`).not.toContain(word);
      }
    }
  });

  it("keeps the claim about QKERN true: no migration, no route and no service knows a catalogue, a namespace or a Parquet table", async () => {
    const migrations = path.resolve(process.cwd(), "db/migrations");
    for (const file of await readdir(migrations)) {
      const text = (await readFile(path.join(migrations, file), "utf8")).toLowerCase();
      for (const word of ["iceberg", "parquet", "analytics_bucket", "metadata_location", "lakehouse"]) {
        expect(text, `${file}: ${word}`).not.toContain(word);
      }
    }
    const seen: string[] = [];
    await walk(path.resolve(process.cwd(), "app/api"), (full, name) => {
      if (/iceberg|parquet|lakehouse|analytics-bucket/u.test(name)) seen.push(full);
    });
    await walk(path.resolve(process.cwd(), "lib/server"), (full, name) => {
      if (/iceberg|parquet|lakehouse/u.test(name)) seen.push(full);
    });
    expect(seen).toEqual([]);
  });

  it("derives its verdict from the catalogue and not from a fixed sentence", () => {
    expect(analyticsVerdict([]).id).toBe("missing");
    expect(analyticsVerdict([{ name: "vector", installedVersion: null }]).id).toBe("missing");
    expect(analyticsVerdict([{ name: "pg_parquet", installedVersion: null }]).id).toBe("available");
    expect(analyticsVerdict([{ name: "pg_parquet", installedVersion: null }, { name: "pg_duckdb", installedVersion: "0.3.0" }]))
      .toEqual({ id: "installed", found: [{ name: "pg_parquet", installedVersion: null }, { name: "pg_duckdb", installedVersion: "0.3.0" }] });
    for (const verdict of Object.values(ANALYTICS_VERDICTS)) {
      expect(verdict.label.length).toBeGreaterThan(10);
      expect(verdict.explains.length).toBeGreaterThan(80);
    }
    // Die Seite behauptet im Quelltext nichts ueber das Image; das Urteil
    // kommt aus dem Katalog. Ein fester Satz "das Image hat kein pg_parquet"
    // waere hier ohne Fall gegen die Datenbank eine Behauptung.
    for (const text of analyticsBucketTexts()) expect(text).not.toContain("postgres:17-alpine");
  });

  it("holds its facts in one place, and the page takes them from there", async () => {
    expect(ANALYTICS_FACTS.extensions.length).toBeGreaterThanOrEqual(5);
    expect(new Set(ANALYTICS_FACTS.extensions).size).toBe(ANALYTICS_FACTS.extensions.length);
    const view = await code(VIEW);
    expect(view).toContain("ANALYTICS_FACTS.s3EndpointPath");
    expect(view).toContain("ANALYTICS_FACTS.s3MaxPutMiB");
    expect(view).toContain("ANALYTICS_FACTS.extensions");
    expect(view).not.toMatch(/"\/s3"/u);
    expect(view).not.toMatch(/\b64\b/u);
    expect(view).not.toMatch(/"pg_parquet"/u);

    // Jeder Text des Moduls geht durch den Uebersetzungsvertrag.
    const texts = analyticsBucketTexts();
    expect(new Set(texts).size).toBe(texts.length);
    const module = await source(TEXTS);
    for (const text of texts) expect(module, text.slice(0, 40)).toContain(text);
  });
});
