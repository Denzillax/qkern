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
 * ## Warum diese Seite nicht mehr dasselbe sagt wie in 2.62
 *
 * Bis 2.62 stand hier, es gebe keine Zusatzleistungen, und zwar nicht, weil
 * sie fehlten, sondern weil die Abrechnung keine Stelle hatte, an der eine
 * stehen koennte. Eine Rechnungszeile hatte kein Feld fuer eine Bezeichnung,
 * die Eindeutigkeit je Metrik begrenzte eine Rechnung auf sechs Zeilen, und
 * eine Pauschale haette ohne Menge keinen Weg zu einem Betrag gehabt.
 *
 * Mit Migration 0080 gilt das nicht mehr. Eine Position traegt eine
 * Bezeichnung und einen stabilen Schluessel, die Eindeutigkeit haengt am
 * Schluessel statt an der Metrik, und eine Pauschale kommt mit einer Menge von
 * eins zu ihrem Betrag. Pauschalen liegen in einem eigenen append-only Blatt,
 * das an Projekt und Umgebung haengt.
 *
 * Darum sagt die Seite jetzt etwas anderes, und sie sagt es genauso belegt:
 * Was kosten kann, sind sechs Metriken und die Pauschalen dieser Umgebung.
 * Was es weiterhin nicht gibt, ist eine Stelle, an der jemand selbst etwas
 * dazubucht, und eine Zahlungsanbindung.
 */

