# Release 2.63.0 – Gerendert, aufgeräumt, kein toter Knopf

Drei Schulden aus den Releases davor sind bezahlt. Keine davon ist eine neue
Fläche, und zwei haben Fehler gefunden, die vorher niemand gesehen hätte.

## Was neu ist

- Jede Konsolenansicht wird wenigstens einmal gerendert, in allen vier Sprachen.
- Abgelaufene Einmal-Token, OAuth-Token und OAuth-Codes verschwinden, 24 Stunden nach ihrem Ablauf.
- Der Knopf "Backup erstellen" ist weg, und an seiner Stelle steht, warum es ihn nicht gibt.
- PostgreSQL-Zertifizierung von 219 auf 220 Fälle, lokale Suite von 2274 auf 2300.

## Der Render-Vertrag, und was er nicht kann

Seit vielen Ausgaben endet jede Release Note mit "Im Browser nicht gesehen".
Rund vierzig Ansichten sind entstanden, und keine war je gerendert worden, auch
nicht in einem Test. Der neue Vertrag rendert 79 Komponenten in 93 Fällen, in
vier Sprachen also 372 Durchläufe, über den Server-Renderer von React und **ohne
eine neue Abhängigkeit**.

Er prüft mehr als "wirft nicht": Jede Ansicht muss beim Öffnen einen
Ladezustand zeigen, und ein englisches Rendern darf keinen deutschen Text
enthalten, den die Übersetzung nie gesehen hat.

**Er hat keinen einzigen Fehler gefunden**, und das ist das ehrliche Ergebnis.
Nachgesetzt wurde mehrfach: ein werfendes `fetch`, mitgeschriebene
React-Beschwerden, eine fremde Zeitzone, alle Flyout-Gruppen.

Was er nicht kann, steht in ihm. Effekte laufen nicht, also bleiben der fertige
Zustand, der Fehlerzustand, der leere Zustand und jede Tabelle mit echten
Zeilen ungesehen. Keine Ereignisse, kein Layout, keine Stylesheets. **Ein
Rendern ohne Effekte ist kein Browserbesuch.**

## Zwei Fehler an der PITR-Seite

Beide sind beim Aufräumen der Backups-Seite aufgefallen, nicht bei ihrer
eigenen Arbeit.

- **Die Drill-Evidenz stand unter einer Überschrift, die sich wie eine Aussage über diese Projektumgebung liest.** Der Geltungsbereich der Evidenz ist die Kontrollebene: Der Drill stellt eine ganz andere Datenbank wieder her. Der Fussnotensatz sagt das jetzt.
- **Die Seite rundete Sekunden auf Minuten.** Ein Rückstand von 29 Sekunden erschien als "0". Das ist an genau dieser Stelle die ungünstigste Lüge, weil die Zahl sagen soll, wie viel ein Wiederanlauf verliert. Sie formatierte ausserdem an den Anzeigeeinstellungen vorbei, die jede andere Ansicht befolgt.

## Die Entscheidungen des Aufräumers

- **24 Stunden Frist**, mit Absicht länger als die längste Lebensdauer dieser Artefakte. Damit kann eine gelöschte Zeile nie das Gegenstück von etwas Gültigem sein, und was morgens schiefging, hat am Abend noch seine Zeilen.
- **Geschnitten wird am Ablauf, nicht am Verbrauch.** An einer verbrauchten, aber noch gültigen Zeile fällt ein zweites Einlösen auf.
- **Jede Spur bleibt stehen**: Sitzungen auch widerrufene, Nutzer, Passkeys, Clients, Schlüssel, jede Audit-Zeile.
- **`project_storage_uploads` bleibt liegen**, obwohl es eine Ablaufspalte hat. Hinter der Zeile stehen Bytes bei einem Anbieter, und sie zu verwaisen wäre schlimmer als eine wachsende Tabelle.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 220/220, exit 0 | `docs/evidence/2026-09-27/welle15-run1.manifest.json` |
| PostgreSQL 17, 220/220, exit 0 | `docs/evidence/2026-09-27/welle15-run2.manifest.json` |
| Mailpit und Dex, 7/7, exit 0 | `docs/evidence/2026-09-27/welle15-auth.manifest.json` |
| HTTPS-Empfänger, 16/16, exit 0 | `docs/evidence/2026-09-27/welle15-receiver.manifest.json` |
| Mutation gelöscht ohne Frist, exit 1 | `docs/evidence/2026-09-27/welle15-mutation-cleanup.manifest.json` |
| Mutation Feldzugriff im ersten Renderdurchlauf, exit 1 | `docs/evidence/2026-09-27/welle15-mutation-renderguard.manifest.json` |
| Mutation der abgeschaltete Knopf ist zurück, exit 1 | `docs/evidence/2026-09-27/welle15-mutation-backupspage.manifest.json` |
| Vitest lokal 2300/2300, exit 0 | `docs/evidence/2026-09-27/welle15-local-run1.manifest.json` |
| Vitest lokal 2300/2300, exit 0 | `docs/evidence/2026-09-27/welle15-local-run2.manifest.json` |

## Nachtrag zum Verfahren

**Ein Vertrag hat eine veraltete Zahl gefunden, die niemand gepflegt hatte.**
Der Empfänger-Stack fährt inzwischen 16 Fälle, die Statusdatei behauptete 14.
Die Zahl war nicht falsch erfunden, sondern mitgewachsen, ohne dass jemand
hinsah. Genau dafür gibt es diesen Vertrag.

**Ein Befund aus dem Bauen des Aufräumers.** `FOR UPDATE SKIP LOCKED` stand
zuerst in den Abfragen und musste wieder weg: PostgreSQL verlangt dafür das
Recht zum Ändern, und die Anmelderolle hat es auf den OAuth-Token nicht. Das
ist die Aussage der Migration und kein Versehen, also ist die Sperrklausel
gefallen und nicht das Recht ausgeweitet worden.

## Ehrlich offen

- **Im Browser weiterhin nicht gesehen.** Der Render-Vertrag ist kein Ersatz dafür, und er sagt das selbst.
- **Vierzehn Ansichten liegen in `console-app.tsx` und werden vom Vertrag nicht erreicht**, weil sie nicht exportiert sind. Sie in eigene Dateien zu ziehen wäre der nächste Schritt.
- **Die Ladevokabel des Vertrags ist eine feste Liste von sechs Verben.** Eine Ansicht mit neuer Formulierung lässt ihn fallen, bis jemand die Liste ergänzt.
- **Zwei Platzhalter bleiben**: Analytics-Buckets und Vektor-Buckets.
- **QKERN hat weiterhin keinen Weg, ein Backup einer Projektdatenbank anzustossen.** Die Seite sagt es, und die fünf Schritte am Server stehen daneben.
