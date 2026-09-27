import { recognisedByName } from "@/lib/server/errors/identity";
import { isDeliverableWebhookTarget } from "@/lib/server/compute/webhooks";

/**
 * Log-Drains (2.54): QKERN leitet Logs an ein fremdes Ziel weiter.
 *
 * ## Die eine harte Grenze
 *
 * Ein Drain traegt genau die Felder, die die Console fuer dieselbe Quelle
 * schon zeigt, und kein einziges mehr. Diese Grenze ist der ganze Slice. Ein
 * Drain, der rohe Anwendungslogs an einen fremden Dienst schickt, ist ein
 * Datenleck mit freundlichem Namen: Die Adresse eines Endnutzers, eine
 * Nutzlast oder ein Geheimnis verlaesst dabei die Plattform, und niemand
 * bemerkt es, weil das Ziel ja bestellt war.
 *
 * Darum steht die Grenze hier als Liste von Feldnamen je Quelle, zusammen mit
 * der Datei und dem Typ der Console-Ansicht, aus der sie stammen. Der Vertrag
 * `tests/log-drain-field-boundary` liest diese Ansichten und verlangt fuer
 * jedes weitergeleitete Feld einen Eintrag in ihrer Projektion. Die Grenze
 * haengt damit an einem Test, nicht an Sorgfalt.
 *
 * ## Warum die Liste kuerzer ist als die Ansicht
 *
 * Drei Felder zeigt die Console, und ein Drain traegt sie trotzdem nicht:
 *
 * * `invokedBy` im Aufrufprotokoll ist die Referenz des Aufrufers und kann
 *   eine E-Mail-Adresse sein (0045 laesst 320 Zeichen zu, und der
 *   Administratorweg setzt genau die Adresse ein). In der Console sieht sie
 *   ein Administrator derselben Organisation; an ein fremdes Ziel gehoert sie
 *   nicht.
 * * `ownerSubject` am Speicherobjekt ist dieselbe Sorte Referenz, mit
 *   derselben Laengengrenze und derselben Moeglichkeit.
 * * `bucketId` und `functionId`-Geschwister sind bloss interne Kennungen; die
 *   Namen tragen dieselbe Auskunft lesbar. `functionId` bleibt, weil das
 *   Protokoll ueber alle Functions laeuft und ein Empfaenger sonst nicht
 *   gruppieren kann.
 *
 * Das Auth-Protokoll hat dieses Problem nicht: Der Sanitizer aus 2.35 verbietet
 * in jeder Referenz sowohl `@` als auch `qk_`, und er wirft, bevor irgendein
 * Sink schreibt. `resourceRef` kann deshalb keine Adresse und kein Token sein.
 *
 * ## Warum das Cron-Log nicht auf der Liste steht
 *
 * Das Cron-Log (2.42) ist kein gespeichertes Log. Es wird bei jeder Anfrage aus
 * dem Ausdruck, dem Dedupe-Fenster und den vorhandenen Nachrichten
 * rekonstruiert, und der Zustand eines Vorkommens aendert sich danach noch.
 * Weiterleiten hiesse, dasselbe Vorkommen mehrfach mit wechselndem Zustand zu
 * senden und einem Empfaenger einen Ereignisstrom zu versprechen, den es nicht
 * gibt. Die Ansicht sagt diesen Satz woertlich.
 */

/** Der Vertrag mit dem Empfaenger. Steigt, wenn ein Feld verschwindet. */
export const LOG_DRAIN_SCHEMA_VERSION = 1;

/** Die feste Liste. Ein Aufrufer waehlt daraus; er ergaenzt sie nicht. */
export const LOG_DRAIN_SOURCES = [
  "auth_audit", "function_invocations", "storage_objects", "webhook_deliveries", "usage_series",
] as const;
export type LogDrainSourceId = (typeof LOG_DRAIN_SOURCES)[number];

