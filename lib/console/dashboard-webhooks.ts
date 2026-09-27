import { recognisedByName } from "@/lib/server/errors/identity";
import { isDeliverableWebhookTarget } from "@/lib/server/compute/webhooks";

/**
 * Dashboard-Webhooks (2.75): QKERN meldet Ereignisse des Projekts selbst.
 *
 * ## Der Unterschied zu den Datenbank-Webhooks
 *
 * Ein Datenbank-Webhook (2.50) traegt eine Aenderung an einer Tabelle **in**
 * einer Projektdatenbank hinaus. Ein Dashboard-Webhook traegt ein Ereignis
 * **des Projekts** aus der Control Plane hinaus: eine angewandte Migration,
 * eine Freigabe, einen Wechsel des Projektzustands, eine neue Umgebung. Die
 * Quelle ist die Audit-Kette aus 0001 und 0002; dort stehen diese Ereignisse
 * schon, mit Hash und Vorgaengerhash.
 *
 * Gebaut wird darum nur eine **Quelle** am vorhandenen Zustellweg. Die
 * Definition liegt weiter in 0032, die Outbox mit Lease, serverberechnetem
 * Backoff und Dead Letter in denselben Tabellen, die Signatur laeuft ueber den
 * Vault, und zustellen tut derselbe Prozess. Ein zweiter Zusteller waere eine
 * zweite Stelle, an der die Regeln fuer ausgehende Verbindungen auseinander
 * fallen koennten.
 *
 * ## Die eine harte Grenze
 *
 * Hinaus geht nur, was die Console ohnehin zeigt. Darum steht hier je
 * Ereignisart eine Positivliste von Feldnamen, zusammen mit der Datei und dem
 * Typ der Console-Ansicht, aus der sie stammt. Der Vertrag
 * `tests/dashboard-webhook-field-boundary` liest diese Typen und verlangt fuer
 * jedes gemeldete Feld einen Eintrag darin. Die Grenze haengt damit an einem
 * Test, nicht an Sorgfalt. Dasselbe Muster wie bei den Log-Drains (2.54).
 *
 * ## Warum die Akteursreferenz nicht hinausgeht
 *
 * Das ist die eine Entscheidung, die dieser Schnitt bewusst trifft.
 * `audit_logs.actor_ref` traegt bei jedem Ereignis, das ein Mensch ausgeloest
 * hat, die Referenz dieses Menschen -- in der Control Plane ist das die
 * E-Mail-Adresse des angemeldeten Kontos, weil der Kontext genau sie als `ref`
 * einsetzt. Die Console **zeigt** sie: Die Audit-Ansicht hat eine Spalte
 * "Akteur", und dort steht die Adresse. Ein Administrator derselben
 * Organisation sieht sie also ohnehin.
 *
 * Hinaus geht sie trotzdem nicht. Ein Dashboard-Webhook geht an ein fremdes
 * Ziel im Internet, und der Empfaenger ist nicht die Organisation, sondern ein
 * Dienst, der eine Benachrichtigung verarbeitet. Fuer "die Migration ist
 * angewandt" oder "die Freigabe ist erteilt" braucht er die Person nicht. Wer
 * wissen will, wer entschieden hat, liest das Audit-Log -- dort steht es mit
 * Hash und Kette, statt in einem Chatkanal.
 *
 * Es gibt dafuer bewusst **keinen** Schalter. Ein Schalter waere eine Zeile,
 * die ein Betreiber einmal umlegt und danach niemand mehr liest.
 *
 * ## Warum der gespeicherte Zustand hinausgeht und nicht der Badge
 *
 * `audit_logs.status` traegt das Wort, das der schreibende Dienst gesetzt hat
 * (`success`, `succeeded`, `pending`, `blocked`, `failed`). Die Audit-Ansicht
 * der Console faltet das fuer ihren Badge auf drei Werte zusammen. Gemeldet
 * wird das gespeicherte Wort: Die Faltung ordnet alles, was nicht `success`
 * oder `pending` heisst, dem Badge `blocked` zu -- auch das `succeeded` des
 * Provisioners. Ein Empfaenger, dem ein gelungenes Provisioning als
 * "blockiert" gemeldet wuerde, bekaeme eine Unwahrheit statt einer kuerzeren
 * Liste.
 */

