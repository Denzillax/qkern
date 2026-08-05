# Release 1.14.0 — Change Delivery End to End

> Datum: 5. August 2026 · Vorgänger: `1.13.0`

## Wofür dieses Release steht

Release 1.13 hat die Trigger-Erfassung zertifiziert und den `changes:`-Kanal
verdrahtet, aber zwei Lücken offen benannt: Es gab **keinen Poller**, der Quelle
und Zustellung verbindet, und die Kette war nur in ihren Teilen zertifiziert,
nicht als Ganzes.

Beides ist geschlossen. Erfasste Änderungen erreichen jetzt tatsächlich
Abonnenten, und der Weg dorthin ist gegen echtes PostgreSQL belegt.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | **45 von 45 bestanden**, exit 0, 10 Testdateien |
| davon die ganze Änderungskette | 6 Fälle |
| Vitest lokal | 754 bestanden, 63 übersprungen, 0 fehlgeschlagen |
| Strict TypeScript | grün |

## Der Poller

`RealtimeChangePoller` verbindet `RealtimeChangeSource.read` mit
`RealtimeService.deliverChanges`. Drei Eigenschaften prägen ihn:

**Die Position wird erst nach der Zustellung fortgeschrieben.** Scheitert ein
Durchlauf, wird derselbe Bereich erneut gelesen. Lieber eine Änderung zweimal
zustellen als sie zu verlieren: Die doppelte Zustellung ist für den Abonnenten
beobachtbar, der Verlust nicht.

**Läufe überlappen nicht**, und `drain` hat eine Stapelgrenze. Ohne sie könnte
ein schnell wachsender Feed den Aufruf beliebig lange festhalten und andere
Arbeit aushungern.

**Der Poller räumt den Feed nicht auf.** Jede Instanz führt ihre eigene Position,
weil sie eigene Abonnenten beliefert. Nach Position zu löschen hieße, dass die
schnellste Instanz entfernt, was eine langsamere noch nicht gelesen hat — genau
die stille Lücke, die der Cursor-Vertrag ausschließt.

Deshalb ist `RealtimeChangeSource.prune` von positions- auf **altersbasiert**
umgestellt. Aufbewahrung ist eine Betriebsaufgabe und gehört nicht in den
Zustellpfad; ein Test hält fest, dass der Poller sie nie auslöst.

## Die Kette gegen echtes PostgreSQL

Sechs Fälle fahren den vollständigen Weg: `INSERT` → Trigger → Feed → Poller →
Sichtbarkeitsprüfung pro Abonnent → Zustellung.

Der tragende Fall ist der zweite: Zwei Abonnenten desselben Kanals erhalten
unterschiedliche Teilmengen desselben Änderungsstroms — geprüft gegen eine
**echte RLS-Policy in einer echten Datenbank**, nicht gegen eine Attrappe.

Ein weiterer prüft Nebenläufigkeit dort, wo der Entwurf teuer ist: Die
Sichtbarkeitsprüfung läuft je Änderung und je Abonnent, also quadratisch. Zwölf
Abonnenten mal 36 Änderungen sind 432 einzeln RLS-geprüfte Lesevorgänge. Ein
gemeinsamer Fan-out wäre erheblich schneller und genau deshalb falsch; der Fall
hält fest, dass die korrekte Variante jedem exakt seine Zeilen liefert,
vollständig und in Schreibreihenfolge.

Dazu: Burst von 40 Änderungen ohne Verlust, Duplikat oder Reihenfolgefehler;
ein langsamer Abonnent, der mit `REALTIME_BACKPRESSURE` geschlossen wird statt
Ereignisse zu überspringen; und die altersbasierte Aufbewahrung.

## Was der erste Lauf zutage brachte

Drei Fälle scheiterten zunächst. Die Ursache lag in meinem Test, nicht im
Produkt — aber sie ist inhaltlich aufschlussreich: Ich hatte abonniert, **bevor**
der Poller den Feed aufgeholt hatte, worauf der Aufholvorgang die Änderungen
vorheriger Tests an den frischen Abonnenten zustellte.

Ein `changes:`-Kanal liefert bewusst **keine Historie**. Wer später abonniert,
sieht ab dann. Das unterscheidet ihn vom Broadcast-Kanal, der über signierte
Cursor ein Replay anbietet. Für Datenbankänderungen wäre ein Replay
problematisch: Die Sichtbarkeit hängt an den Claims zum Zeitpunkt der Prüfung,
und eine zurückgezogene Berechtigung würde bei einem Replay historischer
Änderungen umgangen. Der Testkommentar hält das fest.

## Stufenwirkung

**Stufe 1.5 bleibt offen — mit nur noch einer benannten Lücke.**

Das Austrittskriterium verlangt Tenant-, Ordering-, Drop- und Lasttests gegen
echte Infrastruktur. Tenant, Ordering und Drop sind jetzt belegt.

Beim Lasttest bleibe ich zurückhaltend: Ein Test mit expliziten `drain`-Aufrufen
misst keine Zustelllatenz, weil diese vom Pollintervall dominiert wird, das der
Aufrufer bestimmt. Ein aussagekräftiger Lasttest braucht einen laufenden Poller
mit Intervall und einen anhaltenden Schreiber — ein Soak-Harness, keinen
Testfall. Das als erfüllt zu buchen wäre die Art Rundung, die dieser Sprint
abgeschafft hat.

## Ehrlich offen

- Soak-Harness mit laufendem Poller, anhaltendem Schreiber und Latenzmessung;
  erst danach ist Stufe 1.5 zu schließen
- Kein Betriebsprozess ruft den Poller: Es gibt keine `workers/`-Runtime dafür,
  ebenso wenig einen Scheduler für die beiden `prune`-Pfade
- Realtime verweigert weiterhin technisch den Start bei `NODE_ENV=production`
- Löschungen erreichen nur `service_role` (siehe Release 1.12)
- Production-TLS/Proxy, Telemetrie, Browser-SDK
