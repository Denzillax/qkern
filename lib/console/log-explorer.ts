/**
 * Der Log-Explorer (2.65): eine Suche ueber die Log-Quellen, die es wirklich
 * gibt.
 *
 * ## Was der Platzhalter versprochen hat und warum es so nicht gebaut wird
 *
 * Die Platzhalterseite sagte „Logs mit SQL durchsuchen, speichern, als Vorlage
 * ablegen". Eingeloest wird davon die Suche und das Speichern; **nicht** das
 * SQL. Der Grund steht in der Ablage der Daten.
 *
 * Jede log-artige Quelle von QKERN liegt in der **Control Plane**: das
 * Auth-Protokoll in `audit_logs`, das Aufrufprotokoll in
 * `project_function_invocations`, der Stand der Speicherobjekte in
 * `project_storage_objects`, die Zustellungen in
 * `project_webhook_deliveries`, die Nutzung in den Usage-Tabellen. In der
 * Control Plane stehen die Zeilen **aller** Mandanten in denselben Tabellen,
 * getrennt allein durch `organization_id` und die Policies darueber.
 *
 * Der SQL-Editor der Console laeuft nicht dort. Er laeuft ueber
 * `environments/{environment}/query` gegen die **Projektdatenbank** — eine
 * eigene Datenbank je Projekt, in der nur die Daten dieses Projekts liegen.
 * Ein freier SQL-Weg dorthin ist vertretbar, weil das Schlimmste, was eine
 * falsche Abfrage sieht, die eigenen Daten sind.
 *
 * Dieselbe Flaeche ueber die Control Plane zu oeffnen waere etwas voellig
 * anderes: Ein Aufrufer mit Console-Rechten koennte `audit_logs` ohne
 * `WHERE organization_id` lesen, und die Trennung der Mandanten haenge dann an
 * einer Policy, die eine einzige `SECURITY DEFINER`-Funktion oder ein
 * vergessenes `FORCE ROW LEVEL SECURITY` aushebelt. Die Seite gaebe im
 * Fehlerfall jede fremde Zeile heraus, und niemand saehe es der Abfrage an.
 * Darum wird dieser Weg nicht gebaut, und die Ansicht sagt das woertlich.
 *
 * ## Was stattdessen gebaut ist
 *
 * Eine **strukturierte** Suche: Zeitraum, Quellen, ein paar getypte Filter je
 * Quelle. Beantwortet wird sie, indem der Server die Leseweg faechert, die es
 * fuer jede Quelle ohnehin schon gibt — dieselben Dienste, dieselben
 * Zugangspruefungen, dieselben Projektionen —, und die Ergebnisse zu **einer**
 * geordneten Liste zusammenfuehrt. Es entsteht keine neue Lesestelle: Wer eine
 * Quelle heute nicht lesen darf, sieht sie auch hier nicht.
 *
 * ## Warum nur drei Quellen in der Liste stehen
 *
 * Eine Quelle kommt in die gemischte Liste, wenn es fuer sie eine Leseroute
 * **ueber die ganze Umgebung** gibt und wenn ihre Zeilen Ereignisse mit einem
 * Zeitpunkt sind. Das trifft auf drei zu. Die uebrigen stehen in
 * `LOG_EXPLORER_OUT_OF_REACH`, mit dem Grund — nicht weil sie vergessen
 * wurden, sondern weil ein Suchfeld ueber ihnen eine Zusage waere, die die
 * Fläche nicht haelt.
 */

/** Die Quellen, die der Explorer wirklich mischt. */
export const LOG_EXPLORER_SOURCES = [
  "auth_audit", "function_invocations", "storage_objects",
] as const;
export type LogExplorerSourceId = (typeof LOG_EXPLORER_SOURCES)[number];

export type LogExplorerSourceDefinition = Readonly<{
  id: LogExplorerSourceId;
  label: string;
  /** Die vorhandene Leseroute, relativ zur Umgebung. Keine neue. */
  route: string;
  /** Welche Rolle sie heute schon verlangt. */
  capability: string;
  /** Was eine Zeile dieser Quelle ist — und was sie nicht ist. */
  meaning: string;
}>;

