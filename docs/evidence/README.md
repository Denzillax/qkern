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

## Läufe zu Release 1.51 (8. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-08/boundary-names-run1.log` | PostgreSQL 17 | 123 von 123, exit 0, 35 Migrationen |
| `2026-08-08/boundary-names-run2.log` | PostgreSQL 17 | 123 von 123, exit 0, Wiederholung |
| `2026-08-08/boundary-names-mutation.log` | PostgreSQL 17 | **122 von 123, exit 1 — absichtlich** |

Die Mutation lässt den Zaun wieder eine leere Liste melden: Der Auftrag scheitert
weiterhin, aber niemand erfährt woran. Genau der neue Fall fällt.

## Läufe zu Release 1.52 (8. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-08/host-logger-run1.log` | Docker 29.5, registry:2 und PostgreSQL 17 | 26 von 26, exit 0 |
| `2026-08-08/host-logger-run2.log` | Docker 29.5, registry:2 und PostgreSQL 17 | 26 von 26, exit 0, Wiederholung |
| `2026-08-08/host-logger-mutation.log` | Docker 29.5, registry:2 und PostgreSQL 17 | **25 von 26, exit 1 — absichtlich** |
| `2026-08-08/host-logger-postgres.log` | PostgreSQL 17 | 123 von 123, exit 0, unverändert |

Die Mutation nimmt dem Queue-Wirt die Durchreichung des Loggers: Nachrichten
werden weiterhin verarbeitet, aber der Prozess schweigt darüber. Genau der
Prozess-Fall fällt.

Die zweite Probe dieses Release hat kein Manifest, weil sie ohne Stack läuft:
Wird dem Migrations-Prozess der Worker-Logger genommen, nennt der Vertrag Datei,
Fabrik und Logger.

## Läufe zu Release 1.53 (8. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-08/compute-logger-run1.log` | PostgreSQL 17 | 123 von 123, exit 0, 35 Migrationen |
| `2026-08-08/compute-logger-run2.log` | PostgreSQL 17 | 123 von 123, exit 0, Wiederholung |
| `2026-08-08/compute-logger-mutation.log` | PostgreSQL 17 | **122 von 123, exit 1 — absichtlich** |

Die Mutation nimmt der Cron-Schleife ihre Rundenmeldung: Vorkommen werden
weiterhin ausgelöst, aber der Prozess schweigt darüber. Genau der Prozess-Fall
fällt.

## Läufe zu Release 1.54 (8. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-08/webhook-process-run1.log` | Node 24 HTTPS-Empfänger und PostgreSQL 17 | 11 von 11, exit 0 |
| `2026-08-08/webhook-process-run2.log` | Node 24 HTTPS-Empfänger und PostgreSQL 17 | 11 von 11, exit 0, Wiederholung |
| `2026-08-08/webhook-process-mutation.log` | Node 24 HTTPS-Empfänger und PostgreSQL 17 | **10 von 11, exit 1 — absichtlich** |

Die Mutation nimmt dem Zusteller seinen Erfolgshaken: Die Zustellung kommt
weiterhin an, aber der Prozess schweigt darüber. Genau der Prozess-Fall fällt.

## Läufe zu Release 1.55 (8. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-08/webhook-refused-run1.log` | Node 24 HTTPS-Empfänger und PostgreSQL 17 | 12 von 12, exit 0 |
| `2026-08-08/webhook-refused-run2.log` | Node 24 HTTPS-Empfänger und PostgreSQL 17 | 12 von 12, exit 0, Wiederholung |
| `2026-08-08/webhook-refused-mutation.log` | Node 24 HTTPS-Empfänger und PostgreSQL 17 | **11 von 12, exit 1 — absichtlich** |

Die Mutation nimmt dem Zusteller die Meldung des Fehlschlags: Die Zustellung
landet weiterhin im Dead Letter, aber der Prozess schweigt darüber.

## Läufe zu Release 1.56 (8. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-08/incident-process-run1.log` | Node 24 HTTPS-Empfänger und PostgreSQL 17 | 13 von 13, exit 0 |
| `2026-08-08/incident-process-run2.log` | Node 24 HTTPS-Empfänger und PostgreSQL 17 | 13 von 13, exit 0, Wiederholung |
| `2026-08-08/incident-process-mutation.log` | Node 24 HTTPS-Empfänger und PostgreSQL 17 | **12 von 13, exit 1 — absichtlich** |

Die Mutation lässt den Empfänger eine andere Kennung bestätigen: Die Zustellung
kommt an, gilt aber zu Recht nicht als angekommen.

## Läufe zu Release 1.57 (8. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-08/realtime-process-run1.log` | PostgreSQL 17 | 124 von 124, exit 0, 35 Migrationen |
| `2026-08-08/realtime-process-run2.log` | PostgreSQL 17 | 124 von 124, exit 0, Wiederholung |
| `2026-08-08/realtime-process-mutation.log` | PostgreSQL 17 | **123 von 124, exit 1 — absichtlich** |

Die Mutation gibt jedem Projekt-Key die Rolle `anon`: Die Anmeldung gelingt
weiterhin, das Abonnement eines `private:`-Kanals nicht mehr.

Eine erste, gröbere Probe traf nicht — sie nahm der Fernzustellung ihre
Verdrahtung, und ein Client auf einer Instanz merkt davon nichts. Das steht hier,
weil es die Reichweite des Falls beschreibt.

## Läufe zu Release 1.58 (8. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-08/apply-process-run1.log` | Node 24 HTTPS-Empfänger und PostgreSQL 17 | 14 von 14, exit 0 |
| `2026-08-08/apply-process-run2.log` | Node 24 HTTPS-Empfänger und PostgreSQL 17 | 14 von 14, exit 0, Wiederholung |
| `2026-08-08/apply-process-mutation.log` | Node 24 HTTPS-Empfänger und PostgreSQL 17 | **13 von 14, exit 1 — absichtlich** |

