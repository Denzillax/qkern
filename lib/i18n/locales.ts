/**
 * Sprachen der Website (2.2): Deutsch ist Standard, dazu Englisch,
 * Französisch und Italienisch. Die Wahl liegt in einem Cookie; beim ersten
 * Besuch entscheidet der Accept-Language-Header des Browsers.
 */
export const LOCALES = ["de", "en", "fr", "it"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "de";
export const LOCALE_COOKIE = "qkern_locale";

export const LOCALE_NAMES: Record<Locale, string> = { de: "Deutsch", en: "English", fr: "Français", it: "Italiano" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Wählt aus einem Accept-Language-Header die beste unterstützte Sprache. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag: tag.toLowerCase(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const entry of ranked) {
    const base = entry.tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** Ersetzt {name}-Platzhalter in einem übersetzten Text. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