export const ADDONS_TEXTS = {
  kicker: "EINSTELLUNGEN",
  title: "Add-ons: was extra kosten kann, und wer es festlegt",
  /** Der Satz, der die Seite eroeffnet. */
  addons:
    "Extra kosten kann zweierlei. Gemessen wird, was anfällt, und dafür gibt es sechs Metriken mit je einem Preis. Daneben kann eine Pauschale an dieser Umgebung hängen, zum Beispiel für Betreuung oder eine Bereitstellung; sie trägt eine eigene Bezeichnung und einen festen Betrag im Monat. Diese Seite zeigt beides vollständig, auch die Metriken ohne Preis.",
  /** Was es weiterhin nicht gibt, und warum das keine fehlende Oberflaeche ist. */
  noSelfService:
    "Dazubuchen lässt sich hier nichts. Es gibt keinen Knopf, kein Formular und keine Schnittstelle, die eine Pauschale anlegt, weil eine kaufmännische Zusage keine Projektfläche ist. Eine Pauschale legt ein Operator an, auf demselben Weg wie einen Preis, und sie erscheint danach hier und in der Abrechnung.",
  /** Die Metrikliste bleibt geschlossen. */
  closedList:
    "Die Liste der Metriken ist geschlossen, nicht bloss kurz. Dieselben sechs Kennungen stehen als Prüfbedingung in der Migration des Preisblatts und ein zweites Mal als Aufzählung in der Schnittstellenbeschreibung. Eine siebte Kennung nimmt die Datenbank nicht an. Eine Pauschale braucht deshalb auch keine Kennung: Sie hängt an keiner Metrik.",
  /** Die Abgrenzung gegen die Seite, die es schon gibt. */
  scope:
    "Was dieser Monat bisher kostet und welche Rechnungen es gibt, steht unter Einstellungen → Abrechnung und wird hier nicht wiederholt. Dort stehen die Beträge des laufenden Monats; hier steht, was überhaupt einen Betrag haben kann, also auch die Metriken ohne Preis.",

  /* Die Liste selbst. */
  catalogTitle: "Alles, was etwas kosten kann",
  catalogMeaning:
    "Sechs Metriken, und das ist der ganze Katalog der gemessenen Posten. Zu jeder steht hier, ob für diese Organisation ein Preis gesetzt ist und wie hoch der Stückpreis ist. Eine Metrik ohne Preis wird gemessen, aber nicht berechnet; sie erscheint in keiner Summe und in keiner Rechnungszeile.",
  catalogPriceSource:
    "Der Preis kommt aus der Projektion des laufenden Monats und ist der Preis, der am Ende der Periode gilt. Ein Gültig-ab-Datum liefert die Schnittstelle nicht, und ein Preis, der mitten im Monat gewechselt hat, ist von hier aus nicht zu sehen.",
  catalogNoPrices:
    "Für diese Organisation ist noch kein einziger Preis gesetzt. Das heisst, dass gemessen wird und nichts berechnet wird, nicht, dass etwas fehlerhaft ist.",

  /* Die Pauschalen dieser Umgebung. */
  chargesTitle: "Pauschalen dieser Umgebung",
  chargesMeaning:
    "Eine Pauschale hängt an Projekt und Umgebung, trägt eine Bezeichnung und einen Betrag im Monat und steht als eigene Position auf der Rechnung. Eine Menge hat sie nicht, und ihr Betrag hängt an keiner Messung. Der Rechnungslauf schreibt sie in denselben abgeschlossenen Monat wie die gemessenen Posten.",
  chargesNone:
    "Für diese Umgebung gilt keine Pauschale. Abgerechnet wird dann ausschliesslich, was gemessen wurde.",
  chargesEnd:
    "Das Blatt der Pauschalen ist append-only wie das Preisblatt. Eine Pauschale wird darum nicht gelöscht, sondern mit einem Betrag von null und einem späteren Gültig-ab-Datum beendet. Ab diesem Tag schreibt sie keine Position mehr, und die Rechnungen davor bleiben nachvollziehbar.",

  /* Wer Preise setzt. */
  whoSetsTitle: "Wer einen Preis oder eine Pauschale setzt",
  whoSetsMeaning:
    "Beides setzt ein Operator, und zwar nicht über die Console: Preisblatt und Pauschalenblatt haben keine schreibende REST-Fläche, und es gibt hier deshalb auch kein Eingabefeld und keinen Knopf. Die Kontrollebene selbst darf nur lesen und anlegen; eine Zeile in einem der beiden Blätter lässt sich nicht ändern und nicht löschen, weil es dafür keine Zeilenpolitik gibt.",
  whoSetsHistory:
    "Ein neuer Preis ist eine neue Zeile mit einem eigenen Gültig-ab-Datum, und für eine Pauschale gilt dasselbe. Der alte Wert bleibt stehen, damit eine bereits gestellte Rechnung nachvollziehbar bleibt. Das ist der Grund, warum es hier nichts zu ändern gibt und nicht bloss eine fehlende Oberfläche.",

  /* Was es nicht gibt, mit Grund. */
  noPaymentTitle: "Was es ausserdem nicht gibt",
  noPaymentMeaning:
    "Es gibt keine Zahlungsanbindung. Eine Rechnung entsteht im Rechnungslauf aus abgeschlossenen Monaten, bekommt eine Nummer aus einem lückenlosen Kreis und eine Fälligkeit dreissig Tage später. Niemand zieht etwas ein, niemand verschickt sie, und es gibt keinen Ort, an dem eine Karte hinterlegt wäre.",
  noPaymentNoPlans:
    "Es gibt auch keine Tarife. Die drei Pakete auf der Startseite sind ein Entwurf für den Auftritt und hängen an keiner Zeile der Abrechnung; kein Preis dort erreicht das Preisblatt, und kein Paket schaltet etwas frei.",
  noPaymentNoQuota:
    "Ein gekauftes Kontingent gibt es ebenfalls nicht. Eine Pauschale ist ein Betrag, kein Volumen: Sie hebt keine Grenze und schaltet nichts frei. Grenzen entstehen aus Quotas, die eine Anfrage abweisen können.",

  /* Fuer Betreiber. */
  operatorTitle: "Wenn Sie wirklich etwas dazu verkaufen wollen",
  operatorSteps:
    "Eine Pauschale ist keine Migration mehr, sondern eine Zeile im Pauschalenblatt: Projekt, Umgebung, Code, Bezeichnung, Betrag, Währung und Gültig-ab-Datum. Angelegt wird sie von einem Operator über den Billing-Dienst. Ab dem nächsten Rechnungslauf steht sie als Position mit ihrer Bezeichnung auf der Rechnung, und die Projektion zeigt sie schon im laufenden Monat.",
  operatorMeter:
    "Eine weitere Metrik ist weiterhin eine Migration, denn die sechs Kennungen stehen fest. Und eine Währung gilt je Organisation für beide Blätter; eine Pauschale in einer zweiten Währung weist der Dienst ab. Wer nur wissen will, wie viel gerade anfällt, findet die Reihen unter Berichte und die Summen unter Nutzung & Limits.",
} as const;