Die Mutation nimmt dem Empfänger den Pfad `/apply`: Der Prozess veröffentlicht
weiterhin, die Gegenstelle nimmt es nicht an.

## Läufe zu Release 1.60 (8. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-08/provisioning-port-run1.log` | PostgreSQL 17 | 127 von 127, exit 0, 35 Migrationen |
| `2026-08-08/provisioning-port-run2.log` | PostgreSQL 17 | 127 von 127, exit 0, Wiederholung |
| `2026-08-08/provisioning-port-mutation.log` | PostgreSQL 17 | **126 von 127, exit 1 — absichtlich** |

Die abgelegte Mutation lässt nur noch `failed` statt `pending` übernehmen: Genau
der Übernahmefall fällt.

Eine erste Probe weichte die Mandantenbedingung zu `OR true` auf und traf
**nicht** — die Grenze trägt RLS, nicht das Prädikat. Sie ist nicht abgelegt,
weil ein grüner Lauf keine Evidenz für eine Mutation ist; der Befund steht in der
Release Note.

## Läufe zu Release 1.61 (15. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-15/provisioner-heartbeat-run1.log` | PostgreSQL 17 | 129 von 129, exit 0, 36 Migrationen |
| `2026-08-15/provisioner-heartbeat-run2.log` | PostgreSQL 17 | 129 von 129, exit 0, Wiederholung |
| `2026-08-15/provisioner-heartbeat-mutation.log` | PostgreSQL 17 | **127 von 129, exit 1 — absichtlich** |

Die Mutation legt das Leserecht auf `started_at, last_seen_at` statt auf die
Arbiter-Spalten des `ON CONFLICT`. Genau die zwei Heartbeat-Fälle fallen — die
Arbiter-Spalten tragen es, nicht das Leserecht als solches.

## Läufe zu Release 1.62 (15. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-15/provisioner-process-run1.log` | Empfänger plus PostgreSQL 17 | 15 von 15, exit 0 |
| `2026-08-15/provisioner-process-run2.log` | Empfänger plus PostgreSQL 17 | 15 von 15, exit 0, Wiederholung |
| `2026-08-15/provisioner-process-mutation.log` | Empfänger plus PostgreSQL 17 | **14 von 15, exit 1 — absichtlich** |
| `2026-08-15/provisioner-process-postgres-run1.log` | PostgreSQL 17 | 129 von 129, exit 0, 37 Migrationen |
| `2026-08-15/provisioner-process-postgres-run2.log` | PostgreSQL 17 | 129 von 129, exit 0, Wiederholung |

Die Mutation macht das `RETURNING` in `complete()` wieder unqualifiziert. Genau
der Provisionierungsfall fällt.

## Läufe zu Release 1.63 (15. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-15/privilege-clause-run1.log` | PostgreSQL 17 | 134 von 134, exit 0, 38 Migrationen |
| `2026-08-15/privilege-clause-run2.log` | PostgreSQL 17 | 134 von 134, exit 0, Wiederholung |
| `2026-08-15/privilege-clause-mutation.log` | PostgreSQL 17 | **130 von 134, exit 1 — drei absichtlich, einer nicht** |

Die Mutation legt das Leserecht auf `created_at` statt auf die drei
Arbiter-Spalten. Es fallen die beiden Einreihungsfälle und der Vertrag selbst —
genau die drei, die davon abhängen.

Der **vierte** Fall — `claims every message exactly once across six competing
instances` — hat mit der Mutation nichts zu tun: Er liegt auf dem Queue-Weg, den
sie nicht berührt, und beide grünen Läufe haben ihn bestanden. Er ist einmal in
drei Läufen mit einem `PersistenceError` beim Einreihen gescheitert. Das ist
nicht erklärt, und es steht hier, statt weggelassen zu werden.

## Läufe zu Release 1.64 (15. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-15/connection-pressure-run1.log` | PostgreSQL 17 | 135 von 135, exit 0, 38 Migrationen |
| `2026-08-15/connection-pressure-run2.log` | PostgreSQL 17 | 135 von 135, exit 0, Wiederholung |
| `2026-08-15/connection-pressure-mutation.log` | PostgreSQL 17 | **134 von 135, exit 1 — absichtlich** |

Die Mutation reicht den Fehler beim Verbindungsholen wieder durch, statt ihn zu
klassifizieren. Genau der neue Fall fällt.

Der in Release 1.63 offen gebliebene Lastfall ist damit erklärt: Es war der
Verbindungspool, nicht die Warteschlange.

## Läufe zu Release 1.65 (16. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-16/route-unavailable-run1.log` | lokal | 19 von 19, exit 0 |
| `2026-08-16/route-unavailable-run2.log` | lokal | 19 von 19, exit 0, Wiederholung |
| `2026-08-16/route-unavailable-mutation-a.log` | lokal | **17 von 19, exit 1 — absichtlich** |
| `2026-08-16/route-unavailable-mutation-b.log` | lokal | **16 von 19, exit 1 — absichtlich** |
| `2026-08-16/route-unavailable-postgres-run1.log` | PostgreSQL 17 | 135 von 135, exit 0, 38 Migrationen |
| `2026-08-16/route-unavailable-postgres-run2.log` | PostgreSQL 17 | 135 von 135, exit 0, Wiederholung |

Mutation A entfernt die Regel aus einer Grenze — deren zwei Fälle fallen.
Mutation B legt eine zehnte Grenze an, die der Vertrag nicht kennt — die
Abdeckungsprüfung schlägt an und nennt sie beim Namen.

## Läufe zu Release 1.66 (16. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-16/provisioner-step-run1.log` | Empfänger plus PostgreSQL 17 | 16 von 16, exit 0 |
| `2026-08-16/provisioner-step-run2.log` | Empfänger plus PostgreSQL 17 | 16 von 16, exit 0, Wiederholung |
| `2026-08-16/provisioner-step-mutation.log` | Empfänger plus PostgreSQL 17 | **15 von 16, exit 1 — absichtlich** |

