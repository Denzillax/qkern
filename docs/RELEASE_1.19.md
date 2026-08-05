# Release 1.19.0 — Webhook-Outbox

> Datum: 5. August 2026 · Vorgänger: `1.18.0`

## Wofür dieses Release steht

`WebhookDeliverer` existiert seit Release 1.6 Alpha 4 mit Signatur- und
Transportport, aber ohne Ort für Definitionen und ohne Warteschlange für
Zustellversuche. Ein Ereignis konnte nirgends hinterlegt und kein Versuch
wiederholt werden.

Dieses Release ergänzt beides.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | **65 von 65 bestanden**, exit 0, 14 Testdateien, 32 Migrationen |
| Reproduzierbarkeit | zweimal grün **vor** dem Release-Commit |
| davon Webhook-Outbox | 8 Fälle |
| Vitest lokal | 805 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

## Dasselbe Muster, nicht ein neues

Die Outbox folgt bewusst dem Muster von Project Queues: atomarer Claim über
`FOR UPDATE SKIP LOCKED`, workergebundene Lease als SHA-256-Verifier,
serverberechnetes Backoff und Dead Letter nach einer festen Versuchsgrenze.
Dieses Muster ist seit Release 1.17 über sechs konkurrierende Instanzen
zertifiziert.

Ein eigenes Verfahren zu erfinden wäre die schlechtere Wahl gewesen — aber der
eigene Nachweis bleibt nötig: Dass ein Muster bei Queues hält, sagt nichts über
diese Tabellen. Acht Fälle prüfen es gegen echtes PostgreSQL, darunter genau ein
Gewinner bei sechs gleichzeitigen Claimants, Abweisung eines fremden Workers und
eines veralteten Tokens, und dass nur der Verifier gespeichert wird.

## Zwei Autoritäten beim Server

**Die Wartezeit bis zum nächsten Versuch berechnet der Server.** Ein Zusteller,
der sie mitschickt, könnte sie auf null setzen und einen langsamen Empfänger mit
Wiederholungen überziehen.

**Die Versuchsgrenze kommt aus der Definition, nicht vom Zusteller.** Er könnte
sie sonst hochsetzen und einen dauerhaft fehlschlagenden Empfänger endlos
wiederholen.

## Die Nutzlast ist unveränderlich

Ein Trigger verhindert, dass Inhalt, Ereignistyp oder Zeitpunkt einer Zustellung
nachträglich geändert werden. Sonst könnte ein Wiederholungsversuch etwas
anderes senden als der erste, und die Signatur, die der Empfänger prüft, würde
eine andere Nachricht bestätigen als die ausgelöste.

Ebenso ist eine abgeschlossene Zustellung final, und der Versuchszähler darf
nicht zurücklaufen. Beides liegt in der Datenbank, nicht im Code.

Das Signaturgeheimnis selbst steht nirgends in diesen Tabellen — nur eine
Vault-Referenz.

## Vorbeugend angewandt

Migration 0032 gewährt von Anfang an das `UPDATE`-Recht und die UPDATE-Policy,
die `SELECT … FOR UPDATE` verlangt. Genau daran scheiterte in Release 1.9 der
durable Queue-Adapter, und zwar so, dass er nie eine Nachricht schreiben konnte.
Hier war es von vornherein richtig.

## Ein Testfehler mit Lehreffekt

Ein Fall scheiterte zunächst mit `WEBHOOK_OUTBOX_LEASE_LOST`. Die Ursache: Die
Outbox ist FIFO über den ganzen Scope, also holt ein Claim die **älteste**
fällige Zustellung — nicht die gerade angelegte. Meine Tests hatten sich
dadurch aneinander gekoppelt.

Das Verhalten ist richtig; der Test musste sich danach richten, statt eine
Reihenfolge anzunehmen. Er holt jetzt gezielt seine eigene Zustellung.

## Stufenwirkung

**Stufe 1.6 bleibt offen.** Das Austrittskriterium verlangt Egress-Policy,
Ressourcenlimits, Idempotenz, Dead Letters, Retry und Secret-Canary-Tests ohne
gemeinsame Ausführungsautorität.

Erbracht sind Idempotenz, Dead Letters und Retry — für Queues und jetzt auch für
Webhooks — sowie ein betriebsfähiger Cron. Es fehlt die **Functions-Sandbox**,
und damit Egress-Policy, Ressourcenlimits und Secret-Canary.

## Ehrlich offen

- Functions-Sandbox: nur Vertragsport, keine Laufzeit
- Kein Zustellprozess: Die Outbox ist eine Bibliothek. Niemand ruft `claim` und
  `WebhookDeliverer` in einer Schleife auf
- Keine API und keine Console-Fläche zum Anlegen von Webhooks oder Cron-Jobs;
  beide entstehen derzeit nur über direkten Datenbankzugriff
- Kein Signer-Adapter gegen den Vault
- Kein startbarer Handler-Host für Queues
- Kein Scheduler für die beiden Realtime-`prune`-Pfade
