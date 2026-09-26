import { readFile } from "node:fs/promises";
import type { Locale } from "@/lib/i18n/locales";
import { parseGuide, type GuideDocument } from "@/lib/docs/markdown";
import { availableGuideLocales, guidePath, type GuidePage } from "@/lib/docs/pages";
import { fillPlaceholders, guidePlaceholders } from "@/lib/docs/placeholders";

export type LoadedGuidePage = Readonly<{ page: GuidePage; locale: Locale; document: GuideDocument; translated: boolean }>;

/** Liest eine Seite; fehlt die Sprache (nicht alle fuenf Dateien da), kommt Deutsch mit `translated: false`. */
export async function loadGuidePage(locale: Locale, page: GuidePage): Promise<LoadedGuidePage> {
  const available: Locale = availableGuideLocales().includes(locale) ? locale : "de";
  const raw = await readFile(guidePath(available, page), "utf8");
  const filled = fillPlaceholders(raw, await guidePlaceholders());
  return { page, locale, document: parseGuide(filled), translated: available === locale };
}
