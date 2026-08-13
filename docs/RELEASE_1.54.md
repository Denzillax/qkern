# Release 1.54.0 — Der Webhook-Zweig, als Prozess

## Was 1.53 offen liess

> **Der Webhook-Zweig meldet seinen Fehlschlag — verdrahtet, nicht zertifiziert.**
> […] **Eine gelungene Zustellung meldet weiterhin niemand.** Der Zusteller
> bietet dafür keinen Haken.

Beides ist geschlossen, und zwar an derselben Stelle.

## Im Empfänger-Stack

Seit `1.28.0` steht dort ein echter HTTPS-Server, der den HMAC selbst nachrechnet
— ein Empfänger, der jede Nachricht bestätigt, würde nur belegen, dass
irgendetwas ankam.

Der neue Fall startet `npm run worker:compute` mit eingeschaltetem Zustellzweig
und echtem Signaturschlüssel und sieht danach zweimal nach:

- Die Zustellung steht auf `delivered`.
- Der Prozess hat es gesagt.

## Ein Log, das nur Fehler kennt

…beantwortet die häufigste Frage nicht: **Läuft es?**

```json
{"event":"compute.webhook_delivered","scopeIndex":0}
```

Scope-Index und sonst nichts: kein Endpunkt, kein Geheimnisbezug, keine Id. Der
Fall prüft das ausdrücklich mit.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Der Erfolgshaken meldet nichts mehr | 10 von 11 — die Zustellung kommt weiterhin an, aber niemand erfährt es |

## Belege

| Lauf | Manifest |
| --- | --- |
| Empfänger 11/11, exit 0 | `docs/evidence/2026-08-08/webhook-process-run1.manifest.json` |
| Empfänger 11/11, exit 0 | `docs/evidence/2026-08-08/webhook-process-run2.manifest.json` |
| Mutation Erfolgshaken 10/11 | `docs/evidence/2026-08-08/webhook-process-mutation.manifest.json` |

Lokal: 1023 bestanden, 0 fehlgeschlagen. PostgreSQL und Functions unverändert
gegenüber `1.53.0`.

## Ehrlich offen

- **Der Fall belegt eine gelungene Zustellung.** Dass der Prozess einen
  **Fehlschlag** meldet, ist verdrahtet und ungeprüft — der Empfänger antwortet
  in diesem Fall nicht falsch.
- **Die Ereignisse tragen keinen Zeitbezug.** Wer wissen will, wie lange eine
  Zustellung brauchte, findet es hier nicht.
- **Der Scope-Index bleibt nur mit der Konfiguration lesbar.**
- **Vier Prozesse haben weiterhin keinen Arbeitsnachweis**: Realtime, beide
  Publisher und der Provisioner.
