# Release 2.72.0 – Die Spur einer Nachricht, eine Zeile mit Namen, und die letzte Ausnahme

Drei Schnitte. Einer schliesst den letzten offenen Punkt der Queues, einer gibt
einer Rechnung mehr als sechs Zeilen, und einer nimmt dem MCP-Server die
Ausnahme, die er seit `2.64.0` mitgeschleppt hat.

## Was neu ist

- Eine Nachricht der Queues lässt sich verfolgen, von ihrem Einstellen bis zu ihrem Ausgang, über einen toten Wirt und zwei Instanzen hinweg.
- Eine Rechnungsposition trägt eine Bezeichnung, eine Rechnung kann mehr als sechs Zeilen haben, und eine Pauschale kommt ohne Nutzung zu ihrem Betrag.
- Die freie Abfrage des MCP-Servers läuft als der zustimmende Nutzer und unter der Zeilensicherheit.
- PostgreSQL-Zertifizierung von 249 auf 253 Fälle, lokale Suite von 2490 auf 2513.

## Was mit dieser Nachricht passiert ist

Die Queues standen sonst vor dem Supabase-Stand, und offen war genau ein Punkt.
Die Zustandsspalten aus `0026` tragen den letzten Stand und nicht den Weg
dorthin: `attempt_count` sagt vier Versuche und nicht, wann, von welchem Wirt
und woran die ersten drei scheiterten, und `last_failure_code` vergisst jeden
Code ausser dem letzten. Mitgeschrieben hat das alles der Worker-Logger, aber
**in den Prozess**. Ein Neustart nahm es mit, und zwei Instanzen schrieben in
zwei Logs, die niemand zusammenführt.

Jetzt liegt je Station eine Zeile in der Datenbank, geschrieben in **derselben
Transaktion wie der Zustandswechsel**, den sie beschreibt. Damit gibt es keine
Station ohne ihren Wechsel und keinen Wechsel ohne seine Station. Acht
Stationen, von `enqueued` bis `lease_expired`, je mit Zeitpunkt, Versuch, Wirt
und festem Fehlercode.

Zusammengehalten wird eine Spur von der Nachrichten-Id, und das ist keine neue
Kennung: Sie steht in der Quittung, kommt im Claim zurück, benennt Ack, Fail
und Pacht und steht in der Dead-Letter-Liste. Eine zweite daneben wäre eine
zweite Antwort auf dieselbe Frage. W3C Trace Context kommt dazu, aber nur am
Rand, weil die Nachrichten-Id an der QKERN-Grenze endet: Das Einreihen liest
eine Kopfzeile `traceparent`, Spur-Id und Eltern-Span liegen auf der ersten
Station, und QKERN entscheidet an beiden nichts. Ein Kopf, der nicht zur Form
passt, wird weggelassen statt abgewiesen.

**Dass kein Inhalt mitgeht, ist strukturell und nicht vorgenommen**: Die Tabelle
hat keine Spalte dafür, auch keine für den Dedupe-Verifikator, das Lease-Token
oder eine Meldung aus der Datenbank. Der Fall liest die Spaltenliste aus
`information_schema` und vergleicht sie vollständig, sucht den Nutzlast-Marker
in der Antwort, sucht jeden 64-stelligen Hex-String und schaut auch in
`to_jsonb` jeder gespeicherten Zeile.

Geschnitten wird am Ablauf der Station und **nie am Ausgang der Nachricht**,
denn eine Fehlersuche fängt nach dem Ausgang an. Die Frist ist das Grössere aus
der Aufbewahrung der Queue und einem Betriebstag, und es gibt bewusst keinen
Fremdschlüssel auf die Nachricht: Mit einer Kaskade wäre die Spur genau dann
weg, wenn sie das Einzige ist, was von der Nachricht noch erzählen kann.

**Zwei echte Fehler beim Bauen.** Ein Löschwächter als Trigger auf der Spur wäre
unprüfbar gewesen, weil er nur `clock_timestamp()` lesen kann, der Aufräumer
aber mit der einspeisbaren Uhr des Dienstes rechnet. Und `recoverExpiredLeases`
war eine einzige Anweisung ohne `RETURNING`; den alten Wirt kann `RETURNING`
nicht liefern, weil dieselbe Anweisung ihn auf NULL setzt. Davor steht jetzt ein
`SELECT … FOR UPDATE` auf genau den Zeilen, die das `UPDATE` danach anfasst.
Dazu eine Lücke, die von aussen zählt: Die CORS-Kopfzeilenliste des Einreihens
hätte `traceparent` verworfen, der Anschluss hätte aus einem Browser also nie
funktioniert, und von dort fängt eine Spur meistens an.

## Sechs Zeilen waren eine Nebenwirkung

Der Befund aus `2.62.0` lautete, Add-ons fehle keine Oberfläche, sondern die
Form. Eine Rechnungszeile hatte kein Feld für eine Bezeichnung, und die
Eindeutigkeit `UNIQUE (invoice_id, metric)` aus `0040` begrenzte eine Rechnung
auf sechs Zeilen, eine je Metrik. Diese Eindeutigkeit tat zwei Dinge zugleich,
und nur eines war gewollt: Sie verhinderte, dass eine Rechnung dieselbe Sache
zweimal nennt, und begrenzte als Nebenwirkung die Zahl der Zeilen.

Jetzt trägt eine Position `line_key` und `label`, und die Eindeutigkeit hängt am
Schlüssel. Der ist abgeleitet und nicht erzeugt, `metric:<kennung>` oder
`charge:<code>`, also ergibt dieselbe Quelle denselben Schlüssel.