Die Mutation lässt das `step`-Feld weg. Genau der Fall fällt, der den Fehler aus
1.61 absichtlich wiederherstellt und den benannten Schritt verlangt.

## Läufe zu Release 1.67 (16. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-16/billing-run1.log` | PostgreSQL 17 | 139 von 139, exit 0, 39 Migrationen |
| `2026-08-16/billing-run2.log` | PostgreSQL 17 | 139 von 139, exit 0, Wiederholung |
| `2026-08-16/billing-mutation.log` | PostgreSQL 17 | **138 von 139, exit 1 — absichtlich** |

Die Mutation dreht die Ordnung der Preisauswahl um (`DESC` → `ASC`): der älteste
Preis gewinnt. Genau der Fall „der neueste Preis gewinnt" fällt.

## Läufe zu Release 1.68 (16. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-16/invoice-run1.log` | PostgreSQL 17 | 142 von 142, exit 0, 40 Migrationen |
| `2026-08-16/invoice-run2.log` | PostgreSQL 17 | 142 von 142, exit 0, Wiederholung |
| `2026-08-16/invoice-mutation.log` | PostgreSQL 17 | **141 von 142, exit 1 — absichtlich** |

Die Mutation entfernt den Periodenabschluss des Rechnungslaufs. Genau der Fall
fällt, der einen Lauf über die offene Periode an der Konfigurationsgrenze
scheitern sieht.

Ein erster Mutationslauf endete mit exit 1, ohne dass die Probe lief: Docker
Desktop war ausgefallen. Der Lauf wurde verworfen und wiederholt — ein
Exit-Code allein beglaubigt keine Mutationsprobe.

## Läufe zu Release 1.69 (16. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-16/multipart-run1.log` | MinIO plus ClamAV | 4 von 4, exit 0 |
| `2026-08-16/multipart-run2.log` | MinIO plus ClamAV | 4 von 4, exit 0, Wiederholung |
| `2026-08-16/multipart-mutation.log` | MinIO plus ClamAV | **3 von 4, exit 1 — absichtlich** |

Die Mutation nimmt die Teil-Prüfsumme aus der URL-Signatur. Genau der
Resumable-Fall fällt: Ohne Signaturzwang nimmt der Provider Teile ohne
Prüfsummen-Header an.

Eine erste Fassung der Probe traf nicht — die Abweisung manipulierter Bytes
trägt der mitgesendete Header, nicht die Signatur. Der Fall wurde daraufhin um
den Versuch ohne Header erweitert; erst damit trifft die Probe. Ausserdem war
ein als Mutation beschrifteter Lauf ein grüner Lauf (Skript scheiterte vor dem
Schreiben); er wurde verworfen und wiederholt.

## Läufe zu Release 1.70 (16. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-16/multipart-service-run1.log` | MinIO und ClamAV | 6 von 6, exit 0 |
| `2026-08-16/multipart-service-run2.log` | MinIO und ClamAV | 6 von 6, exit 0, Wiederholung |
| `2026-08-16/multipart-service-mutation.log` | MinIO und ClamAV | **5 von 6, exit 1 — absichtlich** |
| `2026-08-16/multipart-postgres-run1.log` | PostgreSQL 17 | 142 von 142, exit 0, 41 Migrationen |
| `2026-08-16/multipart-postgres-run2.log` | PostgreSQL 17 | 142 von 142, exit 0, Wiederholung |

Die Mutation nimmt dem Scanner den Prüfsummenvergleich. Genau der Fall fällt,
in dem eine gelogene Ganzdatei-Prüfsumme das Objekt in Quarantäne halten muss.

## Läufe zu Release 1.71 (16. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-16/views-run1.log` | PostgreSQL 17 | 143 von 143, exit 0, 41 Migrationen |
| `2026-08-16/views-run2.log` | PostgreSQL 17 | 143 von 143, exit 0, Wiederholung |
| `2026-08-16/views-mutation.log` | PostgreSQL 17 | **141 von 143, exit 1 — absichtlich** |

Die Mutation entfernt die `security_invoker`-Bedingung: Der Views-Fall fällt,
weil der undichte View bedient würde. Der zweite rote Fall im Mutationslauf war
der damals noch ungehärtete Queue-Lastfall (siehe Release Note); der geprobte
Views-Fall ist vom späteren Härten unberührt.

## Läufe zu Release 1.72 (16. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-16/rpc-run1.log` | PostgreSQL 17 | 144 von 144, exit 0, 41 Migrationen |
| `2026-08-16/rpc-run2.log` | PostgreSQL 17 | 144 von 144, exit 0, Wiederholung |
| `2026-08-16/rpc-mutation.log` | PostgreSQL 17 | **143 von 144, exit 1 — absichtlich** |

Die Mutation entfernt die Abweisung von SECURITY-DEFINER-Funktionen. Genau der
RPC-Fall fällt: Die Definer-Variante würde bedient und liefe mit fremden
Rechten.

## Läufe zu Release 1.73 (16. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-16/production-gate-run1.log` | PostgreSQL 17 | 146 von 146, exit 0, 41 Migrationen |
| `2026-08-16/production-gate-run2.log` | PostgreSQL 17 | 146 von 146, exit 0, Wiederholung |
| `2026-08-16/production-gate-mutation.log` | PostgreSQL 17 | **145 von 146, exit 1 — absichtlich** |

Die Mutation entfernt die Log-Bedingung aus dem Production-Tor. Genau der
Abweisungsfall fällt: Ein Production-Prozess mit flüchtigem Log würde lauschen.

## Läufe zu Release 1.74 (16. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-16/deploy-run1.log` | PostgreSQL 17 | 147 von 147, exit 0, 42 Migrationen |
| `2026-08-16/deploy-run2.log` | PostgreSQL 17 | 147 von 147, exit 0, Wiederholung |
| `2026-08-16/deploy-mutation.log` | PostgreSQL 17 | **146 von 147, exit 1 — absichtlich** |

