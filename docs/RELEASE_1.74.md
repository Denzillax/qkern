# Release 1.74.0 — Die eine Tür für neue Images

Sprosse 6 der Paritätsleiter: **Der Image-Deployment-Fluss existiert.** Eine
Function bekommt ein neues digest-gepinntes Image, ohne gelöscht und neu
angelegt zu werden — und ohne dass ihre Unveränderlichkeit fällt.

## Die Konstruktion

Seit Migration 0033 ist eine Function-Definition unveränderlich bis auf das
Aktivierungsflag; das Spaltenrecht und der Wachtrigger tragen das. Beides
bleibt. Neu ist genau **eine** Tür hindurch: `qkern_deploy_project_function`
wechselt das Image und schreibt **im selben Atemzug** die Historienzeile —
über ein transaktionslokales Flag, das nur diese Funktion setzt. Eine
Image-Änderung ohne ihre Historie ist auf Datenbankebene nicht ausdrückbar,
auch nicht für den Eigentümer: `project_function_deployments` ist append-only
mit FORCE RLS ohne UPDATE- und DELETE-Policy.

Rollback ist ein Deployment auf den alten Digest — keine Sonderoperation,
dieselbe Tür, die nächste Revision.

## Was gebaut ist

- **Migration 0042**: Historientabelle, Trigger-Ausnahme, DEFINER-Tür;
  die Laufzeitrolle darf lesen und die Tür rufen, das Feld selbst weiterhin
  nicht schreiben.
- **Dienst**: `deployFunction` (validiert den Digest, liefert die Revision)
  und `listFunctionDeployments` (neueste zuerst, begrenzt).
- **REST**: `POST`/`GET …/compute/functions/{id}/deployments` unter der
  bestehenden Compute-Grenze.

## Zertifiziert

Gegen echtes PostgreSQL, mit der echten Laufzeitrolle:

- Der direkte `UPDATE` auf das Image scheitert weiter an `permission denied`
  — die Grenze aus 0033 lebt.
- Durch die Tür: Deployment auf Image B ist Revision 1, der Rollback auf A
  Revision 2, die Definition zeigt A, und die Historie nennt beide Schritte
  mit Akteur — wer heute liest, sieht, was gestern lief.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Die Tür schreibt die Historienzeile nicht mehr | **146 von 147** — genau der Deployment-Fall |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 147/147, exit 0 | `docs/evidence/2026-08-16/deploy-run1.manifest.json` |
| PostgreSQL 147/147, exit 0 | `docs/evidence/2026-08-16/deploy-run2.manifest.json` |
| Mutation 146/147 | `docs/evidence/2026-08-16/deploy-mutation.manifest.json` |

42 Migrationen. Lokal: 1064 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Kein Aufruf-Fall wechselt das Image unter Last.** Ein laufender Container
  mit dem alten Image läuft zu Ende; dass ein *neuer* Aufruf das neue Image
  zieht, folgt aus dem Auflösen der Definition, ist aber nicht als eigener
  Fall belegt.
- **Die Deployment-Route spricht in keinem Fall HTTP** — der
  Zertifizierungsfall ruft den Dienst.
- **Kein Audit-Log-Eintrag je Deployment.** Die Historientabelle trägt Akteur
  und Zeitpunkt; der zentrale Audit-Weg kennt Deployments noch nicht.
- **Beinahe zum dritten Mal**: Ein reflexhaftes `git checkout` zielte auf die
  *uncommittierte* Migrationsdatei — es schlug fehl, und das vorbereitete
  Python-Fallback stellte den Stand wieder her. Der Reflex ist das Problem;
  Wiederherstellung nach Mutationen läuft ausschliesslich über Kopien.
