# Release 1.48.0 — Zwei Defekte auf dem Pfad zur Kundendatenbank

## Warum dieser Prozess

Von den fünf Prozessen ohne Arbeitsnachweis ist der Migrations-Worker der
folgenreichste: **Er ist der einzige, der Kundendatenbanken schreibt.**

Zertifiziert war er seit Stufe 0.1 — immer als Bibliothek. Ein Lauf, der
`npm run worker:migrations` startet und danach in der Zieldatenbank nachsieht,
gab es nie.

## Zwei Defekte

**`quarantineExpiredReconciliations` war mehrdeutig.** Das CTE selektiert `id`,
das `RETURNING` nennt die Spalten unqualifiziert, und PostgreSQL weist
`column reference "id" is ambiguous` ab. Die Abfrage läuft bei **jedem** Claim.

Folge: Der Worker konnte keinen einzigen Auftrag übernehmen. Der Auftrag blieb
`queued`, die Schleife meldete `iteration_failed`, und niemand sah es. Die
Nachbarabfrage `claimNext` aliasiert ihr CTE seit jeher als `candidate_id`; hier
fehlte der Alias.

**Die Zaun-Grenzprüfung brach an einem leeren Array.**
`aclexplode(coalesce(a.attacl, '{}'::aclitem[]))` — `'{}'::aclitem[]` ist
nulldimensional, `aclexplode` verlangt genau eine Dimension, PostgreSQL weist
die ganze Abfrage mit *ACL arrays must be one-dimensional* ab. Die Funktion ist
strikt: Ein NULL liefert im LATERAL ohnehin keine Zeile, und genau das ist
gemeint — eine Spalte ohne eigene ACL hat keine unerwartete ACL. Die
Nachbarprüfungen benutzen `acldefault(...)` und waren nie betroffen.

Beide Fehler liegen auf demselben Pfad, und beide machten jede Migration über
den ausgelieferten Prozess unmöglich. Gefunden hat sie kein Test, sondern der
Versuch, den Prozess einmal wirklich laufen zu lassen.

## Was belegt ist — und was nicht

Nach beiden Fixes wendet der Prozess **lokal** gegen eine echte Projektdatenbank
an: Auftrag `applied`, Tabelle vorhanden, Ledger geschrieben.

**Im Zertifizierungscluster weist derselbe Zaun mit `INVALID_MIGRATION_FENCE`
ab.** Gemessen wurden Eigentümer, Mitgliedschaften, Schema- und Tabellen-ACL,
Spaltenrechte, RLS und Relationsart — alle wie erwartet. Der Grund ist nicht
isoliert.

Deshalb sagt der zertifizierte Fall nur, was er tragen kann: Der Auftrag
verlässt `queued`, und die Schleife meldet keinen Rundenfehlschlag mehr. **Ein
gescheiterter Auftrag ist etwas anderes als eine gescheiterte Runde** — dieser
Unterschied ist der Kern des ersten Fixes.

Ein Produkt, das in einem echten Cluster migriert und in einem anderen nicht,
ist selbst ein Befund. Er steht hier, statt zu fehlen.

## Nebenbefund

Der Änderungsschutz auf `change_sets` ist stärker als mein erster Testaufbau
annahm: Ein Trigger weist jedes nachträgliche UPDATE ab
(*change set artifact is immutable after preview creation*). Der
Manipulationsfall geht deshalb über eine **Freigabe, die zu einer anderen
Handlung gehört** — und genau das erkennt der Worker, weil er den Hash aus dem
nachrechnet, was in der Datenbank steht.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Der CTE-Alias wird wieder entfernt | 121 von 122 — genau der Prozess-Fall |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 122/122, exit 0 | `docs/evidence/2026-08-08/migration-process-run1.manifest.json` |
| PostgreSQL 122/122, exit 0 | `docs/evidence/2026-08-08/migration-process-run2.manifest.json` |
| Mutation CTE-Alias 121/122 | `docs/evidence/2026-08-08/migration-process-mutation.manifest.json` |

Lokal: 1012 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Das Anwenden hat im Zertifizierungscluster keinen Lauf.** Lokal ja, dort
  nein, Grund unbekannt. Das ist die wichtigste offene Frage dieses Release.
- **Wie lange die beiden Defekte bestanden, ist nicht rekonstruiert.** Beide
  liegen in Abfragen, die es seit früheren Stufen gibt.
- **Vier Prozesse haben weiterhin keinen Arbeitsnachweis**: Realtime, beide
  Publisher und der Provisioner.
- **Die Zieldatenbank wird im Testaufbau von Hand provisioniert.** Rollen,
  Ledger, Zaun und das Schemarecht setzt der Fall selbst — im Betrieb täte das
  der Provisioner, und der ist unbelegt.
- **Der Fall prüft eine Entscheidung, nicht ihren Inhalt.** Dass der Auftrag
  `queued` verlässt, sagt nichts darüber, ob `applied` oder `failed` richtig war.
