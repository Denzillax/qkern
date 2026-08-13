# Zertifizierungsevidenz

Je Lauf liegen hier zwei Dateien: das **ungefilterte Rohlog** und ein
**generiertes Manifest**. Das Manifest wird von
`scripts/certification-manifest.mjs` aus dem Log und aus git erzeugt, nicht von
Hand gepflegt. Ein unvollständiges Log wird abgelehnt, statt eine Teilaussage
als Evidenz abzulegen.

Kein Eintrag hier trägt eine Signatur. Das Ed25519-Verfahren aus
`PRODUCTION_APPLY_AUTHORIZATION_RUNBOOK.md` bindet externe Autoritäten; eine
lokal selbst erzeugte Signatur auf die eigene Aussage wäre Zeremonie ohne
Beweiswert. Die Evidenz belegt, dass ein Lauf stattgefunden hat und mit welchem
Ergebnis — nicht, dass eine unabhängige Stelle ihn bestätigt hat.

## Feldbedeutungen

| Feld | Bedeutung |
| --- | --- |
| `commit` | HEAD zum Zeitpunkt des Laufs |
| `workingTreeClean` | ob der Arbeitsbaum beim Lauf unverändert war |
| `exitCode` | Exit-Code des Runners; nur `0` ist ein bestandener Lauf |
| `migrationsApplied` | vom Init-Script tatsächlich angewandte Migrationen |
| `passed` / `failed` / `skipped` | aus der Vitest-Zusammenfassung gelesen |
| `images` | Image-Tags aus der zugehörigen Compose-Datei |

`workingTreeClean` steht bei den Läufen zu Release 1.9 auf `false`. Das ist
erwartbar und kein Mangel: Das Rohlog entsteht während des Laufs im
Arbeitsverzeichnis und ist zu diesem Zeitpunkt zwangsläufig unversioniert. Der
Stand des Produktcodes ist über `commit` eindeutig belegt.

## Läufe zu Release 1.9 und 1.10 (4. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `postgres-certification-release.log` | PostgreSQL 17 | 28 von 28, exit 0, 29 Migrationen |
| `storage-certification-release.log` | MinIO und ClamAV | 2 von 2, exit 0 |
| `auth-certification-release.log` | Mailpit und Dex | 5 von 5, exit 0 |

Die durchnummerierten Läufe sind die Diagnose- und Fix-Wellen, die zu diesem
Ergebnis geführt haben. Sie bleiben absichtlich erhalten:
`postgres-certification-run4` ist der erste echte Lauf überhaupt und
dokumentiert, dass zu diesem Zeitpunkt keine einzige der sieben
Real-DB-Testdateien bestand. `auth-certification-run1` dokumentiert entsprechend
den Ausgangszustand des Provider-Nachweises.

## Läufe zu Release 1.20 (5. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-05/compute-chain-run1.log` | PostgreSQL 17 | 71 von 71, exit 0, 32 Migrationen |
| `2026-08-05/compute-chain-run2.log` | PostgreSQL 17 | 71 von 71, exit 0, Wiederholung |
| `2026-08-05/compute-chain-mutation.log` | PostgreSQL 17 | **69 von 71, exit 1 — absichtlich** |

Die Mutationsprobe ist der ungewöhnliche Eintrag. Die beiden neuen Garantien aus
Release 1.20 — Freigabe abgelaufener Leases und das Übergehen abgeschalteter
Definitionen — waren im ersten Lauf sofort grün. Statt das zu glauben, wurden
beide im Adapter einzeln abgeschaltet und der Stack erneut ausgeführt. Genau die
zwei zugehörigen Fälle fielen um, kein anderer.

Ein grüner Fall beweist nichts, solange nicht gezeigt ist, dass er auch rot
werden kann. Release 1.16 hatte drei Fälle gefunden, die ausgeführt und
zufällig grün waren.

