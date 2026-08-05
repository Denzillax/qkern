# Release 1.16.0 — Postgres Changes in Betrieb

> Datum: 5. August 2026 · Vorgänger: `1.15.0`

## Wofür dieses Release steht

Release 1.15 schloss Stufe 1.5, hielt aber eine Lücke fest: Ein
`changes:`-Abonnement blieb in der Realtime-Runtime **leer**. Registry, Quelle
und Reader waren zertifiziert, aber die Runtime besaß keinen Port, der je Scope
eine Projektdatenbank auflöst.

Dieses Release liefert diesen Port und verdrahtet die Kette im Betrieb.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | 46 von 46 bestanden, exit 0 |
| Soak mit laufendem Poller | 120 Änderungen, p95 229 ms, max 240 ms |
| Vitest lokal | 779 bestanden, 70 übersprungen, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

## Der fehlende Port

`ControlPlaneRealtimeProjectConnection` geht denselben Weg wie die Generated
Data API: erst die Control Plane nach dem Katalogverweis fragen, dann den
Katalog nach der Verbindung.

Entscheidend ist, **wann** geprüft wird: Die Rollen- und Datenbankgrenze wird
bei jedem Zugriff neu verifiziert, nicht einmal beim Start. Ein Katalog, der auf
eine andere Datenbank oder eine privilegiertere Rolle zeigt, würde sonst
unbemerkt Feed-Zeilen fremder Projekte liefern — und der Reader löst daraufhin
Lesevorgänge mit den Claims echter Abonnenten aus. Geprüft werden Rolle,
Session-Rolle, Datenbankname, Login-Fähigkeit sowie die Abwesenheit von
Superuser-, RLS-Bypass- und Replikationsrechten.

Sieben Tests halten das fest, darunter der Nachweis, dass ein unbekanntes
Projekt nicht auf eine Standardverbindung zurückfällt und dass die Verbindung
auch bei einem Fehler in der Arbeit freigegeben wird.

## Ein Fehler in meinem eigenen Reader

`GeneratedApiRealtimeChangeReader` nahm die Organisation als
**Konstruktorwert**, obwohl jede Änderung ihre eigene trägt. In der Runtime
bedient eine Reader-Instanz alle beobachteten Projekte; ein fester Wert hätte
für fremde Mandanten den falschen Tenantkontext gesetzt.

Der Kontext kommt jetzt aus der Änderung. Der Fehler wäre fail-closed
aufgefallen — die Zielauflösung hätte für fremde Organisationen scheitern
müssen — aber er hätte legitime mandantenübergreifende Zustellung verhindert
und war in den Einzeltests nicht sichtbar, weil dort nur eine Organisation
vorkommt.

## Verdrahtung

`changes:` ist opt-in über `QKERN_REALTIME_CHANGES_ENABLED`. Ohne Opt-in
entsteht weder Reader noch Quelle — ein Abonnement bleibt leer, statt
ungeprüfte Daten auszuliefern.

Der Reader wird **vor** dem Dienst erzeugt und im Konstruktor übergeben, statt
nachträglich gesetzt zu werden: Der Dienst bleibt nach der Konstruktion
unveränderlich.

Ein Intervall gleicht die laufenden Poller regelmäßig an die tatsächlichen
Abonnements an. Poller-Fehler werden bewusst **nicht** protokolliert: Eine
Datenbankmeldung kann Tabellennamen oder Werte enthalten und gehört nicht ins
Log dieses Prozesses.

Beim Shutdown werden Intervall, Registry, WebSocket-Host und Bus in dieser
Reihenfolge beendet.

## Drei latente Wettläufe im Testaufbau

Der erste Zertifizierungslauf dieses Release scheiterte nicht am neuen Code,
sondern an gemeinsam genutzter Testinfrastruktur. Drei Integrationstests legen
Rolle, Schema und Feed an, jeweils „falls nicht vorhanden" — und Vitest führt
Testdateien parallel aus. Jedes dieser `IF NOT EXISTS` ist ein
Check-dann-Erzeuge ohne Atomarität.

Aufgetreten sind nacheinander Kollisionen auf `pg_type_typname_nsp_index`,
`pg_authid_rolname_index` und `pg_namespace`. Alle drei waren seit Release 1.13
latent vorhanden: In den Läufen zu 1.13, 1.14 und 1.15 gewann zufällig immer
eine Datei das Rennen, und die Läufe waren grün, ohne dass der Aufbau
deterministisch war.

Das ist dieselbe Fehlerklasse wie in Release 1.9, eine Ebene höher: nicht „nie
ausgeführt", sondern **ausgeführt und zufällig grün**. Ein grüner Lauf beweist
nicht, dass der Aufbau deterministisch ist.

Die Rollenanlage nutzt jetzt `EXCEPTION WHEN duplicate_object` statt einer
Prüfung davor, Schema- und Feed-Anlage tolerieren die Kollision — und danach
wird ausdrücklich verifiziert, dass der Feed existiert. Der letzte Punkt ist der
entscheidende: Einen Fehler zu schlucken und ohne Feed weiterzulaufen wäre
schlimmer als der Wettlauf selbst.

## Ehrlich offen

- Kein Scheduler für die beiden `prune`-Pfade
- Der Katalog wird mit denselben Umgebungsvariablen aufgebaut wie der der
  Generated Data API, öffnet aber einen zweiten Pool auf dieselben
  Projektdatenbanken. Eine gemeinsame Auflösung wäre sparsamer
- Die Verdrahtung selbst ist über Vertragstests belegt, aber nicht in einem
  laufenden Realtime-Prozess gegen echtes PostgreSQL durchgefahren; die Kette
  ist es (siehe Release 1.14), die Runtime-Komposition nicht
- Realtime verweigert weiterhin technisch den Start bei `NODE_ENV=production`
- Löschungen erreichen nur `service_role` (siehe Release 1.12)
