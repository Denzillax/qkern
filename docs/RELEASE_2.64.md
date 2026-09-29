# Release 2.64.0 – Zustimmung, Riegel, ausgezogen

Drei Schnitte, die parallel entstanden sind und beim Zusammenführen einen
Fehler gezeigt haben, den keiner von ihnen allein sehen konnte.

## Was neu ist

- Eine OAuth-Zustimmung ist eine Zeile in der Datenbank, mit Bereichen, Zeitpunkt und Widerruf.
- Der Remote-MCP-Server ist über OAuth erreichbar, mit genau den Werkzeugen, die die Bereiche eines Tokens öffnen.
- Dreizehn Konsolenansichten liegen in eigenen Dateien und werden vom Render-Vertrag erreicht.
- PostgreSQL-Zertifizierung von 220 auf 222 Fälle, lokale Suite von 2300 auf 2301.

## Die Zustimmung

Migration 0064 legt `project_auth_oauth_consents` an. `authorizeOAuth` gibt
ohne geltende Zustimmung keinen Code mehr heraus, und `verifyOAuthToken` liest
die Zustimmung in derselben Abfrage wie das Token mit, weshalb ein Widerruf
sofort wirkt statt beim nächsten Ablauf.

Der Widerruf löscht nichts. Die Zeile bleibt mit beiden Zeitpunkten stehen,
`qkern_auth` hat auf der Tabelle kein `DELETE`, und ein Wächter lässt
`revoked_at` nicht wieder auf NULL. Verglichen wird auf genau die zugestimmten
Bereiche und nicht auf mindestens diese, sonst entschiede die Reihenfolge der
Zeilen, an welcher Zustimmung ein Code hängt.

Belegt ist damit, dass ein Aufrufer mit dem gültigen Access Token dieses
Nutzers genau diese Bereiche ausdrücklich genannt hat, zu diesem Zeitpunkt.
**Nicht belegt ist, dass ein Mensch eine Liste gesehen hat.** Eine eigene
Zustimmungsseite gäbe es nur mit einem Anmeldefluss im Browser. Zwischen
Anwendung und Nutzer steht also weiterhin die Anwendung. Geändert hat sich,
dass die Zustimmung jetzt eine Zeile mit Zeitpunkt und Bereichen ist statt
einer Behauptung, die mit dem Token abläuft.

## Der Riegel im MCP-Server

Der Riegel nannte seit Langem das Gate, das ihn aufheben würde: einen
OAuth-Resource-Server. Den hat 2.61 gebaut, also fällt er jetzt dort, wo das
Gate steht.

Über OAuth erreichbar sind vier Werkzeuge: Lesen unter `data:read`, Einfügen,
Ändern und Löschen unter `data:write`. Die übrigen zwölf werden für eine solche
Sitzung gar nicht erst angemeldet und fehlen schon in der Werkzeugliste. Die
freie Abfrage und die Schemaliste lesen an der Zeilensicherheit vorbei, während
`data:read` das Lesen unter ihr zusagt. Für Control Plane, Storage, Queues und
die beiden Migrationswerkzeuge gibt es keinen Bereich, der sie beschreibt. Ein
Werkzeugname ohne Eintrag in der Tabelle wirft beim Start.

Der Mandant kommt vollständig aus dem Projekt-Key, die Prozessumgebung gilt auf
diesem Weg nicht.

## Die dreizehn Ansichten

Der Render-Vertrag aus 2.63 nannte vierzehn Ansichten, die er nicht erreicht.
Vierzehn waren es nicht: Die Liste war einen Schnitt zu alt.

Der Umzug allein war folgenlos. Sichtbar wurde erst, was beim ersten Rendern
passiert, sobald der Vertrag die Seiten erreicht:

