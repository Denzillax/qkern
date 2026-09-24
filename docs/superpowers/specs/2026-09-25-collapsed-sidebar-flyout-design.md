# Flyout für Untermenüs in der eingeklappten Sidebar

Entwurf vom 25. September 2026, mit Denzil im Brainstorming abgestimmt.
Gewählt: Variante A (Flyout am Icon) gegen B (zweite Spalte) und C (kurz
aufklappen).

## Verhalten

In der eingeklappten Sidebar (70 px, ab 761 px Fensterbreite) bekommt jedes
Gruppen-Icon mit Unterpunkten ein Flyout. Es öffnet nach 150 ms Hover oder
sofort per Klick. Es zeigt oben den Gruppennamen, darunter die Unterpunkte
mit dem grünen (echte Ansicht) oder grauen (Platzhalter) Punkt; der aktive
Unterpunkt ist markiert.

Es schliesst bei Klick auf einen Unterpunkt (und wechselt die Ansicht),
bei Escape, bei Klick ausserhalb, und 250 ms nachdem die Maus Icon und
Flyout verlassen hat (Gnadenfrist für den diagonalen Weg).

Gruppen ohne Unterpunkte (Übersicht, Table Editor, API, AI Bridge,
KI-Aktivität, Freigabezentrale, Nutzung & Limits) wechseln per Klick direkt
und zeigen beim Hover nur den Namen als `title`.

Auf dem Telefon (bis 760 px) ist die Sidebar eine Schublade; dort ändert
sich nichts, das Untermenü bleibt inline.

## Platzierung

Rechts neben dem Icon, oben bündig, 220 px breit, dunkler Sidebar-Stil,
Schatten wie die bisherigen Menüs. Höchstens Fensterhöhe minus 24 px; bei
langen Gruppen (Auth: 16 Einträge) scrollt es innen. Steht das Icon so weit
unten, dass das Flyout aus dem Fenster ragen würde, verschiebt es sich nach
oben.

## Aufbau

- `components/console/sidebar-flyout.tsx`: Client-Bauteil je Gruppe mit
  Icon-Button und Flyout. Eigener Zustand (offen/zu), Timer für Hover und
  Gnadenfrist, Escape und Klick ausserhalb wie beim Umgebungsmenü,
  Positionierung über `getBoundingClientRect` des Icons und `position:
  fixed`. Beschriftungen über `t()`.
- `console-app.tsx`: im eingeklappten Zustand rendert die Sidebar dieses
  Bauteil für Gruppen mit Unterpunkten, sonst den bisherigen Button; im
  ausgeklappten Zustand alles wie bisher.
- Barrierefreiheit: Icon-Button mit `aria-haspopup="menu"` und
  `aria-expanded`; Flyout `role="menu"`, Einträge `role="menuitem"`,
  Pfeiltasten hoch/runter bewegen den Fokus, Escape schliesst.

## Tests

- Vertrag `tests/console-flyout-contract.test.ts`: aus `NAV` abgeleitet
  hat jede Gruppe mit Unterpunkten mindestens einen Eintrag im Flyout, keine
  Gruppe ohne Unterpunkte eines; die Gnadenfrist und die Hover-Verzögerung
  stehen als benannte Konstanten im Bauteil und sind exportiert.
- Sichtprüfung im Browser bei 1280 px: Hover öffnet nach Verzögerung, Klick
  sofort, Escape schliesst, Auth scrollt, das unterste Icon bleibt im
  Fenster. Bei 375 px kein Flyout.
- Suite zweimal, Release 2.5.
