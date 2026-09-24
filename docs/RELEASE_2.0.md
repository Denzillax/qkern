# Release 2.0.0 — Das Menü von Supabase

Denzils Auftrag: alles, was Supabase Studio an Menüs hat und QKERN nicht,
als Platzhalter einfügen. Danach wird es Stück für Stück gebaut.

## Die Quelle

Nicht das eingeloggte Dashboard, sondern das Routen-Verzeichnis von
Supabase Studio: `apps/studio/pages/project/[ref]` im Repo
supabase/supabase, am 24. September 2026 über den GitHub-Tree gelesen. 18
Verzeichnisse, rund 90 Seiten. Studio steht unter Apache 2.0 und lässt sich
selbst betreiben, ist aber an den Supabase-Stack gebunden; als Vorlage ist
es frei.

## Was die Console jetzt hat

19 Gruppen, 12 davon mit Untermenü. 15 echte Ansichten bleiben, 83
Platzhalter kommen dazu. Jeder Platzhalter sagt drei Dinge: wie die Seite
bei Supabase heisst, ob QKERN das Backend hat (vorhanden, teilweise, fehlt)
und was fehlt. Queues, Migrationen, Realtime-Inspector und
Function-Aufrufe haben ein zertifiziertes Backend und brauchen nur die
Ansicht. Trigger, Enum-Typen, Passkeys, Wrappers oder Replikation haben
gar nichts. Die Platzhalterseite zeigt die Nachbarn der Gruppe; die Suche
findet alle Einträge.

## Der Vertrag

`tests/console-navigation-contract.test.ts`: jedes Studio-Verzeichnis hat
eine QKERN-Gruppe, jede Ansicht steht genau einmal, jede Erklärung hat
mindestens 40 Zeichen. Beim ersten Lauf fand er Backups doppelt und zehn
Erklärungen ohne Inhalt.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1100/1100, exit 0 | `docs/evidence/2026-09-24/supabase-menu-local-run1.manifest.json` |
| Vitest lokal 1100/1100, exit 0 | `docs/evidence/2026-09-24/supabase-menu-local-run2.manifest.json` |

Im Browser in der angemeldeten Session geprüft. Stacks unverändert.

## Ehrlich offen

- **83 Platzhalter sind 83 offene Ansichten.** Das Backend-Urteil sagt, wo
  es schnell geht; die Reihenfolge ist Denzils Entscheidung.
- **Die Liste ist ein Stand vom 24. September 2026.** Studio wächst; der
  Vertrag kennt nur die Verzeichnisse von diesem Tag.