## Läufe zu Release 1.21 (5. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-05/compute-definitions-run1.log` | PostgreSQL 17 | 78 von 78, exit 0, 32 Migrationen |
| `2026-08-05/compute-definitions-run2.log` | PostgreSQL 17 | 78 von 78, exit 0, Wiederholung |
| `2026-08-05/compute-definitions-mutation.log` | PostgreSQL 17 | **76 von 78, exit 1 — absichtlich** |

Die Mutationsprobe ist inzwischen fester Bestandteil: Abgeschaltet wurden die
Löschvorbedingung eines Webhooks und das Weglassen der Nutzlast im
Zustellstatus. Genau die zwei zugehörigen Fälle fielen um, kein anderer.

## Läufe zu Release 1.22 (5. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-05/functions-run1.log` | Docker 29.5 | 13 von 13, exit 0 |
| `2026-08-05/functions-run2.log` | Docker 29.5 | 13 von 13, exit 0, Wiederholung |
| `2026-08-05/functions-mutation.log` | Docker 29.5 | **10 von 13, exit 1 — absichtlich** |

Abgeschaltet wurden `--network none`, `--user` und die erzwungene
Container-Entfernung nach einem Fehlschlag. Genau die drei zugehörigen Fälle
fielen um, kein anderer.

## Läufe zu Release 1.23 (5. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-05/compute-functions-run1.log` | PostgreSQL 17 | 85 von 85, exit 0, 33 Migrationen |
| `2026-08-05/compute-functions-run2.log` | PostgreSQL 17 | 85 von 85, exit 0, Wiederholung |
| `2026-08-05/compute-functions-mutation.log` | PostgreSQL 17 | **83 von 85, exit 1 — absichtlich** |

Aufgeweicht wurden die Digest-Bindung des Images und das UPDATE-Spaltenrecht.
Genau die zwei zugehörigen Fälle fielen um, kein anderer.

## Läufe zu Release 1.24 (5. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-05/function-chain-run1.log` | Docker 29.5 und PostgreSQL 17 | 18 von 18, exit 0 |
| `2026-08-05/function-chain-run2.log` | Docker 29.5 und PostgreSQL 17 | 18 von 18, exit 0, Wiederholung |
| `2026-08-05/function-chain-mutation.log` | Docker 29.5 und PostgreSQL 17 | **15 von 18, exit 1 — absichtlich** |

Abgeschaltet wurden die Nebenläufigkeitsgrenze und das erneute Lesen der
Definition bei jedem Aufruf. Zwei Fälle fielen direkt um, ein dritter als Folge:
ohne Grenze startete der Test einen zweiten schlafenden Container, der den Lauf
überlebte.

Beide grünen Läufe stammen aus einer Serie von drei aufeinanderfolgenden Läufen,
nachdem zwei Flakes im Harness behoben waren.

## Läufe zu Release 1.25 (5. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-05/webhook-vault-run1.log` | HashiCorp Vault 1.18 | 6 von 6, exit 0 |
| `2026-08-05/webhook-vault-run2.log` | HashiCorp Vault 1.18 | 6 von 6, exit 0, Wiederholung |
| `2026-08-05/webhook-vault-mutation.log` | HashiCorp Vault 1.18 | **4 von 6, exit 1 — absichtlich** |

Abgeschaltet wurden die Mindestlänge des Signaturgeheimnisses und die
Behandlung von HTTP 404 als „kenne ich nicht". Genau die zwei zugehörigen Fälle
fielen um, kein anderer.

## Läufe zu Release 1.26 (5. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-05/function-egress-run1.log` | Docker 29.5 und PostgreSQL 17 | 22 von 22, exit 0 |
| `2026-08-05/function-egress-run2.log` | Docker 29.5 und PostgreSQL 17 | 22 von 22, exit 0, Wiederholung |
| `2026-08-05/function-egress-mutation.log` | Docker 29.5 und PostgreSQL 17 | **20 von 22, exit 1 — absichtlich** |

Aufgeweicht wurden der exakte Origin-Vergleich (auf einen Präfixvergleich) und
das Anfragebudget je Aufruf. Genau die zwei zugehörigen Fälle fielen um.

