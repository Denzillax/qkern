/**
 * Die Texte der Vault-Uebersicht (2.58), deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `log-view-texts` (2.51) und `storage-log-texts`: Der
 * Schluessel ist der deutsche Text, die Console uebersetzt ihn ueber ihren
 * Katalog, und der Vertrag `console-i18n-contract` liest diese Tabellen mit und
 * verlangt fuer jeden Text en, fr und it. Das eigene Modul braucht es, weil die
 * Ansicht `t(variable)` aufruft und ein Text hinter einer Variablen durch die
 * Suche nach `t("...")` faellt.
 *
 * Das Modul ist rein: keine Farbe, keine Datenbank, kein React -- und kein
 * Feld, das ein Geheimnis halten koennte.
 *
 * Der Platzhalter `int-vault` versprach „Geheimnisse verwalten". Verwaltet wird
 * hier nichts. QKERN zeigt keinen Wert und nimmt keinen entgegen; wer ein
 * Geheimnis anlegt, dreht oder loescht, tut das im Vault. Die Seite sagt das
 * woertlich, statt ein Formular anzubieten, das ein Geheimnis durch einen
 * Browser, ein Anfrageprotokoll und einen Prozess traegt, die es nichts angeht.
 */

/** Die drei Woerter des Inspektors aus 2.38, mit ihrer Bedeutung. */
export const VAULT_REFERENCE_STATUS = {
  present: {
    label: "vorhanden",
    meaning: "Der Vault kennt diesen Pfad und hält dort eine lebende Version.",
  },
  missing: {
    label: "fehlt",
    meaning: "Der Vault kennt diesen Pfad nicht, oder die aktuelle Version ist gelöscht. Eine Zustellung, die ihn braucht, wird nicht signiert.",
  },
  forbidden: {
    label: "kein Zugriff",
    meaning: "Entweder passt die Referenz nicht in die Pfadregel und wird gar nicht erst angefragt, oder die Policy des Tokens erlaubt das Lesen der Metadaten dieses Pfads nicht.",
  },
} as const satisfies Record<string, { label: string; meaning: string }>;

export type VaultReferenceStatusId = keyof typeof VAULT_REFERENCE_STATUS;

/** Woher eine Referenz kommt. Drei Quellen, mehr kennt QKERN heute nicht. */
export const VAULT_REFERENCE_USERS = {
  function: {
    label: "Function",
    meaning: "Eine Function-Definition deklariert diese Referenz unter ihren Secrets.",
  },
  webhook: {
    label: "Webhook",
    meaning: "Ein ausgehender Webhook signiert seine Zustellungen mit diesem Schlüssel.",
  },
  "database-webhook": {
    label: "Datenbank-Webhook",
    meaning: "Ein Datenbank-Webhook signiert seine Zustellungen mit diesem Schlüssel.",
  },
} as const satisfies Record<string, { label: string; meaning: string }>;

export type VaultReferenceUserId = keyof typeof VAULT_REFERENCE_USERS;

/**
 * Was ein Betreiber im Vault selbst tun muss, damit diese Seite etwas Wahres
 * sagen kann. Ohne diese Saetze waere die Seite eine Statusanzeige ohne
 * Handlungsweg.
 */
export const VAULT_OPERATOR_STEPS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Anlegen und Ändern geschieht im Vault",
    body: "QKERN zeigt keinen Wert an und nimmt keinen entgegen. Es gibt auf dieser Seite und in ihrer Route kein Feld für ein Geheimnis. Ein neues Geheimnis, eine Rotation und eine Löschung laufen über den Vault selbst, etwa über vault kv put oder die API von KV Version 2.",
  },
  {
    title: "Die Pfadregel, die QKERN akzeptiert",
    body: "Eine Referenz hat die Form vault:pfad/zum/secret: das Wort vault:, danach Segmente aus Buchstaben, Ziffern, Unterstrich und Bindestrich, durch Schrägstriche getrennt, jedes Segment höchstens 64 Zeichen. Kein führender Schrägstrich, kein Punkt-Punkt, keine Query. Alles liegt unter dem fest konfigurierten KV-Mount; eine Referenz kann ihn nicht verlassen. Was nicht in diese Form passt, gilt als kein Zugriff und wird gar nicht erst angefragt.",
  },
  {
    title: "Die Policy, die der Token braucht",
    body: "Zum Prüfen genügt read auf <mount>/metadata/<pfad>. Das Lesen der Daten braucht diese Seite nicht und bekommt es auch nicht: Gefragt wird ausschliesslich der Metadaten-Endpunkt von KV Version 2. Antwortet der Vault mit 403, steht hier kein Zugriff.",
  },
  {
    title: "Der Zustellprozess braucht mehr",
    body: "Signiert wird nicht hier, sondern im Compute-Prozess, und der liest den Wert. Sein Token braucht read auf <mount>/data/<pfad>. Das sind bewusst zwei Tokens mit zwei Policies: Die Console soll den Schlüssel nicht lesen können, den sie anzeigt.",
  },
];

/**
 * Die Grenze der Seite, offen ausgesprochen. Sie steht hier und nicht nur im
 * Kommentar, weil sie in der Ansicht stehen muss.
 */
export const VAULT_OVERVIEW_SCOPE = [
  "Diese Seite zeigt jede Secret-Referenz, auf die QKERN in dieser Umgebung zeigt: aus Function-Definitionen, aus ausgehenden Webhooks und aus Datenbank-Webhooks.",
  "Sie listet den Vault nicht auf. Ein Geheimnis, auf das nichts in QKERN zeigt, erscheint hier nicht — QKERN kann es ohne eine Auflistung nicht kennen, und ein Verzeichnis fremder Vault-Pfade in einer Web-Konsole wäre genau die Offenlegung, die diese Seite vermeidet.",
  "Eine Referenz erscheint einmal, auch wenn mehrere Stellen sie benutzen. Alle Benutzer stehen dann in derselben Zeile.",
] as const;

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function vaultOverviewTexts(): string[] {
  return [
    ...Object.values(VAULT_REFERENCE_STATUS).flatMap((entry) => [entry.label, entry.meaning]),
    ...Object.values(VAULT_REFERENCE_USERS).flatMap((entry) => [entry.label, entry.meaning]),
    ...VAULT_OPERATOR_STEPS.flatMap((entry) => [entry.title, entry.body]),
    ...VAULT_OVERVIEW_SCOPE,
  ];
}
