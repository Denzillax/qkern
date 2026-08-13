# Release 1.55.0 — Auch das Nein wird gemeldet

## Was 1.54 offen liess

> **Der Fall belegt eine gelungene Zustellung.** Dass der Prozess einen
> **Fehlschlag** meldet, ist verdrahtet und ungeprüft — der Empfänger antwortet
> in diesem Fall nicht falsch.

## Der Empfänger sagt Nein

`/hooks/no-echo` antwortet mit 200, ohne die Zustell-Id zu spiegeln. Für den
Zusteller ist das ein Fehlschlag — die Bestätigung fehlt, also gilt die Nachricht
nicht als angekommen.

Der Fall definiert einen Webhook mit genau **einem** Versuch, startet
`npm run worker:compute` und sieht danach zweimal nach:

- Die Zustellung liegt im Dead Letter.
- Der Prozess hat `compute.webhook_failed` mit festem Code gemeldet.

Ein Versuch statt drei, weil dieser Fall die **Meldung** misst und nicht die
Geduld des Wiederholens — die ist eigens zertifiziert.

Gemeldet wird ein fester Code, kein Endpunkt und keine Antwort des Empfängers.
Der Fall prüft das mit.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Der Fehlerhaken meldet nichts mehr | 11 von 12 — genau der neue Fall |

## Belege

| Lauf | Manifest |
| --- | --- |
| Empfänger 12/12, exit 0 | `docs/evidence/2026-08-08/webhook-refused-run1.manifest.json` |
| Empfänger 12/12, exit 0 | `docs/evidence/2026-08-08/webhook-refused-run2.manifest.json` |
| Mutation Fehlerhaken 11/12 | `docs/evidence/2026-08-08/webhook-refused-mutation.manifest.json` |

Lokal: 1023 bestanden, 0 fehlgeschlagen. PostgreSQL und Functions unverändert.

## Ehrlich offen

- **Belegt sind Erfolg und Fehlschlag einer Zustellung.** Was der Prozess
  zwischen erstem Versuch und Dead Letter meldet, sieht dieser Fall nicht — er
  lässt nur einen Versuch zu.
- **Die Ereignisse tragen weiterhin keinen Zeitbezug.**
- **Vier Prozesse haben weiterhin keinen Arbeitsnachweis**: Realtime, beide
  Publisher und der Provisioner. Das ist seit sieben Releases die grösste
  verbliebene Lücke dieser Reihe.