## Läufe zu Release 1.27 (6. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-05/egress-guard-run1.log` | Docker 29.5 und PostgreSQL 17 | 23 von 23, exit 0 |
| `2026-08-05/egress-guard-run2.log` | Docker 29.5 und PostgreSQL 17 | 23 von 23, exit 0, Wiederholung |
| `2026-08-05/egress-guard-mutation.log` | Docker 29.5 und PostgreSQL 17 | **22 von 23, exit 1 — absichtlich** |

Aufgeweicht wurden die Sperre des Link-local-Bereichs (dort liegt der
Metadatendienst) und die Prüfung aller aufgelösten Adressen statt nur der
ersten. Vier lokale Fälle und der Container-Fall fielen um.

## Läufe zu Release 1.28 (6. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-06/receiver-run1.log` | Node-24-HTTPS-Empfänger und PostgreSQL 17 | 10 von 10, exit 0 |
| `2026-08-06/receiver-run2.log` | Node-24-HTTPS-Empfänger und PostgreSQL 17 | 10 von 10, exit 0, Wiederholung |
| `2026-08-06/receiver-mutation.log` | Node-24-HTTPS-Empfänger und PostgreSQL 17 | **7 von 10, exit 1 — absichtlich** |

Abgeschaltet wurden das Weiterleitungsverbot, die Adressprüfung und die
Antwortgrenze. Genau die drei zugehörigen Fälle fielen um. Eine zweite
Mutationswelle am Empfänger selbst — Zustell-ID auch auf dem stillen Pfad
zurückgespiegelt, `wrong.qkern.test` ins Zertifikat aufgenommen — liess die
anderen drei umfallen; sie ist nicht als eigenes Log abgelegt, weil sie
denselben Stack mit veränderten Testmitteln fährt.

Der **erste** Lauf dieses Slices war rot und ist der eigentliche Fund: Das
DNS-Pinning aus Release 1.27 hat gegen einen echten Socket jede Verbindung
verhindert. Er ist hier nicht abgelegt, weil er den defekten Stand belegt, den
`receiver-run1.log` bereits ersetzt; die Ursache steht in `docs/QA.md` und
`docs/RELEASE_1.28.md`.

## Läufe zu Release 1.29 (6. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-06/usage-emitters-run1.log` | PostgreSQL 17 | 92 von 92, exit 0, 33 Migrationen |
| `2026-08-06/usage-emitters-run2.log` | PostgreSQL 17 | 92 von 92, exit 0, Wiederholung |
| `2026-08-06/usage-emitters-mutation.log` | PostgreSQL 17 | **89 von 92, exit 1 — absichtlich** |
| `2026-08-06/usage-emitters-mutation2.log` | PostgreSQL 17 | **86 von 92, exit 1 — absichtlich** |

Zwei Mutationswellen statt einer, weil die sieben neuen Fälle zwei verschiedene
Zusagen tragen. Erste Welle: Zulassung im Function-Aufruf entfernt, Messung im
Enqueue hinter das Schreiben verschoben — drei Fälle fallen um. Zweite Welle:
Idempotenzschlüssel konstant, Ausfallmodus auf `reject` — sechs Fälle fallen
um. Zusammen ist für jeden der sieben Fälle gezeigt, dass er rot werden kann.

Ab diesem Release schreibt `scripts/postgres-certification.mjs` die
`EXIT=`-Zeile selbst. Bisher musste die Shell sie anhängen — Handpflege genau an
der Stelle, an der die Evidenz entsteht.

## Läufe zu Release 1.30 (6. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-06/usage-transaction-run1.log` | PostgreSQL 17 | 95 von 95, exit 0, 33 Migrationen |
| `2026-08-06/usage-transaction-run2.log` | PostgreSQL 17 | 95 von 95, exit 0, Wiederholung |
| `2026-08-06/usage-transaction-mutation.log` | PostgreSQL 17 | **93 von 95, exit 1 — absichtlich** |
| `2026-08-06/usage-transaction-mutation2.log` | PostgreSQL 17 | **94 von 95, exit 1 — absichtlich** |