Die Mutation nimmt der Deployment-Tür das Schreiben der Historienzeile. Genau
der Fall fällt, der verlangt, dass jede Image-Änderung ihre Historie trägt.

## Läufe zu Release 1.75 (16. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-16/sql-editor-run1.log` | PostgreSQL 17 | 149 von 149, exit 0, 42 Migrationen |
| `2026-08-16/sql-editor-run2.log` | PostgreSQL 17 | 149 von 149, exit 0, Wiederholung |
| `2026-08-16/sql-editor-mutation.log` | PostgreSQL 17 | **148 von 149, exit 1 — absichtlich** |

Die Mutation entfernt den Parser-Wächter der Read-only-Abfrage. Genau der
Abwehrfall fällt: Der zugesagte Fehlercode fehlt — die Daten blieben auch unter
Mutation unverändert, weil `BEGIN READ ONLY` als zweite Linie stand.

## Läufe zu Release 1.76 (16. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-16/social-provider-run1.log` | Mailpit und Dex (2 Provider) | 6 von 6, exit 0 |
| `2026-08-16/social-provider-run2.log` | Mailpit und Dex (2 Provider) | 6 von 6, exit 0, Wiederholung |
| `2026-08-16/social-provider-mutation.log` | Mailpit und Dex (2 Provider) | **5 von 6, exit 1 — absichtlich** |

Die Mutation entfernt die Provider-Bindung des Autorisierungs-States. Genau der
Zwei-Provider-Fall fällt: Der fremde State liefe bis zum Code-Austausch und
scheiterte dort mit dem falschen Fehler.

Ein erster Lauf scheiterte an `ENOTFOUND partner.qkern.test`: Das Startskript
fährt Dienste namentlich hoch, und der neue Dex stand in der Compose-Datei,
aber nicht in der Liste. Der Lauf wurde verworfen und nach dem Fix wiederholt.

## Läufe zu Release 1.77 (16. August 2026)

| Datei | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-16/invoice-read-run1.log` | PostgreSQL 17 | 151 von 151, exit 0, 42 Migrationen |
| `2026-08-16/invoice-read-run2.log` | PostgreSQL 17 | 151 von 151, exit 0, Wiederholung |
| `2026-08-16/invoice-read-mutation.log` | PostgreSQL 17 | **149 von 151, exit 1 — absichtlich** |

Die Mutation entfernt den ON-CONFLICT-Arbiter aus dem Rechnungs-INSERT. Genau
die zwei idempotenzgebundenen Fälle fallen: der zweite Lauf und der Wettlauf —
dieselbe Zusage, getragen von derselben Zeile.

## Läufe zu Release 1.78 (16. August 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-16/storage-lifecycle-run1.log` | MinIO und ClamAV | 8 von 8, exit 0 |
| `2026-08-16/storage-lifecycle-run2.log` | MinIO und ClamAV | 8 von 8, exit 0, Wiederholung |
| `2026-08-16/storage-lifecycle-mutation.log` | MinIO und ClamAV | **7 von 8, exit 1 — absichtlich** |
| `2026-08-16/storage-lifecycle-postgres-run1.log` | PostgreSQL 17 | 152 von 152, exit 0 |
| `2026-08-16/storage-lifecycle-postgres-run2.log` | PostgreSQL 17 | 152 von 152, exit 0, Wiederholung |

Die Mutation entfernt die Schutzprüfung für lebende Reservierungen aus dem
Waisen-Aufräumer. Genau der Verschonungsfall fällt: Der lebende Upload wird
wie eine Waise abgebrochen.

## Läufe zu Release 1.79 (16. August 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-16/deploy-audit-run1.log` | PostgreSQL 17 | 153 von 153, exit 0 |
| `2026-08-16/deploy-audit-run2.log` | PostgreSQL 17 | 153 von 153, exit 0, Wiederholung |
| `2026-08-16/deploy-audit-mutation.log` | PostgreSQL 17 | **152 von 153, exit 1 — absichtlich** |

Die Mutation entfernt den Audit-Append aus der Deployment-Transaktion. Genau
der Audit-Fall fällt — Tür und Historie bestehen weiter, aber der zentrale
Audit-Weg sieht nichts mehr.

## Läufe zu Release 1.80 (16. August 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-16/openapi-views-rpc-run1.log` | PostgreSQL 17 | 154 von 154, exit 0 |
| `2026-08-16/openapi-views-rpc-run2.log` | PostgreSQL 17 | 154 von 154, exit 0, Wiederholung |
| `2026-08-16/openapi-views-rpc-mutation.log` | PostgreSQL 17 | **153 von 154, exit 1 — absichtlich** |

Die Mutation entfernt die security_invoker-Bedingung aus dem Views-Filter des
OpenAPI-Dokuments. Das Dokument bewirbt dann einen View, den die Fläche
abweist — genau der OpenAPI-Fall fällt.

## Läufe zu Release 1.81 (16. August 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-16/invoice-numbers-run1.log` | PostgreSQL 17 | 155 von 155, exit 0 |
| `2026-08-16/invoice-numbers-run2.log` | PostgreSQL 17 | 155 von 155, exit 0, Wiederholung |
| `2026-08-16/invoice-numbers-mutation.log` | PostgreSQL 17 | **154 von 155, exit 1 — absichtlich** |

Die Mutation entfernt den SAVEPOINT-Rollback des Wettlauf-Verlierers. Ein
verlorener zweiter Lauf lässt seinen Zählerstand stehen und reisst eine Lücke
in den Nummernkreis — genau der Nummernkreis-Fall fällt.

## Läufe zu Release 1.82 (16. August 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-16/console-invoices-run1.log` | Vitest lokal (Windows) | 1069 bestanden, exit 0 |
| `2026-08-16/console-invoices-run2.log` | Vitest lokal (Windows) | 1069 bestanden, exit 0, Wiederholung |
| `2026-08-16/console-invoices-mutation.log` | Vitest lokal (Windows) | **1 fehlgeschlagen, exit 1 — absichtlich** |

