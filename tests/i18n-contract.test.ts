import { describe, expect, it } from "vitest";
import { AUTH } from "@/lib/i18n/auth";
import { LANDING, formatDate } from "@/lib/i18n/landing";
import { DEFAULT_LOCALE, LOCALES, fill, negotiateLocale } from "@/lib/i18n/locales";

/**
 * Die Website spricht vier Sprachen (2.2). Der Vertrag: Jede Sprache hat
 * jeden Text, keiner ist leer, keiner ist nur die deutsche Vorlage, die
 * Platzhalter stimmen ueberein, und die Sprachwahl aus dem Browser faellt
 * auf Deutsch zurueck.
 */
type Leaf = { path: string; value: string };

// `names` ist je Sprache eine eigene Abbildung deutscher Manifest-Namen und
// darf verschieden lang sein; Deutsch braucht sie nicht.
function leaves(value: unknown, path = ""): Leaf[] {
  if (path === "names") return [];
  if (typeof value === "string") return [{ path, value }];
  if (Array.isArray(value)) return value.flatMap((entry, index) => leaves(entry, `${path}[${index}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, entry]) => leaves(entry, path ? `${path}.${key}` : key));
  return [];
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

// Wörter, die in jeder Sprache gleich bleiben dürfen: Eigennamen, Produktbegriffe, Codes.
const SHARED = new Set(["QKERN AI Bridge", "Free", "Pro", "Business", "Generated Data API", "Realtime", "Application API", "MCP Agent Interface", "Model Provider API", "Console", "AI Bridge", "SMTP", "Status", "Functions", "© 2026 QKERN. Product MVP.", "chg_8F2A", "Password", "Passwort"]);

describe("i18n contract", () => {
  it("has every landing and auth text in every locale, none empty", () => {
    const reference = leaves(LANDING.de).map((leaf) => leaf.path);
    for (const locale of LOCALES) {
      const found = leaves(LANDING[locale]);
      expect(found.map((leaf) => leaf.path), `Landing ${locale}: andere Struktur als Deutsch`).toEqual(reference);
      for (const leaf of found) expect(leaf.value.trim().length, `Landing ${locale}: ${leaf.path} ist leer`).toBeGreaterThan(0);
      const auth = leaves(AUTH[locale]);
      expect(auth.map((leaf) => leaf.path)).toEqual(leaves(AUTH.de).map((leaf) => leaf.path));
      for (const leaf of auth) expect(leaf.value.trim().length, `Auth ${locale}: ${leaf.path} ist leer`).toBeGreaterThan(0);
    }
  });

  it("translates instead of copying the German template", () => {
    const german = new Map(leaves(LANDING.de).map((leaf) => [leaf.path, leaf.value]));
    for (const locale of LOCALES) {
      if (locale === "de") continue;
      const copied = leaves(LANDING[locale]).filter((leaf) => !leaf.path.startsWith("names.") && !leaf.path.endsWith(".small") && !SHARED.has(leaf.value) && german.get(leaf.path) === leaf.value && leaf.value.length > 12 && !leaf.value.startsWith("#"));
      expect(copied.map((leaf) => `${leaf.path}: ${leaf.value}`), `${locale} kopiert Deutsch`).toEqual([]);
    }
  });

  it("keeps the same placeholders in every translation", () => {
    const german = new Map(leaves(LANDING.de).map((leaf) => [leaf.path, placeholders(leaf.value)]));
    for (const locale of LOCALES) {
      for (const leaf of leaves(LANDING[locale])) {
        expect(placeholders(leaf.value), `${locale} ${leaf.path}`).toEqual(german.get(leaf.path));
      }
    }
    expect(fill("{n} von {n}", { n: 160 })).toBe("160 von 160");
    expect(fill("{name} gegen {stack}", { name: "A", stack: "B" })).toBe("A gegen B");
  });

  it("negotiates the browser language and falls back to German", () => {
    expect(negotiateLocale("fr-CH,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(negotiateLocale("en-US,en;q=0.9,de;q=0.8")).toBe("en");
    expect(negotiateLocale("it-CH")).toBe("it");
    expect(negotiateLocale("es-ES,pt;q=0.8")).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("de;q=0.3,en;q=0.9")).toBe("en");
    expect(negotiateLocale(null)).toBe(DEFAULT_LOCALE);
  });

  it("formats evidence dates per language", () => {
    expect(formatDate("2026-09-24", "de")).toBe("24. September 2026");
    expect(formatDate("2026-09-24", "en")).toBe("September 24, 2026");
    expect(formatDate("2026-09-24", "fr")).toBe("24 septembre 2026");
    expect(formatDate("2026-09-24", "it")).toBe("24 settembre 2026");
  });
});