Erste Welle: zurück auf das Verhalten von 1.29 — messen vor der Operation, in
einer eigenen Transaktion. Genau die zwei zugehörigen Fälle fielen um.

Zweite Welle: die Zeilensperre auf dem Monatszähler entfernt. Diese Welle lief
**zweimal**. Beim ersten Mal fiel nichts um — der Nebenläufigkeitsfall benutzte
eine einzige Queue, und Enqueues derselben Queue serialisieren ohnehin auf deren
Zeile. Der Fall war grün, ohne die Zusage zu tragen. Mit vier Queues fällt er
ohne die Sperre sofort um.

Abgelegt ist die zweite, aussagekräftige Ausführung. Der erste, grüne Versuch
ist kein Nachweis, sondern war der Anlass, den Testfall zu korrigieren; er steht
in `docs/QA.md` und `docs/RELEASE_1.30.md` beschrieben.

## Läufe zu Release 1.31 (6. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-06/usage-modules-run1.log` | PostgreSQL 17 | 98 von 98, exit 0, 33 Migrationen |
| `2026-08-06/usage-modules-run2.log` | PostgreSQL 17 | 98 von 98, exit 0, Wiederholung |
| `2026-08-06/usage-modules-mutation.log` | PostgreSQL 17 | **95 von 98, exit 1 — absichtlich** |

Ersetzt wurden die gelesene Zeilenzahl durch eine feste Eins, die Byte-Messung
durch nichts und das enforce-Verbot durch nichts. Genau die drei zugehörigen
Fälle fielen um.

## Läufe zu Release 1.32 (6. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-06/usage-api-requests-run1.log` | PostgreSQL 17 | 99 von 99, exit 0, 33 Migrationen |
| `2026-08-06/usage-api-requests-run2.log` | PostgreSQL 17 | 99 von 99, exit 0, Wiederholung |
| `2026-08-06/usage-api-requests-mutation.log` | PostgreSQL 17 | **98 von 99, exit 1 — absichtlich** |

Entfernt wurde die Ablehnung in `admitApiRequest`. Der Zertifizierungsfall fiel
um, zusammen mit dem lokalen Abbruchfall.

## Läufe zu Release 1.33 (6. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-06/usage-realtime-run1.log` | PostgreSQL 17 | 101 von 101, exit 0, 33 Migrationen |
| `2026-08-06/usage-realtime-run2.log` | PostgreSQL 17 | 101 von 101, exit 0, Wiederholung |
| `2026-08-06/usage-realtime-mutation.log` | PostgreSQL 17 | **98 von 101, exit 1 — absichtlich** |

Abgeschaltet wurden die Bündelung (Schreiben je Nachricht statt gesammelt) und
die Eintragung von `realtime_messages` in die Liste der nicht erzwingbaren
Metriken. Genau die drei zugehörigen Fälle fielen um.

## Läufe zu Release 1.34 (6. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-06/usage-changes-run1.log` | PostgreSQL 17 | 101 von 101, exit 0, 33 Migrationen |
| `2026-08-06/usage-changes-run2.log` | PostgreSQL 17 | 101 von 101, exit 0, Wiederholung |
| `2026-08-06/usage-changes-baseline.log` | PostgreSQL 17 | **100 von 101, exit 1 — absichtlich** |

Der dritte Eintrag ist zweierlei zugleich, und deshalb steht er hier: Er ist die
Mutationsprobe — der Emitter wurde aus dem Soak-Lauf entfernt, und genau die
Zählerprüfung fiel um — und er ist die **Basislinie** der Latenzmessung.

Die Latenzwerte über vier Läufe (Stand 1.34): mit Emitter p95 421 ms, 1846 ms und 1716 ms,
ohne Emitter p95 528 ms. Die Streuung **derselben** Konfiguration ist rund
viermal so gross wie jeder Unterschied zwischen den Konfigurationen — diese
Messreihe kann die Kosten des Emitters deshalb nicht isolieren. Sie belegt, dass
der Lauf mit eingeschaltetem Emitter seine Stillstandsschranken einhält, und
nicht mehr.