Dieser Slice ändert keinen Server-Code; die Dienste dahinter sind seit
1.77/1.81 gegen echtes PostgreSQL zertifiziert. Die Mutation verbiegt die URL
des Console-Ladewegs auf die Usage-Route — genau der Ladeweg-Vertrag fällt.

## Läufe zu Release 1.83 (16. August 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-16/provider-list-run1.log` | Mailpit und Dex | 7 von 7, exit 0 |
| `2026-08-16/provider-list-run2.log` | Mailpit und Dex | 7 von 7, exit 0, Wiederholung |
| `2026-08-16/provider-list-mutation.log` | Mailpit und Dex | **6 von 7, exit 1 — absichtlich** |

Die Mutation macht aus der Zwei-Felder-Projektion eine Durchreichung der
vollen Provider-Objekte — genau der Projektions-Fall fällt, am
Geheimnis-Muster und an der Form.

## Läufe zu Release 1.84 (16. August 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-08-16/login-chooser-run1.log` | Vitest lokal (Windows) | 1075 bestanden, exit 0 |
| `2026-08-16/login-chooser-run2.log` | Vitest lokal (Windows) | 1075 bestanden, exit 0, Wiederholung |
| `2026-08-16/login-chooser-mutation.log` | Vitest lokal (Windows) | **1 fehlgeschlagen, exit 1 — absichtlich** |

Dieser Slice ändert keinen Dienst-Code; die Projektion dahinter ist seit 1.83
gegen zwei echte Dex-Provider zertifiziert. Die Mutation nimmt die
Schlüsselprüfung aus der Chooser-Route — ein anonymer Aufrufer bekäme die
Liste, und genau der Abweisungs-Fall fällt.

## Läufe zu Release 1.85 (24. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-24/email-verified-run1.log` | Mailpit und Dex | 7 von 7, exit 0 |
| `2026-09-24/email-verified-run2.log` | Mailpit und Dex | 7 von 7, exit 0, Wiederholung |
| `2026-09-24/email-verified-local-run1.log` | Vitest lokal (Windows) | 1076 bestanden, exit 0 |
| `2026-09-24/email-verified-local-run2.log` | Vitest lokal (Windows) | 1076 bestanden, exit 0, Wiederholung |
| `2026-09-24/email-verified-mutation.log` | Vitest lokal (Windows) | **1 fehlgeschlagen, exit 1 — absichtlich** |

Der Auth-Stack belegt den echten Pfad (beide Dex-Provider senden
`email_verified: true`); die Trusted-Matrix ist nur lokal ausdrückbar. Die
Mutation lässt trusted auch ein explizites `false` schlucken — genau der
Matrix-Fall fällt.

## Läufe zu Release 1.86 (24. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-24/aggregates-run1.log` | PostgreSQL 17 | 156 von 156, exit 0 |
| `2026-09-24/aggregates-run2.log` | PostgreSQL 17 | 156 von 156, exit 0, Wiederholung |
| `2026-09-24/aggregates-mutation.log` | PostgreSQL 17 | **155 von 156, exit 1 — absichtlich** |
| `2026-09-24/aggregates-local-run1.log` | Vitest lokal (Windows) | 1078 bestanden, exit 0 |

Die Mutation nimmt die Sensibel-Prüfung aus der Spaltenwahl der Aggregate —
`min(api_token)` läse dann ein Geheimnis. Genau der Aggregat-Fall fällt.

## Läufe zu Release 1.87 (24. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-24/cron-grammar-run1.log` | PostgreSQL 17 | 157 von 157, exit 0 |
| `2026-09-24/cron-grammar-run2.log` | PostgreSQL 17 | 157 von 157, exit 0, Wiederholung |
| `2026-09-24/cron-grammar-mutation.log` | PostgreSQL 17 | **156 von 157, exit 1 — absichtlich** |
| `2026-09-24/cron-grammar-soak-red.log` | PostgreSQL 17 | **156 von 157, exit 1 — verworfen**: Realtime-Soak p95 6200 ms > 5000 ms kurz nach Docker-Neustart; nicht der Cron-Slice |
| `2026-09-24/cron-grammar-local-run1.log` | Vitest lokal (Windows) | 1079 bestanden, exit 0 |
| `2026-09-24/cron-grammar-local-mutation.log` | Vitest lokal (Windows) | **1 fehlgeschlagen, exit 1 — absichtlich** |

Die Mutation nimmt die Bereichsform `a-b` aus der Feldgrammatik. Der lokale
Grammatik-Fall und sein Zwilling im Stack (`0,30 6-8 * * 1-5`) fallen. Ein
erster Mutationslauf liess zusätzlich den Readiness-Fall fallen — der Fund,
der ihn repariert hat; die drei Läufe oben sind auf dem Endstand.

## Läufe zu Release 1.88 (24. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-24/queue-metrics-run1.log` | PostgreSQL 17 | 158 von 158, exit 0 |
| `2026-09-24/queue-metrics-run2.log` | PostgreSQL 17 | 158 von 158, exit 0, Wiederholung |
| `2026-09-24/queue-metrics-mutation.log` | PostgreSQL 17 | **157 von 158, exit 1 — absichtlich** |
| `2026-09-24/queue-metrics-local-run1.log` | Vitest lokal (Windows) | 1083 bestanden, exit 0 |

Die Mutation lässt leere Queues aus dem Export fallen — genau der Export-Fall
fällt. Lokal bleibt die Suite unter dieser Mutation grün: Die Zusage lebt im
Dienst, und nur der Real-DB-Fall prüft sie.

