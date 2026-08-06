# Release 1.26.0 — Vermittelter Egress

> Datum: 5. August 2026 · Vorgänger: `1.25.0`

## Wofür dieses Release steht

Seit Release 1.22 stand in jeder Notiz derselbe Satz: *Functions können nichts
nach aussen rufen.* Eine Definition durfte erlaubte Origins nennen, aber ihr
Aufruf wurde abgewiesen — fail closed, weil es nichts gab, das die Liste
bedient hätte.

Jetzt gibt es das. Und der Container bekommt trotzdem **kein Netz**.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| Functions-Zertifizierung (Docker 29.5 plus PostgreSQL 17) | **22 von 22 bestanden**, exit 0 |
| Reproduzierbarkeit | zweimal grün **vor** dem Release-Commit |
| davon Egress | 5 Fälle im Container, 11 lokal |
| Mutationsprobe | Allowlist auf Präfixvergleich, Budget abgeschaltet → genau 2 Fälle fallen um |
| Vitest lokal | 912 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

## Die Entscheidung: vermitteln statt proxen

Der übliche Weg wäre ein Egress-Proxy in einem internen Docker-Netz: Der
Container bekommt ein Netz, aber nur zum Proxy, und der prüft die Allowlist. Das
hätte den Vorteil, dass `fetch` im Container direkt funktioniert.

Es hätte aber `--network none` gekostet — die stärkste Zusage, die diese Sandbox
gibt, und die einzige, die keine Konfiguration falsch machen kann. Dazu ein
zusätzliches Image, ein zusätzliches Netz und eine zusätzliche
Vertrauensbeziehung, um am Ende dieselbe Frage zu beantworten: *Darf dieser
Aufruf zu diesem Ziel?*

Die Antwort gibt jetzt Code im Runtime-Prozess. Der Container bittet über stdio
um jede Verbindung, die Runtime prüft und führt sie aus.

**Der Preis ist ehrlich zu nennen:** Eine Function benutzt nicht direkt `fetch`,
sondern den vermittelten Kanal ihrer Laufzeit. Wer den Proxy-Weg später will,
kann ihn ergänzen, ohne die Policy-Semantik zu ändern — die Entscheidung, *ob*
ein Ziel erlaubt ist, bliebe dieselbe.

## Was die Policy prüft

Bei **jeder einzelnen** Anfrage, nicht einmal beim Start:

- **Exakte Origin** aus der Definition. `https://api.example.com.evil.test` ist
  eine andere Origin — ein Präfixvergleich wäre hier genau der Fehler, und die
  Mutationsprobe zeigt, dass der Fall ihn fängt.
- HTTPS ohne eingebettete Zugangsdaten, kein abweichender Port.
- Eine kleine Methodenliste; `CONNECT` und `TRACE` fallen durch.
- **Keine Weiterleitungen.** Eine Umleitung könnte an ein Ziel führen, das nicht
  auf der Liste steht; ihr zu folgen hiesse, die Policy zu umgehen.
- Hop-by-Hop- und Identitätsheader gehören der Runtime. `cookie` fällt ebenfalls:
  Eine Function soll keine fremde Sitzung mitschicken können.
- Begrenzte Anfrage- und Antwortgrösse, begrenzte Zeit, und eine **Anzahl je
  Aufruf** — ohne sie wäre die Zahl der Verbindungen unbegrenzt.
- Von der Antwort kehren nur vier feste Header zurück. `set-cookie` und interne
  Backend-Header bleiben draussen.

Ein Fehlschlag kommt ohne Ursache zurück: Sie könnte Ziel, Header oder
Netzwerkdetails tragen.

## Das Protokoll

Zeilenweises JSON in beide Richtungen. Eine einzelne Antwort ohne `type` gilt
weiterhin als Ergebnis — das war das Protokoll aus Release 1.22, und ein Image,
das nichts nach aussen ruft, muss dafür nicht angefasst werden.

## Ein echter Fund beim Umbau

Weil stdin jetzt offen bleibt, fiel der Fall „nach einem Timeout läuft kein
Sandbox-Container mehr" um. Ursache war nicht das neue Protokoll, sondern eine
Schwäche, die ich in Release 1.24 selbst als Einschränkung notiert hatte: Das
harte Entfernen des Containers lief **abgekoppelt** weiter und war damit nur
best-effort.

Jetzt wird darauf gewartet. Der Preis sind wenige hundert Millisekunden auf
einem ohnehin gescheiterten Aufruf; der Gewinn ist, dass die Zusage keine
Einschränkung mehr braucht.

## Die Mutationsprobe

Allowlist auf einen Präfixvergleich aufgeweicht und das Anfragebudget
abgeschaltet: Genau die zwei zugehörigen Fälle fallen um, kein anderer.

## Ehrlich offen

- **Keine Zertifizierung gegen einen echten externen HTTPS-Server.** Der
  ausgehende Aufruf selbst läuft in den Fällen gegen ein eingespeistes `fetch`;
  geprüft sind Kanal und Policy, nicht die Socket-Schicht. Dieselbe Lücke steht
  seit Release 1.20 bei den Webhooks
- Kein DNS-Pinning und keine Sperre privater Adressbereiche im Egress-Pfad; ein
  allowlistetes Ziel, das auf eine interne Adresse zeigt, würde erreicht
- Kein Deployment-Weg für Function-Images
- Die Nebenläufigkeitsgrenze ist prozesslokal, nicht clusterweit
- SDK und CLI kennen weder Definitionen noch Aufruf
