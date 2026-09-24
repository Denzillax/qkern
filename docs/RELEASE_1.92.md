# Release 1.92.0 — Schwebende Flächen

Redesign von Landingpage, Konto-Seiten und Console nach der Formensprache
einer Framer-SaaS-Referenz — mit QKERNs Farbe und beiden Modi.

## Die Form

Schwebende Kapsel-Navigation mit weichem Schatten, vollrunde
Bedienelemente, Flächen mit Radius 24 px, Pill-Badges und -Zähler,
pastellene Halos aus dem Markenblau gemischt. Der Hero ist zentriert; unter
ihm steht die Belegtafel als „schwebendes Dashboard", darunter eine
Kennzahlenreihe — beides aus denselben Manifesten wie seit `1.91`.
Feature-Karten tragen pastellene Verläufe, die Methode drei Karten, die AI
Bridge eine gerundete dunkle Tafel, die Preise gerundete Karten mit
hervorgehobenem Pro-Plan, der Abschluss eine blaue Fläche.

## Was gleich bleibt

Das Markenblau `#004dd5` und der Light/Dark-Modus sind unverändert die
Tokens am Anfang von `globals.css`. Die neue Formschicht liegt bewusst am
Ende der Datei und überschreibt ausschliesslich Radien, Schatten, Abstände
und Grössen — nie Farbe. Die Console bekam keine Markup-Änderung: gerundete
Karten, Navigations-Pills, Kapsel-Kopfleiste, und die alten 7–9-px-Texte
sind auf lesbare 10–13 px gewachsen.

## Belegt

Am laufenden Dev-Server in beiden Modi: Hero, Belegtafel, Kennzahlen,
Feature-Karten, Methode, Preise, Anmeldeseite. Lokal 1093/1093, zweimal.

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1093/1093, exit 0 | `docs/evidence/2026-09-24/redesign-local-run1.manifest.json` |
| Vitest lokal 1093/1093, exit 0 | `docs/evidence/2026-09-24/redesign-local-run2.manifest.json` |

Keine eigene Mutationsprobe: Ein Redesign trägt keine neue Zusage; die
Verträge aus `1.91` (keine literalen Zahlen, gleiche Zahlen wie
`STATUS.md`) halten über den Umbau hinweg.

## Ehrlich offen

- **Die Console ist umgestylt, aber nicht bebildert** — sie braucht ein
  Konto, und Konten legt der Agent nicht an. Die Sichtprüfung dort steht aus.
- **Keine Testimonials, keine FAQ** wie in der Referenz: QKERN hat keine
  zitierbaren Kunden, und erfundene Stimmen wären die erste unbelegte
  Zusage der Seite.