export type LogDrainSourceDefinition = Readonly<{
  id: LogDrainSourceId;
  /** Die Ansicht, deren Projektion die Grenze zieht. */
  consoleView: string;
  /** Die Typen in dieser Datei, die die angezeigten Felder aufzaehlen. */
  consoleTypes: readonly string[];
  /** Genau diese Feldnamen gehen mit. */
  fields: readonly string[];
  /** Felder, die die Console zeigt und ein Drain bewusst zurueckhaelt. */
  withheld: readonly string[];
}>;

export const LOG_DRAIN_SOURCE_DEFINITIONS: Readonly<Record<LogDrainSourceId, LogDrainSourceDefinition>> =
  Object.freeze({
    auth_audit: Object.freeze({
      id: "auth_audit",
      consoleView: "components/console/auth-log-view.tsx",
      consoleTypes: Object.freeze(["Entry"]),
      fields: Object.freeze(["id", "createdAt", "action", "actorType", "resourceRef", "status"]),
      withheld: Object.freeze(["actorRef", "metadata"]),
    }),
    function_invocations: Object.freeze({
      id: "function_invocations",
      consoleView: "components/console/function-log-view.tsx",
      consoleTypes: Object.freeze(["LogRow"]),
      fields: Object.freeze(["functionId", "functionName", "invocationId", "startedAt",
        "durationMs", "outcome", "statusCode", "errorCode"]),
      withheld: Object.freeze(["invokedBy"]),
    }),
    storage_objects: Object.freeze({
      id: "storage_objects",
      consoleView: "components/console/storage-log-view.tsx",
      consoleTypes: Object.freeze(["Entry"]),
      fields: Object.freeze(["id", "bucketName", "key", "sizeBytes", "contentType", "status",
        "createdAt", "deleteAfter", "deletedAt"]),
      withheld: Object.freeze(["bucketId", "ownerSubject"]),
    }),
    webhook_deliveries: Object.freeze({
      id: "webhook_deliveries",
      consoleView: "components/console/database-webhooks-view.tsx",
      consoleTypes: Object.freeze(["Delivery"]),
      fields: Object.freeze(["id", "eventType", "status", "attemptCount", "lastFailureCode",
        "occurredAt", "settledAt"]),
      withheld: Object.freeze(["payload", "url", "webhookId"]),
    }),
    usage_series: Object.freeze({
      id: "usage_series",
      consoleView: "components/console/usage-series-view.tsx",
      consoleTypes: Object.freeze(["Series", "SeriesBucket"]),
      fields: Object.freeze(["metric", "bucket", "start", "accepted", "rejected", "events"]),
      withheld: Object.freeze(["eventKeyHash", "source"]),
    }),
  });

/**
 * Der Ereignistyp einer weitergeleiteten Ladung.
 *
 * Er bleibt unter den 64 Zeichen, die `project_webhook_deliveries.event_type`
 * zulaesst, weil die Quellnamen fest sind — ein langer Name waere genau der
 * Fall, der erst im Betrieb auffiele.
 */
export function logDrainEventType(source: LogDrainSourceId): string {
  return `log.${source}`;
}

export const LOG_DRAIN_REASONS = {
  INVALID_NAME: "Der Name passt nicht: erlaubt sind Kleinbuchstabe am Anfang, danach Kleinbuchstaben, Ziffern, Unterstrich und Bindestrich, 3 bis 63 Zeichen.",
  INVALID_URL: "Das Ziel passt nicht: erlaubt ist genau ein öffentlicher HTTPS-Ursprung ohne Port, ohne Abfrage, ohne Fragment und ohne Zugangsdaten. Kein localhost, keine IP-Adresse.",
  INVALID_SECRET_REF: "Die Referenz auf das Signaturgeheimnis passt nicht. Erwartet wird eine Referenz wie vault:log-drains/siem, niemals ein Geheimnis.",
  NO_SOURCES: "Ein Log-Drain braucht mindestens eine Quelle. Ohne Quelle gäbe es nichts weiterzuleiten.",
  UNKNOWN_SOURCE: "Diese Quelle steht nicht auf der Liste. Es gibt nur die Logs, die die Console selbst zeigt.",
  DUPLICATE_SOURCE: "Dieselbe Quelle steht zweimal in der Liste.",
} as const;

export type LogDrainReasonCode = keyof typeof LOG_DRAIN_REASONS;

