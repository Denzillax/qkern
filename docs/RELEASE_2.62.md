# Release 2.62.0 – Die letzten Platzhalter

Fünf Platzhalterseiten weniger. Von den sechsundzwanzig, mit denen dieser Tag
begann, sind zwei übrig.

## Was neu ist

- Ansicht Logs, Realtime: Kanäle und Nachrichten aus dem Event-Log, und der Rückstand des Änderungs-Feeds.
- Ansicht Database, In neues Projekt wiederherstellen: was es gibt, und welcher Schritt genau fehlt.
- Ansichten Compute und Disk, Integrationen, Add-ons: drei Fragen, drei Antworten aus dem, was QKERN wirklich führt.
- PostgreSQL-Zertifizierung von 217 auf 219 Fälle, lokale Suite von 2247 auf 2274.

## Was die Prüfung ergeben hat, und es war jedes Mal etwas anderes

- **QKERN führt keinen Katalog seiner Backups.** Keine der 62 Migrationen legt eine Tabelle für Backups, Sicherungspunkte oder Wiederherstellungsläufe an. Die einzige echte Quelle ist die signierte Drill-Evidenz, und ihr Geltungsbereich ist die Control Plane: Der zertifizierte Lauf stellt die Kontrollebene wieder her, nicht die Projektdatenbank.
- **Vom Weg ins neue Projekt fehlen drei von vier Gliedern.** Den Broker-Client gibt es, den Dienst dahinter nicht, auch nicht als Attrappe. Die Provisioniererrolle hat `NOCREATEDB`, und im Produktquelltext steht kein `CREATE DATABASE`. Genau eine Stelle fügt eine Umgebung ein, und ein Trigger lässt eine Bindung genau einmal ersetzen.
- **Im Realtime-Log liegt nur, was ein Client als Broadcast geschickt hat.** Zugestellte Datenbankänderungen werden je Abonnent mit dessen Ansprüchen gelesen und nie gemeinsam gespeichert, Presence gar nicht. Die Zahlen messen die Broadcasts auf einem Kanal, nicht den Verkehr darauf.
- **Verbindungen hält QKERN nirgends fest.** Sie liegen in einer Map im Prozessspeicher, die den Prozess nie verlässt. Das ist ein Absatz auf der Seite und keine Kachel.
- **Der Platzhalter zu Compute und Disk war in beide Richtungen falsch.** Die Provisionierung ist nicht "noch nicht verbunden", sondern gebaut und zertifiziert. Die versprochene Grösse gibt es dagegen nirgends: Der Auftrag hat zwanzig Spalten, die Bindung fünfzehn, keine davon eine Ausstattung.
- **Add-ons fehlt keine Oberfläche, sondern die Form.** Eine Rechnungszeile hat kein Feld für eine Bezeichnung, und die Eindeutigkeit je Metrik begrenzt sie auf sechs. Eine Pauschale hätte keine Menge und damit keinen Weg zu einem Betrag.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 219/219, exit 0 | `docs/evidence/2026-09-27/welle14-run1.manifest.json` |
| PostgreSQL 17, 219/219, exit 0 | `docs/evidence/2026-09-27/welle14-run2.manifest.json` |
| Mutation Rückstand gerechnet statt gezählt, exit 1 | `docs/evidence/2026-09-27/welle14-mutation-realtimelog.manifest.json` |
| Mutation Laufzeitrolle liest die Bindungen, exit 1 | `docs/evidence/2026-09-27/welle14-mutation-settings.manifest.json` |
| Mutation eine Migration legt einen Backup-Katalog an, exit 1 | `docs/evidence/2026-09-27/welle14-mutation-restore.manifest.json` |
| Vitest lokal 2274/2274, exit 0 | `docs/evidence/2026-09-27/welle14-local-run1.manifest.json` |
| Vitest lokal 2274/2274, exit 0 | `docs/evidence/2026-09-27/welle14-local-run2.manifest.json` |

## Nachtrag zum Verfahren

**Ein Beispiel muss mitwandern, sonst prüft es irgendwann das Gegenteil von
dem, was es sagt.** Zwei Verträge benutzten `logs-realtime` als Beispiel für
eine Seite, die es als Startseite nicht geben darf. Seit diesem Release ist sie
eine echte Seite, und beide Beispiele zeigen jetzt auf einen Platzhalter, den
es noch gibt. Dasselbe ist in `2.61.0` mit `logs-pooler` passiert.

**Ein Fall liegt bewusst in einer anderen Datei.** Der Fall zur Provisionierung
steht in `provisioning-port-postgres.integration.test.ts` und nicht in
`postgres.integration.test.ts`. Derselbe Stack, dieselbe Beweiskraft, aber die
Datei wird von der Fortschrittstabelle nicht gezählt. Das war schon vorher so
und ist mit diesem Release sichtbar geworden.

**Eine Berichtigung im Handbuch.** Dort stand, ein Projekt habe drei
Umgebungen. Es **kennt** drei; angelegt wird bei der Registrierung nur
Development.

## Ehrlich offen

- **Zwei Platzhalter bleiben**: Analytics-Buckets (Iceberg) und Vektor-Buckets. Beide brauchen eine Ablageform, die QKERN nicht hat, und keine davon ist im Zertifizierungsstack prüfbar.
- **Die Seite Database, Backups zeigt weiterhin einen abgeschalteten Knopf.** Derselbe Massstab würde dort dasselbe verlangen wie auf den fünf Seiten dieses Releases.
- **Die Auskunft über den Objektspeicher ist die schwächste der Integrationsseite.** Gezählt werden Buckets; ob wirklich ein S3-Ziel hinterlegt ist, erreicht keine Route.
- **Die Bindung einer Umgebung bleibt für die Console unlesbar**, weil die Laufzeitrolle kein Leserecht hat. Der neue Fall belegt genau das.
- **Im Browser nicht gesehen.** Die fünf neuen Ansichten sind angemeldet nie betrachtet worden.
