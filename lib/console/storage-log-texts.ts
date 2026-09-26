/**
 * Die Texte der Speicher-Uebersicht (2.51), deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `usage-series-texts` (2.45) und `health-advisor-texts`
 * (2.44): Der Schluessel ist der deutsche Text, die Console uebersetzt ihn
 * ueber ihren Katalog, und der Vertrag `console-i18n-contract` liest diese
 * Tabellen mit und verlangt fuer jeden Text en, fr und it. Das eigene Modul
 * braucht es, weil die Ansicht `t(variable)` aufruft und ein Text hinter
 * einer Variablen durch die Suche nach `t("...")` faellt.
 *
 * Das Modul ist rein: keine Farbe, keine Datenbank, kein React.
 *
 * Der wichtigste Teil sind die Ehrlichkeitssaetze. Der Platzhalter
 * versprach bis 2.51 „Uploads, Downloads und Scanner-Urteile je Objekt".
 * Zwei der drei Dinge gibt es nicht: QKERN schreibt weder einen Upload noch
 * einen Download in eine Ereignistabelle. Was es gibt, ist die Zeile in
 * `project_storage_objects` mit dem aktuellen Stand und dem letzten Urteil
 * des Scanners. Die Seite sagt das selbst, bevor sie die erste Zeile zeigt.
 */

export const STORAGE_LOG_STATUS_IDS = ["quarantined", "clean", "infected"] as const;

export type StorageLogStatusId = (typeof STORAGE_LOG_STATUS_IDS)[number];

export type StorageLogStatusText = {
  label: string;
  /** Was dieser Stand ueber das Objekt aussagt. */
  meaning: string;
};

export const STORAGE_LOG_STATUS_TEXTS: Record<StorageLogStatusId, StorageLogStatusText> = {
  quarantined: {
    label: "In Quarantäne",
    meaning: "Hochgeladen und geprüft auf Grösse, Typ und Prüfsumme, aber noch ohne Urteil des Scanners. Ein Download ist gesperrt.",
  },
  clean: {
    label: "Sauber",
    meaning: "Der Scanner hat das Objekt freigegeben. Nur dafür stellt QKERN eine signierte Adresse aus.",
  },
  infected: {
    label: "Befallen",
    meaning: "Der Scanner hat das Objekt abgelehnt. Es wird im selben Schritt entfernt, die Zeile bleibt als Urteil stehen.",
  },
};

/** Der Satz, der vor der ersten Zeile steht. */
export const STORAGE_LOG_HONESTY =
  "QKERN führt kein Zugriffsprotokoll je Objekt. Diese Ansicht zeigt den Stand der Objekte und das Urteil des Scanners, nicht ihre Geschichte.";

/** Was ausdruecklich nicht dasteht — und warum es nicht dasteht. */
export const STORAGE_LOG_NOT_SHOWN =
  "Wer eine Datei hochgeladen oder heruntergeladen hat und wann, steht nirgends: Ein Upload hinterlässt die Reservierung, die beim Abschluss zur Objektzeile wird, ein Download nur eine kurzlebige signierte Adresse. Auch der Provider-Schlüssel, die Prüfsumme und der Inhalt bleiben aussen vor.";

/** Warum eine entfernte Zeile trotzdem noch dasteht. */
export const STORAGE_LOG_DELETED_NOTE =
  "Entfernte Objekte bleiben in der Liste, sonst wäre kein befallenes je zu sehen: Das Urteil und das Entfernen geschehen im selben Schritt.";

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function storageLogTexts(): string[] {
  return [
    ...Object.values(STORAGE_LOG_STATUS_TEXTS).flatMap((status) => [status.label, status.meaning]),
    STORAGE_LOG_HONESTY,
    STORAGE_LOG_NOT_SHOWN,
    STORAGE_LOG_DELETED_NOTE,
  ];
}