## Läufe zu Release 1.89 (24. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-24/invocation-log-run1.log` | PostgreSQL 17 | 159 von 159, exit 0 |
| `2026-09-24/invocation-log-run2.log` | PostgreSQL 17 | 159 von 159, exit 0, Wiederholung |
| `2026-09-24/invocation-log-mutation.log` | PostgreSQL 17 | **158 von 159, exit 1 — absichtlich** |
| `2026-09-24/invocation-log-connections-red.log` | PostgreSQL 17 | **158 von 159, exit 1 — verworfen**: `remaining connection slots are reserved` in einem fremden Fall; Ressourcengrenze des Stacks, nicht der Slice |
| `2026-09-24/invocation-log-functions-run1.log` | Docker 29.5, registry:2 und PostgreSQL 17 | 27 von 27, exit 0 |
| `2026-09-24/invocation-log-functions-run2.log` | Docker 29.5, registry:2 und PostgreSQL 17 | 27 von 27, exit 0, Wiederholung |
| `2026-09-24/invocation-log-local-run1.log` | Vitest lokal (Windows) | 1088 bestanden, exit 0 |
| `2026-09-24/invocation-log-local-mutation.log` | Vitest lokal (Windows) | **1 fehlgeschlagen, exit 1 — absichtlich** |

Die Mutation protokolliert nur noch Erfolge — der Real-DB-Fall mit dem
gescheiterten Eintrag fällt, ebenso sein lokaler Zwilling.

## Läufe zu Release 1.90 (24. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-24/connection-room-run1.log` | PostgreSQL 17 | 160 von 160, exit 0 |
| `2026-09-24/connection-room-run2.log` | PostgreSQL 17 | 160 von 160, exit 0, Wiederholung |
| `2026-09-24/connection-room-mutation.log` | PostgreSQL 17 | **159 von 160, exit 1 — absichtlich** |
| `2026-09-24/connection-room-local-run1.log` | Vitest lokal (Windows) | 1088 bestanden, exit 0 |

Die Mutation nimmt den `max_connections`-Parameter aus dem Compose — der
Cluster läuft wieder mit 100, und genau der Verbindungs-Fall fällt.

## Läufe zu Release 1.91 (24. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-24/landing-numbers-local-run1.log` | Vitest lokal (Windows) | 1093 bestanden, exit 0 |
| `2026-09-24/landing-numbers-local-run2.log` | Vitest lokal (Windows) | 1093 bestanden, exit 0, Wiederholung |
| `2026-09-24/landing-numbers-local-mutation.log` | Vitest lokal (Windows) | **2 fehlgeschlagen, exit 1 — absichtlich** |

Dieser Slice ändert keinen Dienst-Code. Die Mutation lässt die Seite den
schlechtesten statt den besten grünen Lauf nehmen (85 statt 160) — genau der
Zusammenfassungs-Fall und der Landingpage-Vertrag fallen.

## Läufe zu Release 1.92 (24. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-24/redesign-local-run1.log` | Vitest lokal (Windows) | 1093 bestanden, exit 0 |
| `2026-09-24/redesign-local-run2.log` | Vitest lokal (Windows) | 1093 bestanden, exit 0, Wiederholung |

Ein Redesign trägt keine eigene Zusage, die eine Mutationsprobe brechen
könnte; die Verträge aus 1.91 (keine literalen Zahlen, gleiche Zahlen wie
STATUS.md) halten über den Umbau hinweg.

## Läufe zu Release 1.93 (24. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-24/console-fixes-local-run1.log` | Vitest lokal (Windows) | 1093 bestanden, exit 0 |
| `2026-09-24/console-fixes-local-run2.log` | Vitest lokal (Windows) | 1093 bestanden, exit 0, Wiederholung |

## Läufe zu Release 1.94 (24. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-24/sidebar-return-local-run1.log` | Vitest lokal (Windows) | 1093 bestanden, exit 0 |
| `2026-09-24/sidebar-return-local-run2.log` | Vitest lokal (Windows) | 1093 bestanden, exit 0, Wiederholung |

## Läufe zu Release 1.95 (24. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-24/account-menu-local-run1.log` | Vitest lokal (Windows) | 1096 bestanden, exit 0 |
| `2026-09-24/account-menu-local-run2.log` | Vitest lokal (Windows) | 1096 bestanden, exit 0, Wiederholung |

## Läufe zu Release 1.96 (24. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-24/scroll-reveal-local-run1.log` | Vitest lokal (Windows) | 1096 bestanden, exit 0 |
| `2026-09-24/scroll-reveal-local-run2.log` | Vitest lokal (Windows) | 1096 bestanden, exit 0, Wiederholung |

## Läufe zu Release 1.97 (24. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-24/mobile-menu-local-run1.log` | Vitest lokal (Windows) | 1096 bestanden, exit 0 |
| `2026-09-24/mobile-menu-local-run2.log` | Vitest lokal (Windows) | 1096 bestanden, exit 0, Wiederholung |

## Läufe zu Release 1.98 (24. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-24/landing-copy-local-run1.log` | Vitest lokal (Windows) | 1096 bestanden, exit 0 |
| `2026-09-24/landing-copy-local-run2.log` | Vitest lokal (Windows) | 1096 bestanden, exit 0, Wiederholung |

