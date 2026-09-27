/**
 * Die Texte der Seite Einstellungen -> Compute und Disk (2.88), deutsch und
 * an einer Stelle.
 *
 * Gleiche Bauart wie `missing-log-texts` (2.84): Der Schluessel ist der
 * deutsche Text, die Console uebersetzt ihn ueber ihren Katalog, und der
 * Vertrag `console-i18n-contract` liest diese Tabellen mit und verlangt fuer
 * jeden Text en, fr und it. Ein eigenes Modul braucht es, weil die Ansicht
 * `t(variable)` aufruft und ein Text hinter einer Variablen durch die Suche
 * nach `t("...")` faellt.
 *
 * Das Modul ist rein: keine Farbe, keine Datenbank, kein React.
 *
 * Der Platzhalter versprach „Groesse der Instanz und der Platte" und sagte
 * dazu, die Provisionierung sei „noch nicht verbunden". Beides war falsch,
 * und zwar in zwei verschiedene Richtungen.
 *
 * Die Provisionierung ist gebaut: Migration 0020 fuehrt Auftraege und
 * Bindungen, ein eigener Prozess arbeitet sie unter einer eigenen Rolle ab,
 * und die Route `.../provisioning` gibt es seit 1.60. Was fehlt, ist die
 * Groesse, und sie fehlt nicht bloss noch: Ein Auftrag traegt keine, eine
 * Bindung traegt keine, und die Antwort des Vermittlers hat einen
 * geschlossenen Schluesselsatz, in dem keine Stelle fuer eine Groesse frei
 * ist. Das ist nachgezaehlt, nicht vermutet.
 *
 * Die Seite wiederholt darum nicht, was Infrastruktur (2.68) schon sagt, und
 * beantwortet stattdessen die zwei Fragen, die sonst niemand beantwortet: was
 * ist bestellt, und was ist gebunden.
 */

/* ------------------------------------------------------------------ *
 * Die Seite selbst
 * ------------------------------------------------------------------ */