- **Monitoring zeigte beim Öffnen acht leere Kästen und kein einziges Wort.**
- **Die Live-API behauptete "Nicht eingerichtet", bevor sie gefragt hatte.**
- **Die Freigaben sagten "Regel wird geladen" ohne Auslassungspunkte**, also im Perfekt.
- **Sieben Texte liefen nie durch `t()`** und standen darum in jeder Sprache deutsch da, unter ihnen der ganze Absatz zu den Uploads in Storage.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 222/222, exit 0 | `docs/evidence/2026-09-28/welle16-run1.manifest.json` |
| PostgreSQL 17, 222/222, exit 0 | `docs/evidence/2026-09-28/welle16-run2.manifest.json` |
| Mailpit und Dex, 7/7, exit 0 | `docs/evidence/2026-09-28/welle16-auth.manifest.json` |
| Mutation freie Abfrage unter `data:read`, exit 1 | `docs/evidence/2026-09-28/welle16-mutation-mcpscopes.manifest.json` |
| Mutation widerrufene Zustimmung gilt weiter, exit 1 | `docs/evidence/2026-09-28/welle16-mutation-consent.manifest.json` |
| Mutation Feldzugriff auf den ersten Bucket, exit 1 | `docs/evidence/2026-09-28/welle16-mutation-storageview.manifest.json` |
| Vitest lokal 2301/2301, exit 0 | `docs/evidence/2026-09-28/welle16-local-run1.manifest.json` |
| Vitest lokal 2301/2301, exit 0 | `docs/evidence/2026-09-28/welle16-local-run2.manifest.json` |

## Nachtrag zum Verfahren

**Zwei Schnitte waren jeder für sich grün und zusammen rot.** Der Schnitt zum
MCP-Server hat den Fall `(2.91)` gebaut, der einen OAuth-Ablauf ganz durchfährt.
Der Schnitt zur Zustimmung hat die Regel eingeführt, dass es ohne Zustimmung
keinen Code gibt, und hat den bestehenden Fall `(2.82)` entsprechend
nachgezogen. `(2.91)` gab es zu diesem Zeitpunkt in seinem Worktree nicht, also
konnte er ihn nicht kennen. Erst der zusammengeführte Stand ist gefallen, mit
`consent_missing` an genau der Stelle, an der die neue Regel steht.

Das ist die Rechnung für parallele Arbeit, und sie war hier billig, weil der
Zertifizierungslauf nach dem Zusammenführen steht und nicht davor. Der Fall
hat jetzt seine Zustimmung je Durchlauf, weil jeder der drei Durchläufe eine
andere Bereichsmenge anläuft.

**Die Wiederholung brauchte eine ruhige Maschine, und das zum dritten Mal.**
Der zweite PostgreSQL-Lauf ist am 28. September zweimal gefallen, jedes Mal mit
einer anderen Fünfergruppe von Zeitfällen, alle am 5000-ms-Timeout, keiner
davon ein Logikfall, alle grün im ersten Lauf. Auf der Maschine liefen zu dem
Zeitpunkt drei Docker-Stacks paralleler Schnitte, 1,6 von 15,7 GiB waren frei.
Kein Budget wurde erhöht und keine Zusage abgeschwächt. Der Lauf steht als
`welle16-run2` vom **29. September** in der Evidenz, gefahren auf der leeren
Maschine, 222 von 222 ohne einen einzigen Ausfall im Log.

**Ein Auflöser für Testdateien, der mehrfach falsch war.** Beide Fälle stehen
am Dateiende, also überlappten sie sich vollständig. Nach Klammern zu zählen
scheitert an SQL- und GraphQL-Schnipseln, die in Zeichenketten unbalancierte
Klammern enthalten. Was trägt: von der Zeile `it("(X.Y)` bis zur nächsten
`it(`-Kopfzeile schneiden und den Doc-Kommentar nur mitnehmen, wenn er auf
Einrückung 2 beginnt.

## Ehrlich offen

- **Niemand hat eine Zustimmungsseite gesehen.** Ein Nutzer kann seine eigene Zustimmung auch nicht selbst zurücknehmen, das kann nur der Betreiber in der Console, und die Seite sagt es.
- **Ein einzelnes Token lässt sich nicht widerrufen.** Es fällt nur über den Widerruf der Zustimmung oder über das Löschen des Clients.
- **Im Browser nicht gesehen.** Der Render-Vertrag rendert ohne Effekte, also bleiben der fertige Zustand, der Fehlerzustand und der leere Zustand ungesehen.
- **Nach dem Ausziehen liegen kleine Helfer mehrfach herum**, unter anderem `EmptyState`, `ErrorState`, `formatTime` und `CheckIcon`.
- **Zwei Platzhalter bleiben**: Analytics-Buckets und Vektor-Buckets.
- **Token aus der Zeit vor Migration 0064 gelten nicht mehr.** Sie tragen keine Zustimmung, und ein Token ohne Zustimmung fällt.