## Läufe zu Release 1.99 (24. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-24/console-german-local-run1.log` | Vitest lokal (Windows) | 1096 bestanden, exit 0 |
| `2026-09-24/console-german-local-run2.log` | Vitest lokal (Windows) | 1096 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.0 (24. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-24/supabase-menu-local-run1.log` | Vitest lokal (Windows) | 1100 bestanden, exit 0 |
| `2026-09-24/supabase-menu-local-run2.log` | Vitest lokal (Windows) | 1100 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.1 (24. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-24/sidebar-groups-local-run1.log` | Vitest lokal (Windows) | 1100 bestanden, exit 0 |
| `2026-09-24/sidebar-groups-local-run2.log` | Vitest lokal (Windows) | 1100 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.2 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/four-languages-local-run1.log` | Vitest lokal (Windows) | 1105 bestanden, exit 0 |
| `2026-09-25/four-languages-local-run2.log` | Vitest lokal (Windows) | 1105 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.3 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/console-languages-local-run1.log` | Vitest lokal (Windows) | 1108 bestanden, exit 0 |
| `2026-09-25/console-languages-local-run2.log` | Vitest lokal (Windows) | 1108 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.4 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/stable-buttons-local-run1.log` | Vitest lokal (Windows) | 1108 bestanden, exit 0 |
| `2026-09-25/stable-buttons-local-run2.log` | Vitest lokal (Windows) | 1108 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.5 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/sidebar-flyout-local-run1.log` | Vitest lokal (Windows) | 1110 bestanden, exit 0 |
| `2026-09-25/sidebar-flyout-local-run2.log` | Vitest lokal (Windows) | 1110 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.6 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/queues-view-local-run1.log` | Vitest lokal (Windows) | 1110 bestanden, exit 0 |
| `2026-09-25/queues-view-local-run2.log` | Vitest lokal (Windows) | 1110 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.7 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/three-views-local-run1.log` | Vitest lokal (Windows) | 1110 bestanden, exit 0 |
| `2026-09-25/three-views-local-run2.log` | Vitest lokal (Windows) | 1110 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.8 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/auth-error-identity-local-run1.log` | Vitest lokal (Windows) | 1113 bestanden, exit 0 |
| `2026-09-25/auth-error-identity-local-run2.log` | Vitest lokal (Windows) | 1113 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.9 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/triggers-run1.log` | PostgreSQL 17 | 161 bestanden, exit 0 |
| `2026-09-25/triggers-run2.log` | PostgreSQL 17 | 161 bestanden, exit 0, Wiederholung |
| `2026-09-25/triggers-mutation.log` | PostgreSQL 17 | 160 von 161, Gegenprobe (Filter für interne Trigger entfernt) |
| `2026-09-25/triggers-local-run1.log` | Vitest lokal (Windows) | 1118 bestanden, exit 0 |
| `2026-09-25/triggers-local-run2.log` | Vitest lokal (Windows) | 1118 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.10 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/hero-field-local-run1.log` | Vitest lokal (Windows) | 1118 bestanden, exit 0 |
| `2026-09-25/hero-field-local-run2.log` | Vitest lokal (Windows) | 1118 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.11 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/hero-orbit-local-run1.log` | Vitest lokal (Windows) | 1118 bestanden, exit 0 |
| `2026-09-25/hero-orbit-local-run2.log` | Vitest lokal (Windows) | 1118 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.12 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/hero-copy-local-run1.log` | Vitest lokal (Windows) | 1118 bestanden, exit 0 |
| `2026-09-25/hero-copy-local-run2.log` | Vitest lokal (Windows) | 1118 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.13 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/font-local-run1.log` | Vitest lokal (Windows) | 1118 bestanden, exit 0 |
| `2026-09-25/font-local-run2.log` | Vitest lokal (Windows) | 1118 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.14 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/storage-versitygw-run1.log` | versitygw und ClamAV | 8 von 8, exit 0 |
| `2026-09-25/storage-versitygw-run2.log` | versitygw und ClamAV | 8 von 8, exit 0, Wiederholung |
| `2026-09-25/storage-swap-local-run1.log` | Vitest lokal (Windows) | 1118 bestanden, exit 0 |
| `2026-09-25/storage-swap-local-run2.log` | Vitest lokal (Windows) | 1118 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.15 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/github-dx-run-36163798505.json` | GitHub Actions, Ubuntu/Windows/macOS | alle drei Jobs gruen (Stand 2.14.0) |
| `2026-09-25/github-dx-run-36164575183.json` | GitHub Actions, Ubuntu/Windows/macOS | alle drei Jobs gruen (Stand 2.15.0) |
| `2026-09-25/github-certification-run-36164575195.json` | GitHub Actions, drei Docker-Stacks | 161/161, 8/8, 7/7, alle gruen (Stand 2.15.0) |
| `2026-09-25/postgres-pool-listener-run1.log` | PostgreSQL 17 | 161 von 161, exit 0 |
| `2026-09-25/postgres-pool-listener-run2.log` | PostgreSQL 17 | 161 von 161, exit 0, Wiederholung |
| `2026-09-25/pool-listener-mutation.log` | Vitest lokal (Windows), Mutation | **1 von 1 faellt, exit 1 – absichtlich** |
| `2026-09-25/pool-listener-local-run1.log` | Vitest lokal (Windows) | 1119 bestanden, exit 0 |
| `2026-09-25/pool-listener-local-run2.log` | Vitest lokal (Windows) | 1119 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.16 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/apache-local-run1.log` | Vitest lokal (Windows) | 1119 bestanden, exit 0 |
| `2026-09-25/apache-local-run2.log` | Vitest lokal (Windows) | 1119 bestanden, exit 0, Wiederholung |
| `2026-09-25/github-publish-dryrun-36165337979.json` | GitHub Actions, npm publish --dry-run | gruen, nichts hochgeladen |

## Läufe zu Release 2.17 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/github-publish-failed-36165718596.json` | GitHub Actions, npm publish | E422 Provenance aus privatem Repo, nichts hochgeladen |
| `2026-09-25/github-publish-36165870744.json` | GitHub Actions, npm publish | `@qkern/sdk@1.7.0-alpha.3` und `@qkern/cli@1.7.0-alpha.3` hochgeladen |
| `2026-09-25/cli-usage-mutation.log` | Vitest lokal (Windows), Mutation | **1 von 3 faellt, exit 1 – absichtlich** |
| `2026-09-25/cli-usage-local-run1.log` | Vitest lokal (Windows) | 1122 bestanden, exit 0 |
| `2026-09-25/cli-usage-local-run2.log` | Vitest lokal (Windows) | 1122 bestanden, exit 0, Wiederholung |
| `2026-09-25/github-publish-36166821746.json` | GitHub Actions, npm publish | `@qkern/cli@1.7.0-alpha.4` hochgeladen, SDK uebersprungen |

## Läufe zu Release 2.18 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/functions-run1.log` | PostgreSQL 17 | 162 von 162, exit 0 |
| `2026-09-25/functions-run2.log` | PostgreSQL 17 | 162 von 162, exit 0, Wiederholung |
| `2026-09-25/functions-mutation.log` | PostgreSQL 17, Mutation | **161 von 162, exit 1 – absichtlich** |
| `2026-09-25/functions-local-run1.log` | Vitest lokal (Windows) | 1127 bestanden, exit 0 |
| `2026-09-25/functions-local-run2.log` | Vitest lokal (Windows) | 1127 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.19 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/catalog-run1.log` | PostgreSQL 17 | 165 von 165, exit 0 |
| `2026-09-25/catalog-run2.log` | PostgreSQL 17 | 165 von 165, exit 0, Wiederholung |
| `2026-09-25/catalog-mutation-indexes.log` | PostgreSQL 17, Mutation | **164 von 165, exit 1 – absichtlich** |
| `2026-09-25/catalog-mutation-policies.log` | PostgreSQL 17, Mutation | **164 von 165, exit 1 – absichtlich** |
| `2026-09-25/catalog-mutation-enums.log` | PostgreSQL 17, Mutation | **164 von 165, exit 1 – absichtlich** |
| `2026-09-25/catalog-local-run1.log` | Vitest lokal (Windows) | 1136 bestanden, exit 0 |
| `2026-09-25/catalog-local-run2.log` | Vitest lokal (Windows) | 1136 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.20 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/catalog-wide-run1.log` | PostgreSQL 17 | 169 von 169, exit 0 |
| `2026-09-25/catalog-wide-run2.log` | PostgreSQL 17 | 169 von 169, exit 0, Wiederholung |
| `2026-09-25/catalog-wide-mutation-extensions.log` | PostgreSQL 17, Mutation | **168 von 169, exit 1 – absichtlich** |
| `2026-09-25/catalog-wide-mutation-roles.log` | PostgreSQL 17, Mutation | **168 von 169, exit 1 – absichtlich** |
| `2026-09-25/catalog-wide-mutation-publications.log` | PostgreSQL 17, Mutation | **168 von 169, exit 1 – absichtlich** |
| `2026-09-25/catalog-wide-mutation-privileges.log` | PostgreSQL 17, Mutation | **168 von 169, exit 1 – absichtlich** |
| `2026-09-25/catalog-wide-local-run1.log` | Vitest lokal (Windows) | 1147 bestanden, exit 0 |
| `2026-09-25/catalog-wide-local-run2.log` | Vitest lokal (Windows) | 1147 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.21 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/three-views-local-run1.log` | Vitest lokal (Windows) | 1147 bestanden, exit 0 |
| `2026-09-25/three-views-local-run2.log` | Vitest lokal (Windows) | 1147 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.22 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/jwt-keys-local-run1.log` | Vitest lokal (Windows) | 1147 bestanden, exit 0 |
| `2026-09-25/jwt-keys-local-run2.log` | Vitest lokal (Windows) | 1147 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.23 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/review-run1.log` | PostgreSQL 17 | 169 von 169, exit 0 |
| `2026-09-25/review-run2.log` | PostgreSQL 17 | 169 von 169, exit 0, Wiederholung |
| `2026-09-25/review-mutation.log` | PostgreSQL 17, Mutation | **168 von 169, exit 1 – absichtlich** |
| `2026-09-25/review-local-run1.log` | Vitest lokal (Windows) | 1147 bestanden, exit 0 |
| `2026-09-25/review-local-run2.log` | Vitest lokal (Windows) | 1147 bestanden, exit 0, Wiederholung |
| GitHub 36173571554 | Actions, drei Docker-Stacks | gruen (Stand 2.23.0) |
| GitHub 36173571530 | Actions, Ubuntu/Windows/macOS | Ubuntu einmal rot (provider-e2e-evidence), Wiederholung gruen |

## Läufe zu Release 2.24 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/identity-run1.log` | PostgreSQL 17 | 169 von 169, exit 0 |
| `2026-09-25/identity-run2.log` | PostgreSQL 17 | 169 von 169, exit 0, Wiederholung |
| `2026-09-25/identity-mutation.log` | Vitest lokal (Windows), Mutation | **1 von 2 faellt, exit 1 – absichtlich** |
| `2026-09-25/identity-local-run1.log` | Vitest lokal (Windows) | 1152 bestanden, exit 0 |
| `2026-09-25/identity-local-run2.log` | Vitest lokal (Windows) | 1152 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.25 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/sweep-run1.log` | PostgreSQL 17 | 169 von 169, exit 0 |
| `2026-09-25/sweep-run2.log` | PostgreSQL 17 | 169 von 169, exit 0, Wiederholung |
| `2026-09-25/sweep-mutation.log` | Vitest lokal (Windows), Mutation | **2 von 3 faellt, exit 1 – absichtlich** |
| `2026-09-25/sweep-local-run1.log` | Vitest lokal (Windows) | 1155 bestanden, exit 0 |
| `2026-09-25/sweep-local-run2.log` | Vitest lokal (Windows) | 1155 bestanden, exit 0, Wiederholung |

## Läufe zu Release 2.26 (25. September 2026)

| Log | Stack | Ergebnis |
| --- | --- | --- |
| `2026-09-25/names-run1.log` | PostgreSQL 17 | 170 von 170, exit 0 |
| `2026-09-25/names-run2.log` | PostgreSQL 17 | 170 von 170, exit 0, Wiederholung |
| `2026-09-25/names-mutation.log` | PostgreSQL 17, Mutation | **168 von 170, exit 1 – absichtlich** |
| `2026-09-25/names-local-run1.log` | Vitest lokal (Windows) | 1158 bestanden, exit 0 |
| `2026-09-25/names-local-run2.log` | Vitest lokal (Windows) | 1158 bestanden, exit 0, Wiederholung |
| `2026-09-25/github-publish-alpha5-36182682935.json` | GitHub Actions, npm publish | SDK und CLI 1.7.0-alpha.5 hochgeladen |