**Hier hat der Schnitt meine eigene Begründung widerlegt.** Mein Auftrag sagte,
die Eindeutigkeit je Metrik trage die Idempotenz des Rechnungslaufs. Das war
falsch. Getragen hat sie immer `UNIQUE (organization_id, project_id,
environment, period_start)` auf der Rechnung selbst, und die ist unberührt.

Eine Pauschale kommt mit Menge 1 und Bezugsgrösse 1 zu ihrem Betrag. Es gibt
keinen Positionstyp mit eingetragenem Betrag, denn das wäre die einzige Zahl auf
einer Rechnung, die niemand nachrechnen könnte. **Nebenbei geschlossen**: Bis
`0080` bestimmten allein die Zähler, welche Umgebung der Rechnungslauf besucht.
Ein Projekt mit einer Pauschale und ohne jede Nutzung hätte nie eine Rechnung
gesehen.

## Eine Begründung, die seit `2.64.0` falsch stand

`qkern_query_readonly` und `qkern_schema_list` hatten keinen Bereich, und der
Grund im Quelltext war die Zeilensicherheit. **Der Grund war falsch.** Die
Zeilensicherheit war nie aus, und die Leserolle trägt kein `BYPASSRLS`: Eine
Policy hatte ohne Ansprüche nur nichts zu lesen, und eine Tabelle **ohne**
Policy gab alles her. Das war die eigentliche Lücke, und sie lag nicht bei den
Ansprüchen, sondern bei der fehlenden Prüfung je Relation.

Beide Werkzeuge hängen jetzt an `data:read`, als zwei getrennte Entscheidungen.
Die freie Abfrage läuft über OAuth durch dieselbe Lesetür wie die Zeilenliste:
Rolle `authenticated`, die Ansprüche des zustimmenden Nutzers,
`row_security = on`, `BEGIN READ ONLY`. Neu ist die Lesung des Abfragetextes.
Sie nennt jede Relation, und jede geht durch die Grenzprüfung, bevor die Abfrage
läuft. Eine Tabelle ohne Zeilensicherheit ist über diesen Weg nicht erreichbar,
auch mit Leserecht nicht.

Supabase macht an dieser Stelle das Gegenteil und lässt seinen MCP-Server mit
einer Rolle lesen, die die Zeilensicherheit umgeht; der dokumentierte Preis
dafür ist ein Leck über Prompt Injection.

**Zwei Stellen logen dabei auf**: `examples/codex-mcp.oauth.toml` und die
Bereichsbeschreibung in OpenAPI behaupteten, Storage, Queues, Control Plane und
Migrationen seien über OAuth nicht erreichbar. Seit den Migrationen `0073` und
`0078` stimmt das nicht mehr. Und ein Fehlercode der Data API war am Werkzeug
nicht bekannt, wurde dort also zu „die Data API ist nicht verfügbar": Ein Agent
hätte seinen eigenen Fehler als Ausfall gelesen und wiederholt.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 253/253, exit 0 | `docs/evidence/2026-10-01/welle24-run1.manifest.json` |
| PostgreSQL 17, 253/253, exit 0 | `docs/evidence/2026-10-01/welle24-run2.manifest.json` |
| Realtime unter Production gegen TLS-PostgreSQL, 19/19, exit 0 | `docs/evidence/2026-10-01/welle24-realtime.manifest.json` |
| versitygw und ClamAV, 11/11, exit 0 | `docs/evidence/2026-10-01/welle24-storage.manifest.json` |
| Functions gegen Docker plus PostgreSQL, 33/33, exit 0 | `docs/evidence/2026-10-01/welle24-functions.manifest.json` |
| Mailpit und Dex, 11/11, exit 0 | `docs/evidence/2026-10-01/welle24-auth.manifest.json` |
| Mutation die Spur wird am Ausgang der Nachricht geschnitten, exit 1 | `docs/evidence/2026-10-01/welle24-mutation-traceprune.manifest.json` |
| Mutation die freie Abfrage prueft die Grenze je Relation nicht, exit 1 | `docs/evidence/2026-10-01/welle24-mutation-freequeryboundary.manifest.json` |
| Vitest lokal 2513/2513, exit 0 | `docs/evidence/2026-10-01/welle24-local-run1.manifest.json` |
| Vitest lokal 2513/2513, exit 0 | `docs/evidence/2026-10-01/welle24-local-run2.manifest.json` |

## Ehrlich offen

- **QKERN gibt keinen `traceparent` weiter.** Ein Worker bekommt ihn im Claim nicht mitgeliefert, ein Webhook trägt ihn nicht. Das braucht eine eigene Span-Id je Station und damit eine Entscheidung darüber, wer in QKERN Spans erzeugt.
- **Es gibt keine Suche nach einer Spur-Id**, nur das Lesen je Nachricht, und die Trace-Route ist Admin-only: Eine Anwendung kann die Spur ihrer eigenen Nachricht nicht lesen. MCP hat kein Trace-Werkzeug.
- **Die Spur ist nicht unter Last gemessen.** Der zusätzliche Schreibvorgang je Zustandswechsel liegt in derselben Transaktion und ist nicht beziffert, und die Prometheus-Metriken kennen ihn nicht.
- **Keine Zahlungsanbindung und keine Selbstbedienung.** Eine Pauschale legt der Betreiber an, nicht der Kunde.
- **Die lesenden Storage- und Queue-Werkzeuge laufen über MCP weiter als Betreiber.** Die HTTP-Türen von Storage nehmen kein OAuth-Token an.
- **Die Console ist weiterhin ungesehen**, weil sie hinter der Anmeldung liegt. Der Render-Vertrag rendert die neue Spur in allen Zuständen und vier Sprachen, aber geklickt hat niemand.