export const PROVISIONING_ORDER_TEXTS = {
  kicker: "EINSTELLUNGEN",
  title: "Compute und Disk: bestellt wird eine Datenbank, keine Ausstattung",
  /** Der Satz, der die Seite eroeffnet. Er sagt nicht „noch nicht". */
  noSize:
    "Eine Grösse der Instanz und eine Grösse der Platte gibt es bei QKERN nicht, und sie fehlen nicht bloss noch. Die Provisionierung ist gebaut und läuft: Ein Auftrag geht an einen Vermittler, und zurück kommt eine Bindung. Nur trägt weder der Auftrag noch die Bindung eine Zahl für CPU, Arbeitsspeicher oder Plattenplatz. Bestellt wird der Zugang zu einer Datenbank, nicht die Maschine darunter.",
  /** Warum eine Groesse nicht einmal versehentlich entstehen koennte. */
  closedShape:
    "Das ist keine Auslassung, sondern eine Form. Die Antwort des Vermittlers wird gegen einen festen Schlüsselsatz geprüft: genau neun Felder, nicht acht und nicht zehn. Eine Antwort mit einem zusätzlichen Feld, auch einer Grösse, gilt als ungültige Bindung und wird verworfen, bevor irgendetwas davon in die Datenbank kommt. Eine Grösse liesse sich hier also nicht einmal versehentlich hineinreichen.",
  /** Die Abgrenzung gegen die Seite, die es schon gibt. */
  scope:
    "Was diese Umgebung wirklich fährt, also Postgres-Version, Kodierung und die gemessene Grösse der Datenbank, steht unter Einstellungen → Infrastruktur und wird hier nicht wiederholt. Diese Seite beantwortet die zwei Fragen davor: Was ist bestellt, und was ist gebunden.",

  /* Was bestellt wird. */
  orderTitle: "Was bestellt wird",
  orderMeaning:
    "Ein Auftrag verlässt QKERN mit sechs Angaben: der Kennung des Auftrags, der Organisation, dem Projekt, der Umgebung, der Region als Text und dem Abdruck des Bootstrap-Vertrags. Das ist die ganze Bestellung. Es gibt kein Feld für einen Tarif, keine Stufe, keine Ausstattung und keine Wahl zwischen zwei Maschinen.",
  orderRegion:
    "Die Region ist die einzige Angabe, die überhaupt nach einer Wahl aussieht, und sie ist keine: Sie ist der Text, der beim Anlegen in die Projektzeile geschrieben wurde. QKERN prüft ihn gegen keinen Standort und wählt danach keine Hardware.",
  orderContract:
    "Der Abdruck des Bootstrap-Vertrags ist eine feste Zeichenkette, die im Quelltext und in der Migration an derselben Stelle steht. Kommt eine Bindung mit einem anderen Abdruck zurück, endet der Auftrag mit BOOTSTRAP_UNVERIFIED. Er beschreibt, welche Tabellen die neue Datenbank mitbringen muss, nicht wie gross sie ist.",

  /* Der Zustand des Auftrags: die echte Lesung. */
  jobTitle: "Der Auftrag dieser Umgebung",
  jobMeaning:
    "Gelesen wird der Zustand des Provisionierungsauftrags für genau diese Umgebung. Er sagt, wo der Auftrag steht, wie viele Versuche gelaufen sind, wie viele Wiederholungsrunden ein Betreiber schon angestossen hat und, wenn er gescheitert ist, an welcher der fünf Klassen. Zeitpunkte gibt es zwei: angelegt und zuletzt bewegt.",
  jobLimits:
    "Mehr steht in dieser Antwort nicht. Wer den Auftrag ausgelöst hat, welcher Prozess ihn gerade hält, wie lange seine Pacht noch läuft und wann er begonnen oder geendet hat, bleibt in der Tabelle und wird nicht herausgegeben. Die Grenzen fünf Versuche und drei Wiederholungsrunden stehen in der Migration als Prüfbedingung und sind keine Einstellung dieser Seite.",
  jobNoHistory:
    "Es gibt je Umgebung genau einen Auftrag, kein Protokoll und keinen Verlauf. Eine Wiederholung setzt denselben Auftrag zurück, statt einen zweiten anzulegen; die Zahl der Wiederholungsrunden ist das Einzige, was davon übrig bleibt.",

  /* Was gebunden ist. */
  bindingTitle: "Was gebunden ist",
  bindingMeaning:
    "Eine Bindung entsteht genau dann, wenn ein Auftrag gelingt. Das ist keine Gepflogenheit, sondern eine Prüfbedingung der Tabelle: Der Zustand erfolgreich ist nur zusammen mit einer Bindung ausdrückbar, und gescheitert nur ohne. Steht der Auftrag unten auf erfolgreich, dann gibt es die Bindung, und zwar unabhängig davon, ob jemand sie lesen darf.",
  bindingUnreadable:
    "Lesen darf sie hier niemand. Die Laufzeit des Webs hat auf die Tabelle der Bindungen kein Leserecht, und die einzige Funktion, die sie zum Auftrag befragen darf, gibt kein einziges Feld der Bindung heraus, nicht einmal deren Kennung. Diese Seite lässt die Werte also nicht aus Vorsicht weg. Sie kommen nie bei ihr an.",
  bindingFieldsTitle: "Die neun Felder einer Bindung",
  bindingFieldsMeaning:
    "Wie die Bindung gebaut ist, steht im Quelltext und in der Migration, und das darf hier stehen: Es ist die Form, nicht der Inhalt. Keines der neun Felder ist eine Grösse. Vier davon sind der Grund, warum die Zeile nicht zur Laufzeit des Webs gehört.",
  bindingFieldsNoValues:
    "Unten stehen die Namen der Felder und was sie bedeuten. Kein Wert steht dort, und diese Seite hat auch keinen geholt.",

  /* Was es nicht gibt. */
  noResizeTitle: "Was hier niemand ändern kann",
  noResizeMeaning:
    "Es gibt keinen Weg, eine Instanz zu vergrössern, eine Platte zu erweitern oder einen Tarif zu wechseln, und es gibt hier deshalb auch keinen Knopf dafür. Ein solcher Knopf hätte kein Feld, in das er schreiben könnte: In der Kontrollebene steht keine Spalte für eine Ausstattung, weder bei den Projekten noch bei den Umgebungen noch bei den Aufträgen.",
  noResizeStorage:
    "Auch für Storage gibt es kein Kontingent, das sich kaufen liesse. Was an Speicher anfällt, wird gemessen und in der Abrechnung als Menge geführt, nicht als reservierter Platz. Was das kostet, steht unter Einstellungen → Add-ons und Einstellungen → Abrechnung.",
  noResizeWrite:
    "Diese Seite liest und schreibt nicht. Einen Auftrag anstossen kann die REST-Fläche, und nur für eine Umgebung, die noch auf keine Datenbank zeigt; die Console tut es von hier aus nicht.",

  /* Fuer Betreiber. */
  operatorTitle: "Wenn der Auftrag klemmt",
  operatorSteps:
    "Ein Auftrag, der hängt, ist fast immer eine Frage an den Prozess, nicht an dieses Projekt. Der Provisionierer meldet sich in eigenen Zeilen, und die Gesamtlage aller Aufträge einer Organisation steht unter einer eigenen Route mit reinen Summen, ohne Projekt und ohne Umgebung. Diese Seite zeigt sie nicht, weil sie über diese eine Umgebung Auskunft gibt und nicht über den Betrieb.",
  operatorCodes:
    "Die fünf Fehlerklassen sind in der Migration aufgezählt und damit abschliessend. Eine sechste kann nicht entstehen, weil die Spalte sie nicht annimmt.",
} as const;

