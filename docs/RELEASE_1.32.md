# Release 1.32.0 — Zählung an der HTTP-Grenze

> Datum: 6. August 2026 · Vorgänger: `1.31.0`

## Wofür dieses Release steht

Release 1.31 hat `api_requests` bewusst offen gelassen, mit einer Begründung:
71 Routendateien, kein gemeinsamer Chokepoint, und eine Messung je
Dienstmethode wäre systematisch zu hoch.

Die Begründung war richtig und die Schlussfolgerung falsch. Der Chokepoint war
da — nur nicht auf der Ebene, auf der ich gesucht hatte.

## Fünf Stellen statt 71

Jedes Modul löst den Scope einer Anfrage an **genau einer** Stelle auf:

- `adminProjectQueueContext`, `applicationProjectQueueContext`
- `adminProjectStorageContext`, `applicationProjectStorageContext`
- `generatedDataContext`

Das ist der Ort, an dem eine Anfrage genau einmal weiss, wem sie gehört — und
damit der Ort, an dem sie gezählt gehört. Nicht 71 Dateien, sondern fünf
Funktionen.

Der Aufruf steht am **Ende** des Resolvers. Eine Anfrage, die schon an der
Authentifizierung scheitert, hat keinen Scope, den man belasten könnte, und
einen fremden zu belasten wäre schlimmer, als sie nicht zu zählen.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | **99 von 99 bestanden**, exit 0 |
| Reproduzierbarkeit | zweimal grün **vor** dem Release-Commit |
| Neue Fälle | 1 gegen echtes PostgreSQL, 4 lokal |
| Mutationsprobe | Ablehnung im Helfer entfernt → Zertifizierungsfall und lokaler Abbruchfall fallen um |
| Vitest lokal | 964 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

## Die Gegenprobe zu 1.31

`api_requests` ist genau der umgekehrte Fall zu `database_row_reads` und
`storage_egress_bytes`: Die Menge steht **vorher** fest, und zwar auf eins.

Deshalb darf und soll diese Metrik gaten. `enforce` ist hier die sinnvolle
Einstellung — dieselbe, die für die beiden nachträglichen Metriken seit 1.31
gar nicht erst annehmbar ist. Ein erschöpftes Limit beantwortet die Anfrage mit
`429`: „später wiederkommen", nicht „kaputt". Fällt eine der Fehlerabbildungen
weg, wird daraus eine `500`, und ein Fall pinnt das fest.

Der Zertifizierungslauf zeigt es gegen das echte Ledger: Bei einem Limit von
zwei gehen zwei Anfragen durch, die dritte scheitert, und der Zähler steht auf
zwei. Die abgewiesene Anfrage erhöht ihn nicht.

## Eine Datei, die es schon gab

`lib/server/usage/http.ts` existierte bereits — sie trägt die HTTP-Fläche der
Usage-**Projektion**. Der neue Helfer wäre dort inhaltlich falsch am Platz
gewesen: zwei verschiedene Dinge unter demselben Wort. Er liegt jetzt in
`lib/server/usage/api-requests.ts`.

## Ehrlich offen

- **Zertifiziert ist der Helfer, nicht seine Platzierung.** Dass er an allen
  fünf Resolvern steht und an keinem doppelt, ist gelesen und nicht getestet;
  ein Test dafür bräuchte eine echte HTTP-Anfrage mit Sitzung oder
  Projektschlüssel. Wer einen Resolver hinzufügt, muss selbst daran denken
- `realtime_messages` meldet weiterhin nicht: Es bräuchte einen bündelnden
  Emitter, und ein solcher verliert die Gate-Eigenschaft — eine eigene
  Entscheidung, kein Anhängsel
- `control_plane`, `project_auth` und `mcp` dürfen `api_requests` schreiben, tun
  es aber nicht. Dieser Slice hat die drei Module genommen, die einen
  projektgebundenen Resolver haben
- Kein Abgleich mit Providerwerten, keine Last-Läufe des Messpfads
- Weder Preise noch Tarife noch Rechnungen
- Kein Deployment-Weg für Function-Images
- SDK und CLI sind nur auf Linux belegt
