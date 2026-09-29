import { recognisedByName } from "@/lib/server/errors/identity";
import { isDataIdentifier } from "@/lib/server/data-plane/identifiers";
import { isDeliverableWebhookTarget } from "@/lib/server/compute/webhooks";

/**
 * Datenbank-Webhooks (2.50): eine Tabellenaenderung wird zu einer ausgehenden,
 * signierten Zustellung.
 *
 * ## Die Kopplung: der vorhandene Change Feed, kein zweiter Trigger
 *
 * QKERN beobachtet Tabellenaenderungen bereits. `db/project/0003` legt
 * `qkern_internal.change_feed` samt `qkern_internal.capture_change()` an, und
 * Realtime liest den Feed ueber `PostgresRealtimeChangeSource`. Dieser Slice
 * baut darauf auf und installiert **nichts** zusaetzlich in der Kundendatenbank.
 *
 * Die Alternative waere ein eigener Trigger samt eigener Funktion, angelegt
 * ueber ein Change Set. Sie ist verworfen worden, und zwar aus drei Gruenden:
 *
 * 1. Es gaebe zwei Erfassungswege nebeneinander, mit zwei Zusicherungen
 *    darueber, was eine erfasste Aenderung traegt. Die Zusicherung des Feeds
 *    ("nur Primaerschluessel, nie Zeilenwerte") ist der Grund, warum diese
 *    Flaeche ueberhaupt sicher ist; sie ein zweites Mal zu formulieren heisst,
 *    sie irgendwann zu verlieren.
 * 2. Jede Tabelle traegt dann zwei Trigger fuer dieselbe Beobachtung. Das ist
 *    doppelte Schreiblast in der Datenbank des Kunden, fuer nichts.
 * 3. Der Feed ist begrenzt, hat Aufbewahrung und ist ueber
 *    `realtime-change-soak-postgres` unter Last zertifiziert. Ein zweiter Weg
 *    faengt bei null an.
 *
 * Was daraus folgt und offen gesagt gehoert: Eine Tabelle **ohne** den
 * `capture_change`-Trigger erzeugt keine Zustellung. Das Anschalten je Tabelle
 * ist eine Schemaaenderung und laeuft wie jede andere ueber ein Change Set und
 * die Freigabezentrale — derselbe Weg, den Realtime dafuer schon nimmt, nicht
 * ein eigener dieses Slices.
 *
 * ## Was eine Zustellung traegt
 *
 * Genau das, was der Feed haelt: Schema, Tabelle, Operation, die
 * Primaerschluesselwerte, die Position im Feed und den Commit-Zeitpunkt.
 *
 * Was sie **nicht** traegt, und zwar mit Absicht: keinen Spaltenwert ausser dem
 * Primaerschluessel, kein Vorher-Bild, kein Nachher-Bild, keine Liste der
 * geaenderten Spalten, keine Claims eines Nutzers. Der Feed haelt diese Werte
 * gar nicht; Realtime liest die Zeile je Abonnent frisch unter dessen RLS. Ein
 * Webhook hat keinen Abonnenten, unter dessen Rechten er lesen koennte — er hat
 * eine URL, die ein Administrator eingetragen hat. Die Zeile fuer ihn zu lesen
 * hiesse, die Sichtbarkeitsfrage ausserhalb der Datenbank zu beantworten. Genau
 * das schliesst der Feed seit seinem ersten Tag aus.
 *
 * Der Primaerschluessel geht mit, weil ein Empfaenger sonst nichts anfangen
 * kann. Er ist ein Zeilenwert, und das ist die eine bewusste Offenlegung dieses
 * Slices: Der Empfaenger erfaehrt, dass es eine Zeile mit diesem Schluessel
 * gibt. Das ist dieselbe Vertrauensstufe, die der Feed `service_role`-
 * Abonnenten schon einraeumt, und der Empfaenger ist kein Endnutzer, sondern
 * ein Ziel, das ein Projektadministrator zusammen mit einem Vault-Geheimnis
 * eingetragen hat. Die Ansicht sagt diesen Satz woertlich.
 */

/** Wie die uebrigen Katalogflaechen arbeitet diese auf `public`. */
export const DATABASE_WEBHOOK_SCHEMA = "public";

/** Die feste Liste. Ein Aufrufer waehlt daraus; er ergaenzt sie nicht. */
export const DATABASE_WEBHOOK_EVENTS = ["insert", "update", "delete"] as const;
export type DatabaseWebhookEvent = (typeof DATABASE_WEBHOOK_EVENTS)[number];

/**
 * Der Ereignistyp der ausgehenden Zustellung.
 *
 * Der Tabellenname steht **nicht** darin. Er duerfte bis 63 Zeichen lang sein,
 * und `project_webhook_deliveries.event_type` laesst 64 zu — ein langer
 * Tabellenname waere also genau der Fall, der erst im Betrieb auffiele. Die
 * Tabelle steht in der Definition und in der Nutzlast, wo sie hingehoert.
 */
export function databaseWebhookEventType(event: DatabaseWebhookEvent): string {
  return `db.${event}`;
}