export const LOG_EXPLORER_SOURCE_DEFINITIONS:
Readonly<Record<LogExplorerSourceId, LogExplorerSourceDefinition>> = Object.freeze({
  auth_audit: Object.freeze({
    id: "auth_audit",
    label: "Auth-Protokoll",
    route: "auth/admin/audit",
    capability: "project_auth_admin",
    meaning: "Jede Handlung der Projekt-Anmeldung als eigener Eintrag: Anmeldung, Abmeldung, Sitzungsentzug, Änderung an einem Konto. Die Referenz ist bereinigt; eine Adresse und ein Token können dort nicht stehen.",
  }),
  function_invocations: Object.freeze({
    id: "function_invocations",
    label: "Function-Aufrufe",
    route: "compute/invocations",
    capability: "project_compute_admin",
    meaning: "Je Aufruf ein Eintrag mit Beginn, Dauer, Ausgang und entweder einem HTTP-Status oder einem festen Fehlercode. Nicht die Ausgabe des Containers: QKERN speichert sie nicht.",
  }),
  storage_objects: Object.freeze({
    id: "storage_objects",
    label: "Stand der Speicherobjekte",
    route: "storage/objects",
    capability: "project_storage_admin",
    meaning: "Kein Protokoll, sondern der heutige Stand je Objekt mit dem letzten Urteil des Scanners. Gesucht wird über den Zeitpunkt der Anlage; wer ein Objekt wann gelesen hat, steht nirgends.",
  }),
});

/** Was der Explorer ausdruecklich nicht erreicht, und warum. */
export const LOG_EXPLORER_OUT_OF_REACH: ReadonlyArray<Readonly<{
  label: string; reason: string;
}>> = Object.freeze([
  Object.freeze({
    label: "Webhook-Zustellungen",
    reason: "Lesbar nur je Webhook, über dessen eigene Route. Eine Leseroute über alle Webhooks einer Umgebung gibt es nicht, und der Explorer erfindet sich keine.",
  }),
  Object.freeze({
    label: "Nutzung je Zeitfenster",
    reason: "Aggregierte Eimer, keine Ereignisse. Ein Eimer hat keinen Zeitpunkt, an dem etwas passiert wäre, und stünde in einer gemischten Liste an einer erfundenen Stelle.",
  }),
  Object.freeze({
    label: "Cron-Vorkommen",
    reason: "Kein gespeichertes Log. Es wird bei jeder Anfrage aus dem Ausdruck und dem Dedupe-Fenster rekonstruiert, je Cron-Eintrag; der Zustand eines Vorkommens ändert sich danach noch.",
  }),
  Object.freeze({
    label: "Ausgabe eines Function-Containers",
    reason: "Wird nicht gespeichert. Migration 0045 hält stdout und stderr bewusst nicht; im Fehlerfall steht dort ein fester Code, nie ein Text.",
  }),
  Object.freeze({
    label: "Postgres-, Pooler-, Realtime- und API-Gateway-Log",
    // Berichtigt in 2.84: Drei dieser vier Seiten sind keine Platzhalter mehr,
    // und bei zweien fehlt nicht das Backend, sondern die Sache selbst. Der
    // Grund musste deshalb je Quelle einzeln stimmen.
    reason: "Für keine dieser vier Quellen gibt es eine Leseroute über die ganze Umgebung. Das Serverlog von Postgres liegt neben dem Datenverzeichnis, auf das QKERN keinen Zugriff hat; einen Pooler und einen protokollierenden Rand gibt es gar nicht; und für Realtime fehlt das Backend.",
  }),
]);

/** Die Ehrlichkeitssaetze der Ansicht. */
export const LOG_EXPLORER_NOT_SQL =
  "Dies ist keine SQL-Abfrage über Ihre Logs. Es ist eine strukturierte Suche: Zeitraum, Quelle und ein paar getypte Filter, beantwortet über genau die Leserouten, die es für jede Quelle schon gibt.";

export const LOG_EXPLORER_WHY_NOT_SQL =
  "Freies SQL gibt es hier bewusst nicht. Alle log-artigen Zeilen von QKERN liegen in der Control Plane, und dort stehen die Zeilen aller Organisationen in denselben Tabellen. Eine Abfragefläche darüber hinge mit jeder Zeile an einer einzigen Policy; fiele die aus, gäbe die Seite fremde Zeilen heraus, ohne dass es der Abfrage anzusehen wäre. Der SQL-Editor der Console läuft nicht in der Control Plane, sondern in Ihrer Projektdatenbank, und das bleibt so.";