/** Eine abgewiesene Eingabe. Sie traegt den Code und den Grund, nie den Wert. */
export class LogDrainError extends Error {
  readonly code: LogDrainReasonCode;
  readonly reason: string;

  constructor(code: LogDrainReasonCode) {
    super(`LOG_DRAIN_REJECTED:${code}`);
    this.name = "LogDrainError";
    this.code = code;
    this.reason = LOG_DRAIN_REASONS[code];
  }
}
recognisedByName(LogDrainError, "LogDrainError");

export type LogDrainInput = {
  name: string;
  url: string;
  sources: readonly string[];
  signingSecretRef: string;
  enabled?: boolean;
};

export type LogDrainDraft = Readonly<{
  name: string;
  url: string;
  sources: readonly LogDrainSourceId[];
  eventTypes: readonly string[];
  signingSecretRef: string;
  enabled: boolean;
}>;

const NAME = /^[a-z][a-z0-9_-]{2,62}$/;
const SECRET_REF = /^[A-Za-z][A-Za-z0-9_./:-]{2,127}$/;

/**
 * Prueft eine Eingabe und macht daraus einen Entwurf.
 *
 * Die Zielregel ist **nicht** neu geschrieben: `isDeliverableWebhookTarget` ist
 * genau die Regel, die der Zusteller anwendet. Fielen beide auseinander,
 * entstuende ein Drain, den der Betrieb bei jedem Versuch stumm abweist, und
 * das saehe aus wie ein defekter Empfaenger statt wie eine abgelehnte Eingabe.
 * Dasselbe Argument steht seit 1.21 an der Webhook-Definition.
 */
export function validateLogDrain(input: LogDrainInput): LogDrainDraft {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (!NAME.test(name)) throw new LogDrainError("INVALID_NAME");

  const raw = Array.isArray(input.sources) ? input.sources : [];
  if (raw.length === 0) throw new LogDrainError("NO_SOURCES");
  const sources: LogDrainSourceId[] = [];
  for (const candidate of raw) {
    if (typeof candidate !== "string" ||
        !(LOG_DRAIN_SOURCES as readonly string[]).includes(candidate)) {
      throw new LogDrainError("UNKNOWN_SOURCE");
    }
    if (sources.includes(candidate as LogDrainSourceId)) {
      throw new LogDrainError("DUPLICATE_SOURCE");
    }
    sources.push(candidate as LogDrainSourceId);
  }

  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (!isDeliverableWebhookTarget(url)) throw new LogDrainError("INVALID_URL");

  const signingSecretRef = typeof input.signingSecretRef === "string"
    ? input.signingSecretRef.trim() : "";
  if (!SECRET_REF.test(signingSecretRef)) throw new LogDrainError("INVALID_SECRET_REF");

  // Die Reihenfolge folgt der festen Liste, nicht der Eingabe: zwei
  // gleichbedeutende Definitionen sollen gleich aussehen, und der CHECK in
  // 0054 prueft dieselbe Reihenfolge.
  const ordered = LOG_DRAIN_SOURCES.filter((source) => sources.includes(source));
  return Object.freeze({
    name,
    url,
    sources: Object.freeze([...ordered]),
    eventTypes: Object.freeze(ordered.map(logDrainEventType)),
    signingSecretRef,
    enabled: input.enabled !== false,
  });
}

/**
 * Eine gespeicherte Definition, so wie die Flaeche sie herausgibt.
 *
 * `signingSecretRef` ist eine Referenz. Ein Feld fuer einen Geheimniswert gibt
 * es in diesem Typ nicht, und darum kann auch keine Route und keine Ansicht
 * einen herausgeben.
 */
export type LogDrainRecord = Readonly<{
  id: string;
  organizationId: string;
  projectId: string;
  environment: "development" | "staging" | "production";
  webhookId: string;
  name: string;
  url: string;
  sources: readonly LogDrainSourceId[];
  eventTypes: readonly string[];
  signingSecretRef: string;
  enabled: boolean;
  createdAt: string;
}>;