/** Der Vertrag mit dem Empfaenger. Steigt, wenn ein Feld verschwindet. */
export const DASHBOARD_WEBHOOK_SCHEMA_VERSION = 1;

/** Die feste Liste. Ein Aufrufer waehlt daraus; er ergaenzt sie nicht. */
export const DASHBOARD_EVENT_KINDS = [
  "migration_applied", "approval_decided", "project_state_changed", "environment_added",
] as const;
export type DashboardEventKind = (typeof DASHBOARD_EVENT_KINDS)[number];

/**
 * Die Felder, die jede Ereignisart traegt, weil die Audit-Ansicht der Console
 * genau sie zeigt.
 *
 * Die Namen sind die der Ansicht, nicht die der Tabelle: Die Ansicht rendert
 * `AuditEvent`, und `AuditEvent` heisst das Feld `resource`, wo die Tabelle
 * `resource_ref` heisst. Der Vertrag prueft gegen den Typ, den die Ansicht
 * wirklich rendert.
 */
const AUDIT_ENVELOPE = [
  "id", "createdAt", "action", "status", "environment", "projectId", "resource",
] as const;

/** Die Ansicht, deren Zeilentyp die Grenze fuer eine Ereignisart zieht. */
export type DashboardConsoleSource = Readonly<{
  view: string;
  types: readonly string[];
}>;

export type DashboardEventDefinition = Readonly<{
  kind: DashboardEventKind;
  /**
   * Die Handlungen der Audit-Kette, die diese Ereignisart ausmachen. Die
   * Zuordnung ist eindeutig: Keine Handlung steht bei zwei Arten, sonst
   * bekaeme ein Empfaenger dasselbe Ereignis zweimal mit zwei Namen.
   */
  auditActions: readonly string[];
  /** Die Ansichten, deren Zeilentypen die Feldliste tragen. */
  consoleSources: readonly DashboardConsoleSource[];
  /** Genau diese Feldnamen gehen mit. */
  fields: readonly string[];
  /**
   * Die Schluessel, die aus `redacted_metadata` genommen werden. Jeder steht
   * zugleich in `fields`; der Vertrag prueft das. Alles andere im Metadaten-
   * Objekt bleibt liegen, auch wenn es redigiert ist.
   */
  metadataFields: readonly string[];
  /** Felder, die die Console zeigt und ein Dashboard-Webhook zurueckhaelt. */
  withheld: readonly string[];
}>;