## Läufe zu Release 1.35 (6. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-06/functions-registry-run1.log` | Docker 29.5, registry:2 und PostgreSQL 17 | 23 von 23, exit 0 |
| `2026-08-06/functions-registry-run2.log` | Docker 29.5, registry:2 und PostgreSQL 17 | 23 von 23, exit 0, Wiederholung |
| `2026-08-06/functions-registry-postgres.log` | PostgreSQL 17 | 101 von 101, exit 0, 34 Migrationen |
| `2026-08-06/functions-registry-mutation.log` | Docker 29.5 und PostgreSQL 17 | **18 von 23, exit 1 — absichtlich** |
| `2026-08-06/functions-registry-mutation2.log` | Docker 29.5 und PostgreSQL 17 | **8 von 23, exit 1 — absichtlich** |

Die erste Mutation lässt Migration 0034 weg: Alle fünf Kettenfälle fallen über
`project_functions_image_check`, weil der alte Ausdruck keinen Doppelpunkt und
damit keine Registry mit Port zuliess. Das ist zugleich der Produktfehler, den
dieser Slice gefunden hat.

Die zweite stoppt die Registry nach dem Push. 15 Fälle fallen um, weil nichts
mehr zu ziehen ist — der Beleg, dass der Lauf wirklich aus der Registry zieht
und nicht aus einem Rest im lokalen Zwischenspeicher.

## Läufe zu Release 1.36 (6. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-06/function-slots-run1.log` | PostgreSQL 17 | 106 von 106, exit 0, 35 Migrationen |
| `2026-08-06/function-slots-run2.log` | PostgreSQL 17 | 106 von 106, exit 0, Wiederholung |
| `2026-08-06/function-slots-mutation.log` | PostgreSQL 17 | **105 von 106, exit 1 — absichtlich** |
| `2026-08-06/function-slots-mutation2.log` | PostgreSQL 17 | **104 von 106, exit 1 — absichtlich** |

Erste Welle: Der Zählweg filtert zusätzlich nach dem Halter. Genau der Fall
fällt um, der zwei Instanzen gegeneinander stellt.

Zweite Welle: Ablauf ignoriert und die Unveränderlichkeit des Platzes
aufgehoben. Genau die zwei zugehörigen Fälle fallen um.

Die abgelegte zweite Welle ist der **dritte** Anlauf. Die ersten beiden warfen
alle fünf Fälle um, weil die Mutation ungültiges SQL erzeugte — PostgreSQL kann
den Typ eines Parameters nicht bestimmen, der nur in `IS NOT NULL` oder in
`$5 - interval` vorkommt. Eine Probe, die das Werkzeug zerstört statt die Zusage
aufzuweichen, sagt nichts aus; sie ist deshalb nicht abgelegt, sondern in
`docs/QA.md` und `docs/RELEASE_1.36.md` beschrieben.

## Läufe zu Release 1.37 (6. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-06/realtime-retention-run1.log` | PostgreSQL 17 | 108 von 108, exit 0, 35 Migrationen |
| `2026-08-06/realtime-retention-run2.log` | PostgreSQL 17 | 108 von 108, exit 0, Wiederholung |
| `2026-08-06/realtime-retention-mutation.log` | PostgreSQL 17 | **107 von 108, exit 1 — absichtlich** |

Das Aufbewahrungsfenster wurde ignoriert, also bis `now` gelöscht. Genau der
Fall fiel um, der Altes von Neuem unterscheidet.

Die Tenant-Grenze des zweiten Falls trägt RLS und nicht der Aufräumer; sie lässt
sich vom Adapter aus nicht brechen und ist deshalb nicht durch eine Mutation
belegt.

