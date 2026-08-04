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
