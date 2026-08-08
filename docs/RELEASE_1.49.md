# Release 1.49.0 — Die Zertifizierung stand sich selbst im Weg

## Die offene Frage aus 1.48

> **Das Anwenden hat im Zertifizierungscluster keinen Lauf.** Lokal ja, dort
> nein, Grund unbekannt. Das ist die wichtigste offene Frage dieses Release.

Der Grund war die Zertifizierung selbst.

## Was passiert war

Die Grenzprüfung des Migrationszaunes verlangt einen Ledger-Eigentümer **ohne
jede** Mitgliedschaft — in beide Richtungen:

```sql
EXISTS (SELECT 1 FROM pg_auth_members m
        WHERE m.roleid = owner.oid OR m.member = owner.oid) AS owner_has_memberships
```

Drei Realtime-Testdateien führten `GRANT qkern_ledger_owner TO CURRENT_USER`
aus, damit ihr eigenes DDL im Namen des Eigentümers durchgeht. **Die Rolle ist
clusterweit.** Damit war in jedem Lauf, in dem eine dieser Dateien mitlief, jede
Migration unmöglich — nicht nur im Migrationstest.

Der Grant war zudem unnötig: Der Zertifizierungs-Admin ist Superuser und darf
ohnehin Objekte im Namen anderer Rollen anlegen.

Dazu kommt eine Eigenheit von PostgreSQL 16: **`CREATE ROLE` teilt die neue
Rolle dem Erzeuger automatisch mit ADMIN OPTION zu.** Wer die Rolle anlegt,
verletzt die Bedingung im selben Atemzug. Der Migrationstest räumt deshalb vor
**jedem** Lauf auf, nicht einmal im Setup — die Rolle ist geteilt, und andere
Dateien legen sie parallel an.

## Was jetzt belegt ist

Der Migrations-Prozess wendet in einer echten Projektdatenbank an: Auftrag
`applied`, Tabelle vorhanden, Eintrag im Ledger der Zieldatenbank. Damit sind
**drei von sieben** Prozessen mit Arbeitsnachweis versehen.

## Was die Diagnose gekostet hat

Der erste Messversuch baute die Grenzprüfung nach und prüfte
`owner_has_memberships` nur in **eine** Richtung. Zwei Läufe gingen dafür
verloren.

`FENCE_BOUNDARY_SQL` ist jetzt exportiert, und die Zertifizierung stellt
dieselbe Abfrage mit derselben Rolle statt einer Kopie. Wer eine Prüfung
nachbaut, prüft etwas anderes.

## Mutationsproben

| Mutation | Ergebnis |
| --- | --- |
| Ein einzelner Grant wiederhergestellt | **traf nicht** — das Aufräumen vor dem Lauf holte ihn ein |
| Der ganze Stand von 1.48: drei Grants, kein Aufräumen | 121 von 122 — genau der Anwendungsfall |

Dass die erste Probe nicht traf, steht hier, weil es etwas über die Zusage sagt:
Sie hängt an zwei Dingen, nicht an einem.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 122/122, exit 0 | `docs/evidence/2026-08-08/migration-apply-run1.manifest.json` |
| PostgreSQL 122/122, exit 0 | `docs/evidence/2026-08-08/migration-apply-run2.manifest.json` |
| Mutation Stand 1.48 121/122 | `docs/evidence/2026-08-08/migration-apply-mutation.manifest.json` |

Lokal: 1012 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Dass eine Testdatei den Zustand einer anderen kippen kann, ist behoben und
  nicht verhindert.** Es gibt keine Prüfung, die einen dauerhaften Grant auf eine
  clusterweite Rolle bemerkt. Das wäre die nächste Scheibe.
- **Wie viele frühere Läufe betroffen waren, ist nicht rekonstruiert.** Die
  Realtime-Fälle brauchen den Zaun nicht und blieben grün; aufgefallen ist es
  erst, als zum ersten Mal jemand migrieren wollte.
- **Vier Prozesse haben weiterhin keinen Arbeitsnachweis**: Realtime, beide
  Publisher und der Provisioner.
- **Die Zieldatenbank provisioniert der Test von Hand.** Rollen, Ledger, Zaun und
  das Schemarecht setzt er selbst — im Betrieb täte das der Provisioner, und der
  ist unbelegt.
