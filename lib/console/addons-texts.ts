/**
 * Die Texte der Seite Einstellungen -> Add-ons (2.88), deutsch und an einer
 * Stelle.
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
 * Der Platzhalter versprach „Zusatzleistungen wie eigene Domain oder mehr
 * Backups". Nachgesehen in der Abrechnung gibt es beides nicht, und zwar
 * nicht, weil es noch fehlt, sondern weil die Abrechnung keine Stelle hat, an
 * der eine Zusatzleistung stehen koennte.
 *
 * Abgerechnet wird ausschliesslich je Metrik. Das Preisblatt kennt genau
 * sechs Kennungen, und dieselben sechs stehen als Pruefbedingung in zwei
 * Migrationen und als Aufzaehlung in der OpenAPI-Beschreibung. Eine
 * Rechnungszeile traegt eine dieser sechs Kennungen und sonst nichts; je
 * Rechnung darf jede Kennung genau einmal vorkommen. Ein Posten „eigene
 * Domain" waere also nicht bloss nicht eingerichtet, sondern nicht
 * ausdrueckbar.
 *
 * Die Seite wiederholt darum nicht die Projektion aus Einstellungen ->
 * Abrechnung, sondern beantwortet die andere Frage: Was kostet extra. Die
 * Antwort ist nichts, und der Beleg dafuer ist die vollstaendige Liste der
 * sechs Metriken, auch der unbepreisten.
 */

export const ADDONS_TEXTS = {
  kicker: "EINSTELLUNGEN",
  title: "Add-ons: es gibt nichts, was extra kostet",
  /** Der Satz, der die Seite eroeffnet. Er sagt nicht „noch nicht". */
  noAddons:
    "Zusatzleistungen gibt es bei QKERN nicht, und sie fehlen nicht bloss noch. Es gibt keine eigene Domain zu buchen, kein zusätzliches Backup-Paket, keinen Tarif und keine Stufe. Abgerechnet wird ausschliesslich, was gemessen wurde, und gemessen werden sechs Dinge. Diese Seite zeigt alle sechs, damit die Antwort belegt ist und nicht nur behauptet.",
  /** Warum eine Zusatzleistung nicht einmal ausdrueckbar waere. */
  closedList:
    "Die Liste ist geschlossen, nicht bloss kurz. Dieselben sechs Kennungen stehen als Prüfbedingung in der Migration des Preisblatts, noch einmal in der Migration der Rechnungszeilen und ein drittes Mal als Aufzählung in der Schnittstellenbeschreibung. Eine siebte Kennung nimmt die Datenbank nicht an. Ein Posten für eine Domain oder ein Backup hätte also keine Zeile, in der er stehen könnte.",
  /** Die Abgrenzung gegen die Seite, die es schon gibt. */
  scope:
    "Was dieser Monat bisher kostet und welche Rechnungen es gibt, steht unter Einstellungen → Abrechnung und wird hier nicht wiederholt. Dort stehen die bepreisten Zeilen; hier steht die ganze Liste, auch die Metriken ohne Preis, denn die Frage lautet nicht „was kostet es\", sondern „was kann überhaupt etwas kosten\".",

  /* Die Liste selbst. */
  catalogTitle: "Alles, was etwas kosten kann",
  catalogMeaning:
    "Sechs Metriken, und das ist der ganze Katalog. Zu jeder steht hier, ob für diese Organisation ein Preis gesetzt ist und wie hoch der Stückpreis ist. Eine Metrik ohne Preis wird gemessen, aber nicht berechnet; sie erscheint in keiner Summe und in keiner Rechnungszeile.",
  catalogPriceSource:
    "Der Preis kommt aus der Projektion des laufenden Monats und ist der Preis, der am Ende der Periode gilt. Ein Gültig-ab-Datum liefert die Schnittstelle nicht, und ein Preis, der mitten im Monat gewechselt hat, ist von hier aus nicht zu sehen.",
  catalogNoPrices:
    "Für diese Organisation ist noch kein einziger Preis gesetzt. Das heisst, dass gemessen wird und nichts berechnet wird, nicht, dass etwas fehlerhaft ist.",

  /* Wer Preise setzt. */
  whoSetsTitle: "Wer einen Preis setzt",
  whoSetsMeaning:
    "Preise setzt ein Operator, und zwar nicht über die Console: Das Preisblatt hat keine REST-Fläche, und es gibt hier deshalb auch kein Eingabefeld und keinen Knopf. Die Kontrollebene selbst darf nur lesen und anlegen; eine Zeile im Preisblatt lässt sich nicht ändern und nicht löschen, weil es dafür keine Zeilenpolitik gibt.",
  whoSetsHistory:
    "Ein neuer Preis ist eine neue Zeile mit einem eigenen Gültig-ab-Datum. Der alte Preis bleibt stehen, damit eine bereits gestellte Rechnung nachvollziehbar bleibt. Das ist der Grund, warum es hier nichts zu ändern gibt und nicht bloss eine fehlende Oberfläche.",

  /* Was es nicht gibt, mit Grund. */
  noPaymentTitle: "Was es ausserdem nicht gibt",
  noPaymentMeaning:
    "Es gibt keine Zahlungsanbindung. Eine Rechnung entsteht im Rechnungslauf aus abgeschlossenen Monaten, bekommt eine Nummer aus einem lückenlosen Kreis und eine Fälligkeit dreissig Tage später. Niemand zieht etwas ein, niemand verschickt sie, und es gibt keinen Ort, an dem eine Karte hinterlegt wäre.",
  noPaymentNoPlans:
    "Es gibt auch keine Tarife. Die drei Pakete auf der Startseite sind ein Entwurf für den Auftritt und hängen an keiner Zeile der Abrechnung; kein Preis dort erreicht das Preisblatt, und kein Paket schaltet etwas frei.",
  noPaymentNoQuota:
    "Ein gekauftes Kontingent gibt es ebenfalls nicht. Grenzen entstehen aus Quotas, die eine Anfrage abweisen können, nicht aus einem Volumen, das jemand dazugebucht hätte.",

  /* Fuer Betreiber. */
  operatorTitle: "Wenn Sie wirklich etwas dazu verkaufen wollen",
  operatorSteps:
    "Eine Zusatzleistung wäre keine Oberfläche, sondern eine Migration. Nötig wäre eine Zeile, die nicht an eine Metrik gebunden ist, also ein eigener Zeilentyp in der Rechnung, ein eigener Betrag ohne Menge und ein eigener Weg, sie einem Projekt zuzuordnen. Nichts davon gibt es, und diese Seite tut nicht so, als wäre es bloss noch nicht eingeschaltet.",
  operatorMeter:
    "Was heute geht, ist eine weitere Metrik. Auch sie wäre eine Migration, denn die sechs Kennungen stehen an drei Stellen fest. Wer nur wissen will, wie viel gerade anfällt, findet die Reihen unter Berichte und die Summen unter Nutzung & Limits.",
} as const;

