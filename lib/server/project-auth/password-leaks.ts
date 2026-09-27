import { createHash } from "node:crypto";

/**
 * Passwoerter gegen bekannte Lecks pruefen, offline (2.53).
 *
 * Warum das ein eigenes, reines Modul ist: Es ist der Teil dieses Slices mit
 * Sicherheitsgewicht, und er hat genau zwei Raender. Eine Pruefung, die zu
 * viel ablehnt, nimmt einem Nutzer ein Passwort weg, das niemand kennt; eine,
 * die zu wenig ablehnt, laesst ein bekanntes durch. Beides gehoert einzeln
 * geprueft: keine Datenbank, kein React, keine Farbe, kein Netz.
 *
 * **Kein fremder Dienst.** Der naheliegende Weg waere Have I Been Pwned: die
 * ersten fuenf Zeichen des SHA-1 hinschicken, die Antwort durchsehen. Das ist
 * k-Anonymitaet und technisch anstaendig — und es hiesse doch, dass jede
 * Registrierung jedes Kunden dieser Installation an einen fremden Host geht,
 * samt Zeitpunkt, Haeufigkeit und dem Hashpraefix. Diese Entscheidung darf
 * ein Backend nicht fuer seine Nutzer treffen. Also eine lokale Liste, im
 * Prozessspeicher, ohne einen einzigen ausgehenden Aufruf. Dieses Modul
 * importiert darum nichts ausser `node:crypto`.
 *
 * **Was verglichen wird.** Nie das Passwort, immer sein Digest. Eine Liste
 * traegt entweder vollstaendige Digests oder **Praefixe** davon — das ist das
 * Format, in dem die bekannten Listen ausgeliefert werden. Ein Treffer auf
 * einem Praefix ist streng genommen ein *moeglicher* Treffer: Bei 16 Hexzeichen
 * liegt die Wahrscheinlichkeit einer zufaelligen Kollision je Eintrag bei
 * 2^-64. Das ist die Genauigkeit, die das Format hergibt, und sie wird hier
 * nicht schoenergeredet.
 *
 * **Was eine Ablehnung verraet.** Dass dieses Passwort aus bekannten Lecks
 * stammt — nicht mehr. Nie, wie oft es vorkommt, nie, aus welchem Leck, nie,
 * welcher Eintrag getroffen hat. Die beiden ersten Angaben kennt dieses Modul
 * nicht einmal: In der Liste steht ein Digest und sonst nichts, kein Zaehler
 * und keine Herkunft. Der dritte Wert waere das Passwort selbst und verlaesst
 * dieses Modul nirgends — kein `console.*`, kein Fehlertext, kein Feld eines
 * Fehlers traegt ihn.
 */

/* ------------------------------------------------------------------ *
 * Die Einstellung je Projektumgebung
 * ------------------------------------------------------------------ */

/** Was eine Ablehnung sagen darf. */
export const PROJECT_AUTH_PASSWORD_NOTICES = ["named", "generic"] as const;
export type ProjectAuthPasswordNotice = (typeof PROJECT_AUTH_PASSWORD_NOTICES)[number];

export type ProjectAuthPasswordProtection = {
  /** Ob gegen die Liste geprueft wird. Vorgabe: nein. */
  leakedPasswordCheck: boolean;
  /** Ab welcher Laenge ein Passwort angenommen wird. */
  minLength: number;
  /** Ob die Ablehnung das Leck beim Namen nennt oder nur auf die Regeln zeigt. */
  notice: ProjectAuthPasswordNotice;
};

/**
 * Die untere Grenze der Mindestlaenge ist 12, weil der Dienst seit jeher
 * jedes Passwort unter 12 Zeichen abweist (`assertPassword`). Eine
 * Einstellung, die diese Zusage unterlaufen koennte, waere eine
 * Verschlechterung, die wie eine Einstellung aussieht.
 *
 * Die obere Grenze ist 128 und nicht 256: Bei 256 waere die einzige erlaubte
 * Laenge genau 256, weil der Dienst dort seine obere Grenze hat.
 */
export const PROJECT_AUTH_PASSWORD_MIN_LENGTH_BOUNDS = { min: 12, max: 128 } as const;

/**
 * Die Vorgaben. Die Pruefung ist **aus**, und das ist Absicht: Sie lehnt ein
 * Passwort ab, das ein Nutzer gerade gewaehlt hat, und dieses Verhalten soll
 * ein Betreiber einschalten, nicht geschenkt bekommen. Die Mindestlaenge
 * steht auf den 12 Zeichen, die ohnehin gelten.
 */
