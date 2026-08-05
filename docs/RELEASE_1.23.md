# Release 1.23.0 — Functions aufrufbar

> Datum: 5. August 2026 · Vorgänger: `1.22.0`

## Wofür dieses Release steht

Release 1.22 hat die Sandbox gebaut und zertifiziert — und im selben Atemzug
festgehalten, dass sie eine Bibliothek ist, die niemand aufruft. Es gab keinen
Ort, an dem eine Function hinterlegt werden konnte, und keinen Weg, eine
auszuführen.

Dieses Release schliesst beides.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | **85 von 85 bestanden**, exit 0, 17 Testdateien, 33 Migrationen |
| Functions-Sandbox gegen Docker | **13 von 13 bestanden**, exit 0 |
| Reproduzierbarkeit | zweimal grün **vor** dem Release-Commit |
| davon Function-Definitionen | 7 Fälle |
| Mutationsprobe | Digest-Bindung und Spaltenrecht aufgeweicht → genau 2 Fälle fallen um |
| Vitest lokal | 886 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

## Migration 0033

`project_functions` folgt derselben Regel wie 0031 und 0032: **nur `enabled` ist
änderbar.** Bild, Entrypoint, Grenzen und Referenzen sind über das Spaltenrecht
unveränderlich, nicht über eine Prüfung im Dienst — ein zweiter Schreiber
umginge die Prüfung, nicht das Recht.

Das ist hier keine Formsache. Ein Aufruf darf niemals gegen eine Definition
laufen, die sich zwischen Auflösen und Ausführen verändert hat; sonst führte
QKERN ein anderes Image aus als das, das der Betreiber freigegeben hat.

Die Digest-Bindung des Images steht zusätzlich als Spalten-Check in der
Datenbank. Ein Tag wäre veränderlich, und derselbe Name könnte morgen einen
anderen Inhalt bezeichnen.

## Der Aufrufweg

`POST .../compute/invoke/{name}` löst die **aktive** Definition auf und führt sie
in der Sandbox aus.

**Die Definition wird bei jedem Aufruf frisch gelesen.** Ein zwischen-
gespeichertes Bild liefe nach einem Abschalten weiter, und ein Betreiber, der
eine Function stoppt, will sie gestoppt haben. Ein Zertifizierungsfall zeigt
genau das: pausieren, und der nächste Aufruf findet nichts mehr.

Aufrufen darf ein **Service**-Projektschlüssel oder ein Administrator. Kein
anonymer und kein Endnutzer-Aufruf, und bewusst keine CORS-Freigabe: Eine
Function läuft mit der Autorität des Projekts, nicht mit der ihres Aufrufers,
und eine Policy je Function, die das sicher unterscheiden könnte, gibt es noch
nicht.

Die Antwort wird nicht durchgereicht, sondern auf ihre geprüfte Form reduziert —
Statuscode, begrenzte Header, begrenztes JSON. Container- und Datenbankmeldungen
erreichen den Aufrufer nie.

## Dieselbe Regel, zwei Aufrufer

`validateFunctionDefinition` prüft jetzt beim Anlegen **und** beim Aufrufen. Eine
Definition, die der Betrieb abweisen würde, entsteht gar nicht erst — dieselbe
Regel, die seit Release 1.21 für Cron-Ausdrücke und Webhook-Ziele gilt.

## Die Mutationsprobe

Digest-Bindung aus dem Spalten-Check entfernt und das `UPDATE`-Recht auf `image`
und `memory_mib` erweitert — genau die zwei zugehörigen Fälle fallen um, kein
anderer.

## Stufenwirkung

**Stufe 1.6 ist damit erfüllt.** Das Austrittskriterium verlangt Egress-Policy,
Ressourcenlimits, Idempotenz, Dead Letters, Retry und Secret-Canary-Tests ohne
gemeinsame Ausführungsautorität. Alle sechs sind zertifiziert, und Functions,
Cron und Webhooks sind jetzt hinterlegbar, verwaltbar und ausführbar.

Die Einschränkung, die 1.22 offengelassen hat, ist damit behoben: Die Sandbox
ist keine Bibliothek mehr, die niemand aufruft.

Was das Kriterium **nicht** verlangt und weiterhin fehlt, steht unten.

## Ehrlich offen

- **Kein Egress-Proxy.** Eine Definition mit erlaubten Origins lässt sich
  anlegen, aber ihr Aufruf wird abgewiesen. Functions können nichts nach aussen
  aufrufen
- Kein Deployment-Weg für Function-Images; das Image muss anderswo gebaut und
  in eine Registry geschoben werden
- `maxConcurrency` wird gespeichert, aber nicht durchgesetzt
- Kein anonymer oder Endnutzer-Aufruf und keine Policy je Function
- Die volle Kette Datenbank → HTTP → Container ist **nicht** in einem Lauf
  zertifiziert: Die Definitionen laufen im PostgreSQL-Stack, die Sandbox gegen
  Docker auf dem Host. Beide Hälften sind belegt, die Naht dazwischen nicht
- Kein Vault-gestützter Signaturschlüssel-Provider für Webhooks
- SDK und CLI kennen weder Definitionen noch Aufruf
