# Release 1.13.0 — Postgres Changes

> Datum: 4. August 2026 · Vorgänger: `1.12.0`

## Wofür dieses Release steht

Release 1.12 hat die Erfassungsschicht gebaut, aber weder den Trigger gegen eine
echte Datenbank ausgeführt noch die Zustellung verdrahtet. Dieses Release holt
beides nach.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | **39 von 39 bestanden**, exit 0, 9 Testdateien |
| davon Change-Feed gegen echtes PostgreSQL | 6 Fälle |
| Vitest lokal | 743 bestanden, 63 übersprungen, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

Der Change-Feed-Lauf war beim ersten Versuch grün.

## Zertifizierung des Triggers

Ausgeführt wird die **echte Migrationsdatei** `db/project/0003_qkern_change_feed.sql`,
nicht eine nachgebaute Fassung. Ein Test gegen eine Kopie würde die Datei
zertifizieren, die niemand ausliefert — genau der Fehler, den der Harness-Test in
Release 1.9 gemacht hatte.

Geprüft gegen echtes PostgreSQL:

- Der Trigger feuert bei `INSERT`, `UPDATE` und `DELETE`.
- `row_key` enthält ausschließlich Primärschlüsselspalten — bei zusammengesetztem
  Schlüssel alle, und niemals einen Zeilenwert.
- Positionen sind streng aufsteigend und eindeutig.
- Eine Tabelle ohne Primärschlüssel **weist den Schreibvorgang ab**, statt still
  nichts zu erfassen. Stilles Überspringen wäre die gefährlichere Variante: Der
  Kanal gälte als funktionsfähig und meldete nie etwas.
- **`qkern_project_api_app` kann nicht in den Feed schreiben.** Das ist die
  Zusicherung, die den ganzen Entwurf trägt: Könnte die Laufzeitrolle schreiben,
  ließe sich ein erfundenes Änderungsereignis einschleusen — und da der Reader
  die geänderte Zeile mit den Claims des Abonnenten nachliest, wäre das ein
  Werkzeug, um Lesevorgänge unter fremder Identität auszulösen.
- Lesen und Aufräumen bleiben ihr erlaubt.

## Zustellung

Neu ist die Kanalart `changes:<schema>.<table>`.

**Kein gemeinsamer Fan-out.** Jede Änderung wird je Abonnent einzeln gelesen —
mit dessen Claims, durch die Generated Data API. Zwei Abonnenten desselben
Kanals erhalten unterschiedliche Teilmengen derselben Änderung. Ein gemeinsamer
Fan-out wäre ein Cross-Tenant-Leck; ein Test hält genau diesen Fall fest.

**Nur Abonnieren.** Auf einem `changes:`-Kanal kann niemand senden oder Presence
führen. Sonst ließe sich eine Änderung vortäuschen, die nie stattgefunden hat.
Anonyme Abonnenten sind ausgeschlossen: Row Level Security würde ihnen zwar
ohnehin nichts ausliefern, aber schon der Takt der Ereignisse verrät
Schreibaktivität.

**Rückstau schließt, statt still zu überspringen.** Nimmt eine Senke eine
Nachricht nicht an, erhält der Abonnent `REALTIME_BACKPRESSURE` und wird zum
Schließen gemeldet. Ereignisse zu überspringen würde demselben Vertrag
widersprechen, den die Cursor-Prüfung zusichert.

**Ohne konfigurierten Reader wird nichts zugestellt.** Ein Abonnement bleibt dann
leer, statt ungeprüfte Daten auszuliefern.

## Stufenwirkung

**Stufe 1.5 bleibt offen** — knapp, aber begründet.

Erfüllt sind jetzt PostgreSQL-CDC, WebSocket-Channels, RLS pro Ereignis,
Broadcast, Presence, Backpressure und Reconnect/Catch-up, dazu die vom
Austrittskriterium verlangten Tenant- und Ordering-Tests gegen echte
Infrastruktur.

Nicht erfüllt sind die ebenfalls verlangten **Drop- und Lasttests gegen echte
Infrastruktur**. Der Rückstaupfad ist als Vertrag getestet, aber nie unter Last
gegen echte Verbindungen gelaufen. Eine Stufe zu schließen, deren
Austrittskriterium zwei Testarten ausdrücklich nennt, von denen keine ausgeführt
wurde, wäre genau die Art Rundung, die dieser Sprint abgeschafft hat.

## Ehrlich offen

- Drop- und Lasttests gegen echte Infrastruktur; erst danach ist 1.5 zu schließen
- Die Kette Feed → Dispatcher → Abonnent ist in ihren Teilen zertifiziert, aber
  nicht als Ganzes gegen echtes PostgreSQL durchgefahren
- Kein Poller: `PostgresRealtimeChangeSource.read` und `deliverChanges` sind
  verdrahtet, aber kein Prozess ruft sie in einer Schleife auf
- Aufbewahrung: `prune` existiert auf beiden Seiten, wird von keinem Scheduler
  aufgerufen
- Löschungen erreichen weiterhin nur `service_role` (siehe Release 1.12)
- Production-TLS/Proxy, Telemetrie, Browser-SDK