## Läufe zu Release 1.38 (6. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-06/webhook-retention-run1.log` | PostgreSQL 17 | 110 von 110, exit 0, 35 Migrationen |
| `2026-08-06/webhook-retention-run2.log` | PostgreSQL 17 | 110 von 110, exit 0, Wiederholung |
| `2026-08-06/webhook-retention-mutation.log` | PostgreSQL 17 | **109 von 110, exit 1 — absichtlich** |
| `2026-08-06/webhook-retention-mutation2.log` | PostgreSQL 17 | **109 von 110, exit 1 — absichtlich** |

Erste Welle: Status und Zeitstempel ignoriert, also nach `created_at` gelöscht —
der Fall mit der wartenden Zustellung fällt um. Zweite Welle: tote Zustellungen
mit dem Fenster der zugestellten behandelt — der Fall mit dem Dead Letter fällt
um.

Die abgelegte zweite Welle ist der **dritte** Anlauf. Die ersten beiden liessen
PostgreSQL werfen (`$5 IS NOT NULL`, dann ein unbenutzter Parameter) und warfen
deshalb den falschen Fall um. Daraus die Regel in `docs/QA.md`: Eine Mutation
ändert einen Wert oder ein Prädikat, nie die Parameterzahl.

## Läufe zu Release 1.41 (7. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-06/usage-export-run1.log` | PostgreSQL 17 | 114 von 114, exit 0, 35 Migrationen |
| `2026-08-06/usage-export-run2.log` | PostgreSQL 17 | 114 von 114, exit 0, Wiederholung |
| `2026-08-06/usage-export-mutation.log` | PostgreSQL 17 | **113 von 114, exit 1 — absichtlich** |
| `2026-08-06/usage-export-mutation2.log` | PostgreSQL 17 | **112 von 114, exit 1 — absichtlich** |

Erste Welle: `>` zu `>=` im Keyset — der Seitenfall meldet dreizehn statt sieben
Ereignisse. Zweite Welle: `project_id=$2` zu `(project_id=$2 OR $2 IS NOT NULL)`
— beide Fälle fallen, die die Projektgrenze tragen.

Der Ordner trägt das Datum des Laufs, nicht das des Release: Die vier Läufe
liefen in der Nacht zum 7. August auf demselben Stack wie die Läufe zu 1.38.

Dass die erste Welle **dieselben dreizehn Zeilen** liefert wie der Defekt, den
der erste Zertifizierungslauf gefunden hatte, ist der eigentliche Beleg: Die
Probe misst die Zusage und nicht das Werkzeug.

## Läufe zu Release 1.42 (7. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-06/queue-host-run1.log` | PostgreSQL 17 | 117 von 117, exit 0, 35 Migrationen |
| `2026-08-06/queue-host-run2.log` | PostgreSQL 17 | 117 von 117, exit 0, Wiederholung |
| `2026-08-06/queue-host-mutation.log` | PostgreSQL 17 | **114 von 117, exit 1 — absichtlich** |
| `2026-08-06/queue-host-mutation2.log` | PostgreSQL 17 | **116 von 117, exit 1 — absichtlich** |

Erste Welle: Der Wirt hört auf `functionName` statt auf `queue` — alle drei
Fälle fallen, weil alle drei die Verdrahtung tragen. Zweite Welle: Der Handler
verschluckt den Fehlschlag statt ihn zu melden — genau der Retry-Fall fällt.

Die dritte Probe dieses Release hat kein Manifest, weil sie nicht am
Zertifizierungsstack hängt: Wird `workers/project-queue-runtime.mts` entfernt,
nennt der Erreichbarkeitsvertrag die ganze Kette vom Dispatch bis zum Worker.

## Läufe zu Release 1.43 (7. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-06/queue-container-run1.log` | Docker 29.5, registry:2 und PostgreSQL 17 | 25 von 25, exit 0 |
| `2026-08-06/queue-container-run2.log` | Docker 29.5, registry:2 und PostgreSQL 17 | 25 von 25, exit 0, Wiederholung |
| `2026-08-06/queue-container-mutation.log` | Docker 29.5, registry:2 und PostgreSQL 17 | **24 von 25, exit 1 — absichtlich** |
| `2026-08-06/queue-container-mutation2.log` | Docker 29.5, registry:2 und PostgreSQL 17 | **24 von 25, exit 1 — absichtlich** |