/** Ein weitergeleitetes Feld traegt einen JSON-Skalar, nie mehr. */
export type LogDrainValue = string | number | boolean | null;
export type LogDrainEntry = Readonly<Record<string, LogDrainValue>>;

/**
 * Die Obergrenze eines weitergeleiteten Textes.
 *
 * 1024 Zeichen sind die Grenze, die 0025 dem Objektschluessel setzt — dem
 * laengsten Feld auf der ganzen Liste. Was darueber liegt, kann aus dieser
 * Projektion nicht stammen und faellt weg.
 */
export const LOG_DRAIN_MAX_TEXT = 1_024;

/**
 * Macht aus einer Console-Zeile den weitergeleiteten Eintrag.
 *
 * Die Funktion ist eine **Whitelist**, keine Filterung: Sie geht die
 * deklarierten Feldnamen der Quelle durch und nimmt nur, was dort steht. Ein
 * Leser, der versehentlich eine Spalte mehr liest, kann sie darum nicht
 * weiterleiten — und das ist der Grund, warum die Whitelist hier steht und
 * nicht im SQL, wo sie jeder zweite Leser neu formulieren muesste.
 *
 * Ein Wert, der kein JSON-Skalar ist, faellt weg. Ein verschachteltes Objekt
 * ist die Stelle, an der sich eine Nutzlast verstecken wuerde, und ein Drain
 * hat fuer keine Quelle einen Grund, eines zu tragen.
 */
export function projectLogDrainEntry(
  source: LogDrainSourceId,
  record: Readonly<Record<string, unknown>>,
): LogDrainEntry {
  const definition = LOG_DRAIN_SOURCE_DEFINITIONS[source];
  const entry: Record<string, LogDrainValue> = {};
  for (const field of definition.fields) {
    const value = record[field];
    if (value === null) { entry[field] = null; continue; }
    if (typeof value === "boolean") { entry[field] = value; continue; }
    if (typeof value === "number" && Number.isFinite(value)) { entry[field] = value; continue; }
    if (typeof value === "string" && value.length <= LOG_DRAIN_MAX_TEXT) {
      entry[field] = value;
    }
  }
  return Object.freeze(entry);
}

/** Die Huelle einer Ladung. Ohne Ziel, ohne Referenz, ohne Geheimnis. */
export type LogDrainBatch = Readonly<{
  schemaVersion: number;
  source: LogDrainSourceId;
  count: number;
  entries: readonly LogDrainEntry[];
}>;

export function buildLogDrainBatch(
  source: LogDrainSourceId,
  records: readonly Readonly<Record<string, unknown>>[],
): LogDrainBatch {
  const entries = records.map((record) => projectLogDrainEntry(source, record));
  return Object.freeze({
    schemaVersion: LOG_DRAIN_SCHEMA_VERSION,
    source,
    count: entries.length,
    entries: Object.freeze(entries),
  });
}

/** Was eine Quelle ist und was sie traegt — die Texte der Ansicht. */
export const LOG_DRAIN_SOURCE_TEXTS: Readonly<Record<LogDrainSourceId, Readonly<{
  label: string; carries: string;
}>>> = Object.freeze({
  auth_audit: Object.freeze({
    label: "Auth-Protokoll",
    carries: "Zeitpunkt, Handlung, Art des Akteurs, die bereinigte Ressourcenreferenz und den Ausgang. Der Sanitizer verbietet in jeder Referenz das Zeichen @ und die Zeichenfolge qk_; eine Adresse und ein Token können dort nicht stehen.",
  }),
  function_invocations: Object.freeze({
    label: "Function-Aufrufe",
    carries: "Function, Aufruf-Kennung, Beginn, Dauer, Ausgang und entweder einen HTTP-Status oder einen festen Fehlercode. Nicht die Ausgabe des Containers, die QKERN gar nicht speichert, und nicht die Referenz des Aufrufers.",
  }),
  storage_objects: Object.freeze({
    label: "Stand der Speicherobjekte",
    carries: "Bucket, Objektschlüssel, Grösse, Inhaltstyp, das Urteil des Scanners und drei Zeitpunkte. Nicht den Schlüssel beim Anbieter, nicht die Prüfsumme, nicht den Eigentümer und keine signierte Adresse.",
  }),
  webhook_deliveries: Object.freeze({
    label: "Webhook-Zustellungen",
    carries: "Kennung, Ereignistyp, Zustand, Zahl der Versuche, den letzten Fehlercode und zwei Zeitpunkte. Nicht die Nutzlast der Zustellung und nicht die Ziel-Adresse.",
  }),
  usage_series: Object.freeze({
    label: "Nutzung je Zeitfenster",
    carries: "Metrik, Fenstergrösse, Beginn des Fensters, die angenommene und die abgewiesene Menge und die Zahl der Ereignisse. Weitergeleitet werden nur abgeschlossene Fenster; ein laufendes würde sich noch ändern.",
  }),
});