export const DEFAULT_PROJECT_AUTH_PASSWORD_PROTECTION: ProjectAuthPasswordProtection = {
  leakedPasswordCheck: false,
  minLength: 12,
  notice: "named",
};

/** Warum eine Einstellung abgelehnt wurde. Stabiler Schluessel, kein Satz. */
export type ProjectAuthPasswordProtectionRejection =
  | "not_an_object"
  | "unknown_field"
  | "check_not_a_boolean"
  | "min_length_not_an_integer"
  | "min_length_out_of_range"
  | "unknown_notice";

export type ProjectAuthPasswordProtectionParseResult =
  | { ok: true; protection: ProjectAuthPasswordProtection }
  | { ok: false; reason: ProjectAuthPasswordProtectionRejection; field: string };

const PROTECTION_FIELDS = ["leakedPasswordCheck", "minLength", "notice"] as const;

export function isProjectAuthPasswordNotice(value: unknown): value is ProjectAuthPasswordNotice {
  return typeof value === "string" &&
    (PROJECT_AUTH_PASSWORD_NOTICES as readonly string[]).includes(value);
}

/**
 * Prueft die ganze Einstellung. Alle drei Felder muessen dabei sein: Ein
 * Koerper, der nur den Schalter nennt, liesse offen, was mit Mindestlaenge und
 * Wortlaut geschehen soll, und "unveraendert lassen" waere eine Annahme. Die
 * Console schickt darum immer alle drei, so wie sie sie gelesen hat.
 */
export function parseProjectAuthPasswordProtection(
  value: unknown,
): ProjectAuthPasswordProtectionParseResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "not_an_object", field: "" };
  }
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!(PROTECTION_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, reason: "unknown_field", field: key };
    }
  }
  const { leakedPasswordCheck, minLength, notice } = input;
  if (typeof leakedPasswordCheck !== "boolean") {
    return { ok: false, reason: "check_not_a_boolean", field: "leakedPasswordCheck" };
  }
  if (typeof minLength !== "number" || !Number.isInteger(minLength)) {
    return { ok: false, reason: "min_length_not_an_integer", field: "minLength" };
  }
  if (minLength < PROJECT_AUTH_PASSWORD_MIN_LENGTH_BOUNDS.min ||
      minLength > PROJECT_AUTH_PASSWORD_MIN_LENGTH_BOUNDS.max) {
    return { ok: false, reason: "min_length_out_of_range", field: "minLength" };
  }
  if (!isProjectAuthPasswordNotice(notice)) {
    return { ok: false, reason: "unknown_notice", field: "notice" };
  }
  return { ok: true, protection: { leakedPasswordCheck, minLength, notice } };
}

/* ------------------------------------------------------------------ *
 * Die Liste
 * ------------------------------------------------------------------ */

export const PROJECT_AUTH_LEAK_ALGORITHMS = ["sha1", "sha256"] as const;
export type ProjectAuthLeakAlgorithm = (typeof PROJECT_AUTH_LEAK_ALGORITHMS)[number];

/** Wie viele Hexzeichen ein vollstaendiger Digest hat. */
const DIGEST_LENGTH: Record<ProjectAuthLeakAlgorithm, number> = { sha1: 40, sha256: 64 };

/**
 * Die Raender der Liste. Sie sind da, damit eine falsch gesetzte Datei nicht
 * den Prozess aufisst: Eine Liste ist eine Konfiguration, kein Datenbestand.
 *
 * 16 Hexzeichen sind 64 Bit und die untere Grenze eines brauchbaren
 * Praefixes; kuerzer waeren Kollisionen kein theoretisches Problem mehr.
 */
export const PROJECT_AUTH_LEAK_LIST_BOUNDS = {
  prefixLength: { min: 16, max: 64 },
  entries: 1_000_000,
  bytes: 16 * 1024 * 1024,
} as const;

/** Woher die geladene Liste stammt. */
export type ProjectAuthLeakListSource = "built_in" | "file";

export type ProjectAuthLeakList = {
  algorithm: ProjectAuthLeakAlgorithm;
  /** Wie viele Hexzeichen jeder Eintrag traegt; 40 oder 64 heisst "vollstaendig". */
  prefixLength: number;
  /** Die Eintraege, gross geschrieben. Nie ein Passwort, immer ein Digest. */
  digests: ReadonlySet<string>;
  entries: number;
  source: ProjectAuthLeakListSource;
};