/* ------------------------------------------------------------------ *
 * Der Zustand eines Auftrags
 * ------------------------------------------------------------------ */

/** Die vier Zustaende aus `qkern_project_provisioning_status`. */
export type ProvisioningJobStateId = "pending" | "running" | "succeeded" | "failed";

export type ProvisioningJobStateText = {
  label: string;
  explains: string;
  /** Dieselben Klassen wie die Berater. */
  tone: "secure" | "muted" | "risk medium" | "risk high";
};

export const PROVISIONING_JOB_STATE_TEXTS: Record<ProvisioningJobStateId, ProvisioningJobStateText> = {
  pending: {
    label: "wartet",
    explains: "Der Auftrag liegt bereit und hält keine Pacht. Ein Provisionierer nimmt ihn, sobald sein Fälligkeitszeitpunkt erreicht ist; bis dahin ist nichts geschehen.",
    tone: "muted",
  },
  running: {
    label: "läuft",
    explains: "Ein Provisionierer hält diesen Auftrag unter einer Pacht mit Ablauf. Läuft die Pacht ab, ohne dass er fertig wird, nimmt ihn die nächste Runde wieder auf.",
    tone: "muted",
  },
  succeeded: {
    label: "erfolgreich",
    explains: "Der Auftrag ist fertig, und damit gibt es eine Bindung. Die Prüfbedingung der Tabelle lässt diesen Zustand ohne Bindung gar nicht zu.",
    tone: "secure",
  },
  failed: {
    label: "gescheitert",
    explains: "Der Auftrag hat alle fünf Versuche verbraucht und keine Bindung erzeugt. Eine Wiederholungsrunde kann ihn zurücksetzen, solange drei noch nicht erreicht sind.",
    tone: "risk high",
  },
};

export function provisioningJobState(status: string): ProvisioningJobStateId {
  return status === "pending" || status === "running" || status === "succeeded" || status === "failed"
    ? status
    : "pending";
}

/** Die fuenf Fehlerklassen, so wie die Migration sie aufzaehlt. */
export const PROVISIONING_ERROR_TEXTS: Record<string, string> = {
  PROVIDER_UNAVAILABLE: "Der Vermittler war nicht erreichbar. Das ist eine Aussage über die Verbindung, nicht über die Bestellung.",
  PROVIDER_REJECTED: "Der Vermittler hat die Bestellung abgelehnt. Den Grund kennt er, QKERN hält ihn nicht fest.",
  INVALID_BINDING: "Die zurückgegebene Bindung hatte nicht die verlangte Form. Genau hier fällt eine Antwort mit einem Feld zu viel heraus.",
  BOOTSTRAP_UNVERIFIED: "Der Abdruck des Bootstrap-Vertrags stimmte nicht. Die Datenbank war nicht die, die bestellt wurde.",
  PROVISIONING_TIMEOUT: "Der Versuch hat zu lange gedauert und wurde abgebrochen, bevor eine Bindung entstand.",
};

/* ------------------------------------------------------------------ *
 * Die Form der Bestellung und der Bindung
 * ------------------------------------------------------------------ */

export type FieldNote = {
  /** Der Feldname, wie er im Quelltext steht. Kein uebersetzter Text. */
  field: string;
  meaning: string;
};

