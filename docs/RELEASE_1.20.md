# Release 1.20.0 — Zustellprozess

> Datum: 5. August 2026 · Vorgänger: `1.19.0`

## Wofür dieses Release steht

Seit Release 1.19 sind Cron-Definitionen und die Webhook-Outbox persistiert und
gegen echtes PostgreSQL zertifiziert. Trotzdem wurde nie ein Webhook gesendet
und nie ein Cron-Vorkommen ausgelöst: Beides waren Bibliotheken, und kein Prozess
rief sie auf.

Dieses Release baut den Prozess.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | **71 von 71 bestanden**, exit 0, 15 Testdateien, 32 Migrationen |
| Reproduzierbarkeit | zweimal grün **vor** dem Release-Commit |
| davon Zustellkette | 6 Fälle |
| Mutationsprobe | beide neuen Garantien einzeln abgeschaltet → genau 2 Fälle fallen um |
| Vitest lokal | 841 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

Evidenz: `docs/evidence/2026-08-05/` mit Rohlogs und generierten Manifesten.

## Die Kette, nicht die Teile

`tests/compute-webhook-chain.integration.test.ts` prüft, was bisher niemand
geprüft hatte: hinterlegen → holen → signieren → senden → abschließen, gegen
echtes PostgreSQL, mit einem Empfänger, der die Signatur **wirklich verifiziert**.
Ein Empfängerstub, der jede Nachricht bestätigt, würde nur beweisen, dass
irgendetwas ankam.

## Zwei Fehler, die erst der Betrieb sichtbar macht

**Eine abgestürzte Zustellung blieb für immer `in_flight`.** Der Claim der
Webhook-Outbox holte nur `pending`-Zeilen und gab abgelaufene Leases nie frei.
Project Queues tun das an genau derselben Stelle seit Langem; bei den Webhooks
fehlte es. Es fiel nicht auf, weil niemand zustellte — erst mit einem
Zustellprozess kann ein Prozess mitten in einem Versuch sterben.

**Ein abgeschalteter Webhook lief weiter.** Seine Zustellungen wurden geholt,
scheiterten beim Settlement und verbrannten Versuche bis zum Dead Letter.
Abschalten heißt für einen Betreiber aber *pausieren*. Der Claim übergeht jetzt
Zustellungen abgeschalteter Definitionen; nach dem Wiedereinschalten laufen
dieselben Zustellungen weiter.

Beides sind Korrekturen an Release 1.19, nicht neue Funktionen.

## Die Mutationsprobe

Beide Garantien waren im ersten Zertifizierungslauf sofort grün. Angesichts der
Fehlerdichte dieses Sprints war das eher verdächtig als beruhigend: Release 1.16
hatte drei Fälle gefunden, die *ausgeführt und zufällig grün* waren.

Deshalb habe ich beide Garantien im Adapter abgeschaltet und den Stack erneut
laufen lassen. Ergebnis: **genau die zwei zugehörigen Fälle fallen um, kein
anderer.** Das Protokoll liegt als `compute-chain-mutation.log` in der Evidenz.

Ein grüner Fall beweist nichts, solange nicht gezeigt ist, dass er auch rot
werden kann.

## Signatur und Transport

Der `WebhookDeliverer` hatte seit Release 1.6 Alpha 4 einen Signatur- und einen
Transportport — und für keinen von beiden je einen Adapter. Beide entstehen hier:

**`HmacWebhookSigner`** signiert `<zeitstempel>.<körper>` mit HMAC-SHA256. Der
Zeitstempel steht *im* signierten Text, nicht nur im Header: Sonst könnte eine
abgefangene Nachricht später erneut gesendet werden und die Signatur bliebe
gültig. Jeder Schlüssel trägt eine `keyId`, damit ein Empfänger während einer
Rotation beide Schlüssel kennen kann, ohne raten zu müssen.

**`FetchWebhookTransport`** liest den Antwortkörper des Empfängers **nie**. Er
kommt von einem fremden System, kann beliebig groß sein und trüge nichts bei:
Die Bestätigung steht im zurückgespiegelten Header `x-qkern-delivery-id`. Ein
Empfänger, der nicht oder falsch bestätigt, gilt als Fehlschlag — sonst würde
eine Zustellung abgehakt, weil irgendein Proxy mit 200 geantwortet hat.
Weiterleitungen sind ausgeschlossen; eine Umleitung würde die signierte Nachricht
an ein Ziel tragen, das der Betreiber nie eingetragen hat.

## Ohne Schlüssel wird nicht zugestellt

`workers/compute-runtime.ts` startet nicht, wenn kein Signaturschlüssel
erreichbar ist. Ein Zusteller, der stillschweigend unsigniert sendet, wäre
schlimmer als einer, der gar nicht startet: Der Empfänger könnte dann nicht mehr
unterscheiden, ob eine Nachricht wirklich von hier kommt.

Der einzige Provider in diesem Release liest die Schlüssel aus der Umgebung, ist
ausdrücklich freizuschalten und **in der Produktion abgewiesen** — ein
Signaturgeheimnis in einer Umgebungsvariable steht in jedem Prozessabbild und in
jeder Container-Definition. Der Vault-gestützte Provider bleibt offen.

## Welche Projekte der Prozess bedient

Bewusst ausdrücklich statt entdeckt: `QKERN_COMPUTE_SCOPES_JSON` listet die
Scopes. Die Runtime-Rolle sieht durch RLS nur die eigene Organisation; eine
organisationsübergreifende Suche nach fälliger Arbeit ginge nur mit einer Rolle,
die alles sieht. Diese Rolle für einen Dauerprozess einzuführen ist eine größere
Entscheidung, als dieser Schnitt trägt.

```bash
QKERN_COMPUTE_RUNTIME_ENABLED=true npm run worker:compute
```

## Stufenwirkung

**Stufe 1.6 bleibt offen.** Erbracht sind jetzt Idempotenz, Dead Letters, Retry
*und Betrieb* für Queues, Cron und Webhooks. Es fehlt weiterhin die
**Functions-Sandbox**, und mit ihr Egress-Policy, Ressourcenlimits und
Secret-Canary — die drei Teile, die das Austrittskriterium ausdrücklich nennt.

## Ehrlich offen

- Functions-Sandbox: nur Vertragsport, keine Laufzeit
- Kein Vault-gestützter Signaturschlüssel-Provider; nur der Umgebungs-Provider
  für lokale Entwicklung
- Keine API und keine Console-Fläche zum Anlegen von Webhooks oder Cron-Jobs;
  beide entstehen weiterhin nur über direkten Datenbankzugriff
- Keine automatische Entdeckung der zu bedienenden Scopes
- Kein startbarer Handler-Host für Queues
- Kein Scheduler für die beiden Realtime-`prune`-Pfade
- Der Zustellprozess ist gegen echtes PostgreSQL zertifiziert, aber noch nie
  gegen einen echten HTTPS-Empfänger gelaufen; der Transport ist nur mit einem
  eingespeisten `fetch` geprüft
