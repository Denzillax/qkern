# Release 1.31.0 — Nachträgliche Metriken

> Datum: 6. August 2026 · Vorgänger: `1.30.0`

## Wofür dieses Release steht

Nach 1.29 und 1.30 meldeten zwei Metriken. Vier zeigten null. Dieses Release
bringt zwei weitere dazu — und beantwortet für die letzten beiden die Frage, die
wichtiger ist als das Anschliessen: **warum nicht.**

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | **98 von 98 bestanden**, exit 0 |
| Reproduzierbarkeit | zweimal grün **vor** dem Release-Commit |
| Neue Fälle | 3 gegen echtes PostgreSQL |
| Mutationsprobe | Zeilenzahl, Byte-Messung und enforce-Verbot einzeln entfernt → genau 3 Fälle fallen um |
| Vitest lokal | 960 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

## Zwei Metriken, deren Menge man vorher nicht kennt

`GeneratedDataApiService.listRows` meldet `database_row_reads`,
`ProjectStorageService.createDownloadGrant` meldet `storage_egress_bytes`.

Beide unterscheiden sich grundsätzlich von `queue_operations` und
`function_invocations`: Wie viele Zeilen eine Abfrage liefert, weiss man **nach**
der Abfrage. Wie viele Bytes eine Freigabe umfasst, nach dem Auflösen des
Objekts. Es gibt keinen Moment, in dem man mit dieser Zahl noch ablehnen könnte.

Das hat eine unangenehme Konsequenz, die man leicht übersieht: Ein
`enforce`-Limit auf einer solchen Metrik verhindert nichts — es hört nur auf zu
zählen. Das Ledger lehnt das Ereignis ab, der Zähler bleibt stehen, und die
Nutzung läuft weiter. Ein Zähler, der stillsteht, während die Nutzung wächst,
ist schlimmer als gar keiner: Er sieht aus wie eine Aussage und ist keine.

**Also wird der Modus gar nicht erst angenommen.** `setQuota` weist `enforce`
für diese beiden Metriken mit `USAGE_INVALID_INPUT` ab. Ein Modus, der nicht
wirken kann, darf nicht setzbar sein — dieselbe Regel, nach der eine
Webhook-Definition mit unzustellbarem Ziel abgewiesen wird, statt im Betrieb
stumm zu scheitern.

Damit wird auch das Ignorieren der Antwort in beiden Emittern zu einer
**abgesicherten** Eigenschaft statt einer Nachlässigkeit: Das Ledger kann diese
Ereignisse nicht ablehnen.

## Was genau gezählt wird

Bei der Generated Data API zählt, was der Aufrufer tatsächlich bekommt. Die eine
Zeile über dem Limit dient nur dazu, `hasMore` zu bestimmen, und verlässt QKERN
nie. Eine Lesung ohne Treffer zählt nicht — die Metrik heisst
`database_row_reads`, nicht `database_reads`.

Bei Storage zählen **freigegebene**, nicht ausgelieferte Bytes. Die Auslieferung
übernimmt der Provider direkt; QKERN sieht sie nie und könnte sie nur schätzen.
Eine Freigabe, die niemand einlöst, zählt deshalb mit. Das ist die ehrliche
Beschreibung dessen, was gemessen wird — und ein Grund mehr, diese Zahl nicht
als Abrechnungsbeleg zu verwenden.

## Warum die letzten beiden Metriken nicht angeschlossen sind

**`api_requests`** gehört an die HTTP-Grenze: eine Zählung je Request. QKERN hat
71 Routendateien und keinen gemeinsamen Chokepoint. Eine Messung je
Dienstmethode wäre kein Ersatz, sondern falsch — eine Route ruft mehrere
Methoden, und die Zahl wäre systematisch zu hoch. Das ist ein eigener Schnitt.

**`realtime_messages`** bräuchte einen bündelnden Emitter. Eine
Control-Plane-Transaktion je Nachricht wäre auf dem Realtime-Pfad ein absehbarer
Fehler; der Soak-Lauf misst dort p95 in Millisekunden. Ein Emitter, der bündelt,
verliert allerdings die Gate-Eigenschaft — man kann keine Nachricht ablehnen,
die man schon in einem offenen Stapel gezählt hat. Auch das ist ein eigener
Schnitt, mit einer eigenen Entscheidung.

Beides jetzt schnell anzuschliessen hätte zwei Zahlen erzeugt, die aussehen wie
Messungen und keine sind.

## Zwei Testfehler, beide vom Produkt korrekt abgewiesen

Der erste Lauf war rot, aber diesmal lag es nicht am Produkt: Die Generated Data
API weist eine Tabelle ohne Row Level Security ab, und Storage weist einen
MIME-Typ ausserhalb der Allowlist ab. Beide Regeln haben genau das getan, wofür
sie da sind. Korrigiert wurde der Testaufbau.

## Ehrlich offen

- `api_requests` und `realtime_messages` melden nicht — siehe oben
- Gemessen werden freigegebene, nicht ausgelieferte Bytes
- Die beiden neuen Messungen sind **nicht** transaktional. Die Generated Data
  API schreibt in eine **andere Datenbank** als das Ledger; eine gemeinsame
  Transaktion gibt es dort nicht einmal im Prinzip
- Kein Abgleich mit Providerwerten, keine Last-Läufe des Messpfads
- Weder Preise noch Tarife noch Rechnungen
- Kein Deployment-Weg für Function-Images
- SDK und CLI sind nur auf Linux belegt
