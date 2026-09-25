import path from "node:path";
import type { Locale } from "@/lib/i18n/locales";

/**
 * Die Einstiegsdoku (2.30): fuenf Seiten, eine Quelle. Route, Seitenleiste,
 * INDEX-Block und Vertragstests lesen diese Liste; wer eine Seite ergaenzt,
 * ergaenzt sie hier und nirgends sonst.
 */
export type GuidePage = {
  /** Leer fuer die Startseite `/docs`. */
  slug: "" | "schnellstart" | "erstes-backend" | "gruender" | "glossar";
  file: string;
  /** Kurztitel fuer Seitenleiste und Metadaten, deutsch; Uebersetzungen kommen mit den Texten. */
  title: string;
  audience: "alle" | "A" | "B" | "C";
};

export const GUIDE_PAGES: readonly GuidePage[] = [
  { slug: "", file: "WAS_IST_QKERN.md", title: "Was ist QKERN", audience: "alle" },
  { slug: "schnellstart", file: "SCHNELLSTART.md", title: "Schnellstart", audience: "A" },
  { slug: "erstes-backend", file: "ERSTES_BACKEND.md", title: "Erstes Backend", audience: "B" },
  { slug: "gruender", file: "FUER_GRUENDER.md", title: "Für Gründer", audience: "C" },
  { slug: "glossar", file: "GLOSSAR.md", title: "Glossar", audience: "alle" },
];

export function pageBySlug(slug: string): GuidePage | undefined {
  return GUIDE_PAGES.find((page) => page.slug === slug);
}

export function guidePath(locale: Locale, page: GuidePage): string {
  return path.resolve(process.cwd(), "docs/guide", locale, page.file);
}

/** Welche Sprachen schon Texte haben. Solange eine fehlt, zeigt die Website Deutsch mit Hinweis. */
export const GUIDE_LOCALES_AVAILABLE: readonly Locale[] = ["de"];