/** Warum eine Listendatei nicht geladen werden konnte. */
export type ProjectAuthLeakListRejection =
  | "empty"
  | "too_large"
  | "too_many_entries"
  | "not_hex"
  | "mixed_prefix_length"
  | "prefix_too_short"
  | "prefix_too_long";

export type ProjectAuthLeakListParseResult =
  | { ok: true; list: ProjectAuthLeakList }
  | { ok: false; reason: ProjectAuthLeakListRejection; line: number };

/**
 * Der Kopf einer Zeile bis zum ersten Doppelpunkt. Die bekannten Listen
 * liefern `DIGEST:ANZAHL`; die Anzahl wird hier weggeworfen und nirgends
 * gespeichert, weil eine Ablehnung nie sagen soll, wie oft ein Passwort
 * vorkommt.
 */
const HEX = /^[0-9A-F]+$/;

/**
 * Liest eine Listendatei. Leerzeilen und Zeilen, die mit `#` beginnen, gelten
 * als Kommentar; jede uebrige Zeile ist ein Digest oder ein Praefix davon,
 * wahlweise gefolgt von `:` und einer Zahl, die ignoriert wird.
 *
 * Alle Eintraege muessen dieselbe Laenge haben. Das ist keine Schikane: Ein
 * Praefixvergleich braucht eine Laenge, und eine Datei mit gemischten Laengen
 * liesse offen, auf wie viele Zeichen gekuerzt verglichen werden soll. Lieber
 * eine klare Ablehnung als eine stille Entscheidung.
 */
export function parseProjectAuthLeakList(
  text: string,
  algorithm: ProjectAuthLeakAlgorithm,
  source: ProjectAuthLeakListSource = "file",
): ProjectAuthLeakListParseResult {
  if (Buffer.byteLength(text, "utf8") > PROJECT_AUTH_LEAK_LIST_BOUNDS.bytes) {
    return { ok: false, reason: "too_large", line: 0 };
  }
  const digests = new Set<string>();
  let prefixLength = 0;
  let lineNumber = 0;
  for (const raw of text.split(/\r?\n/)) {
    lineNumber += 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const entry = (trimmed.split(":", 1)[0] ?? "").toUpperCase();
    if (!HEX.test(entry)) return { ok: false, reason: "not_hex", line: lineNumber };
    if (entry.length < PROJECT_AUTH_LEAK_LIST_BOUNDS.prefixLength.min) {
      return { ok: false, reason: "prefix_too_short", line: lineNumber };
    }
    if (entry.length > DIGEST_LENGTH[algorithm]) {
      return { ok: false, reason: "prefix_too_long", line: lineNumber };
    }
    if (prefixLength === 0) prefixLength = entry.length;
    else if (entry.length !== prefixLength) {
      return { ok: false, reason: "mixed_prefix_length", line: lineNumber };
    }
    digests.add(entry);
    if (digests.size > PROJECT_AUTH_LEAK_LIST_BOUNDS.entries) {
      return { ok: false, reason: "too_many_entries", line: lineNumber };
    }
  }
  if (digests.size === 0) return { ok: false, reason: "empty", line: lineNumber };
  return { ok: true, list: { algorithm, prefixLength, digests, entries: digests.size, source } };
}

/* ------------------------------------------------------------------ *
 * Die eingebaute Liste
 * ------------------------------------------------------------------ */

/**
 * Die eingebaute Liste: **die 25 Eintraege der jaehrlich veroeffentlichten
 * Liste "Worst Passwords of the Year 2019" von SplashData**, in ihrer
 * Reihenfolge. Genau 25 Eintraege, keine erfundenen, keine ergaenzten.
 *
 * Warum so klein: Eine echte Leckliste ist Hunderte Megabyte gross. Sie in
 * dieses Repository zu legen waere eine Zusage, die niemand pflegen kann —
 * sie veraltet ab dem Tag des Commits, und sie machte jeden Checkout teuer.
 * Die eingebaute Liste ist darum nicht der Schutz, sondern die Zusicherung,
 * dass der Schalter ohne Konfiguration ein definiertes Verhalten hat.
 *
 * **Und jetzt die unbequeme Haelfte:** Alle 25 Eintraege sind kuerzer als die
 * 12 Zeichen, die QKERN ohnehin verlangt. Ohne Listendatei lehnt die Pruefung
 * darum nichts ab, was die Laengenregel nicht schon abgelehnt haette. Das
 * steht so auf der Console-Seite, im Handbuch und hier. Wer wirklich gegen
 * Lecks pruefen will, zeigt mit `QKERN_PROJECT_AUTH_LEAKED_PASSWORD_FILE` auf
 * eine Liste; die Alternative waere gewesen, laengere Eintraege zu erfinden
 * und eine Quelle zu behaupten, die es nicht gibt.
 */
