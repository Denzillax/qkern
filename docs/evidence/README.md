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
