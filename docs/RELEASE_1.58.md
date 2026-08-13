# Release 1.58.0 — Der sechste Prozess, und eine widerlegte Annahme

## Die Annahme

Release 1.56 und 1.57 haben beide festgehalten:

> Der Apply-Publisher braucht einen Broker, den es im Stack nicht gibt.

Das war eine **Annahme**, kein Hindernis. Ich hatte den Namen gelesen und nicht
den Code.

## Der „Broker" ist eine HTTPS-Gegenstelle

Mit genau demselben Format wie beim Incident-Publisher: `v1=<hex>` als Signatur,
Schlüsselkennung im eigenen Header, Bestätigung mit genau der gesendeten
Kennung.

Derselbe Empfänger genügt. Er bekommt nur einen zweiten Pfad — dieselbe Prüfung,
weil es dieselbe Zusage ist, aber getrennt, damit beide Fälle unabhängig
voneinander fallen können.

Der Fall lief beim ersten Anlauf grün. Nach sechs Prozessen ist das Muster
eingeübt: Fixture in die Control Plane, Prozess starten, Zustand in der Datenbank
abwarten, Redaktion mitprüfen.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Der Empfänger kennt `/apply` nicht mehr | 13 von 14 — genau der neue Fall |

## Belege

| Lauf | Manifest |
| --- | --- |
| Empfänger 14/14, exit 0 | `docs/evidence/2026-08-08/apply-process-run1.manifest.json` |
| Empfänger 14/14, exit 0 | `docs/evidence/2026-08-08/apply-process-run2.manifest.json` |
| Mutation Pfad 13/14 | `docs/evidence/2026-08-08/apply-process-mutation.manifest.json` |

Lokal: 1023 bestanden, 0 fehlgeschlagen.

## Sechs von sieben

| Prozess | Belegt seit |
| --- | --- |
| Queue-Wirt | `1.44.0` |
| Compute | `1.45.0` |
| Migrationen | `1.49.0` |
| Incident-Publisher | `1.56.0` |
| Realtime | `1.57.0` |
| Apply-Publisher | `1.58.0` |
| **Provisioner** | **offen** |

## Ehrlich offen

- **Der Provisioner bleibt.** Er legt Datenbanken an und braucht dafür einen
  Vault-Weg, den der Stack nicht hat. Das ist diesmal keine Annahme: Die
  Komposition verlangt in Produktion ausdrücklich einen vault-gestützten Katalog,
  und der lokale Weg deckt nicht dasselbe ab.
- **Belegt ist die gelungene Veröffentlichung.** Wiederholung und Dead Letter des
  Apply-Outbox sind gegen echtes PostgreSQL zertifiziert, aber nicht durch diesen
  Prozess.
- **Zwei Prozesse teilen sich eine Gegenstelle.** Im Betrieb wären es zwei
  verschiedene Systeme; dass beide dasselbe Format sprechen, ist hier bequem und
  dort kein Versprechen.