export const PROJECT_AUTH_BUILT_IN_LEAKED_PASSWORDS: readonly string[] = [
  "123456", "123456789", "qwerty", "password", "1234567",
  "12345678", "12345", "iloveyou", "111111", "123123",
  "abc123", "qwerty123", "1q2w3e4r", "admin", "qwertyuiop",
  "654321", "555555", "lovely", "7777777", "welcome",
  "888888", "princess", "dragon", "password1", "123qwe",
];

/** Die Quelle der eingebauten Liste, im Klartext und nachpruefbar. */
export const PROJECT_AUTH_BUILT_IN_LEAK_SOURCE =
  "SplashData, Worst Passwords of the Year 2019, Rang 1 bis 25";

/**
 * Die eingebaute Liste als geladene Liste. Gerechnet wird sie einmal beim
 * ersten Zugriff; die Passwoerter selbst bleiben im Modul und gehen nie
 * hinaus — was herausgeht, sind ihre SHA-1-Digests.
 */
let builtIn: ProjectAuthLeakList | null = null;

export function projectAuthBuiltInLeakList(): ProjectAuthLeakList {
  builtIn ??= {
    algorithm: "sha1",
    prefixLength: DIGEST_LENGTH.sha1,
    digests: new Set(PROJECT_AUTH_BUILT_IN_LEAKED_PASSWORDS.map(
      (password) => projectAuthPasswordDigest(password, "sha1"),
    )),
    entries: PROJECT_AUTH_BUILT_IN_LEAKED_PASSWORDS.length,
    source: "built_in",
  };
  return builtIn;
}

/* ------------------------------------------------------------------ *
 * Die Entscheidung
 * ------------------------------------------------------------------ */

/**
 * Der Digest eines Passworts, gross geschrieben — das Format, in dem die
 * bekannten Listen ausgeliefert werden.
 */
export function projectAuthPasswordDigest(
  password: string,
  algorithm: ProjectAuthLeakAlgorithm,
): string {
  return createHash(algorithm).update(password, "utf8").digest("hex").toUpperCase();
}

/**
 * Ob dieses Passwort in der Liste steht. Absichtlich langweilig: Digest
 * rechnen, auf die Praefixlaenge der Liste kuerzen, nachschlagen.
 *
 * Kein Logging, kein Fehler, keine Ausgabe — die Funktion gibt einen
 * Wahrheitswert zurueck und sonst nichts. Alles andere waere ein Weg, auf dem
 * ein Passwort dieses Modul verlassen koennte.
 */
export function projectAuthPasswordIsLeaked(
  list: ProjectAuthLeakList,
  password: string,
): boolean {
  return list.digests.has(
    projectAuthPasswordDigest(password, list.algorithm).slice(0, list.prefixLength),
  );
}

/**
 * Was die Console ueber die geladene Liste erfahren darf: woher sie stammt und
 * wie viele Eintraege sie traegt. Nie ein Pfad, nie ein Eintrag.
 *
 * Kein Pfad, weil ein Dateipfad des Servers in der Console eines Kunden
 * nichts zu suchen hat; kein Eintrag, weil eine Liste von Digests bekannter
 * Passwoerter zwar kein Geheimnis ist, aber auch kein Inhalt einer
 * Verwaltungsseite.
 */
export type PublicProjectAuthLeakList = {
  source: ProjectAuthLeakListSource;
  algorithm: ProjectAuthLeakAlgorithm;
  prefixLength: number;
  entries: number;
  builtInEntries: number;
  builtInSource: string;
};

export function publicProjectAuthLeakList(list: ProjectAuthLeakList): PublicProjectAuthLeakList {
  return {
    source: list.source,
    algorithm: list.algorithm,
    prefixLength: list.prefixLength,
    entries: list.entries,
    builtInEntries: PROJECT_AUTH_BUILT_IN_LEAKED_PASSWORDS.length,
    builtInSource: PROJECT_AUTH_BUILT_IN_LEAK_SOURCE,
  };
}