export const DASHBOARD_EVENT_DEFINITIONS:
Readonly<Record<DashboardEventKind, DashboardEventDefinition>> = Object.freeze({
  migration_applied: Object.freeze({
    kind: "migration_applied",
    // Nur der Abschluss eines Laufs, gelungen oder gescheitert. Das Einreihen,
    // das Wiederholen und das Review sind Zwischenstaende desselben Laufs; sie
    // zu melden hiesse, denselben Vorgang mehrfach mit wechselndem Ausgang zu
    // senden -- genau der Grund, warum das Cron-Log bei den Drains gar nicht
    // auf der Liste steht.
    auditActions: Object.freeze(["migration.apply.completed", "migration.apply.failed"]),
    consoleSources: Object.freeze([
      Object.freeze({ view: "lib/types.ts", types: Object.freeze(["AuditEvent"]) }),
      Object.freeze({
        view: "components/console/migrations-view.tsx",
        types: Object.freeze(["ReviewItem"]),
      }),
    ]),
    fields: Object.freeze([...AUDIT_ENVELOPE, "changeSetId", "errorCode"]),
    metadataFields: Object.freeze(["changeSetId", "errorCode"]),
    // `executorResult` steht in den Metadaten eines gelungenen Laufs und
    // beschreibt, was der Executor auf der Projektdatenbank gesehen hat. Keine
    // Console-Ansicht zeigt es, und es ist die Stelle, an der ein Stueck der
    // Anweisung hinausfahren koennte.
    withheld: Object.freeze(["actor", "executorResult"]),
  }),
  approval_decided: Object.freeze({
    kind: "approval_decided",
    auditActions: Object.freeze([
      "approval.approved", "approval.rejected", "approval.automatically_approved",
    ]),
    consoleSources: Object.freeze([
      Object.freeze({ view: "lib/types.ts", types: Object.freeze(["AuditEvent", "Approval"]) }),
    ]),
    fields: Object.freeze([...AUDIT_ENVELOPE, "risk"]),
    metadataFields: Object.freeze(["risk"]),
    // `actionHash` bindet die Freigabe an genau eine Anweisung und genau eine
    // Datenbankinstanz. Die Freigabezentrale braucht ihn, um eine erfundene
    // Freigabe abzuweisen; eine Benachrichtigung braucht ihn nicht, und ein
    // Empfaenger koennte mit ihm nichts pruefen, was er nicht ohnehin glauben
    // muesste.
    withheld: Object.freeze(["actor", "actionHash"]),
  }),
  project_state_changed: Object.freeze({
    kind: "project_state_changed",
    auditActions: Object.freeze([
      "project.database.provisioning_failed", "project.database.provisioning_retry_scheduled",
    ]),
    consoleSources: Object.freeze([
      Object.freeze({ view: "lib/types.ts", types: Object.freeze(["AuditEvent", "Project"]) }),
    ]),
    fields: Object.freeze([...AUDIT_ENVELOPE]),
    // Bewusst leer. Die Metadaten dieser Handlungen tragen den Fehlercode des
    // Anbieters und die Zahl der Versuche, und **keine** Console-Ansicht zeigt
    // beides fuer einen Projektzustand. Die Grenze dieses Schnitts ist die
    // Console, nicht die Nuetzlichkeit.
    metadataFields: Object.freeze([]),
    withheld: Object.freeze(["actor", "errorCode", "attempt"]),
  }),
  environment_added: Object.freeze({
    kind: "environment_added",
    auditActions: Object.freeze([
      "project.database.provisioning_requested", "project.database.provisioned",
    ]),
    consoleSources: Object.freeze([
      Object.freeze({ view: "lib/types.ts", types: Object.freeze(["AuditEvent"]) }),
      Object.freeze({
        view: "components/console/infrastructure-view.tsx",
        types: Object.freeze(["Binding"]),
      }),
    ]),
    fields: Object.freeze([...AUDIT_ENVELOPE]),
    metadataFields: Object.freeze([]),
    // `databaseInstanceRef` zeigt die Infrastruktur-Ansicht einem
    // Administrator, und sie benennt die Instanz, auf der diese Umgebung
    // laeuft. Nach draussen gehoert sie nicht: Sie ist der Griff, an dem ein
    // Angreifer die Datenbank dieses Projekts sucht, und fuer "es gibt eine
    // neue Umgebung" traegt sie nichts bei.
    withheld: Object.freeze([
      "actor", "databaseInstanceRef", "bootstrapContractSha256", "provisioningJobId",
    ]),
  }),
});

/**
 * Der Ereignistyp einer Meldung.
 *
 * Er bleibt unter den 64 Zeichen, die `project_webhook_deliveries.event_type`
 * zulaesst, weil die Namen der Arten fest sind. Der laengste ist
 * `project.project_state_changed` mit 29 Zeichen.
 */
export function dashboardEventType(kind: DashboardEventKind): string {
  return `project.${kind}`;
}

