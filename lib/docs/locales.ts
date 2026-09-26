import type { Locale } from "@/lib/i18n/locales";

/** Was die Vertraege je Sprache pruefen: Glossar-Einleitungen, Ueberschrift "Ehrlich offen", verbotene Floskeln. */
export type GuideLocaleText = Readonly<{
  leadIns: readonly [string, string, string];
  honest: string;
  banned: readonly string[];
}>;

const DASHES = ["—", "–"] as const;

export const GUIDE_LOCALE_TEXT: Readonly<Record<Locale, GuideLocaleText>> = {
  de: {
    leadIns: ["Was es ist:", "In QKERN:", "Bei Supabase:"],
    honest: "Ehrlich offen",
    banned: ["nahtlos", "robust", "leistungsstark", "revolutionär", "tauchen wir ein", "es ist wichtig zu beachten", "in der heutigen zeit", "spielt eine entscheidende rolle", "zusammenfassend", ...DASHES],
  },
  en: {
    leadIns: ["What it is:", "In QKERN:", "At Supabase:"],
    honest: "Honestly open",
    banned: ["seamless", "robust", "leverage", "delve", "let's dive in", "it's important to note", "in today's", "plays a crucial role", "in conclusion", ...DASHES],
  },
  fr: {
    leadIns: ["Ce que c'est :", "Dans QKERN :", "Chez Supabase :"],
    honest: "En toute franchise",
    banned: ["sans faille", "robuste", "plongeons", "il est important de noter", "joue un rôle crucial", "en conclusion", ...DASHES],
  },
  it: {
    leadIns: ["Che cos'è:", "In QKERN:", "In Supabase:"],
    honest: "In tutta franchezza",
    banned: ["senza soluzione di continuità", "robusto", "immergiamoci", "è importante notare", "gioca un ruolo cruciale", "in conclusione", ...DASHES],
  },
};
