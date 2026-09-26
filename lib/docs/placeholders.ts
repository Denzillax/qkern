import { readFile } from "node:fs/promises";
import path from "node:path";
import { LOCALES } from "@/lib/i18n/locales";
import { readArchivedManifests, summarizeCertification } from "@/lib/server/evidence/certification-summary";

/**
 * Zahlen der Einstiegsdoku (2.30) kommen aus denselben Quellen wie STATUS.md
 * und die Landing-Page. Ein Platzhalter, den niemand kennt, ist ein Fehler.
 */
export type GuidePlaceholders = Record<"version" | "node" | "postgresCases" | "stackCount" | "languageCount", string>;

export async function guidePlaceholders(): Promise<GuidePlaceholders> {
  const pkg = JSON.parse(await readFile(path.resolve(process.cwd(), "package.json"), "utf8")) as { version: string; engines?: { node?: string } };
  const summary = summarizeCertification(await readArchivedManifests());
  const postgres = summary.rows.find((row) => row.name === "Control Plane und Data API");
  return {
    version: pkg.version,
    node: (pkg.engines?.node ?? ">=24.7.0").replace(/^[^\d]*/, ""),
    postgresCases: String(postgres?.passed ?? 0),
    stackCount: String(summary.rows.length),
    languageCount: String(LOCALES.length),
  };
}

export function fillPlaceholders(text: string, values: GuidePlaceholders): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    // Object.hasOwn statt `in`: sonst wuerde {{toString}} still eine Funktion einsetzen.
    if (!Object.hasOwn(values, key)) throw new Error(`Unbekannter Platzhalter {{${key}}}`);
    return values[key as keyof GuidePlaceholders];
  });
}
