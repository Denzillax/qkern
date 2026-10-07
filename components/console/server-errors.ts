import { t } from "@/components/console/console-i18n";

/**
 * Die Fehlermeldungen des Servers in der Sprache der Console (2.160).
 *
 * **Der Befund.** Die Routen antworten auf Englisch (`Resource not found`,
 * `Authentication required`), und 75 Ansichten zeigten diesen Text nach dem
 * Muster `payload.error ?? t("deutscher Ersatz")`. Der Ersatz kam damit nur,
 * wenn der Server gar nichts sagte; sonst stand mitten in der deutschen
 * Oberflaeche ein englischer Satz. Gesehen im Nachbau der Console, wo jede
 * nicht nachgebildete Route mit `Resource not found` antwortete.
 *
 * **Was hier steht.** Die haeufigen Meldungen einzeln, und vier Familien mit
 * je einem Satz: `Invalid …`, `… unavailable`, `Could not …` und
 * `… is disabled`. Eine Familie sagt weniger als der englische Satz, etwa
 * nicht, welcher Dienst fehlt; das sagt die Seite, auf der sie steht.
 *
 * **Was nicht.** Eine Meldung, die hier nicht vorkommt, bleibt, wie der Server
 * sie schickt. Sie zu verschlucken waere schlimmer als sie englisch zu lassen,
 * denn dann saehe man nicht mehr, dass etwas schiefging, oder nur den
 * allgemeinen Ersatz. Die Codes der Zustellung (`EGRESS_LIMIT` und so weiter)
 * bleiben ebenfalls stehen: Sie sind Bezeichner, nach denen man sucht.
 */