export const LOG_DRAIN_WHAT =
  "Ein Log-Drain leitet genau die Felder weiter, die diese Console für dieselbe Quelle schon zeigt. Diese Grenze hängt an einem Vertrag im Testlauf: Jedes weitergeleitete Feld muss in der Projektion der zugehörigen Ansicht vorkommen, sonst schlägt der Lauf fehl.";

export const LOG_DRAIN_NEVER =
  "Ein Drain trägt nie die Ausgabe eines Containers, nie die Nutzlast eines Webhooks oder einer Queue, nie einen Zeilenwert Ihrer Tabellen, nie eine E-Mail-Adresse, nie ein Token und nie ein Geheimnis. Drei Felder, die die Console zeigt, bleiben zusätzlich zurück: die Referenz des Aufrufers eines Function-Aufrufs, der Eigentümer eines Speicherobjekts und die interne Bucket-Kennung.";

export const LOG_DRAIN_SECRET =
  "Jede Ladung wird mit HMAC-SHA256 signiert, über denselben Weg wie jeder andere ausgehende Webhook von QKERN. Der Schlüssel liegt im Vault; hier steht ausschliesslich seine Referenz, und es gibt in dieser Ansicht kein Feld, in das ein Geheimniswert passen würde.";

export const LOG_DRAIN_SAME_PATH =
  "Zugestellt wird über den vorhandenen Webhook-Weg: dieselbe Outbox mit Lease, dieselbe serverberechnete Wartezeit, dieselbe Versuchsgrenze und dasselbe Dead Letter. Ein zweiter Zustellweg wäre eine zweite Stelle, an der die Regeln für ausgehende Verbindungen auseinanderfallen könnten.";

export const LOG_DRAIN_NO_CRON =
  "Das Cron-Log steht nicht auf der Liste der Quellen. Es ist kein gespeichertes Log, sondern wird bei jeder Anfrage aus dem Ausdruck und dem Dedupe-Fenster rekonstruiert; der Zustand eines Vorkommens ändert sich danach noch. Weiterleiten hiesse, dasselbe Vorkommen mehrfach mit wechselndem Zustand zu senden.";

export const LOG_DRAIN_NO_DELETE =
  "Löschen gibt es hier nicht. Ein Löschen nähme die wartenden Ladungen mit; Abschalten hält sie an, ohne etwas zu verlieren.";

export const LOG_DRAIN_GAPS =
  "Ein Drain verspricht keine Lückenlosigkeit. Der weiterleitende Prozess führt seinen Stand je Lauf; nach einem Neustart beginnt er bei der Gegenwart, statt die Vergangenheit nachzuschicken. Eine Ladung kann doppelt ankommen, und ein Empfänger erkennt das an der Kennung des Eintrags.";

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function logDrainTexts(): string[] {
  return [
    ...Object.values(LOG_DRAIN_REASONS),
    ...Object.values(LOG_DRAIN_SOURCE_TEXTS).flatMap((entry) => [entry.label, entry.carries]),
    LOG_DRAIN_WHAT, LOG_DRAIN_NEVER, LOG_DRAIN_SECRET, LOG_DRAIN_SAME_PATH,
    LOG_DRAIN_NO_CRON, LOG_DRAIN_NO_DELETE, LOG_DRAIN_GAPS,
  ];
}
