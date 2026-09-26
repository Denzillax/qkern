import { readFile } from "node:fs/promises";
import path from "node:path";
import { LOCALES } from "@/lib/i18n/locales";
import { loadCertificationSummary, type CertificationSummary } from "@/lib/server/evidence/certification-summary";

/**
 * Zahlen der Einstiegsdoku (2.30) kommen aus denselben Quellen wie STATUS.md
 * und die Landing-Page. Ein Platzhalter, den niemand kennt, ist ein Fehler.
 * Fehlt eine Quelle, wirft der Build; eine Seite behauptet nie 0 Faelle.
 */
export type GuidePlaceholders = Readonly<Record<"version" | "node" | "postgresCases" | "stackCount" | "languageCount", string>>;

export type PackageInfo = { version: string; engines?: { node?: string } };

/** Austauschbare Quellen, damit Tests fehlende Angaben pruefen koennen. Standard: die echten Dateien. */
export type GuidePlaceholderDeps = {
  readPackage?: () => Promise<PackageInfo>;
  summary?: () => Promise<CertificationSummary>;
};

async function readPackageJson(): Promise<PackageInfo> {
  return JSON.parse(await readFile(path.resolve(process.cwd(), "package.json"), "utf8")) as PackageInfo;
}

export async function guidePlaceholders(deps: GuidePlaceholderDeps = {}): Promise<GuidePlaceholders> {
  const pkg = await (deps.readPackage ?? readPackageJson)();
  const summary = await (deps.summary ?? loadCertificationSummary)();
  const node = pkg.engines?.node;
  if (!node) throw new Error("package.json ohne engines.node");
  const postgres = summary.rows.find((row) => row.name === "Control Plane und Data API");
  if (!postgres) throw new Error("Kein gruener Nachweis fuer Control Plane und Data API in docs/evidence");
  return {
    version: pkg.version,
    node: node.replace(/^[^\d]*/, ""),
    postgresCases: String(postgres.passed),
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