export const DATABASE_WEBHOOK_REASONS = {
  INVALID_NAME: "Der Name passt nicht: erlaubt sind Kleinbuchstabe am Anfang, danach Kleinbuchstaben, Ziffern, Unterstrich und Bindestrich, 3 bis 63 Zeichen.",
  INVALID_TABLE: "Der Tabellenname passt nicht: erlaubt sind Buchstabe oder Unterstrich am Anfang, danach Buchstaben, Ziffern und Unterstriche, höchstens 63 Zeichen.",
  INVALID_URL: "Das Ziel passt nicht: erlaubt ist genau ein öffentlicher HTTPS-Ursprung ohne Port, ohne Abfrage, ohne Fragment und ohne Zugangsdaten. Kein localhost, keine IP-Adresse.",
  INVALID_SECRET_REF: "Die Referenz auf das Signaturgeheimnis passt nicht. Erwartet wird eine Referenz wie vault:webhooks/bestellungen, niemals ein Geheimnis.",
  NO_EVENTS: "Ein Datenbank-Webhook braucht mindestens ein Ereignis.",
  UNKNOWN_EVENT: "Dieses Ereignis steht nicht auf der Liste. Es gibt nur insert, update und delete.",
  DUPLICATE_EVENT: "Dasselbe Ereignis steht zweimal in der Liste.",
} as const;

export type DatabaseWebhookReasonCode = keyof typeof DATABASE_WEBHOOK_REASONS;

/** Eine abgewiesene Eingabe. Sie traegt den Code und den Grund, nie den Wert. */
export class DatabaseWebhookError extends Error {
  readonly code: DatabaseWebhookReasonCode;
  readonly reason: string;

  constructor(code: DatabaseWebhookReasonCode) {
    super(`DATABASE_WEBHOOK_REJECTED:${code}`);
    this.name = "DatabaseWebhookError";
    this.code = code;
    this.reason = DATABASE_WEBHOOK_REASONS[code];
  }
}
recognisedByName(DatabaseWebhookError, "DatabaseWebhookError");

export type DatabaseWebhookInput = {
  name: string;
  table: string;
  events: readonly string[];
  url: string;
  signingSecretRef: string;
  enabled?: boolean;
};

export type DatabaseWebhookDraft = Readonly<{
  name: string;
  schema: typeof DATABASE_WEBHOOK_SCHEMA;
  table: string;
  events: readonly DatabaseWebhookEvent[];
  eventTypes: readonly string[];
  url: string;
  signingSecretRef: string;
  enabled: boolean;
}>;

const NAME = /^[a-z][a-z0-9_-]{2,62}$/;
const SECRET_REF = /^[A-Za-z][A-Za-z0-9_./:-]{2,127}$/;

/**
 * Prueft eine Eingabe und macht daraus einen Entwurf.
 *
 * Die URL-Regel ist **nicht** neu geschrieben: `isDeliverableWebhookTarget` ist
 * genau die Regel, die der Zusteller anwendet. Fielen beide auseinander,
 * entstuende ein Webhook, den der Betrieb bei jedem Versuch stumm abweist.
 * Dasselbe Argument steht seit 1.21 an der Webhook-Definition.
 */
export function validateDatabaseWebhook(input: DatabaseWebhookInput): DatabaseWebhookDraft {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (!NAME.test(name)) throw new DatabaseWebhookError("INVALID_NAME");

  const table = typeof input.table === "string" ? input.table.trim() : "";
  if (!isDataIdentifier(table)) throw new DatabaseWebhookError("INVALID_TABLE");

  const raw = Array.isArray(input.events) ? input.events : [];
  if (raw.length === 0) throw new DatabaseWebhookError("NO_EVENTS");
  const events: DatabaseWebhookEvent[] = [];
  for (const candidate of raw) {
    if (typeof candidate !== "string" ||
        !(DATABASE_WEBHOOK_EVENTS as readonly string[]).includes(candidate)) {
      throw new DatabaseWebhookError("UNKNOWN_EVENT");
    }
    if (events.includes(candidate as DatabaseWebhookEvent)) {
      throw new DatabaseWebhookError("DUPLICATE_EVENT");
    }
    events.push(candidate as DatabaseWebhookEvent);
  }

  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (!isDeliverableWebhookTarget(url)) throw new DatabaseWebhookError("INVALID_URL");

  const signingSecretRef = typeof input.signingSecretRef === "string"
    ? input.signingSecretRef.trim() : "";
  if (!SECRET_REF.test(signingSecretRef)) throw new DatabaseWebhookError("INVALID_SECRET_REF");

  // Die Reihenfolge der Liste folgt der festen Liste, nicht der Eingabe: zwei
  // gleichbedeutende Definitionen sollen gleich aussehen.
  const ordered = DATABASE_WEBHOOK_EVENTS.filter((event) => events.includes(event));
  return Object.freeze({
    name,
    schema: DATABASE_WEBHOOK_SCHEMA,
    table,
    events: Object.freeze([...ordered]),
    eventTypes: Object.freeze(ordered.map(databaseWebhookEventType)),
    url,
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
export type DatabaseWebhookRecord = Readonly<{
  id: string;
  organizationId: string;
  projectId: string;
  environment: "development" | "staging" | "production";
  webhookId: string;
  name: string;
  schema: string;
  table: string;
  events: readonly DatabaseWebhookEvent[];
  eventTypes: readonly string[];
  url: string;
  signingSecretRef: string;
  enabled: boolean;
  createdAt: string;
}>;

/**
 * Die drei Ereignisse, wie sie in der Ansicht stehen. Sie liegen hier und
 * nicht in der Ansicht, damit der Uebersetzungsvertrag sie sieht: Er sammelt
 * die Texte der Module, und ein `t(TABELLE[schluessel])` in einer Ansicht
 * findet er nicht.
 */
export const DATABASE_WEBHOOK_EVENT_LABELS: Record<DatabaseWebhookEvent, string> = {
  insert: "Einfügen (insert)",
  update: "Ändern (update)",
  delete: "Löschen (delete)",
};

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function databaseWebhookTexts(): string[] {
  return [...Object.values(DATABASE_WEBHOOK_REASONS), ...Object.values(DATABASE_WEBHOOK_EVENT_LABELS)];
}