export const LOG_EXPLORER_SAME_DOOR =
  "Jede Quelle wird durch ihre eigene, vorhandene Tür gelesen. Wer eine Quelle heute nicht lesen darf, bekommt sie auch hier nicht: Sie erscheint dann als nicht erreichbar, und die übrigen bleiben nutzbar.";

export const LOG_EXPLORER_ORDER =
  "Gemischt wird nach Zeitpunkt, neueste zuerst. Zwei Einträge derselben Mikrosekunde ordnet die Quelle und danach die Kennung, damit dieselbe Suche zweimal dieselbe Reihenfolge ergibt.";

export const LOG_EXPLORER_BUDGET =
  "Je Quelle liest der Explorer eine begrenzte Zahl an Seiten. Reicht das Budget für einen Zeitraum nicht, sagt die Quelle das ausdrücklich, statt eine vollständige Antwort vorzutäuschen.";

export const LOG_EXPLORER_SAVED =
  "Eine gespeicherte Suche hält den strukturierten Filter, nie eine Abfrage. Sie liegt in der Ablage dieses Browsers, je Projekt und Umgebung — sie verlässt dieses Gerät nicht und wird mit niemandem geteilt.";

/** Zustaende einer Quelle in der Antwort. */
export const LOG_EXPLORER_SOURCE_STATES = Object.freeze({
  ok: "Gelesen.",
  forbidden: "Für diese Anmeldung nicht lesbar. Die Quelle verlangt ihre eigene Rolle, und die Suche umgeht sie nicht.",
  unavailable: "Der Dienst hinter dieser Quelle ist abgeschaltet oder gerade nicht erreichbar.",
  truncated: "Gelesen, aber das Leserbudget war vor dem Ende des Zeitraums erschöpft. Ältere Einträge dieser Quelle fehlen.",
  failed: "Diese Quelle hat nicht geantwortet. Die übrigen stehen trotzdem in der Liste.",
});
export type LogExplorerSourceState = keyof typeof LOG_EXPLORER_SOURCE_STATES;

/** Ein gemischter Eintrag. Jede Quelle liefert dieselben sechs Felder. */
export type LogExplorerEntry = Readonly<{
  source: LogExplorerSourceId;
  /** Eindeutig innerhalb der Quelle. */
  id: string;
  /** ISO-8601, der Zeitpunkt, nach dem gemischt wird. */
  at: string;
  /** Was passiert ist. */
  action: string;
  /** Worum es ging. */
  subject: string;
  outcome: "ok" | "failed" | "pending";
  /** Ein kurzer getypter Zusatz: Status, Code, Grösse. Nie eine Nutzlast. */
  detail: string;
}>;

export const LOG_EXPLORER_OUTCOMES = Object.freeze({
  ok: "Erfolgreich",
  failed: "Fehlgeschlagen",
  pending: "Offen",
});

/**
 * Die Ordnung der gemischten Liste.
 *
 * Absteigend nach Zeit, danach nach Quelle, danach nach Kennung. Die beiden
 * Nachrangigen sind kein Beiwerk: Ohne sie waere die Reihenfolge zweier
 * Eintraege derselben Mikrosekunde von der Antwortzeit zweier Dienste
 * abhaengig, und dieselbe Suche gaebe zweimal eine andere Seite zurueck --
 * beim Blaettern hiesse das, einen Eintrag doppelt zu sehen und einen nie.
 */
export function compareLogExplorerEntries(a: LogExplorerEntry, b: LogExplorerEntry): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * Ein Zeitpunkt in genau einer Schreibweise: `YYYY-MM-DDTHH:mm:ss.sssZ`.
 *
 * Die feste Breite ist keine Kosmetik, sondern die Bedingung dafuer, dass der
 * Vergleich zweier Zeichenketten dieselbe Ordnung ergibt wie der Vergleich
 * zweier Zeitpunkte. Die Quellen liefern uneinheitlich: Das Aufrufprotokoll
 * gibt `started_at::text` heraus, die Audit-Kette ein ISO-Datum mit oder ohne
 * Millisekunden. Blieben beide Formen stehen, waere
 * `2026-01-01T00:00:00.500Z` lexikografisch **kleiner** als
 * `2026-01-01T00:00:00Z` -- der Punkt steht vor dem Z -- und das Blaettern
 * uebersprunge Eintraege.
 *
 * Die Zone ist dabei der heikle Teil. `timestamptz::text` schreibt den Versatz
 * **zweistellig**, wenn er auf volle Stunden faellt: `2026-09-27 08:23:40.35+00`,
 * nicht `+00:00`. Eine Pruefung, die nur vier Ziffern kennt, haelt das fuer eine
 * Zeit ohne Zone, haengt ein `Z` an und erzeugt `...+00Z` -- ein ungueltiges
 * Datum. Genau daran ist der Fall (2.65) gescheitert: Die Quelle warf, der
 * Faecher meldete sie als `failed`, und die gemischte Liste zeigte stumm nur
 * die Haelfte ihrer Zeilen. Erkannt werden darum alle drei Schreibweisen des
 * Versatzes, und `Z` kommt nur an eine Zeit, die wirklich keine Zone traegt.
 */
