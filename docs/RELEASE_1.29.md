# Release 1.29.0 — Usage-Emitter

> Datum: 6. August 2026 · Vorgänger: `1.28.0`

## Wofür dieses Release steht

Usage Metering war seit Alpha 1 vollständig gebaut: sechs Metriken, monatliche
Fenster, verifier-only Idempotenz, atomare `observe`/`enforce`-Entscheidungen,
Migration 0028 mit Tenant-RLS, eine read-only Projektion — und vier
PostgreSQL-Fälle, die das alles gegen einen echten Server belegten.

Und die Projektion zeigte null.

Kein Produktmodul hat je ein Ereignis gemeldet. Der „vertrauenswürdige Emitter",
den die Dokumentation seit Alpha 1 voraussetzte, existierte nicht. Das ist
dasselbe Muster, das dieser Sprint schon beim Realtime-Poller, beim dauerhaften
Event-Log, bei der Webhook-Outbox und bei der Functions-Sandbox gefunden hat:
**gebaut, zertifiziert und trotzdem wirkungslos, weil niemand es aufruft.**

Es war der letzte Ort, an dem sich dieses Muster noch versteckt hatte.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | **92 von 92 bestanden**, exit 0 |
| Reproduzierbarkeit | zweimal grün **vor** dem Release-Commit |
| Neue Fälle | 7 gegen echtes PostgreSQL, 9 lokal |
| Mutationsprobe Welle 1 | Zulassung entfernt, Messung hinter das Schreiben verschoben → genau 3 Fälle fallen um |
| Mutationsprobe Welle 2 | Idempotenzschlüssel konstant, Ausfall auf `reject` → 6 Fälle fallen um |
| Vitest lokal | 960 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

## Ein Port mit einer Methode

```ts
admit(scope, { metric, reference }): Promise<UsageAdmission>
```

Sie meldet die Operation **und** gibt zurück, ob sie stattfinden darf.

Eine zweite Methode — ein `measure` ohne Antwort — wäre die naheliegende
Bequemlichkeit gewesen und war die falsche Wahl. Sie hätte einen zweiten
Codepfad ergeben, den ein Aufrufer versehentlich nimmt, und ein hartes Limit,
das an einer Stelle greift und an einer anderen nicht, ist schlimmer als gar
keines. Wer nicht gaten will, ignoriert die Antwort sichtbar.

Der Emitter besitzt den `meter`-Principal. Ein Produktmodul, das sich seinen
eigenen bauen dürfte, könnte in einen fremden Scope schreiben; hier kommt der
Scope aus dem Aufruf und die Autorität aus dem Emitter.

Er baut auch den Idempotenzschlüssel aus Quelle, Metrik und Bezug. Der
Schlüsselraum ist **scope-weit**, nicht metrikweit: Zwei Module, die dieselbe
Kennung benutzen, würden sich sonst gegenseitig deduplizieren.

## Gezählt wird die Operation, nicht ihr Ergebnis

Die Messung steht **vor** dem Schreiben und **vor** dem Aufruf. Wer erst danach
misst, kann nicht mehr ablehnen — und ein Limit, das nach der Annahme greift,
ist keines.

Der Preis ist ehrlich zu nennen: Ein Aufruf, der anschliessend scheitert, zählt
trotzdem. Das ist bei Functions sogar richtig — ein Container ist gestartet
worden — und bei Queues eine bewusste Entscheidung: Gezählt werden Operationen,
nicht entstandene Nachrichten. Ein deduplizierter Enqueue hat stattgefunden.

## Zwei Ausfallsemantiken, und die Trennung ist der Punkt

| Wann | Verhalten |
| --- | --- |
| Fehlkonfiguration beim Start | abweisen |
| Messung fällt im Betrieb aus | durchlassen |
| Schlüssel wiederverwendet, Inhalt verändert | immer abweisen |

Die mittlere Zeile bricht mit der Gewohnheit dieses Projekts, alles
fail-closed zu bauen — bewusst. Eine Quota ist eine **kaufmännische** Grenze,
keine Sicherheitsgrenze. Der Schaden eines kurz nicht gezählten Aufrufs ist
begrenzt und nachträglich abgleichbar; der Schaden einer Plattform, die bei
jedem Datenbankschluckauf jede Operation abweist, ist es nicht.
`QKERN_USAGE_EMITTER_ON_FAILURE=reject` stellt das um, und beide Wege sind
zertifiziert.

Die erste Zeile ist die Gegensicherung: Wer die Messung falsch konfiguriert,
kommt gar nicht erst hoch. Niemand soll unbemerkt ohne Zähler laufen.

## Was die Mutationsprobe gezeigt hat

Zwei Wellen, weil die sieben neuen Fälle zwei verschiedene Zusagen tragen. Die
erste — Zulassung entfernt, Messung hinter das Schreiben verschoben — liess
genau drei Fälle umfallen. Die zweite — konstanter Idempotenzschlüssel,
Ausfallmodus auf `reject` — sechs.

Die zweite Welle brachte eine Einsicht mit, die vorher nicht auf dem Papier
stand: Ein Schlüssel, der sich nicht ändert, macht aus dem ganzen Ledger eine
**einzige** Entscheidung, die ewig wiederholt wird. Auch die Ablehnung eines
harten Limits greift dann nur ein einziges Mal, danach wird sie als
`deduplicated: true` mit dem alten `accepted: true` beantwortet. Der
Idempotenzschlüssel schützt nicht nur gegen Doppelzählung — er ist die
Bedingung dafür, dass eine Grenze mehr als einmal beisst.

## Nebenbei

`scripts/postgres-certification.mjs` schreibt die `EXIT=`-Zeile jetzt selbst,
wie die fünf anderen Stacks. Bisher musste die Shell sie anhängen — Handpflege
genau an der Stelle, an der die Evidenz entsteht.

## Ehrlich offen

- **Generated Data API, Storage und Realtime melden nicht.** Für
  `api_requests`, `database_row_reads`, `storage_egress_bytes` und
  `realtime_messages` zeigt die Projektion weiterhin null
- Das Ereignis entsteht in einer **eigenen** Transaktion, nicht in der der
  Operation. Ein Absturz zwischen Messung und Schreiben zählt zu viel. Ein
  wirklich transaktionaler Emitter müsste die Transaktion des Moduls
  mitbenutzen; das ist ein eigener Schnitt
- Kein Abgleich mit Providerwerten, keine Last- und Crash-Läufe des Messpfads
- Weder Preise noch Tarife noch Rechnungen. Dies ist kein Billing-System
- Kein Deployment-Weg für Function-Images
- Die Nebenläufigkeitsgrenze ist prozesslokal, nicht clusterweit
- SDK und CLI sind nur auf Linux belegt
