# Release 2.1.0 — Gruppen, die zugehen

Nutzerbefund direkt nach `2.0`: Die Sidebar-Gruppen liessen sich nicht
schliessen, und bei längeren Namen verschwanden die Pfeile.

## Zwei Ursachen

Der Zustand „geschlossen" war ein leerer String. Ein leerer String ist in
JavaScript falsch, also fiel die Bedingung auf „die aktive Gruppe ist
offen" zurück, und genau die aktive Gruppe ging nie zu. Jetzt hält eine
Menge die offenen Gruppen. Jede lässt sich per Klick auf den Kopf öffnen
und schliessen; die aktive öffnet sich von selbst, wenn die Ansicht
wechselt.

Die Pfeile verschwanden, weil die Beschriftung weder umbrach noch kürzte
und den Pfeil aus der 232 px breiten Leiste schob. Jetzt nimmt der Text
den Platz, der übrig ist, kürzt mit Ellipse, und der Pfeil hat feste
Breite.

## Gemessen

In der angemeldeten Session: alle zwölf Pfeile liegen innerhalb der
Leiste, Datenbank und Functions & Jobs öffnen und schliessen je zweimal.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1100/1100, exit 0 | `docs/evidence/2026-09-24/sidebar-groups-local-run1.manifest.json` |
| Vitest lokal 1100/1100, exit 0 | `docs/evidence/2026-09-24/sidebar-groups-local-run2.manifest.json` |

Stacks unverändert.

## Ehrlich offen

- **Der Zustand der Gruppen wird nicht gemerkt**; nach einem Reload ist nur
  die aktive Gruppe offen.