const ZONE = /(Z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * Bringt die Schreibweise einer Quelle in die Form, die `new Date` nach Norm
 * liest: `T` zwischen Datum und Zeit, und ein Versatz mit vier Ziffern.
 *
 * Das Auffuellen des Versatzes ist kein Schoenheitsschritt. `+00` ist nach
 * ECMA-262 kein gueltiger Versatz, und die Laufzeit antwortet darauf mit
 * `Invalid Date` -- nicht mit einem Fehler, den man an der Zeichenkette saehe.
 */
function normaliseMoment(value: string): string {
  const text = value.replace(" ", "T");
  const zone = ZONE.exec(text);
  if (zone === null) return `${text}Z`;
  if (zone[1] === "Z") return text;
  const digits = zone[1].slice(1).replace(":", "");
  const full = digits.length === 2 ? `${digits}00` : digits;
  return `${text.slice(0, text.length - zone[1].length)}${zone[1][0]}${full.slice(0, 2)}:${full.slice(2)}`;
}

export function logExplorerMoment(value: string | Date): string {
  const at = value instanceof Date ? value : new Date(normaliseMoment(value));
  if (Number.isNaN(at.getTime())) throw new LogExplorerError("INVALID_RANGE");
  return at.toISOString();
}

const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isLogExplorerMoment(value: string): boolean {
  return MOMENT.test(value);
}

/** Der Platz eines Eintrags in der Gesamtordnung, als Zeichenkette. */
export function logExplorerCursor(entry: LogExplorerEntry): string {
  return `${entry.at}|${entry.source}|${entry.id}`;
}

const CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|[a-z_]{1,40}\|[^|]{1,200}$/;

export function isLogExplorerCursor(value: string): boolean {
  return CURSOR.test(value);
}

/**
 * Steht der Eintrag in der Gesamtordnung **hinter** dem Cursor?
 *
 * Verglichen wird mit demselben `compareLogExplorerEntries`, nach dem auch
 * sortiert wird. Ein blosser Zeichenkettenvergleich der beiden Cursor waere
 * falsch, und zwar unauffaellig falsch: Die Zeit ordnet absteigend, Quelle und
 * Kennung ordnen aufsteigend, und eine einzige Zeichenkette kann nicht beides.
 * Bei zwei Eintraegen derselben Mikrosekunde verschwaende die falsche Fassung
 * den einen und zeigte den anderen zweimal.
 */
export function isAfterLogExplorerCursor(entry: LogExplorerEntry, cursor: string): boolean {
  const at = cursor.slice(0, 24);
  const rest = cursor.slice(25);
  const separator = rest.indexOf("|");
  const marker = {
    source: rest.slice(0, separator) as LogExplorerSourceId,
    id: rest.slice(separator + 1),
    at, action: "", subject: "", outcome: "ok" as const, detail: "",
  };
  return compareLogExplorerEntries(entry, marker) > 0;
}

/**
 * Mischt die Seiten der Quellen zu einer Seite.
 *
 * Drei Zusicherungen, und alle drei haben einen Grund im Betrieb:
 *
 * 1. **Stabile Ordnung.** Siehe `compareLogExplorerEntries`.
 * 2. **Blaettern ueber Quellen hinweg.** `before` ist der Cursor des letzten
 *    gezeigten Eintrags. Genommen wird nur, was in der Gesamtordnung strikt
 *    dahinter liegt -- nicht „aelter als dieser Zeitpunkt", denn das liesse
 *    die uebrigen Eintraege derselben Mikrosekunde verschwinden.
 * 3. **Eine gescheiterte Quelle nimmt die anderen nicht mit.** Diese Funktion
 *    sieht nur die Seiten, die es gegeben hat; wer nichts geliefert hat,
 *    liefert hier auch keine Ausnahme.
 */
export function mergeLogExplorerPages(
  pages: ReadonlyArray<readonly LogExplorerEntry[]>,
  input: { limit: number; before?: string | null },
): Readonly<{ entries: readonly LogExplorerEntry[]; hasMore: boolean; nextCursor: string | null }> {
  const limit = Number.isSafeInteger(input.limit) && input.limit > 0 ? input.limit : 1;
  const before = input.before ?? null;
  const seen = new Set<string>();
  const all: LogExplorerEntry[] = [];
  for (const page of pages) {
    for (const entry of page) {
      const key = `${entry.source}|${entry.id}`;
      // Dieselbe Zeile zweimal ist moeglich, wenn eine Quelle beim Blaettern
      // eine Seite ueberlappt. Gezeigt wird sie einmal.
      if (seen.has(key)) continue;
      if (before !== null && !isAfterLogExplorerCursor(entry, before)) continue;
      seen.add(key);
      all.push(entry);
    }
  }
  all.sort(compareLogExplorerEntries);
  const entries = all.slice(0, limit);
  const last = entries.at(-1);
  return Object.freeze({
    entries: Object.freeze(entries),
    hasMore: all.length > limit,
    nextCursor: all.length > limit && last ? logExplorerCursor(last) : null,
  });
}

/** Die Gruende, aus denen eine Suche abgewiesen wird. */
export const LOG_EXPLORER_REASONS = {
  UNKNOWN_PARAMETER: "Diese Suche kennt den Parameter nicht. Es gibt nur Zeitraum, Quellen, Seitengrösse, Cursor und die getypten Filter der gewählten Quellen.",
  UNKNOWN_SOURCE: "Diese Quelle steht nicht auf der Liste. Es gibt nur die Quellen, für die eine Leseroute über die ganze Umgebung besteht.",
  INVALID_RANGE: "Der Zeitraum passt nicht: erwartet werden zwei ISO-8601-Zeitpunkte, und der Beginn muss vor dem Ende liegen.",
  INVALID_FILTER: "Dieser Filterwert passt nicht zu seiner Quelle.",
  INVALID_LIMIT: "Die Seitengrösse liegt ausserhalb von 1 bis 100.",
  INVALID_CURSOR: "Der Cursor stammt nicht aus einer Antwort dieser Suche.",
} as const;
export type LogExplorerReasonCode = keyof typeof LOG_EXPLORER_REASONS;

/** Die getypten Filter je Quelle. Eine feste Liste, kein freies Feld. */
export const LOG_EXPLORER_FILTERS = Object.freeze({
  authStatus: Object.freeze({
    source: "auth_audit" as const, label: "Ausgang der Handlung",
    values: Object.freeze(["succeeded", "failed"]),
  }),
  authActor: Object.freeze({
    source: "auth_audit" as const, label: "Art des Akteurs",
    values: Object.freeze(["app_user", "admin", "system"]),
  }),
  outcome: Object.freeze({
    source: "function_invocations" as const, label: "Ausgang des Aufrufs",
    values: Object.freeze(["completed", "failed"]),
  }),
  objectStatus: Object.freeze({
    source: "storage_objects" as const, label: "Urteil des Scanners",
    values: Object.freeze(["quarantined", "clean", "infected"]),
  }),
});
export type LogExplorerFilterId = keyof typeof LOG_EXPLORER_FILTERS;

export const LOG_EXPLORER_FILTER_IDS =
  Object.keys(LOG_EXPLORER_FILTERS) as readonly LogExplorerFilterId[];

export type LogExplorerQuery = Readonly<{
  sources: readonly LogExplorerSourceId[];
  from: string | null;
  to: string | null;
  limit: number;
  before: string | null;
  filters: Readonly<Partial<Record<LogExplorerFilterId, string>>>;
}>;

export class LogExplorerError extends Error {
  readonly code: LogExplorerReasonCode;
  readonly reason: string;

  constructor(code: LogExplorerReasonCode) {
    super(`LOG_EXPLORER_REJECTED:${code}`);
    this.name = "LogExplorerError";
    this.code = code;
    this.reason = LOG_EXPLORER_REASONS[code];
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * Macht aus rohen Parametern eine Suche -- oder wirft.
 *
 * Geprueft wird **vor** jedem Dienstaufruf, und ein unbekannter Name ist ein
 * Fehler, keine stille Auslassung: Ein Tippfehler in einem Filter waere sonst
 * eine Suche ohne diesen Filter, und die Antwort saehe richtig aus.
 */
export function parseLogExplorerQuery(
  raw: Readonly<Record<string, string>>,
): LogExplorerQuery {
  const known = new Set<string>(["sources", "from", "to", "limit", "before",
    ...LOG_EXPLORER_FILTER_IDS]);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) throw new LogExplorerError("UNKNOWN_PARAMETER");
  }

  const sources: LogExplorerSourceId[] = [];
  if (raw.sources !== undefined) {
    for (const candidate of raw.sources.split(",")) {
      if (!(LOG_EXPLORER_SOURCES as readonly string[]).includes(candidate)) {
        throw new LogExplorerError("UNKNOWN_SOURCE");
      }
      if (!sources.includes(candidate as LogExplorerSourceId)) {
        sources.push(candidate as LogExplorerSourceId);
      }
    }
    if (sources.length === 0) throw new LogExplorerError("UNKNOWN_SOURCE");
  }
  // Die Reihenfolge folgt der festen Liste, nicht der Eingabe.
  const chosen = sources.length === 0
    ? [...LOG_EXPLORER_SOURCES]
    : LOG_EXPLORER_SOURCES.filter((source) => sources.includes(source));

  if ((raw.from !== undefined && !ISO.test(raw.from)) ||
      (raw.to !== undefined && !ISO.test(raw.to))) {
    throw new LogExplorerError("INVALID_RANGE");
  }
  // Beide Grenzen in dieselbe Schreibweise wie jeder Eintrag, sonst
  // vergliche der Zeitraum Zeichenketten unterschiedlicher Breite.
  const from = raw.from === undefined ? null : logExplorerMoment(raw.from);
  const to = raw.to === undefined ? null : logExplorerMoment(raw.to);
  if (from !== null && to !== null && from >= to) throw new LogExplorerError("INVALID_RANGE");

  const limit = raw.limit === undefined ? 50 : Number(raw.limit);
  if (!/^\d{1,3}$/.test(raw.limit ?? "50") || !Number.isSafeInteger(limit) ||
      limit < 1 || limit > 100) {
    throw new LogExplorerError("INVALID_LIMIT");
  }

  const before = raw.before ?? null;
  if (before !== null && !isLogExplorerCursor(before)) {
    throw new LogExplorerError("INVALID_CURSOR");
  }

  const filters: Partial<Record<LogExplorerFilterId, string>> = {};
  for (const id of LOG_EXPLORER_FILTER_IDS) {
    const value = raw[id];
    if (value === undefined) continue;
    const definition = LOG_EXPLORER_FILTERS[id];
    // Ein Filter ohne seine Quelle ist eine Suche, die nichts bedeutet.
    if (!chosen.includes(definition.source) ||
        !(definition.values as readonly string[]).includes(value)) {
      throw new LogExplorerError("INVALID_FILTER");
    }
    filters[id] = value;
  }

  return Object.freeze({
    sources: Object.freeze(chosen),
    from, to, limit, before,
    filters: Object.freeze(filters),
  });
}

/** Liegt der Eintrag im gewaehlten Zeitraum? `from` zaehlt mit, `to` nicht. */
export function withinLogExplorerRange(
  entry: LogExplorerEntry, query: { from: string | null; to: string | null },
): boolean {
  if (query.from !== null && entry.at < query.from) return false;
  if (query.to !== null && entry.at >= query.to) return false;
  return true;
}

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function logExplorerTexts(): string[] {
  return [
    ...Object.values(LOG_EXPLORER_REASONS),
    ...Object.values(LOG_EXPLORER_SOURCE_DEFINITIONS).flatMap((entry) => [entry.label, entry.meaning]),
    ...LOG_EXPLORER_OUT_OF_REACH.flatMap((entry) => [entry.label, entry.reason]),
    ...Object.values(LOG_EXPLORER_SOURCE_STATES),
    ...Object.values(LOG_EXPLORER_OUTCOMES),
    ...Object.values(LOG_EXPLORER_FILTERS).map((entry) => entry.label),
    LOG_EXPLORER_NOT_SQL, LOG_EXPLORER_WHY_NOT_SQL, LOG_EXPLORER_SAME_DOOR,
    LOG_EXPLORER_ORDER, LOG_EXPLORER_BUDGET, LOG_EXPLORER_SAVED,
  ];
}