/** Zu welcher Art eine Handlung der Audit-Kette gehoert, oder zu keiner. */
export function dashboardEventKindOfAction(action: string): DashboardEventKind | null {
  for (const kind of DASHBOARD_EVENT_KINDS) {
    if (DASHBOARD_EVENT_DEFINITIONS[kind].auditActions.includes(action)) return kind;
  }
  return null;
}

export const DASHBOARD_WEBHOOK_REASONS = {
  INVALID_NAME: "Der Name passt nicht: erlaubt sind Kleinbuchstabe am Anfang, danach Kleinbuchstaben, Ziffern, Unterstrich und Bindestrich, 3 bis 63 Zeichen.",
  INVALID_URL: "Das Ziel passt nicht: erlaubt ist genau ein öffentlicher HTTPS-Ursprung ohne Port, ohne Abfrage, ohne Fragment und ohne Zugangsdaten. Kein localhost, keine IP-Adresse.",
  INVALID_SECRET_REF: "Die Referenz auf das Signaturgeheimnis passt nicht. Erwartet wird eine Referenz wie vault:dashboard-webhooks/chat, niemals ein Geheimnis.",
  NO_KINDS: "Ein Dashboard-Webhook braucht mindestens eine Ereignisart. Ohne Art gäbe es nichts zu melden.",
  UNKNOWN_KIND: "Diese Ereignisart steht nicht auf der Liste. Es gibt nur die Ereignisse, die diese Console selbst zeigt.",
  DUPLICATE_KIND: "Dieselbe Ereignisart steht zweimal in der Liste.",
} as const;

export type DashboardWebhookReasonCode = keyof typeof DASHBOARD_WEBHOOK_REASONS;

/** Eine abgewiesene Eingabe. Sie traegt den Code und den Grund, nie den Wert. */
export class DashboardWebhookError extends Error {
  readonly code: DashboardWebhookReasonCode;
  readonly reason: string;

  constructor(code: DashboardWebhookReasonCode) {
    super(`DASHBOARD_WEBHOOK_REJECTED:${code}`);
    this.name = "DashboardWebhookError";
    this.code = code;
    this.reason = DASHBOARD_WEBHOOK_REASONS[code];
  }
}
recognisedByName(DashboardWebhookError, "DashboardWebhookError");

export type DashboardWebhookInput = {
  name: string;
  url: string;
  kinds: readonly string[];
  signingSecretRef: string;
  enabled?: boolean;
};

