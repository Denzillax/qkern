import { createHash } from "node:crypto";

/**
 * Die Grenzen je Zeitfenster einer Projektumgebung (2.56).
 *
 * Warum das ein eigenes, reines Modul ist: Es ist der Teil dieses Slices mit
 * Sicherheitsgewicht. Eine Grenze, die zu frueh greift, sperrt einen echten
 * Nutzer aus; eine, die zu spaet greift, laesst ein Passwortraten durch.
 * Beide Fehler sind Entscheidungen an einem Rand, und ein Rand gehoert
 * einzeln geprueft: keine Datenbank, kein React, keine Farbe.
 *
 * Drei Begriffe, und der Unterschied traegt alles:
 *
 * - **Art** (`kind`): wovor die Grenze schuetzt. `sign_in` sind Anmeldeversuche,
 *   `mail` sind Magic Links und Passwort-Zuruecksetzungen, `refresh` sind
 *   Token-Erneuerungen.
 * - **Schluessel** (`subject`): wonach gezaehlt wird. Fuer `sign_in` und `mail`
 *   ist das die Identitaet, also die kanonische Adresse; fuer `refresh` die
 *   Sitzungsfamilie. Niemals eine IP-Adresse.
 * - **Fenster** (`windowSeconds`): ein festes Raster, kein gleitendes Fenster.
 *   Der Anfang eines Fensters ist `floor(t / w) * w`. Das ist die Eigenschaft,
 *   auf der alles Uebrige steht: Zwei Instanzen ohne jede Absprache rechnen
 *   denselben Fensteranfang aus und zaehlen darum in dieselbe Zeile. Ein
 *   gleitendes Fenster koennten sie nicht teilen, ohne sich zu einigen.
 *
 * Was hier **nicht** steht, ist ebenso wichtig: Der Schluessel wird gehasht,
 * bevor er das Modul verlaesst (`projectAuthRateSubjectHash`), und nur der
 * Hash wandert in die Datenbank. Eine Adresse steht damit nirgends in der
 * Zaehltabelle, und aus einer Zeile laesst sich nicht zuruecklesen, wer es
 * war — nur pruefen, ob eine vermutete Adresse es war.
 */

/** Wovor eine Grenze schuetzt. Drei Arten, mehr gibt es nicht. */
export const PROJECT_AUTH_RATE_LIMIT_KINDS = ["sign_in", "mail", "refresh"] as const;
export type ProjectAuthRateLimitKind = (typeof PROJECT_AUTH_RATE_LIMIT_KINDS)[number];

export type ProjectAuthRateLimit = {
  /** Wie viele Versuche ein Fenster hoechstens traegt. */
  max: number;
  /** Wie lang ein Fenster ist, in Sekunden. */
  windowSeconds: number;
};

export type ProjectAuthRateLimits = Record<ProjectAuthRateLimitKind, ProjectAuthRateLimit>;

/**
 * Beide Zahlen sind beidseitig begrenzt, und zwar in der Datenbank und hier.
 *
 * Die untere Grenze von `max` ist 1 und nicht 0: Eine Grenze von 0 hiesse
 * "niemand darf sich anmelden", und das ist keine Grenze, sondern ein
 * Ausschalter fuer die Anmeldung. Wer das will, schaltet Project Auth ab.
 *
 * Die untere Grenze des Fensters ist eine Minute, weil ein kuerzeres Fenster
 * gegen ein verteiltes Raten nichts ausrichtet und nur echte Nutzer trifft;
 * die obere ist ein Tag, weil ein laengeres Fenster einen Fehlversuch von
 * vorgestern gegen die Anmeldung von heute zaehlte.
 */
export const PROJECT_AUTH_RATE_LIMIT_BOUNDS = {
  max: { min: 1, max: 10_000 },
  windowSeconds: { min: 60, max: 86_400 },
} as const;

/**
 * Die Vorgaben. Sie sind bewusst genau das, was der Dienst vor 2.56 im
 * Prozessspeicher hielt — die Werte aendern sich nicht, nur der Ort, an dem
 * gezaehlt wird, und die Frage, wonach. Eine Umgebung ohne Zeile in
 * `project_auth_settings` verhaelt sich darum wie zuvor, nur wirksam ueber
 * mehr als eine Instanz.
 */
export const DEFAULT_PROJECT_AUTH_RATE_LIMITS: ProjectAuthRateLimits = {
  sign_in: { max: 10, windowSeconds: 15 * 60 },
  mail: { max: 5, windowSeconds: 60 * 60 },
  refresh: { max: 60, windowSeconds: 60 * 60 },
};

/**
 * Warum eine Grenze abgelehnt wurde. Der Schluessel ist stabil; die Console
 * uebersetzt ihn, die Route gibt ihn unveraendert heraus.
 */
export type ProjectAuthRateLimitRejection =
  | "not_an_object"
  | "unknown_kind"
  | "missing_kind"
  | "max_not_an_integer"
  | "max_out_of_range"
  | "window_not_an_integer"
  | "window_out_of_range";

