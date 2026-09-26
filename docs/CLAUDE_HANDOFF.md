# QKERN Übergabe an Claude oder einen anderen Coding-Agenten

Diese Datei ist der chatunabhängige Einstiegspunkt für `2.29.0`. Sie wird
bei jedem versionierten Stand zusammen mit Quellcode, Status, Handbuch und Release
Note aktualisiert.

## Wichtigster Kontext für den nächsten Agenten

Bis `1.8.0-alpha.1` war **kein einziger Real-Service-Test jemals ausgeführt
worden**. Release 1.9 hat beide Docker-Zertifizierungsstacks zum Laufen gebracht
und dabei fünf Produktfehler gefunden, die nur unter einer realen Datenbank
auftreten. Zwei davon machten einen als fertig dokumentierten Pfad vollständig
funktionsunfähig.

Die Lehre daraus gilt weiter: **Ein grüner `npm test` ist keine Zertifizierung.**
Die Memory-Adapter kennen weder Rechtemodell noch RLS noch Transaktionsgrenze.
Wer einen dauerhaften Adapter anfasst, muss `npm run test:postgres:docker`
ausführen, bevor er ihn als funktionsfähig beschreibt.

## Verbindliche Lesereihenfolge

1. `AGENTS.md`
2. `STATUS.md`
3. `docs/CLAUDE_HANDOFF.md`
4. `docs/STUFENPLAN.md`
5. `docs/HANDBUCH.md`
6. `docs/USAGE_METERING.md`
7. `docs/PROJECT_QUEUES.md`
8. `docs/MODULES.md`
9. `docs/SECURITY.md`
10. `docs/QA.md`
11. `docs/SDK_TYPESCRIPT.md`
12. `docs/CLI.md`
13. `docs/DEVELOPER_EXPERIENCE.md`
14. `docs/RELEASE_1.9.md` und `docs/RELEASE_1.10.md`

Für Realtime-Arbeit zusätzlich `docs/REALTIME_PROTOCOL.md` lesen. Historische
Release Notes bleiben unverändert.

## Aktueller technischer Stand

### Laufende Arbeit: Einstiegsdoku (Stand 26. September 2026, frueh)

Spec `docs/superpowers/specs/2026-09-25-documentation-design.md`, Plan
`docs/superpowers/plans/2026-09-25-documentation.md` (13 Aufgaben, Weg 1:
Markdown im Repo, eigener Renderer, Route `/docs`). Umsetzung mit
Unteragenten, je Aufgabe Spec-Pruefung und Code-Review.

- Abgenommen und gepusht: Aufgaben 1 bis 10 und 12. Dev-Compose mit
  `project_database`, Bindungsskript, `lib/docs/*` (Seitenliste, Parser,
  Platzhalter, Laden, Links), Route `/docs` mit Seitenleiste und
  Kopieren-Knopf, Links in Konsole und Kopfmenue, die fuenf deutschen Seiten
  unter `docs/guide/de/` (Humanizer-Durchgang gemacht), drei Vertragstests
  (`tests/docs-*`), Handbuch-Verweis, INDEX-Block, DOCS_MAINTENANCE-Abschnitt,
  SDK-README. Volle Suite 1236 bestanden, CI gruen.
- Offen, Aufgabe 11: der gemessene Schnellstart-Durchlauf in einem frischen
  Ordner. Braucht Denzils Registrierung im Wegwerfstack (Konten legt der
  Agent nicht an). Danach Zeit in `SCHNELLSTART.md` und
  `ERSTES_BACKEND.md` eintragen, Log und Manifest unter `docs/evidence/`.
- Offen, Aufgabe 13: Release 2.30 "Drei Tueren" nach dem Muster der
  bisherigen Sweeps (Suite zweimal, Mutation am Glossar, Build, Docs).
- Offen, Denzils Entscheidung: das Kopfmenue hat mit "Dokumentation" sieben
  Eintraege und bricht bei mittlerer Breite um ("Offene Punkte" zweizeilig);
  Vorschlag: `white-space: nowrap`, kleinerer Abstand, Hamburger frueher,
  oder "Entwickler" aus dem Kopfmenue nehmen. Dazu die Scrollbar der
  Doku-Seitenleiste schmal stylen.
- Offen, Denzils Entscheidung: Repository privat lassen (Schnellstart sagt
  "Zip oder git clone") oder oeffentlich.

## Ehrlich offene Arbeit

- konkreter startbarer Handler-Host/Consumer-Vertrag und Sandbox;
- externer Queue-Metrics-Exporter, Tracing, Alerting und Capacity-Grenzen;
- archivierte Real-PostgreSQL-Multi-Instance-, Crash-, Cleanup-, Soak- und Lastläufe;
- Functions-Sandbox, Cron, Webhook Delivery, Vault-Secret-Injektion;
- Egress-/Ressourcenlimits und unabhängige Security-Zertifizierung.
- persistente Compute-Definitionen, Cron-Leases/Catch-up, Webhook-Outbox,
  DNS/IP-Pinning und konkrete Production-Sandbox;
- reale archivierte Windows-/macOS-DX-Läufe, Upgrade-E2E, Registry-Publishing,
  Paket-Signatur/Provenance und Browser-/Bundler-Matrix;
- transaktionale, idempotente Usage-Emitter in allen Produktmodulen und ein
  Reconciliation-/Retention-/Export-Vertrag;
- archivierte Usage-Multi-Instance-/Crash-/Soak-/Last-Races, Metrics und Alerts;
- Tarife, Preisversionen, Credits, Rechnungen, Steuern, Payments und Provider-
  Abgleich; Alpha 1 ist ausdrücklich kein Billing;

