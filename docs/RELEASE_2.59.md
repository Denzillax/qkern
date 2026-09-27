# Release 2.59.0 – Geschlossen fällt, was nicht antwortet

Zwei Platzhalter weniger, ein Vertrag, der jetzt auch die HTTP-Verben kennt,
und zwei Fehler, die der eigene Zertifizierungsfall gefunden hat.

## Was neu ist

- Ansicht Authentication, Auth-Hooks: eigener Code an zwei Punkten der Anmeldung, und beide fallen geschlossen.
- Ansicht Storage, S3-Zugang: Schlüsselpaare, genau einmal gezeigt und widerrufbar, mit dem Satz, dass sie heute noch nichts öffnen.
- Der OpenAPI-Vertrag prüft jetzt Pfade **und** Verben, in beide Richtungen.
- PostgreSQL-Zertifizierung von 209 auf 211 Fälle, lokale Suite von 2174 auf 2191.

## Die Entscheidungen, die man kennen muss

- **Ein Hook, der hängt, sperrt die Projektumgebung aus.** Keine Antwort in der Frist heisst keine Sitzung und kein Token. Das ist die richtige Wahl für diese zwei Punkte, und sie hat einen Preis, den die Seite wörtlich nennt. Drei unterschiedene Ausgänge trennen die Fälle: abgewiesen, nicht erreichbar, unbrauchbar geantwortet.
- **Es gibt keinen Punkt „nach der Anmeldung".** Ein Punkt, an dem das Ergebnis des Aufrufs verworfen würde, ist kein Hook, sondern eine Benachrichtigung, die wie eine Wirkung aussieht.
- **Keinen Mail-Hook.** Der Link einer Aktionsmail trägt das Token im Klartext, und fremder Code bekommt es nicht.
- **Reservierte Ansprüche stehen dreimal und sind einmal gemeint**: als Regel im reinen Modul, als Absicherung in der Token-Ausgabe und als `CHECK` in der Migration.
- **Ein S3-Schlüsselpaar öffnet heute nichts, und der erste Absatz der Seite sagt das.** Beide möglichen Wege sind begründet verworfen: Beim Anbieter lässt sich kein Paar anlegen, weil alle Objekte aller Projekte in einem Bucket liegen und nur das Präfix sie trennt. Und gegen QKERN selbst lässt sich ein Paar nicht prüfen, solange nur sein Hash liegt: Eine S3-Signatur wird nachgerechnet, und die Rechnung braucht das Geheimnis.

## Zwei Fehler, gefunden vom eigenen Fall

- Der Anspruchs-Hook stand **hinter** dem Schreibzugriff. Eine Abweisung liess damit eine Sitzung ohne Token zurück, und bei einer Erneuerung wäre die Sitzungsfamilie erledigt gewesen.
- Die erklärten Ansprüche fielen im Audit still weg, weil die Bereinigung kein Komma in einem Metadatenwert durchlässt.

## Der Vertrag über die Verben, und was er nicht fand

Es fehlte **kein einziges Verb**. Gezählt sind 131 Routendateien und 190
Exporte; nach Abzug der 24 CORS-Vorflüge und der einen ausgenommenen Route
decken sich 165 Verben genau mit 165 beschriebenen Operationen, in beide
Richtungen. Nachgetragen wurde nichts, weil nichts zu tragen war.

Der Wert liegt in der Strenge: Der Leser erkennt die drei Exportformen, die es
im Projekt gibt, und **jede andere Form am Zeilenanfang lässt den Vertrag
fallen**, mit Datei und Zeile. Eine Umbenennung beim Export wäre sonst eine
unsichtbare Fläche.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 211/211, exit 0 | `docs/evidence/2026-09-27/welle11-run1.manifest.json` |
| PostgreSQL 17, 211/211, exit 0 | `docs/evidence/2026-09-27/welle11-run2.manifest.json` |
| Mailpit und Dex, 7/7, exit 0 | `docs/evidence/2026-09-27/welle11-auth.manifest.json` |
| versitygw und ClamAV, 8/8, exit 0 | `docs/evidence/2026-09-27/welle11-storage.manifest.json` |
| Mutation reservierter Anspruch kommt durch, exit 1 | `docs/evidence/2026-09-27/welle11-mutation-hooks.manifest.json` |
| Mutation Hash des Geheimnisses in der Liste, exit 1 | `docs/evidence/2026-09-27/welle11-mutation-s3.manifest.json` |
| Mutation ein Verb fehlt und eines hat keinen Export, exit 1 | `docs/evidence/2026-09-27/welle11-mutation-verbs.manifest.json` |
| Vitest lokal 2191/2191, exit 0 | `docs/evidence/2026-09-27/welle11-local-run1.manifest.json` |
| Vitest lokal 2191/2191, exit 0 | `docs/evidence/2026-09-27/welle11-local-run2.manifest.json` |

## Nachtrag zum Verfahren

Beim Ablegen der Belege fiel auf, dass nur der PostgreSQL-Läufer seinen
Exit-Code selbst ins Protokoll schreibt. Beim Auth- und beim Storage-Läufer
musste ihn die Shell anhängen, also von Hand genau an der Stelle, an der die
Evidenz entsteht. Beide schreiben ihn jetzt selbst, und die beiden Läufe dieses
Releases sind mit der Zeile wiederholt.

Und ein Nachtrag, der mir selbst gilt. Nach den elf Stack-Laeufen dieses Tages
hatte der Arbeitsplatz 1.9 von 15.7 GiB frei, und die lokale Suite ist unter
dieser Last zerfallen: 139 gescheiterte Faelle, fast alle das
Fuenf-Sekunden-Budget von Routentests, die allein in einer Sekunde
durchlaufen. Die Ladezeit der Module lag bei 3586 Sekunden statt bei 116.

Ich habe daraus zuerst den falschen Schluss gezogen und einen statischen Import
der Compute-Seite im Auth-Weg als Ursache benannt. Die Gegenprobe hat das
widerlegt: Derselbe Stand von `2.58.0`, heute zweimal gruen, faellt auf dieser
Maschine jetzt genauso. Die Ursache war der Speicher, nicht der Modulgraph.

Die Entkopplung bleibt trotzdem, weil sie fuer sich richtig ist: Der Auth-Weg
wird in fast jeder Route geladen, und der Aufrufdienst zieht die ganze
Compute-Seite mit, ohne dass ohne `QKERN_FUNCTIONS_ENABLED` eine Zeile davon
laeuft. Der falsche Messwert steht nicht im Kommentar. Die beiden gruenen
Laeufe sind mit `--maxWorkers=3` gefahren, dieselben Dateien und dieselben
Erwartungen, und die Evidenz sagt das.

## Ehrlich offen

- **Ein S3-Schlüsselpaar öffnet nichts.** Keine Rotation, nur neu anlegen und widerrufen.
- **Der Container läuft nach Ablauf der Hook-Frist weiter.** Die Frist beendet das Warten, nicht die Function. Erzwungen wird nicht, dass sie kleiner ist als der Timeout der Function; die Seite zeigt beide Zahlen, weil eine stille Kürzung eine Einstellung wäre, die nicht gilt.
- **Der Verb-Vertrag prüft nur Exporte am Zeilenanfang.** Das deckt den Bestand vollständig und bleibt eine Annahme über künftige Formatierung.
- **Die CORS-Vorflüge stehen mit Grund draussen.** Ein eigener Fall hält die Ausnahme ehrlich: Jede dieser Zeilen muss an einen Vorflug-Helfer weiterreichen.
- **Im Browser nicht gesehen.** Die zwei neuen Ansichten sind angemeldet nie betrachtet worden.