/** Die sechs Angaben, die eine Bestellung wirklich verlaesst. */
export const ORDER_FIELDS: readonly FieldNote[] = [
  { field: "provisioningJobId", meaning: "Die Kennung des Auftrags. Sie macht die Bestellung wiederholbar, ohne dass zweimal etwas entsteht." },
  { field: "organizationId", meaning: "Der Mandant, auf dessen Rechnung die Datenbank entsteht." },
  { field: "projectId", meaning: "Das Projekt, zu dem die Umgebung gehört." },
  { field: "environment", meaning: "Eine der drei festen Umgebungen. Es gibt keine vierte und keine eigene." },
  { field: "region", meaning: "Der Text aus der Projektzeile, unverändert weitergereicht. Kein Standort, den QKERN geprüft hätte." },
  { field: "bootstrapContractSha256", meaning: "Der Abdruck des Vertrags, den die neue Datenbank erfüllen muss. Er beschreibt Tabellen, nicht Hardware." },
];

/** Die neun Felder einer Bindung, benannt und erklaert, ohne einen einzigen Wert. */
export const BINDING_FIELDS: readonly FieldNote[] = [
  { field: "databaseInstanceRef", meaning: "Die Kennung, unter der die Umgebung im Katalog der Verbindungen nachschlägt. Sie beginnt mit managed: und darf weder ein Schema noch ein At-Zeichen enthalten, damit niemand eine Verbindungszeichenfolge hineinschreibt." },
  { field: "vaultStaticRole", meaning: "Der Name der Rolle, unter der der Vault das Passwort dieser Datenbank dreht. Ein Name, kein Passwort." },
  { field: "host", meaning: "Die Adresse der Datenbank. Einer der vier Gründe, warum diese Zeile die Laufzeit des Webs nichts angeht." },
  { field: "port", meaning: "Der Port der Datenbank. Aus demselben Grund nicht für hier." },
  { field: "expectedRole", meaning: "Die Rolle, unter der gelesen und geschrieben wird. Sie muss sich vom Eigentümer des Ledgers unterscheiden; die Tabelle lässt es anders nicht zu." },
  { field: "expectedDatabase", meaning: "Der Name der Datenbank, die entstehen soll." },
  { field: "expectedLedgerOwner", meaning: "Die getrennte Rolle, der das Ledger gehört. Die Trennung ist eine Prüfbedingung, keine Konvention." },
  { field: "serverCertificateSha256", meaning: "Der Abdruck des Serverzertifikats. Damit wird die Datenbank erkannt, zu der eine Verbindung überhaupt aufgebaut werden darf." },
  { field: "bootstrapContractSha256", meaning: "Derselbe Vertragsabdruck wie in der Bestellung. Die Tabelle nimmt genau einen Wert an und keinen anderen." },
];

/* ------------------------------------------------------------------ *
 * Zustaende, die die Ansicht ueber t(variable) zeigt
 * ------------------------------------------------------------------ */

export const PROVISIONING_ORDER_STATES = {
  /**
   * Ein 404 hat hier zwei Ursachen, und die Route unterscheidet sie
   * absichtlich nicht: Es gibt keinen Auftrag, oder diese Anmeldung darf ihn
   * nicht lesen. Beides mit einer Antwort zu beantworten verhindert, dass
   * jemand über die Statuscodes herausfindet, welche Umgebungen es gibt. Der
   * Satz sagt deshalb beide Ursachen, statt eine zu behaupten.
   */
  noJob: "Hier steht kein Auftrag. Das heisst entweder, dass für diese Umgebung keiner verzeichnet ist, oder dass diese Anmeldung ihn nicht lesen darf. Die Route unterscheidet die beiden Fälle mit Absicht nicht, damit sich über ihre Antworten nicht abzählen lässt, welche Umgebungen es gibt. Eine Umgebung, die schon auf eine Datenbank zeigt, hatte im Übrigen nie einen nötig.",
  unavailable: "Der Dienst für die Provisionierung antwortet gerade nicht. Das ist ein Befund über diese Abfrage, nicht über Ihre Umgebung, und geschätzt wird hier nichts.",
  notReady: "Der Auftrag steht in einer Form, die QKERN nicht als gültig annimmt, und wird darum nicht angezeigt. Lieber keine Auskunft als eine, die auf einer ungeprüften Zeile beruht.",
  failed: "Der Auftrag konnte nicht gelesen werden.",
} as const;

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function provisioningOrderTexts(): string[] {
  return [
    ...Object.values(PROVISIONING_ORDER_TEXTS),
    ...Object.values(PROVISIONING_JOB_STATE_TEXTS).flatMap((entry) => [entry.label, entry.explains]),
    ...Object.values(PROVISIONING_ERROR_TEXTS),
    ...ORDER_FIELDS.map((entry) => entry.meaning),
    ...BINDING_FIELDS.map((entry) => entry.meaning),
    ...Object.values(PROVISIONING_ORDER_STATES),
  ];
}