Auch die offenen Live-Gates aus 1.3 bis 1.5 bleiben bestehen. Docker, Podman,
`postgres` und `psql` waren in dieser Arbeitsumgebung nicht verfügbar.

## Nächster bounded Slice

`1.21.0`: Flaechen fuer Definitionen. Cron und Webhooks laufen seit 1.20 in
einem startbaren Prozess, aber eine Definition entsteht weiterhin nur ueber
direkten Datenbankzugriff. Es fehlen REST-Endpunkte und eine Console-Flaeche
fuer beide Definitionsarten sowie ein Vault-gestuetzter Provider fuer
Signaturschluessel -- der einzige heutige Provider liest sie aus der Umgebung
und ist in Produktion abgewiesen.

Ebenfalls offen und kleiner: die automatische Entdeckung der zu bedienenden
Scopes (heute `QKERN_COMPUTE_SCOPES_JSON`; eine Suche ueber alle Organisationen
braucht eine Rolle, die RLS nicht einschraenkt), ein Scheduler fuer die beiden
Realtime-`prune`-Pfade und ein gemeinsamer Katalog, damit Generated Data API und
Realtime-Changes nicht je einen eigenen Pool zu denselben Projektdatenbanken
oeffnen.

Danach schliesst nur noch die **Functions-Sandbox** die Stufe 1.6. Sie ist der
groesste verbleibende Brocken, weil sie echte Prozessisolation, Ressourcenlimits
und Egress-Kontrolle verlangt -- und genau diese drei nennt das
Austrittskriterium ausdruecklich. Offene Adapter stehen in
`docs/COMPUTE_CONTRACTS.md`.

## Zwei Muster, die mehrfach aufgetreten sind

**Gebaut, zertifiziert -- und trotzdem wirkungslos, weil niemand es aufruft.**
Release 1.14 fand den Poller, den kein Prozess rief. 1.15 fand, dass die
Realtime-Runtime weiterhin den Memory-Log verwendete, obwohl der dauerhafte
Adapter seit 1.11 zertifiziert war. Beim Anfassen eines Moduls lohnt die Frage:
Ruft der Betrieb das ueberhaupt auf?

**Der Gegenprobe trauen, nicht dem gruenen Haken.** Release 1.20 hat zwei neue
Garantien zertifiziert, die im ersten Lauf sofort gruen waren. Statt das zu
glauben, wurden beide im Adapter einzeln abgeschaltet und der Stack erneut
ausgefuehrt: Genau die zwei zugehoerigen Faelle fielen um, kein anderer. Wer
eine neue Garantie zertifiziert, sollte einmal zeigen, dass ihr Test auch rot
werden kann -- der Lauf dauert Minuten und beantwortet die Frage endgueltig.

**Ausgefuehrt und zufaellig gruen.** Release 1.16 fand drei Wettlaeufe im
gemeinsamen Testaufbau, die seit 1.13 latent waren: Rolle, Schema und Feed
werden von parallel laufenden Integrationstests angelegt, und jedes
`IF NOT EXISTS` davor ist ein Check-dann-Erzeuge ohne Atomaritaet. Die Laeufe zu
1.13 bis 1.15 waren gruen, ohne dass der Aufbau deterministisch war. Ein gruener
Lauf beweist nicht, dass der Aufbau deterministisch ist.

## Sichere Arbeitsregeln

- Keine Organisation, Actor-, User-, Projekt- oder Environment-Identität aus
  Request-Behauptungen übernehmen.
- Keine Keys, Dedupe-Schlüssel, Lease-Tokens, Worker-IDs oder Payloads loggen.
- Worker-Lease-Operationen nicht in MCP oder einen Admin-Bypass übernehmen.
- Retry, Attempt-Limit und Dead-Letter-Status bleiben Serverautorität.
- `ephemeral` niemals als `durable` deklarieren.
- Usage-Idempotency Keys niemals roh speichern oder loggen; Hard-Quota,
  Counter und Evententscheidung müssen atomar bleiben.
- Keine öffentliche Event-Ingestion oder Browser-/MCP-Quota-Mutation ergänzen.
- `usage_events` bleibt append-only. Der Export aus `1.41.0` ersetzt keine
  Aufbewahrung: Ein gelöschtes Ereignis heisst, dass derselbe Schlüssel später
  erneut zählt. Cursor niemals über einen Typ führen, der den Wert der
  Datenbank abschneidet.
- Usage-Zähler nicht als Rechnung darstellen, solange Tarife/Reconciliation fehlen.
- Service Role ist kein PostgreSQL-/RLS-Privilegien-Bypass.
- Historische `docs/RELEASE_*.md` niemals nachträglich ändern.
- Niemals dauerhaft `GRANT qkern_ledger_owner TO …` in einem Test: Die Rolle
  ist clusterweit, und der Migrationszaun verlangt sie ohne jede
  Mitgliedschaft. Ein Grant macht jede Migration im ganzen Lauf unmöglich.
- Worker-Einstiege heissen `.mts`. Ohne `"type": "module"` uebersetzt tsx
  jede `.ts` als CommonJS, und Top-Level-await bricht den Start ab, bevor eine
  eigene Zeile laeuft. Bis `1.44.0` konnte deshalb kein einziger der sieben
  Prozesse starten.

## Pflichtprüfung und Checkpoint

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run verify:dx:full
npm audit --omit=dev --audit-level=moderate
npm run test:postgres:docker
npm run test:storage:docker
```

Ohne Docker die letzten beiden Läufe ausdrücklich als nicht ausgeführt markieren.
Danach ein neues `QKERN_Source_v*.zip` ohne `node_modules`, `.next`, `.git`,
Coverage, Build-Cache und lokale `.env*` erzeugen und versioniert speichern.