export type DashboardWebhookDraft = Readonly<{
  name: string;
  url: string;
  kinds: readonly DashboardEventKind[];
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
 * entstuende ein Webhook, den der Betrieb bei jedem Versuch stumm abweist, und
 * das saehe aus wie ein defekter Empfaenger statt wie eine abgelehnte Eingabe.
 * Dasselbe Argument steht seit 1.21 an der Webhook-Definition und seit 2.54 an
 * den Log-Drains.
 */
export function validateDashboardWebhook(input: DashboardWebhookInput): DashboardWebhookDraft {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (!NAME.test(name)) throw new DashboardWebhookError("INVALID_NAME");

  const raw = Array.isArray(input.kinds) ? input.kinds : [];
  if (raw.length === 0) throw new DashboardWebhookError("NO_KINDS");
  const kinds: DashboardEventKind[] = [];
  for (const candidate of raw) {
    if (typeof candidate !== "string" ||
        !(DASHBOARD_EVENT_KINDS as readonly string[]).includes(candidate)) {
      throw new DashboardWebhookError("UNKNOWN_KIND");
    }
    if (kinds.includes(candidate as DashboardEventKind)) {
      throw new DashboardWebhookError("DUPLICATE_KIND");
    }
    kinds.push(candidate as DashboardEventKind);
  }

  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (!isDeliverableWebhookTarget(url)) throw new DashboardWebhookError("INVALID_URL");

  const signingSecretRef = typeof input.signingSecretRef === "string"
    ? input.signingSecretRef.trim() : "";
  if (!SECRET_REF.test(signingSecretRef)) throw new DashboardWebhookError("INVALID_SECRET_REF");

  // Die Reihenfolge folgt der festen Liste, nicht der Eingabe: zwei
  // gleichbedeutende Definitionen sollen gleich aussehen, und der CHECK in
  // 0057 prueft dieselbe Reihenfolge.
  const ordered = DASHBOARD_EVENT_KINDS.filter((kind) => kinds.includes(kind));
  return Object.freeze({
    name,
    url,
    kinds: Object.freeze([...ordered]),
    eventTypes: Object.freeze(ordered.map(dashboardEventType)),
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
export type DashboardWebhookRecord = Readonly<{
  id: string;
  organizationId: string;
  projectId: string;
  environment: "development" | "staging" | "production";
  webhookId: string;
  name: string;
  url: string;
  kinds: readonly DashboardEventKind[];
  eventTypes: readonly string[];
  signingSecretRef: string;
  enabled: boolean;
  createdAt: string;
}>;

/** Ein gemeldetes Feld traegt einen JSON-Skalar, nie mehr. */
export type DashboardEventValue = string | number | boolean | null;
export type DashboardEventEntry = Readonly<Record<string, DashboardEventValue>>;

/**
 * Die Obergrenze eines gemeldeten Textes.
 *
 * Die Spalten der Audit-Kette sind in 0001 unbegrenztes `text`; eine Grenze
 * muss darum hier stehen. 320 Zeichen sind dieselbe Grenze, die 0046 einer
 * Referenz zugesteht, und sie ist reichlich: Jedes Feld dieser Projektion ist
 * eine Kennung, eine Handlung, ein Zustand oder ein Fehlercode. Was darueber
 * liegt, kann aus dieser Projektion nicht stammen und faellt weg, statt eine
 * unbekannt lange Zeichenkette hinauszutragen.
 */
export const DASHBOARD_EVENT_MAX_TEXT = 320;

/**
 * Macht aus einem Audit-Eintrag die gemeldete Zeile.
 *
 * Die Funktion ist eine **Whitelist**, keine Filterung: Sie geht die
 * deklarierten Feldnamen der Art durch und nimmt nur, was dort steht. Ein
 * Leser, der versehentlich eine Spalte mehr liest, kann sie darum nicht melden
 * -- und das ist der Grund, warum die Whitelist hier steht und nicht im SQL, wo
 * sie jeder zweite Leser neu formulieren muesste.
 *
 * Ein Wert, der kein JSON-Skalar ist, faellt weg. Ein verschachteltes Objekt
 * ist die Stelle, an der sich eine Anweisung oder eine Nutzlast verstecken
 * wuerde, und kein Ereignis dieses Projekts hat einen Grund, eines zu tragen.
 */
export function projectDashboardEvent(
  kind: DashboardEventKind,
  record: Readonly<Record<string, unknown>>,
): DashboardEventEntry {
  const definition = DASHBOARD_EVENT_DEFINITIONS[kind];
  const entry: Record<string, DashboardEventValue> = {};
  for (const field of definition.fields) {
    const value = record[field];
    if (value === undefined) continue;
    if (value === null) { entry[field] = null; continue; }
    if (typeof value === "boolean") { entry[field] = value; continue; }
    if (typeof value === "number" && Number.isFinite(value)) { entry[field] = value; continue; }
    if (typeof value === "string" && value.length <= DASHBOARD_EVENT_MAX_TEXT) {
      entry[field] = value;
    }
  }
  return Object.freeze(entry);
}

/** Die Huelle einer Meldung. Ohne Ziel, ohne Referenz, ohne Geheimnis. */
export type DashboardEventNotice = Readonly<{
  schemaVersion: number;
  kind: DashboardEventKind;
  event: DashboardEventEntry;
}>;

/**
 * Ein Ereignis, eine Meldung.
 *
 * Gebuendelt wird ausdruecklich **nicht**. Ein Log-Drain buendelt, weil eine
 * ruhige Umgebung dort hunderte Zeilen je Minute erzeugt; ein Projekt erzeugt
 * am Tag eine Handvoll dieser Ereignisse. Eine Ladung mit einem Eintrag waere
 * eine Huelle um nichts, und ein Empfaenger, der eine Freigabe in einen
 * Chatkanal schreibt, muesste sie erst wieder auspacken.
 */
export function buildDashboardEventNotice(
  kind: DashboardEventKind,
  record: Readonly<Record<string, unknown>>,
): DashboardEventNotice {
  return Object.freeze({
    schemaVersion: DASHBOARD_WEBHOOK_SCHEMA_VERSION,
    kind,
    event: projectDashboardEvent(kind, record),
  });
}

/** Was eine Ereignisart ist und was sie traegt -- die Texte der Ansicht. */
export const DASHBOARD_EVENT_TEXTS: Readonly<Record<DashboardEventKind, Readonly<{
  label: string; carries: string;
}>>> = Object.freeze({
  migration_applied: Object.freeze({
    label: "Migration angewendet",
    carries: "Den Abschluss eines Migrationslaufs, gelungen oder gescheitert, mit der Kennung des Laufs, der Kennung des Change Sets und bei einem Fehlschlag dem festen Fehlercode. Nicht die Anweisung, nicht ihren Diff und nicht das Ergebnis, das der Executor auf der Projektdatenbank gesehen hat. Eingereiht, wiederholt und zur Prüfung zurückgestellt sind Zwischenstände desselben Laufs und lösen keine Meldung aus.",
  }),
  approval_decided: Object.freeze({
    label: "Freigabe entschieden",
    carries: "Eine erteilte, abgelehnte oder von der Automatik erteilte Freigabe, mit der Kennung der Freigabe und der Risikostufe. Nicht den Aktionshash, der die Freigabe an genau eine Anweisung bindet, und nicht die Person, die entschieden hat.",
  }),
  project_state_changed: Object.freeze({
    label: "Projektzustand gewechselt",
    carries: "Dass das Provisioning einer Umgebung fehlgeschlagen ist oder ein weiterer Versuch eingeplant wurde, mit der Kennung des Auftrags und dem gespeicherten Zustand. Nicht den Fehlercode des Anbieters und nicht die Zahl der Versuche: Für einen Projektzustand zeigt diese Console beides nirgends.",
  }),
  environment_added: Object.freeze({
    label: "Umgebung hinzugekommen",
    carries: "Dass eine Umgebung provisioniert wurde oder ihre Provisionierung angefragt ist, mit der Umgebung und der Kennung der Bindung. Nicht die Referenz auf die Datenbankinstanz, nicht die Kennung des Auftrags und nicht die Prüfsumme des Bootstrap-Vertrags.",
  }),
});

export const DASHBOARD_WEBHOOK_WHAT =
  "Ein Dashboard-Webhook meldet Ereignisse des Projekts selbst und trägt dabei genau die Felder, die diese Console für einen Audit-Eintrag schon zeigt. Diese Grenze hängt an einem Vertrag im Testlauf: Jedes gemeldete Feld muss im Zeilentyp der zugehörigen Ansicht vorkommen, sonst schlägt der Lauf fehl.";

export const DASHBOARD_WEBHOOK_NOT_DATABASE =
  "Änderungen an Ihren Tabellen meldet diese Seite nicht. Dafür gibt es die Datenbank-Webhooks unter Integrationen: Sie hängen an einem Trigger in der Projektdatenbank. Ein Dashboard-Webhook liest ausschliesslich die Audit-Kette der Control Plane und sieht keine einzige Zeile Ihrer Daten.";

export const DASHBOARD_WEBHOOK_NEVER =
  "Eine Meldung trägt nie eine SQL-Anweisung, nie einen Diff, nie einen Zeilenwert Ihrer Tabellen, nie eine E-Mail-Adresse, nie ein Token und nie ein Geheimnis. Die Referenz des Akteurs bleibt bewusst zurück, obwohl die Audit-Ansicht sie zeigt: Eine Benachrichtigung braucht nicht zu wissen, welcher Mensch entschieden hat, und wer es wissen muss, liest das Audit-Log.";

export const DASHBOARD_WEBHOOK_SECRET =
  "Jede Meldung wird mit HMAC-SHA256 signiert, über denselben Weg wie jeder andere ausgehende Webhook von QKERN. Der Schlüssel liegt im Vault; hier steht ausschliesslich seine Referenz, und es gibt in dieser Ansicht kein Feld, in das ein Geheimniswert passen würde.";

export const DASHBOARD_WEBHOOK_SAME_PATH =
  "Zugestellt wird über den vorhandenen Webhook-Weg: dieselbe Outbox mit Lease, dieselbe serverberechnete Wartezeit, dieselbe Versuchsgrenze und dasselbe Dead Letter. Ein zweiter Zustellweg wäre eine zweite Stelle, an der die Regeln für ausgehende Verbindungen auseinanderfallen könnten.";

export const DASHBOARD_WEBHOOK_AT_LEAST_ONCE =
  "Zugestellt wird mindestens einmal, nicht genau einmal. Zwischen dem Einreihen einer Meldung und dem Festhalten der Position liegt ein Augenblick, und zwei Compute-Prozesse mit derselben Umgebungsliste sind eine zulässige Betriebsform. Dieselbe Meldung kann deshalb zweimal ankommen; ein Empfänger erkennt das an der Kennung des Audit-Eintrags, die in jeder Meldung steht.";

export const DASHBOARD_WEBHOOK_NO_BACKFILL =
  "Die Vergangenheit wird nicht nachgeschickt. Ein neu angelegter Dashboard-Webhook beginnt an der Spitze der Audit-Kette; was vor dem Anlegen passiert ist, meldet er nicht. Der Stand liegt je Webhook und Ereignisart in der Control Plane, damit ein Neustart dort weiterliest, wo die letzte Meldung endete.";

export const DASHBOARD_WEBHOOK_NO_CHAIN =
  "Die Kette geht nicht mit hinaus. Jeder Audit-Eintrag trägt seinen Hash und den seines Vorgängers, und genau daran lässt sich in der Console prüfen, dass nichts entfernt wurde. Eine Meldung trägt beide Hashes nicht: Ein Empfänger kann aus einer Folge von Meldungen nicht beweisen, dass keine fehlt. Wer diesen Beweis braucht, liest das Audit-Log.";

export const DASHBOARD_WEBHOOK_NO_DELETE =
  "Löschen gibt es hier nicht. Ein Löschen nähme die wartenden Meldungen mit; Abschalten hält sie an, ohne etwas zu verlieren.";

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function dashboardWebhookTexts(): string[] {
  return [
    ...Object.values(DASHBOARD_WEBHOOK_REASONS),
    ...Object.values(DASHBOARD_EVENT_TEXTS).flatMap((entry) => [entry.label, entry.carries]),
    DASHBOARD_WEBHOOK_WHAT, DASHBOARD_WEBHOOK_NOT_DATABASE, DASHBOARD_WEBHOOK_NEVER,
    DASHBOARD_WEBHOOK_SECRET, DASHBOARD_WEBHOOK_SAME_PATH, DASHBOARD_WEBHOOK_AT_LEAST_ONCE,
    DASHBOARD_WEBHOOK_NO_BACKFILL, DASHBOARD_WEBHOOK_NO_CHAIN, DASHBOARD_WEBHOOK_NO_DELETE,
  ];
}
