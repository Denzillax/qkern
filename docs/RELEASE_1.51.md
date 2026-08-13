# Release 1.51.0 — Der Zaun sagt jetzt, woran es liegt

## Der Anlass

Release 1.48 und 1.49 haben zusammen fünf Zertifizierungsläufe gekostet, und der
Grund war jedes Mal derselbe: `INVALID_MIGRATION_FENCE` sagt, **dass** eine von
fünfundzwanzig Bedingungen verletzt ist — nicht **welche**.

Ich konnte die Prüfung von Hand nachbauen. Ein Betreiber hat keinen Zugang zur
Zieldatenbank und könnte das nicht.

## Was jetzt im Log steht

```
{"event":"migration.failed","errorCode":"INVALID_MIGRATION_FENCE",
 "failedChecks":["owner_has_memberships"], …}
```

Die Erwartungen stehen als Liste im Produkt statt als lange `if`-Bedingung, und
die verletzten Namen gehen ins **Prozesslog**.

Ein Name wie `owner_has_memberships` ist eine Struktureigenschaft und im
Provisionierungs-Runbook nachlesbar. Kein Rollenname, kein Schema, kein Wert,
keine Datenbankmeldung: **Was die Zieldatenbank ist, sagt die Liste nicht — nur,
was ihr fehlt.** Die Meldung an den Mandanten bleibt unverändert redigiert.

## Der eigentliche Grund, warum niemand je etwas sah

Der Prozess setzte nur den **Runtime**-Logger. Der **Worker**-Logger — der jedes
einzelne Auftragsereignis führt, von `migration.claimed` bis `migration.failed` —
war nie gesetzt. Alles Auftragsbezogene ging verloren, seit es den Prozess gibt.

Aufgefallen ist das erst, als der neue Fall die Namen im Log suchte und nichts
fand.

## Zwei Umwege

**Die falsche Grenze.** Der erste Versuch verletzte die Bedingung über die
Migrationsrolle — das fängt schon der Katalog ab, früher und mit eigenem Code
(`INVALID_PROJECT_DATABASE_ROLE`). Verletzt wird sie deshalb über eine **dritte**
Rolle, genau wie in 1.49, wo der Erzeuger der Rolle die Mitgliedschaft hielt.

**Ein Wettlauf im Testaufbau.** Die Warteschleife brach bei `running` ab statt
bei einem Endzustand. Wer auf „nicht mehr `queued`" wartet, misst den Zeitpunkt
statt das Ergebnis.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Der Zaun meldet wieder eine leere Liste | 122 von 123 — genau der neue Fall |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 123/123, exit 0 | `docs/evidence/2026-08-08/boundary-names-run1.manifest.json` |
| PostgreSQL 123/123, exit 0 | `docs/evidence/2026-08-08/boundary-names-run2.manifest.json` |
| Mutation leere Liste 122/123 | `docs/evidence/2026-08-08/boundary-names-mutation.manifest.json` |

Lokal: 1015 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Nur Zaun und Ledger nennen ihre Bedingungen.** Die übrigen Fehlercodes des
  Executors sagen weiterhin nur, dass etwas nicht stimmt.
- **Die Namen stehen im Prozesslog, nicht in der Projektion für den Mandanten.**
  Wer kein Log sieht, sieht sie nicht — und ob ein Mandant sie sehen sollte, ist
  eine offene Produktfrage.
- **Dass der Worker-Logger fehlte, hat niemand geprüft.** Es gibt keinen
  Vertrag, der verlangt, dass ein Prozess die Logger setzt, die seine
  Komposition anbietet. Das wäre die nächste Scheibe.
- **Vier Prozesse haben weiterhin keinen Arbeitsnachweis**: Realtime, beide
  Publisher und der Provisioner.
