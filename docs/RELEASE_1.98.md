# Release 1.98.0 — Texte ohne Tells

Die Prosa der Landingpage ist durch den Skill `humanizer` gelaufen, mit dem
deutschen Abschnitt, den Denzil dazu wollte. Zwölf Passagen in
`app/page.tsx`, kein Code, keine Zahlenquelle.

## Was sich geändert hat

Zwei Absätze wiederholten ihre Überschrift und sagen jetzt etwas Eigenes.
Bei den offenen Punkten sagten Eyebrow und Überschrift dasselbe, und der
Absatz darunter inszenierte statt zu berichten; jetzt steht dort, dass
dieselbe Liste jede Release-Notiz beendet. „Preise, die mit dir wachsen"
war Werbeton, jetzt heisst es „Drei Pläne, in Franken." Der Satz mit
sechsmal „echtes" nennt die Dienste einmal. Die Entwurfsnotiz spricht in
Verben. Die Schlussparole „Baue den Kern. Nicht die Infrastruktur." war ein
Nicht-X-sondern-Y; jetzt: „Fang mit dem Kern an."

Behalten: „Ein grüner Testlauf ist keine Zertifizierung." Der Satz
korrigiert etwas, das Leser wirklich glauben.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1096/1096, exit 0 | `docs/evidence/2026-09-24/landing-copy-local-run1.manifest.json` |
| Vitest lokal 1096/1096, exit 0 | `docs/evidence/2026-09-24/landing-copy-local-run2.manifest.json` |

Der Vertrag `landing-numbers-contract` ist grün: keine Zahl kam hinzu,
keine fiel weg. Stacks unverändert.

## Ehrlich offen

- **Login, Registrierung und Console-Texte** sind noch nicht durch den
  Skill gelaufen.
