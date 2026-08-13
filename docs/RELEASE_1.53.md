# Release 1.53.0 — Der Compute-Prozess meldet jetzt auch

## Was 1.52 offen liess

> **Der Compute-Prozess hat weiterhin keine Logger-Naht.** Seine Komposition
> bietet keine an, und der Vertrag kann nur einfordern, was angeboten wird.

## Die Naht musste erst entstehen

Anders als beim Queue-Wirt gab es hier nichts durchzureichen. Beide Bausteine
darunter hatten nur Fehler-Haken — `onError` beim Scheduler, `onFailure` beim
Zusteller — und keinen Ereignisstrom.

```json
{"event":"compute.cron_round","scopeIndex":0,"dispatched":3,"failures":0}
{"event":"compute.webhook_failed","scopeIndex":0,"failureCode":"…"}
```

**Ein Index statt einer Id.** Die Startzeile des Prozesses nennt seit jeher nur
die Zahl der Scopes, und dabei bleibt es. Der Index zeigt in
`QKERN_COMPUTE_SCOPES_JSON`, die der Betreiber selbst gesetzt hat: Für ihn ist er
auflösbar, für jeden anderen bedeutungslos. Dazu die Zahl der ausgelösten
Vorkommen und feste Failure Codes — keine Endpunkte, keine Datenbankmeldungen.

**Gemeldet wird nur, was geschehen ist.** Eine Runde ohne fälliges Vorkommen
schweigt. Sonst schriebe der Prozess im Standardtakt alle 30 Sekunden je Scope
eine Zeile über nichts, und ein Log, in dem Leerlauf überwiegt, ist so wenig
lesbar wie gar keines.

## Der Umweg

Der Fall war beim ersten Anlauf flaky, und der Fehler war meiner: Die Nachricht
steht in der Datenbank, **bevor** die Runde zu Ende ist. Wer sofort nach der
Meldung sieht, misst den Wettlauf statt die Zusage. Gewartet wird jetzt auf die
Meldung, mit eigener Frist.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Die Cron-Schleife meldet ihre Runde nicht mehr | 122 von 123 — genau der Prozess-Fall |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 123/123, exit 0 | `docs/evidence/2026-08-08/compute-logger-run1.manifest.json` |
| PostgreSQL 123/123, exit 0 | `docs/evidence/2026-08-08/compute-logger-run2.manifest.json` |
| Mutation Rundenmeldung 122/123 | `docs/evidence/2026-08-08/compute-logger-mutation.manifest.json` |

Lokal: 1023 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Der Webhook-Zweig meldet seinen Fehlschlag — verdrahtet, nicht zertifiziert.**
  Dieser Lauf schaltet die Zustellung aus, weil sie einen Signaturschlüssel
  verlangt.
- **Eine gelungene Zustellung meldet weiterhin niemand.** Der Zusteller bietet
  dafür keinen Haken; einen zu bauen wäre eine eigene Scheibe.
- **Der Scope-Index ist nur mit der Konfiguration lesbar.** Wer das Log ohne
  `QKERN_COMPUTE_SCOPES_JSON` liest, weiss nicht, welches Projekt gemeint ist —
  das ist Absicht und trotzdem eine Hürde.
- **Vier Prozesse haben weiterhin keinen Arbeitsnachweis**: Realtime, beide
  Publisher und der Provisioner.
