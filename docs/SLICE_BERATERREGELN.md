# Slice: Regeln, die nie liefen

> **Nachtrag vom 27. September 2026.** Diese Datei hiess `RELEASE_2.57.md` und
> trug die Überschrift „Release 2.57.0". Ein Release 2.57.0 hat es nie
> gegeben. Die Zahl stammt von den Fallnummern dieses Schnitts, nicht von
> einer Version; ausgeliefert wurde er in `2.52.0`, und dort steht er auch in
> der Release Note. Umbenannt wurde die Datei, bevor 2.57.0 wirklich erscheint
> und zwei verschiedene Dinge denselben Namen tragen. Der Text darunter ist
> unverändert.


Vier Stellen, an denen frühere Releases selbst notiert haben, dass etwas
offen bleibt. Keine neue Fläche: zwei Beraterregeln laufen jetzt, ein
Gesundheitszustand heisst, was er ist, und eine Zahl steht da, wo bisher
eine Fussnote stand.

## Was neu ist

- `auth_provider_unverified_email` (2.39) läuft. Die Provider-Projektion trägt
  ein drittes Feld: ein abgeleitetes `boolean`.
- `slow_statement` (2.40) läuft. `inspectStatements` liest aus
  `pg_stat_statements` nur Zeilen der eigenen Datenbank und von jeder nur
  Kennung, Aufrufe und Gesamtzeit.
- Gesundheit (2.44) hat einen sechsten Zustand: `configured`. Realtime und
  Vault stehen nicht mehr als „erreichbar" da.
- Berichte → Verbindungen (2.46) zeigt, wie viele Backends diese Rolle nicht
  sehen darf.
- PostgreSQL-Zertifizierung von 191 auf 192 Fälle.

## Die vier Entscheidungen

**Sicherheitsberater: verbreitern statt streichen.** `listOidcProviders` gibt
seit 1.83 Slug und Issuer heraus, und genau darum konnte die achte Regel nie
laufen. Sie nennt jetzt zusätzlich `requiresVerifiedEmail`, abgeleitet aus
`emailVerification`. Das ist sicher, weil ein `boolean` keine Stelle hat, an
der ein Secret, eine Client-ID oder ein Endpunkt stehen könnte — es ist kein
durchgereichtes Feld, sondern ein Vergleich. Die **öffentliche** Route
`/auth/oidc/providers` verengt weiterhin auf Slug und Issuer; hinter der
Admin-Grenze steht das dritte Feld, davor nicht.

**Leistungsberater: einen sicheren Teilausschnitt bauen.** 2.40 nannte zwei
Gründe, die Sicht gar nicht zu lesen: Sie gilt für den ganzen Cluster, und ein
Utility-Befehl behält seine Literale. Beide treffen die Spalte `query` und die
Zeilen fremder Datenbanken, nicht die Zähler. Die Abfrage grenzt darum auf
`dbid` der eigenen Datenbank ein, wählt `query` nirgends aus und lässt Zeilen
ohne `queryid` weg. `PerformanceAdvisorStatement` hat sein nie gefülltes Feld
`text` verloren: Was es nicht gibt, kann niemand aus Versehen füllen.

**Gesundheit: umbenennen statt proben.** Eine Reachability-Probe hätte eine
Verbindung aufgebaut oder den Vault gefragt; beides sollte diese Seite nicht.
Der ehrliche Weg war, den Zustand zu trennen. `ok` heisst jetzt: gefragt und
geantwortet. `configured` heisst: hinterlegt, niemand gefragt. `configured`
liegt im Rang über `ok`, also zieht es das Gesamturteil herunter — das ist
gewollt, weil eine Seite, die nichts gefragt hat, nicht „alles erreichbar"
melden soll.

**Verbindungen: die Lücke benennen.** `backends` minus die gezählten Gruppen
ist eine Zahl und keine Fussnote. Sie steht als eigene Kachel, nach unten auf
null geklemmt, weil beide Werte aus zwei Abfragen nacheinander kommen.

## Belege

| Lauf | Ergebnis |
| --- | --- |
| `npx tsc --noEmit -p .` | grün |
| Vitest lokal | 1724 bestanden, 0 fehlgeschlagen, 275 übersprungen |

Die PostgreSQL-Zertifizierung ist in diesem Slice **nicht** gefahren: Der
Stack läuft beim Controller. Der neue Fall heisst
`(2.57) proves the advisor rules that used to be unreachable` und braucht
`pg_stat_statements`; `docker-compose.certification.yml` lädt die Erweiterung
seit diesem Release über `shared_preload_libraries`, und
`db/docker/000-certification-init.sh` legt sie an, ohne dass ein Stack ohne
Preload daran scheitert.

## Ehrlich offen

- **Die Zertifizierung dieses Slices steht aus.** Die Zahl 192 ist gezählt,
  nicht gefahren.
- **`shared_preload_libraries` ist ein Eingriff in den Stack**, nicht nur in
  den Fall. Die 191 vorhandenen Fälle laufen ab jetzt mit aktivem
  Statement-Tracking.
- **Ohne `pg_read_all_stats` sieht die Leserolle fremde Zeilen ohne Kennung.**
  Sie fallen heraus; der Berater sieht also weniger, als im Cluster steht.
  Das ist die richtige Richtung, aber es heisst: keine Vollständigkeit.
- **`configured` verschiebt das Gesamturteil** jedes Projekts mit Realtime
  oder Vault von „erreichbar" auf „eingerichtet". Das ist die Korrektur einer
  Unwahrheit und sieht trotzdem wie eine Verschlechterung aus.
- **Die Provider-Regel bleibt eine Aussage über die Konfiguration**, nicht
  über den Anbieter. Ob ein Anbieter mit `required` seine Adressen wirklich
  prüft, weiss QKERN nicht.
- **Im Browser nicht gesehen.**
