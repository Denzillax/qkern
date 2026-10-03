/**
 * Der Entwurf eines neuen Projekts (2.147), an einer Stelle.
 *
 * Dieses Modul ist rein: kein React, keine Datenbank, kein `fetch`. Die Route
 * `POST /api/v1/projects` nimmt eine Eingabe damit an, und die kleine Form im
 * Projektwechsler wendet dieselben Regeln schon vor dem Absenden an. Zwei
 * Pruefungen aus einer Quelle, damit die Oberflaeche nichts durchlaesst, was
 * der Server ablehnt, und nichts ablehnt, was er annehmen wuerde.
 *
 * ## Der Slug wird abgeleitet und nicht gefragt
 *
 * `projects` hat `UNIQUE (organization_id, slug)`. Die Eindeutigkeit gilt also
 * je Organisation und nicht global: Zwei Organisationen duerfen dasselbe
 * Projekt gleich nennen, und das ist richtig, denn der Slug ist kein
 * oeffentlicher Name. Wer den Slug selbst tippen koennte, muesste die Regel
 * kennen; abgeleitet aus dem Namen kennt sie das Programm.
 *
 * Die Bedingung traegt `deleted_at` nicht. Ein geloeschtes Projekt haelt
 * seinen Slug darum weiter besetzt, und der Grund der Ablehnung sagt das in
 * Worten, statt den Namen als frei zu behaupten.
 *
 * ## Die Region ist eine Liste von einem Eintrag
 *
 * QKERN fuehrt keinen Katalog von Regionen. Die Region ist der Text, der beim
 * Anlegen in die Projektzeile geschrieben wird; geprueft wird er gegen keinen
 * Standort, und es wird danach keine Hardware gewaehlt (so steht es auch unter
 * Einstellungen und im Bestellbeleg). Hier steht darum genau die eine Region,
 * die bestehende Projekte tragen, und nicht eine erfundene Auswahl aus acht
 * Staedten. Kommt eine zweite Region dazu, kommt sie hier dazu.
 */

/**
 * Die Regionen, die QKERN wirklich kennt. Eine, naemlich die der bestehenden
 * Projekte (`lib/server/store.ts`).
 */
export const PROJECT_REGIONS = ["ch-zrh-1"] as const;
export type ProjectRegion = (typeof PROJECT_REGIONS)[number];

/** Die kuerzeste und die laengste erlaubte Laenge des Namens. */
export const PROJECT_NAME_MIN = 2;
export const PROJECT_NAME_MAX = 60;

export const PROJECT_DRAFT_REASONS = {
  shape: "Aus dieser Eingabe lässt sich kein Projekt bauen.",
  name: "Ein Projektname braucht zwischen 2 und 60 Zeichen.",
  slug: "Aus diesem Namen lässt sich keine Kennung bilden. Er braucht mindestens einen Buchstaben oder eine Ziffer.",
  region: "Diese Region führt QKERN nicht.",
} as const;

export class ProjectDraftError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "ProjectDraftError";
  }
}

/** Ein geprüfter Entwurf: der Name, wie er dasteht, dazu Kennung und Region. */
export type ProjectDraft = {
  name: string;
  slug: string;
  region: ProjectRegion;
};

/**
 * Die Kennung aus dem Namen.
 *
 * Kleinbuchstaben, Ziffern und Striche. Alles andere wird ein Strich, Striche
 * am Rand und doppelte fallen weg. Umlaute werden zerlegt und ihre
 * Akzentzeichen entfernt (NFKD), damit aus "Müller Söhne" nicht
 * "m-ller-s-hne" wird: Ein Strich an der Stelle eines Buchstabens liest sich
 * wie ein Fehler.
 */
export function projectSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, PROJECT_NAME_MAX)
    .replace(/-+$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Nimmt eine Eingabe an oder lehnt sie mit einem Grund in Worten ab.
 *
 * Der Name wird an den Raendern beschnitten, aber nicht sonst veraendert: Was
 * jemand als Namen seines Projekts tippt, ist seine Sache. Nur die abgeleitete
 * Kennung folgt einer Regel.
 */
export function validateProjectDraft(input: unknown): ProjectDraft {
  if (!isRecord(input)) throw new ProjectDraftError(PROJECT_DRAFT_REASONS.shape);
  if (typeof input.name !== "string" || typeof input.region !== "string") {
    throw new ProjectDraftError(PROJECT_DRAFT_REASONS.shape);
  }
  const name = input.name.trim();
  if (name.length < PROJECT_NAME_MIN || name.length > PROJECT_NAME_MAX) {
    throw new ProjectDraftError(PROJECT_DRAFT_REASONS.name);
  }
  const slug = projectSlug(name);
  if (!slug) throw new ProjectDraftError(PROJECT_DRAFT_REASONS.slug);
  const region = PROJECT_REGIONS.find((candidate) => candidate === input.region);
  if (!region) throw new ProjectDraftError(PROJECT_DRAFT_REASONS.region);
  return { name, slug, region };
}
