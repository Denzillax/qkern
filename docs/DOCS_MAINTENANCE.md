# Dokumentationspflege

Dokumentation ist ein Release-Artefakt. Eine Änderung ist nicht fertig, wenn der
ausführbare Vertrag und die zugehörigen Dokumente auseinanderlaufen.

## Bei jeder relevanten Änderung aktualisieren

1. `STATUS.md`: Release, Datum, Teststand, fertig/offen und aktueller Fokus.
2. `docs/STUFENPLAN.md`: Stufenstatus oder Austrittskriterium.
3. `docs/HANDBUCH.md`: Installation, Konfiguration oder Bedienung.
4. `docs/MODULES.md`: neue Modulgrenze oder Abhängigkeit.
5. `lib/openapi.ts` und `.env.example`: öffentlicher Vertrag und Konfiguration.
6. `docs/SECURITY.md` und `docs/QA.md`: neue Trust Boundary und Tests.
7. Eine neue `docs/RELEASE_<VERSION>.md` für jeden Release; historische Notes
   niemals nachträglich als aktuellen Zustand umschreiben.
8. `docs/CLAUDE_HANDOFF.md`: genaue Version, Migrationsstand, Grenzen, offene
   nächste Arbeit und Pflichtprüfungen für eine chatunabhängige Fortsetzung.

## Definition of Done

- Code, Migration, OpenAPI und Handbuch beschreiben denselben Zustand.
- Product Preview und echte Funktion sind klar getrennt.
- Keine Go-live-, Schweiz-, Compliance-, RPO/RTO- oder HA-Behauptung ohne Nachweis.
- `npm run typecheck`, `npm test` und `npm run build` sind grün.
- `tests/documentation-contract.test.ts` bestätigt Version und Pflichtdokumente.
- Ein geprüftes, neues `QKERN_Source_v*.zip` enthält Source und Dokumentation, aber
  keine Dependencies, Build-Ausgaben, lokale `.env*`, Credentials oder Git-Metadaten.

Die Regeln sind zusätzlich in `AGENTS.md` verankert, damit spätere Agenten sie vor
Änderungen sehen.

## Zahlen in `STATUS.md`

Seit Release 1.39 prueft `tests/status-numbers-contract.test.ts` jede
Zertifizierungszahl gegen die archivierten Manifeste unter `docs/evidence/`.
Wer eine solche Zahl aendert, ohne dass ein gruener Lauf sie deckt, bekommt
einen roten Test — nicht erst ein Dutzend Releases spaeter.

Zwei Regeln folgen daraus:

1. **Erst der Lauf, dann die Zahl.** Ein Manifest entsteht mit
   `scripts/certification-manifest.mjs` aus einem echten Rohlog.
2. **Keine Zahl ohne moeglichen Beleg.** Was kein Manifest decken kann, gehoert
   nicht als absolute Zahl in die Releasezustand-Tabelle. Die lokalen
   Vitest-Zahlen stehen deshalb als Checkpoint in `docs/QA.md`.

Kommt ein neuer Zertifizierungsstack dazu, muss seine Zuordnung in der Liste
`CLAIMS` des Tests ergaenzt werden. Fehlt sie, faellt der Vertrag laut aus.

## Einstiegsdoku bei jedem Release prüfen

Die fünf Seiten unter `docs/guide/de/` gehören zum Release-Doc-Sweep:

1. `npx vitest run tests/docs-` muss grün sein; rote Fälle sind Textfehler
   (toter Link, falscher Anker, Glossareintrag ohne drei Zeilen, Sperrwort,
   Kommando, das es nicht gibt).
2. Kommt ein Kommando, ein Klickweg oder ein Begriff dazu, den der Schnellstart
   berührt, wird der Text geändert und der Durchlauf wiederholt
   (`docs/evidence/<datum>/quickstart-walkthrough.manifest.json` mit neuem
   Commit).
3. Neue Fachbegriffe in Code oder Konsole bekommen einen Glossareintrag mit
   den drei Zeilen: Was es ist, In QKERN, Bei Supabase.
4. Zahlen kommen aus Platzhaltern (`lib/docs/placeholders.ts`), nie aus dem
   Text; `{{version}}`, `{{node}}`, `{{postgresCases}}`, `{{stackCount}}`,
   `{{languageCount}}`.
5. Jeder Text für Leser geht durch den Humanizer-Durchgang: kein
   Gedankenstrich, keine Sperrwörter, keine Einzeiler als Schluss.