const EXACT: Record<string, string> = {
  "Resource not found": "Nicht gefunden. Die Ressource gibt es in dieser Umgebung nicht, oder sie gehört zu einem anderen Projekt.",
  "Authentication required": "Die Sitzung ist abgelaufen. Bitte melde dich neu an.",
  "Authentication failed": "Die Anmeldung wurde abgelehnt.",
  "Origin is not allowed": "Die Anfrage kam von einer Adresse, die dieses Projekt nicht zulässt.",
  "Request origin is not allowed": "Die Anfrage kam von einer Adresse, die dieses Projekt nicht zulässt.",
  "Too many attempts": "Zu viele Versuche. Warte einen Moment und versuch es dann noch einmal.",
  "Too many requests": "Zu viele Anfragen. Warte einen Moment und versuch es dann noch einmal.",
  "Usage quota exceeded": "Das Nutzungskontingent dieser Umgebung ist ausgeschöpft.",
  "Storage quota exceeded": "Das Speicherkontingent dieser Umgebung ist ausgeschöpft.",
  "Project data plane is not ready": "Die Projektdatenbank ist noch nicht bereit.",
  "Project environment is not provisioned": "Diese Umgebung hat noch keine Datenbank.",
  "Vault is not connected": "Der Tresor ist nicht verbunden.",
  "Vault is misconfigured": "Der Tresor ist falsch eingerichtet.",
  "The function is at its concurrency limit": "Die Function läuft schon so oft gleichzeitig, wie sie darf.",
  "Approval was already decided": "Über diese Freigabe wurde schon entschieden.",
  "Approval expired; create a fresh Change Set": "Die Freigabe ist abgelaufen. Lege das Change Set neu an.",
  "Change Set is not approved": "Das Change Set ist noch nicht freigegeben.",
  "Production apply is not authorized": "Für Production fehlt die Berechtigung zum Anwenden.",
  "Views are read-only": "Eine View lässt sich nur lesen.",
  "A row-level security policy rejected the write": "Eine Policy der Tabelle hat das Schreiben abgelehnt.",
  // Die Ablehnungen, die ein Formular am ehesten bekommt (2.171), gefunden,
  // indem jeder Fehlercode von Storage und Compute durch die echte Abbildung
  // der Route lief. Ein Konflikt hat drei Ursachen, und der Satz nennt alle.
  "Storage conflict": "Das widerspricht dem, was schon da ist: Der Name ist vergeben, die Höchstzahl ist erreicht, oder jemand hat dasselbe gleichzeitig geändert.",
  "Compute definition conflict": "Das widerspricht dem, was schon da ist: Der Name ist vergeben, die Höchstzahl ist erreicht, oder jemand hat dasselbe gleichzeitig geändert.",
  "Disable the webhook before deleting it": "Schalte den Webhook zuerst ab, dann lässt er sich löschen.",
  "The usage quota for function invocations is exhausted": "Das Kontingent für Function-Aufrufe ist ausgeschöpft.",
  "Object is quarantined or not ready": "Das Objekt ist noch in Quarantäne oder nicht fertig hochgeladen.",
  "Object was rejected": "Das Objekt wurde abgelehnt, weil der Scanner es nicht freigegeben hat.",
  // Auth, Queues und Usage (2.172), nach demselben Durchlauf durch die echten
  // Abbildungen der Routen. Die Konflikte stehen mit den Ursachen, die der
  // Code an der Stelle wirklich kennt.
  // Loeschen eines Projekts (2.173).
  "The confirmation does not match the project name.": "Der abgetippte Name passt nicht zum Projekt.",
  "This role may not delete projects.": "Ein Projekt löschen darf nur die Owner-Rolle.",
  "Account already exists": "Unter dieser Adresse gibt es schon ein Konto.",
  "Email verification required": "Die E-Mail-Adresse ist noch nicht bestätigt.",
  "Password appears in a known credential leak": "Dieses Passwort steht in einer bekannten Sammlung geleakter Zugangsdaten. Wähle ein anderes.",
  "Password does not meet the policy of this project": "Das Passwort erfüllt die Regeln dieses Projekts nicht.",
  "Sign-in refused by the auth hook of this project": "Der Auth-Hook dieses Projekts hat die Anmeldung abgelehnt.",
  "Project Auth hook did not answer": "Der Auth-Hook dieses Projekts hat nicht geantwortet.",
  "Project Auth hook returned an answer that was refused": "Der Auth-Hook hat eine Antwort geschickt, die nicht angenommen wurde.",
  "Project Auth audit is not configured": "Das Audit-Log von Project Auth ist nicht eingerichtet.",
  "Queue conflict": "Das widerspricht dem, was schon da ist: Der Name der Queue ist vergeben, oder jemand hat sie gleichzeitig geändert.",
  "Queue capacity exceeded": "Die Queue ist voll: Sie hält schon so viele offene Nachrichten, wie sie darf.",
  "Queue lease is no longer valid": "Die Lease dieser Nachricht gilt nicht mehr. Sie ist abgelaufen, oder ein anderer Worker hat die Nachricht übernommen.",
  "Usage idempotency conflict": "Ein Ereignis mit demselben Schlüssel wurde schon mit anderen Werten gemeldet.",
  "Usage policy conflict": "Das widerspricht dem bestehenden Preisblatt: Für diesen Zeitpunkt gibt es schon einen Eintrag, oder die Währung passt nicht zu den bisherigen.",
};

const INVALID = "Die Anfrage wurde abgelehnt, weil ein Wert fehlt oder ungültig ist.";
const UNAVAILABLE = "Der Dienst antwortet gerade nicht. Versuch es gleich noch einmal.";
const FAILED = "Das hat nicht geklappt. Der Server hat die Anfrage nicht ausgeführt.";
const DISABLED = "Dieser Dienst ist für diese Umgebung abgeschaltet.";

function germanOf(raw: string): string | undefined {
  if (raw in EXACT) return EXACT[raw];
  if (/^Invalid\b/.test(raw)) return INVALID;
  if (/ (is |are )?unavailable$/.test(raw)) return UNAVAILABLE;
  if (/^Could not\b/.test(raw)) return FAILED;
  if (/ (is|are) disabled$/.test(raw)) return DISABLED;
  return undefined;
}

/**
 * Die Meldung des Servers, uebersetzt, wenn sie bekannt ist. Ohne Meldung
 * kommt `undefined` zurueck, damit `?? t("Ersatz")` wie bisher greift.
 */
export function serverErrorText(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const german = germanOf(raw);
  return german === undefined ? raw : t(german);
}

/** Alle Saetze, damit der i18n-Vertrag sie findet; `t(variable)` sieht er nicht. */
export function serverErrorTexts(): string[] {
  return [...new Set([...Object.values(EXACT), INVALID, UNAVAILABLE, FAILED, DISABLED])];
}