/**
 * Was eine Rechnungszeile tragen kann, benannt. Seit 0080 traegt sie eine
 * Bezeichnung und einen stabilen Schluessel, und genau das steht hier.
 */
export type InvoiceShapeNote = {
  title: string;
  body: string;
};

export const INVOICE_SHAPE: readonly InvoiceShapeNote[] = [
  {
    title: "Eine Position je Schlüssel, höchstens einmal",
    body: "Jede Position trägt einen stabilen Schlüssel, der sagt, was sie ist: die Kennung einer Metrik oder der Code einer Pauschale. Je Rechnung darf ein Schlüssel genau einmal vorkommen, und eine Rechnung kann deshalb so viele Positionen tragen, wie es Metriken mit Preis und geltende Pauschalen gibt.",
  },
  {
    title: "Eine Bezeichnung, und sie bleibt stehen",
    body: "Eine Position trägt ein Feld für ihre Bezeichnung, bis zu zweihundert Zeichen. Es wird mit der Rechnung eingefroren wie jeder andere Wert. Eine Metrik nennt zusätzlich ihre Kennung, eine Pauschale hat keine und wird allein über ihre Bezeichnung gelesen.",
  },
  {
    title: "Kein Betrag, der nicht gerechnet ist",
    body: "Der Betrag jeder Position entsteht aus Menge, Stückpreis und Bezugsgrösse. Eine Pauschale trägt die Menge eins und als Stückpreis ihren Monatsbetrag; damit gilt dieselbe Formel für alle Positionen. Ein eingetragener Betrag wäre die einzige Zahl auf der Rechnung, die niemand nachrechnen könnte.",
  },
  {
    title: "Nur abgeschlossene Monate",
    body: "Der Rechnungslauf nimmt nur Perioden, die vorbei sind. Ein laufender Monat lässt sich nicht abrechnen, und ein Monat ohne eine einzige bepreiste Position erzeugt keine Rechnung über null, sondern gar keine.",
  },
  {
    title: "Zweimal derselbe Lauf, einmal dieselbe Rechnung",
    body: "Je Projekt, Umgebung und Periode gibt es höchstens eine Rechnung, und diese Eindeutigkeit trägt die Idempotenz des Laufs. Ein zweiter Lauf desselben Monats verliert sie und schreibt keine einzige Position, auch nicht bei vielen Positionen; die Rechnungsnummern bleiben dabei lückenlos.",
  },
  {
    title: "Abgerundet zugunsten des Kunden",
    body: "Gerechnet wird in Mikro-Einheiten mit ganzen Zahlen, und die Division schneidet ab. Der Bruchteil einer Mikro-Einheit gehört dem Kunden. Das ist auch der Grund, warum die Anzeige nie mehr zeigt als das Ledger.",
  },
];

/** Zustaende, die die Ansicht ueber t(variable) zeigt. */
export const ADDONS_STATES = {
  disabled: "Usage Metering ist für diese Installation abgeschaltet. Ohne Zähler gibt es weder Preise noch Rechnungen, und darum steht hier auch keine Liste mit Preisen und keine Pauschale. Angelegt werden können beide trotzdem nicht über diese Seite: Das hängt nicht an der Messung, sondern daran, wer eine kaufmännische Zusage gibt.",
  unavailable: "Die Abrechnung ist gerade nicht erreichbar. Welche Preise gesetzt sind und welche Pauschalen gelten, steht deshalb hier nicht, und geschätzt wird es nicht.",
  failed: "Die Preise konnten nicht geladen werden.",
  noPrice: "kein Preis gesetzt",
  perMonth: "im Monat",
} as const;

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function addonsTexts(): string[] {
  return [
    ...Object.values(ADDONS_TEXTS),
    ...INVOICE_SHAPE.flatMap((entry) => [entry.title, entry.body]),
    ...Object.values(ADDONS_STATES),
  ];
}