/**
 * Was eine Rechnungszeile tragen kann, benannt. Das ist die Form, die eine
 * Zusatzleistung nicht hat.
 */
export type InvoiceShapeNote = {
  title: string;
  body: string;
};

export const INVOICE_SHAPE: readonly InvoiceShapeNote[] = [
  {
    title: "Eine Zeile je Metrik, höchstens einmal",
    body: "Eine Rechnungszeile trägt eine der sechs Kennungen, eine Menge, einen Stückpreis, eine Bezugsgrösse und den Betrag daraus. Je Rechnung darf jede Kennung genau einmal vorkommen; eine Rechnung hat deshalb höchstens sechs Zeilen.",
  },
  {
    title: "Kein Betrag ohne Menge",
    body: "Der Betrag einer Zeile wird aus Menge und Stückpreis gerechnet, nicht eingetragen. Eine Pauschale hätte keine Menge und damit keinen Weg, zu einem Betrag zu kommen.",
  },
  {
    title: "Kein freier Text",
    body: "Es gibt kein Feld für eine Bezeichnung und keines für eine Beschreibung. Was auf einer Rechnung steht, ist der Name einer Metrik, und der steht nicht in der Zeile, sondern kommt aus der Kennung.",
  },
  {
    title: "Nur abgeschlossene Monate",
    body: "Der Rechnungslauf nimmt nur Perioden, die vorbei sind. Ein laufender Monat lässt sich nicht abrechnen, und ein Monat ohne einen einzigen bepreisten Posten erzeugt keine Rechnung über null, sondern gar keine.",
  },
  {
    title: "Abgerundet zugunsten des Kunden",
    body: "Gerechnet wird in Mikro-Einheiten mit ganzen Zahlen, und die Division schneidet ab. Der Bruchteil einer Mikro-Einheit gehört dem Kunden. Das ist auch der Grund, warum die Anzeige nie mehr zeigt als das Ledger.",
  },
];

/** Zustaende, die die Ansicht ueber t(variable) zeigt. */
export const ADDONS_STATES = {
  disabled: "Usage Metering ist für diese Installation abgeschaltet. Ohne Zähler gibt es weder Preise noch Rechnungen, und darum steht hier auch keine Liste mit Preisen. Dass es keine Zusatzleistungen gibt, gilt trotzdem: Das hängt nicht an der Messung, sondern an der Form der Abrechnung.",
  unavailable: "Die Abrechnung ist gerade nicht erreichbar. Welche Preise gesetzt sind, steht deshalb hier nicht, und geschätzt wird es nicht.",
  failed: "Die Preise konnten nicht geladen werden.",
  noPrice: "kein Preis gesetzt",
} as const;

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function addonsTexts(): string[] {
  return [
    ...Object.values(ADDONS_TEXTS),
    ...INVOICE_SHAPE.flatMap((entry) => [entry.title, entry.body]),
    ...Object.values(ADDONS_STATES),
  ];
}
