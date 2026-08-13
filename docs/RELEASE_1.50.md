# Release 1.50.0 — Ein Grant, der alle trifft

## Was 1.49 offen liess

> **Dass eine Testdatei den Zustand einer anderen kippen kann, ist behoben und
> nicht verhindert.** Es gibt keine Prüfung, die einen dauerhaften Grant auf eine
> clusterweite Rolle bemerkt. Das wäre die nächste Scheibe.

Dies ist die Scheibe.

## Der Vertrag

`tests/shared-cluster-role-contract.test.ts` meldet jede Testdatei, die
`GRANT qkern_ledger_owner TO …` oder `GRANT qkern_project_migrator TO …`
ausführt, ohne die Zuteilung wieder zurückzunehmen.

Er prüft den **Quelltext**, nicht den Cluster. Das ist die schwächere Aussage
und die, die früh genug kommt: beim Schreiben statt nach dem Lauf. Ein Grant,
den dieselbe Datei wieder zurücknimmt, ist erlaubt — er steht dann samt `REVOKE`
an derselben Stelle.

Beim ersten Lauf meldete er vier Dateien: sich selbst und die drei
Realtime-Dateien, die den Fund inzwischen nur noch **beschreiben**. Kommentare
zählen deshalb nicht mit. Das ist keine Aufweichung — was in einem Kommentar
steht, führt PostgreSQL nicht aus.

## Die Bedingung betrifft nicht nur Tests

`docs/PROJECT_DATABASE_PROVISIONING_RUNBOOK.md` nennt jetzt beides:

- `qkern_ledger_owner` darf **keine einzige** Mitgliedschaft haben, in beide
  Richtungen — sonst lehnt der Zaun jede Migration ab.
- PostgreSQL 16 arbeitet dagegen: `CREATE ROLE` teilt die neue Rolle dem
  Erzeuger automatisch mit ADMIN OPTION zu. Wer sie anlegt, muss sie sich selbst
  wieder entziehen.

Und der Punkt, der die Tragweite ausmacht: Die Rolle ist **clusterweit**. Ein
Grant, den irgendjemand irgendwo setzt, macht Migrationen für **alle**
Projektdatenbanken dieses Clusters unmöglich — nicht nur für die eine, um die es
gerade ging.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Der Grant wird in einer Realtime-Datei wiederhergestellt | Der Vertrag nennt die Datei namentlich |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 122/122, exit 0 | `docs/evidence/2026-08-08/cluster-role-run1.manifest.json` |
| PostgreSQL 122/122, exit 0 | `docs/evidence/2026-08-08/cluster-role-run2.manifest.json` |

Lokal: 1015 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Der Vertrag liest nur `tests/`.** `scripts/`, `db/` und die
  Kubernetes-Vorlagen sind ungeprüft.
- **Er erkennt eine Zuteilung nur als SQL-Text.** Wer sie aus Teilen
  zusammensetzt, fällt nicht auf.
- **Er prüft den Quelltext, nicht den Cluster.** Ein Grant, den die Umgebung
  mitbringt — etwa aus einem Basis-Image oder einem Init-Skript —, bleibt
  unbemerkt, bis wieder jemand migrieren will.
- **Vier Prozesse haben weiterhin keinen Arbeitsnachweis**: Realtime, beide
  Publisher und der Provisioner.