Erste Welle: Die Statuscode-Prüfung des Handlers entschärft — genau der
Fehlschlag-Fall fällt. Zweite Welle: Der Wirt ruft `message.queue` statt des
gebundenen Funktionsnamens — genau der Erfolgsfall fällt.

Dass jede Welle **einen anderen** Fall umwirft, ist die eigentliche Aussage:
Die beiden Fälle hängen nicht am selben Pfad.

## Läufe zu Release 1.44 (7. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-06/queue-process-run1.log` | Docker 29.5, registry:2 und PostgreSQL 17 | 26 von 26, exit 0 |
| `2026-08-06/queue-process-run2.log` | Docker 29.5, registry:2 und PostgreSQL 17 | 26 von 26, exit 0, Wiederholung |
| `2026-08-06/queue-process-mutation.log` | Docker 29.5, registry:2 und PostgreSQL 17 | **25 von 26, exit 1 — absichtlich** |
| `2026-08-06/worker-boot-run1.log` | PostgreSQL 17 | 117 von 117, exit 0, 35 Migrationen |
| `2026-08-06/worker-boot-run2.log` | PostgreSQL 17 | 117 von 117, exit 0, Wiederholung |

Die Mutation lässt den Wirt starten, aber seine Schleife nicht aufrufen: Genau
der Prozess-Fall fällt, die beiden Objekt-Fälle bleiben grün. Damit ist
„startet" von „arbeitet" getrennt.

Die zweite Probe dieses Release hat kein Manifest, weil sie ohne Stack läuft:
Wird eine Worker-Datei wieder `.ts` genannt, benennt der Boot-Vertrag sie
namentlich — und genau daran sind bis `1.44.0` alle sieben Prozesse gescheitert.

Die beiden PostgreSQL-Läufe zeigen keine neue Zahl. Sie stehen hier, weil die
Umbenennung nach `.mts` `lib/server/operations/runtime-deployment.ts` berührt
und ein unveränderter Lauf danach keine Selbstverständlichkeit ist.

## Läufe zu Release 1.45 (8. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-06/compute-process-run1.log` | PostgreSQL 17 | 118 von 118, exit 0, 35 Migrationen |
| `2026-08-06/compute-process-run2.log` | PostgreSQL 17 | 118 von 118, exit 0, Wiederholung |
| `2026-08-06/compute-process-mutation.log` | PostgreSQL 17 | **117 von 118, exit 1 — absichtlich** |

Die Mutation lässt die Cron-Schleife vor jedem `scheduler.run` werfen: Genau der
Prozess-Fall fällt, die zwölf übrigen Cron-Fälle bleiben grün.

Ein verworfener Lauf dieses Release zeigte Fehler in Dateien unter
`.claude/worktrees/…` — der Stack kopierte ein fremdes Verzeichnis mit und
zertifizierte damit etwas anderes als den Arbeitsstand. Die fünf tar-basierten
Compose-Stacks schliessen `.claude` seither aus. Der Lauf ist nicht abgelegt: Er
belegt nichts über das Produkt, nur über den Stack.

## Läufe zu Release 1.46 (8. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-08/probe-run1.log` | PostgreSQL 17 | 120 von 120, exit 0, 35 Migrationen |
| `2026-08-08/probe-run2.log` | PostgreSQL 17 | 120 von 120, exit 0, Wiederholung |
| `2026-08-08/probe-mutation.log` | PostgreSQL 17 | **119 von 120, exit 1 — absichtlich** |

Die Mutation nimmt dem `onError` des Cron-Schedulers seine Meldung: Genau der
negative Fall fällt — `/ready` bliebe grün, während jede Definition scheitert.
Der positive Fall bleibt bestehen, die beiden hängen also nicht am selben Pfad.

