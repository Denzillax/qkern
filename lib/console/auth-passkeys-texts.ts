/**
 * Die Texte von Auth → Passkeys (2.79), deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `auth-mfa-texts` (2.52) und `auth-hooks-texts` (2.77):
 * Der Schluessel ist der deutsche Text, die Console uebersetzt ihn ueber ihren
 * Katalog, und der Vertrag `console-i18n-contract` liest diese Tabellen mit und
 * verlangt fuer jeden Text en, fr und it. Ein eigenes Modul braucht es, weil
 * die Ansicht `t(variable)` aufruft und ein Text hinter einer Variablen durch
 * die Suche nach `t("...")` faellt.
 *
 * Das Modul ist rein: keine Farbe, keine Datenbank, kein React.
 *
 * Der wichtigste Teil sind die Ehrlichkeitssaetze, und es sind hier mehr als
 * sonst. Bei einer Anmeldung mit Kryptografie ist die Liste der Pruefungen, die
 * **nicht** laufen, die einzige Angabe, die man hinterher nicht selbst
 * herausfinden kann.
 */

/** Welche Pruefungen bei jeder Anmeldung wirklich laufen. */
export const AUTH_PASSKEYS_CHECKS_RUN =
  "Bei jeder Anmeldung läuft: die Herausforderung wird in der Datenbank verbraucht und gilt danach nicht mehr; die Signatur über authenticatorData und den SHA-256 der clientDataJSON wird gegen den abgelegten öffentlichen Schlüssel nachgerechnet; type, challenge, origin und crossOrigin werden aus den Client-Daten geprüft; der rpIdHash muss der Hash genau der Domäne sein, von der die Antwort kommt; das Bit für die Anwesenheit des Nutzers muss gesetzt sein; und der Zähler muss gewachsen sein.";

/** Warum die Einmaligkeit in der Datenbank sitzt und nicht im Dienst. */
export const AUTH_PASSKEYS_CHALLENGE_ONCE =
  "Die Herausforderung ist 32 zufällige Byte, gilt fünf Minuten und wird mit einem einzigen UPDATE verbraucht, das nur dann eine Zeile zurückgibt, wenn es sie selbst als verbraucht markiert hat. Darum kommen auch zwei gleichzeitige Anfragen mit derselben Herausforderung genau einmal durch. Eine wiederverwendbare Herausforderung wäre ein Wiedereinspielangriff.";

/** Was mit einem rückwärts laufenden Zähler passiert, und wann er nichts sagt. */
export const AUTH_PASSKEYS_COUNTER =
  "Ein Zähler, der nicht gewachsen ist, heisst geklonter Schlüssel, und die Anmeldung wird abgewiesen. Stehen der abgelegte und der vorgezeigte Stand beide auf 0, führt dieser Authenticator keinen Zähler (Apple tut das nicht), und dann gibt es nichts zu vergleichen. Das ist die eine Stelle, an der diese Prüfung durchlässt.";

/** Welche Verfahren zugelassen sind, und was mit den anderen geschieht. */
export const AUTH_PASSKEYS_ONLY_ES256 =
  "Zugelassen ist genau ein Verfahren: ES256, also ECDSA über P-256 mit SHA-256. Das bieten Windows Hello, Touch ID, Face ID, Android und jeder YubiKey ab Serie 5. RS256 und EdDSA werden abgewiesen, weil jedes weitere Verfahren ein zweiter Unterschriftenweg wäre, den kein Zertifizierungsfall mit einem echten Schlüssel abfährt.";

/** Die Attestation, und dass sie nicht geprüft wird. */
export const AUTH_PASSKEYS_NO_ATTESTATION =
  "Die Attestation wird nicht geprüft. Plattform-Authenticatoren schicken fmt none, und darin steht keine Aussage über die Herkunft des Geräts, die man prüfen könnte; eine Kette gegen die FIDO-Metadaten wäre eine eigene Ablage. Bei der Registrierung glaubt QKERN also, dass der Schlüssel aus dem Gerät kommt, das der Nutzer gerade in der Hand hat. Ab der ersten Anmeldung glaubt es nichts mehr und rechnet nach.";

/** Warum eine Anmeldung mit Passkey aal1 bleibt. */
export const AUTH_PASSKEYS_STAYS_AAL1 =
  "Eine Anmeldung mit Passkey ergibt eine aal1-Sitzung, auch wenn der Authenticator den Nutzer per Fingerabdruck erkannt hat. aal2 heisst in QKERN „ein bestätigter zweiter Faktor liegt vor“, und das ist eine andere Aussage. Verlangt die Umgebung den zweiten Faktor, endet auch eine Anmeldung mit Passkey erst bei einer TOTP-Challenge.";

/** Dass der Weg zur Sitzung derselbe ist wie beim Passwort. */
export const AUTH_PASSKEYS_SAME_PATH =
  "Die Sitzung entsteht an derselben Stelle wie bei einer Anmeldung mit Passwort. Darum läuft auch der Auth-Hook sign_in, und darum greifen die Grenzen je Zeitfenster und der erzwungene zweite Faktor hier genauso.";

/** Woher die erlaubten Herkünfte kommen, und was das ausschliesst. */
export const AUTH_PASSKEYS_ORIGINS =
  "Geprüft wird gegen die Herkünfte der Installation, dieselbe Liste, die auch die Rücksprungziele begrenzt. Der rpIdHash muss der Hash genau dieses Hostnamens sein; ein Passkey über mehrere Unterdomänen hinweg, wie WebAuthn es mit einer registrierbaren Oberdomäne erlaubt, geht hier nicht.";