export type ProjectAuthRateLimitParseResult =
  | { ok: true; limits: ProjectAuthRateLimits }
  | { ok: false; reason: ProjectAuthRateLimitRejection; field: string };

export function isProjectAuthRateLimitKind(value: unknown): value is ProjectAuthRateLimitKind {
  return typeof value === "string" &&
    (PROJECT_AUTH_RATE_LIMIT_KINDS as readonly string[]).includes(value);
}

/**
 * Prueft einen ganzen Satz Grenzen. Alle drei Arten muessen dabei sein: Ein
 * Koerper, der nur eine Art nennt, liesse offen, was mit den beiden anderen
 * geschehen soll, und "unveraendert lassen" waere eine Annahme. Die Console
 * schickt darum immer alle drei, so wie sie sie gelesen hat.
 */
export function parseProjectAuthRateLimits(value: unknown): ProjectAuthRateLimitParseResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "not_an_object", field: "" };
  }
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!isProjectAuthRateLimitKind(key)) return { ok: false, reason: "unknown_kind", field: key };
  }
  const limits = {} as ProjectAuthRateLimits;
  for (const kind of PROJECT_AUTH_RATE_LIMIT_KINDS) {
    const entry = input[kind];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, reason: "missing_kind", field: kind };
    }
    const { max, windowSeconds } = entry as Record<string, unknown>;
    if (typeof max !== "number" || !Number.isInteger(max)) {
      return { ok: false, reason: "max_not_an_integer", field: kind };
    }
    if (max < PROJECT_AUTH_RATE_LIMIT_BOUNDS.max.min || max > PROJECT_AUTH_RATE_LIMIT_BOUNDS.max.max) {
      return { ok: false, reason: "max_out_of_range", field: kind };
    }
    if (typeof windowSeconds !== "number" || !Number.isInteger(windowSeconds)) {
      return { ok: false, reason: "window_not_an_integer", field: kind };
    }
    if (windowSeconds < PROJECT_AUTH_RATE_LIMIT_BOUNDS.windowSeconds.min ||
        windowSeconds > PROJECT_AUTH_RATE_LIMIT_BOUNDS.windowSeconds.max) {
      return { ok: false, reason: "window_out_of_range", field: kind };
    }
    limits[kind] = { max, windowSeconds };
  }
  return { ok: true, limits };
}

/**
 * Der Anfang des Fensters, in dem `at` liegt. Ein festes Raster ab der Epoche,
 * damit zwei Instanzen ohne Absprache denselben Wert ausrechnen; das ist der
 * Grund, warum in der Datenbank zwei Instanzen dieselbe Zeile treffen.
 */
export function projectAuthRateWindowStart(at: Date, windowSeconds: number): Date {
  const step = windowSeconds * 1_000;
  return new Date(Math.floor(at.getTime() / step) * step);
}

/**
 * Die Entscheidung am Rand, und sie ist absichtlich langweilig: `count` ist
 * der Stand **nach** dem Hochzaehlen. Bei `max` = 3 sind die Versuche 1, 2
 * und 3 erlaubt und der vierte nicht. Genau an der Grenze wird noch
 * durchgelassen — die Grenze sagt, wie viele Versuche ein Fenster traegt,
 * nicht wie viele es weniger als traegt.
 */
export function projectAuthRateAllowed(input: { count: number; max: number }): boolean {
  return input.count <= input.max;
}

/**
 * Wie lange der Aufrufer warten muss, bis das Fenster wechselt. Nie unter
 * einer Sekunde: `Retry-After: 0` hiesse "sofort wieder", und das stimmt nie.
 */
export function projectAuthRateRetryAfterSeconds(input: {
  windowStart: Date;
  windowSeconds: number;
  at: Date;
}): number {
  const endsAt = input.windowStart.getTime() + input.windowSeconds * 1_000;
  return Math.max(1, Math.ceil((endsAt - input.at.getTime()) / 1_000));
}

/**
 * Der Schluessel, wie er in die Datenbank geht: ein Hash, nie der Wert selbst.
 *
 * Die Zaehltabelle traegt darum keine Adresse und keine Sitzungs-ID im
 * Klartext. Die Art geht in den Hash ein, damit derselbe Nutzer fuer
 * Anmeldung und Mail nicht dieselbe Zeile trifft, und der Scope ebenfalls,
 * damit zwei Projektumgebungen mit derselben Adresse nicht voneinander
 * abhaengen — obwohl der Scope ohnehin im Primaerschluessel steht, kostet das
 * nichts und macht den Hash allein schon eindeutig.
 *
 * Das ist ein Pseudonym, keine Anonymisierung: Wer eine Adresse vermutet,
 * kann sie nachrechnen. Mehr soll es auch nicht sein — die Tabelle muss
 * zaehlen koennen, und die Console bekommt diese Werte nie zu sehen.
 */
export function projectAuthRateSubjectHash(input: {
  organizationId: string;
  projectId: string;
  environment: string;
  kind: ProjectAuthRateLimitKind;
  subject: string;
}): string {
  return createHash("sha256")
    .update(`${input.organizationId}\n${input.projectId}\n${input.environment}\n${input.kind}\n${input.subject}`)
    .digest("base64url");
}