## Läufe zu Release 1.47 (8. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-08/queue-probe-run1.log` | Docker 29.5, registry:2 und PostgreSQL 17 | 26 von 26, exit 0 |
| `2026-08-08/queue-probe-run2.log` | Docker 29.5, registry:2 und PostgreSQL 17 | 26 von 26, exit 0, Wiederholung |
| `2026-08-08/queue-probe-mutation.log` | Docker 29.5, registry:2 und PostgreSQL 17 | **25 von 26, exit 1 — absichtlich** |
| `2026-08-08/queue-probe-postgres.log` | PostgreSQL 17 | 120 von 120, exit 0, unverändert |

Die Mutation nimmt dem Queue-Wirt den durchgereichten Beobachter: `/ready` bliebe
503, während Nachrichten verarbeitet werden. Genau der Prozess-Fall fällt.

Die zweite Probe dieses Release hat kein Manifest, weil sie ohne Stack läuft:
Wird dem Wirt der Probe-Aufruf genommen, nennt der Vertrag die Datei namentlich.

Der PostgreSQL-Lauf zeigt keine neue Zahl. Er steht hier, weil die Verdrahtung
`lib/server/project-queues/host-runtime.ts` berührt und ein unveränderter Lauf
danach keine Selbstverständlichkeit ist.

## Läufe zu Release 1.48 (8. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-08/migration-process-run1.log` | PostgreSQL 17 | 122 von 122, exit 0, 35 Migrationen |
| `2026-08-08/migration-process-run2.log` | PostgreSQL 17 | 122 von 122, exit 0, Wiederholung |
| `2026-08-08/migration-process-mutation.log` | PostgreSQL 17 | **121 von 122, exit 1 — absichtlich** |

Die Mutation entfernt den CTE-Alias in `quarantineExpiredReconciliations` wieder:
Der Auftrag bleibt `queued`, weil PostgreSQL die Abfrage als mehrdeutig abweist.
Genau der Prozess-Fall fällt.

Kein Lauf belegt das **Anwenden** in einer echten Projektdatenbank. Lokal
gelingt es nach beiden Fixes; im Zertifizierungscluster weist der Zaun mit
`INVALID_MIGRATION_FENCE` ab, und der Grund ist nicht isoliert. Der lokale Lauf
ist nicht abgelegt: Er lief ausserhalb eines Stacks und trägt deshalb keine
Evidenz im Sinne dieses Ordners.

## Läufe zu Release 1.49 (8. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-08/migration-apply-run1.log` | PostgreSQL 17 | 122 von 122, exit 0, 35 Migrationen |
| `2026-08-08/migration-apply-run2.log` | PostgreSQL 17 | 122 von 122, exit 0, Wiederholung |
| `2026-08-08/migration-apply-mutation.log` | PostgreSQL 17 | **121 von 122, exit 1 — absichtlich** |

Die Mutation stellt den Stand von `1.48.0` wieder her: drei dauerhafte Grants auf
die clusterweite Ledger-Rolle und kein Aufräumen vor dem Lauf. Genau der
Anwendungsfall fällt.

Eine erste, kleinere Probe — ein einzelner wiederhergestellter Grant — traf
nicht, weil das Aufräumen vor dem Lauf ihn einholte. Das steht hier, weil es
etwas über die Zusage sagt: Sie hängt an zwei Dingen, nicht an einem.

## Läufe zu Release 1.50 (8. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-08/cluster-role-run1.log` | PostgreSQL 17 | 122 von 122, exit 0, 35 Migrationen |
| `2026-08-08/cluster-role-run2.log` | PostgreSQL 17 | 122 von 122, exit 0, Wiederholung |

Die Mutationsprobe dieses Release hat kein Manifest, weil sie ohne Stack läuft:
Wird der Grant in einer Realtime-Datei wiederhergestellt, nennt der Vertrag die
Datei namentlich.

Die beiden Läufe zeigen keine neue Zahl. Sie stehen hier, weil der Vertrag zwar
lokal läuft, sein Gegenstand aber der Zertifizierungslauf ist — ein
unveränderter Lauf ist die Zusage, dass nichts kippt.