/** Was der Server bei der Anmeldung nicht vorgibt, und was daraus folgt. */
export const AUTH_PASSKEYS_DISCOVERABLE =
  "Die Anmeldung nennt keine Liste erlaubter Schlüssel, weil sie vorher nicht weiss, wer kommt. Der Browser muss den Passkey darum selbst finden können; ein Schlüssel, der nur auf einem Sicherheitsschlüssel ohne eigenen Speicher liegt, wird so nicht gefunden.";

/** Was diese Seite ausdrücklich nicht kann. */
export const AUTH_PASSKEYS_CANNOT_DO =
  "Diese Seite richtet keinen Passkey ein und entfernt keinen. Einrichten kann nur, wer den Authenticator in der Hand hat; entfernen tut der Nutzer in seiner eigenen Anwendung. Die Console sieht drei Zahlen und die geprüften Herkünfte, aber keine Kennung, keinen Schlüssel und keinen Nutzer.";

/** Was in der Ablage liegt, und was dort nicht liegt. */
export const AUTH_PASSKEYS_STORAGE =
  "In der Datenbank liegt ein öffentlicher Schlüssel und nichts Geheimes. Der private Teil verlässt den Authenticator nie. Ein Leck dieser Tabelle gibt niemandem eine Anmeldung; es verrät, welche Nutzer wie viele Passkeys haben.";

/**
 * Was wirklich laeuft, in der Reihenfolge, in der der Dienst es prueft. Die
 * Liste steht hier und nicht in der Ansicht, weil die Ansicht sie ueber
 * t(variable) zeigt und ein Text hinter einer Variablen durch die Suche nach
 * t("...") faellt.
 */
export const AUTH_PASSKEYS_CHECKS_THAT_RUN = [
  "Die Herausforderung wird in der Datenbank verbraucht",
  "Der Typ der Client-Daten",
  "Die Herausforderung aus den Client-Daten",
  "Die Herkunft aus den Client-Daten",
  "crossOrigin aus den Client-Daten",
  "Der rpIdHash gegen die Domäne der Herkunft",
  "Das Bit für die Anwesenheit des Nutzers",
  "Die Signatur gegen den abgelegten öffentlichen Schlüssel",
  "Der Zähler, sofern der Authenticator ihn führt",
] as const;

/** Was bewusst nicht laeuft. Jeder Eintrag hat seinen Satz weiter oben. */
export const AUTH_PASSKEYS_CHECKS_THAT_DO_NOT_RUN = [
  "Die Attestation des Authenticators",
  "Andere Verfahren als ES256",
  "Der Zähler, wenn beide Stände auf 0 stehen",
  "Eine registrierbare Oberdomäne als rpId",
  "Die Benutzerbestätigung als zweiter Faktor",
] as const;

/** Die Gründe, aus denen eine Antwort abgewiesen wird, als Sätze. */
export const AUTH_PASSKEYS_REFUSAL_TEXTS = {
  challenge_spent: "Die Herausforderung war verbraucht oder abgelaufen",
  challenge_mismatch: "Die Herausforderung in den Client-Daten passte nicht",
  type_mismatch: "Der Typ der Client-Daten passte nicht zum Vorgang",
  origin_not_allowed: "Die Herkunft steht nicht in der erlaubten Liste",
  cross_origin: "Die Antwort kam aus einem eingebetteten Rahmen",
  rp_id_hash_mismatch: "Der rpIdHash passte nicht zur Domäne",
  user_not_present: "Niemand hat das Gerät berührt",
  signature_invalid: "Die Signatur stimmte nicht",
  sign_count_regressed: "Der Zähler lief rückwärts: geklonter Schlüssel",
  unsupported_algorithm: "Das Verfahren des Schlüssels wird nicht geprüft",
  credential_unknown: "Diesen Schlüssel kennt die Umgebung nicht",
  malformed_response: "Die Antwort des Browsers war nicht lesbar",
  malformed_client_data: "Die Client-Daten waren nicht lesbar",
  attested_credential_data_missing: "Die Antwort trug keinen Schlüssel",
} as const;

export type AuthPasskeyRefusalId = keyof typeof AUTH_PASSKEYS_REFUSAL_TEXTS;

/** Die Verfahren, die es gibt, als Wort. Heute genau eines. */
export const AUTH_PASSKEYS_ALGORITHM_TEXTS = {
  "-7": "ES256 (ECDSA über P-256 mit SHA-256)",
} as const;

/** Wie das Verfahren einer Zeile heisst, oder die Zahl, wenn es unbekannt ist. */
export function authPasskeyAlgorithmText(algorithm: number): string {
  return algorithm === -7 ? AUTH_PASSKEYS_ALGORITHM_TEXTS["-7"] : `COSE ${algorithm}`;
}

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function authPasskeysTexts(): string[] {
  return [
    AUTH_PASSKEYS_CHECKS_RUN,
    AUTH_PASSKEYS_CHALLENGE_ONCE,
    AUTH_PASSKEYS_COUNTER,
    AUTH_PASSKEYS_ONLY_ES256,
    AUTH_PASSKEYS_NO_ATTESTATION,
    AUTH_PASSKEYS_STAYS_AAL1,
    AUTH_PASSKEYS_SAME_PATH,
    AUTH_PASSKEYS_ORIGINS,
    AUTH_PASSKEYS_DISCOVERABLE,
    AUTH_PASSKEYS_CANNOT_DO,
    AUTH_PASSKEYS_STORAGE,
    ...AUTH_PASSKEYS_CHECKS_THAT_RUN,
    ...AUTH_PASSKEYS_CHECKS_THAT_DO_NOT_RUN,
    ...Object.values(AUTH_PASSKEYS_REFUSAL_TEXTS),
    ...Object.values(AUTH_PASSKEYS_ALGORITHM_TEXTS),
  ];
}
