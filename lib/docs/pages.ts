import { existsSync } from "node:fs";
import path from "node:path";
import { LOCALES, type Locale } from "@/lib/i18n/locales";

/**
 * Die Einstiegsdoku (2.30): fuenf Seiten, eine Quelle. Route, Seitenleiste,
 * INDEX-Block und Vertragstests lesen diese Liste; wer eine Seite ergaenzt,
 * ergaenzt sie hier und nirgends sonst. Die Dateinamen gelten in jeder Sprache.
 */
export type GuidePage = {
  /** Leer fuer die Startseite `/docs`. */
  readonly slug: "" | "schnellstart" | "erstes-backend" | "gruender" | "glossar";
  readonly file: string;
  /** Kurztitel fuer Seitenleiste und Metadaten, je Sprache. */
  readonly titles: Readonly<Record<Locale, string>>;
  readonly audience: "alle" | "A" | "B" | "C";
};

export const GUIDE_PAGES: readonly GuidePage[] = [
  {
    slug: "",
    file: "WAS_IST_QKERN.md",
    titles: { de: "Was ist QKERN", en: "What is QKERN", fr: "Qu'est-ce que QKERN", it: "Che cos'è QKERN" },
    audience: "alle",
  },
  {
    slug: "schnellstart",
    file: "SCHNELLSTART.md",
    titles: { de: "Schnellstart", en: "Quick start", fr: "Démarrage rapide", it: "Avvio rapido" },
    audience: "A",
  },
  {
    slug: "erstes-backend",
    file: "ERSTES_BACKEND.md",
    titles: { de: "Erstes Backend", en: "First backend", fr: "Premier backend", it: "Primo backend" },
    audience: "B",
  },
  {
    slug: "gruender",
    file: "FUER_GRUENDER.md",
    titles: { de: "Für Gründer", en: "For founders", fr: "Pour les fondateurs", it: "Per i fondatori" },
    audience: "C",
  },
  {
    slug: "glossar",
    file: "GLOSSAR.md",
    titles: { de: "Glossar", en: "Glossary", fr: "Glossaire", it: "Glossario" },
    audience: "alle",
  },
];

export function pageBySlug(slug: string): GuidePage | undefined {
  return GUIDE_PAGES.find((page) => page.slug === slug);
}

export function guideTitle(page: GuidePage, locale: Locale): string {
  return page.titles[locale];
}

export function guidePath(locale: Locale, page: GuidePage): string {
  return path.resolve(process.cwd(), "docs/guide", locale, page.file);
}

/**
 * Welche Sprachen schon Texte haben: alle fuenf Dateien liegen unter
 * `docs/guide/<sprache>/`. Eine halb fertige Sprache zaehlt nicht; die Website
 * zeigt dann Deutsch mit Hinweis.
 */
export function availableGuideLocales(): readonly Locale[] {
  return LOCALES.filter((locale) => GUIDE_PAGES.every((page) => existsSync(guidePath(locale, page))));
}
