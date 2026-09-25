# Release 2.17.0 – Hilfe, die antwortet

`@qkern/sdk` und `@qkern/cli` sind auf npm, Version 1.7.0-alpha.3, Tag
`alpha`, Apache 2.0. Der erste Versuch fiel: npm nimmt einen
Herkunftsnachweis nur aus oeffentlichen Repositories an. Der zweite Lauf
ohne Nachweis kam durch.

## Der Fehler

Installation in ein leeres Projekt, dann `npx qkern --help`: "QKERN CLI
command failed." Der Einstieg warf jede Fehlermeldung weg, auch die
Nutzung. Wer die CLI zum ersten Mal startet, sah nur einen Fehlschlag.

Jetzt: `help`, `--help`, `-h` und der leere Aufruf zeigen die Nutzung mit
Exit 0. Ein unbekannter oder halber Befehl zeigt sie auf stderr mit Exit 1,
noch bevor die Konfiguration gelesen wird. Jeder andere Fehler nennt seinen
Grund. Die CLI steht auf 1.7.0-alpha.4, das SDK bleibt bei alpha.3.

## Belege

| Lauf | Manifest |
| --- | --- |
| npm publish alpha.3, beide Pakete | `docs/evidence/2026-09-25/github-publish-36165870744.json` |
| Mutation 1/3 faellt, exit 1 | `docs/evidence/2026-09-25/cli-usage-mutation.manifest.json` |
| Vitest lokal 1122/1122, exit 0 | `docs/evidence/2026-09-25/cli-usage-local-run1.manifest.json` |
| Vitest lokal 1122/1122, exit 0 | `docs/evidence/2026-09-25/cli-usage-local-run2.manifest.json` |

`next build` gruen, Tarballs geprueft.

## Ehrlich offen

- **alpha.4 wird nach diesem Commit veroeffentlicht.** Der Nachtrag folgt.
- **`latest` zeigt auf die Alpha.** npm setzt es bei der ersten Version
  automatisch; ein `npm install @qkern/sdk` ohne Tag holt die Alpha.
- **Kein Herkunftsnachweis**, solange das Repository privat ist.
